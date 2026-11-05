// SMS opt-outs vs. the Twenty CRM, end to end with the in-memory opt-out sink,
// the test consent ledger and the real Twenty client behind a fake fetch:
//
//   1. a STOP the webhook could not mirror (outage, or no Twenty person yet) is
//      queued and retried by the crm-retry cron;
//   2. a CRM push that runs after a STOP (the cron re-pushing a failed lead or
//      partner) reads the ledger and never writes the number as textable.

import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decideWithRules } from "@/lib/ai/jev";
import { pushLead, pushPartner, type CrmProgress } from "@/lib/crm/twenty";
import { smsConsentEvent, smsConsentLookup } from "@/lib/notify/consent";
import { MAX_OPTOUT_SYNC_ATTEMPTS } from "@/lib/notify/optout-sync";
import { handleTelnyxWebhook, type TelnyxWebhookDeps } from "@/lib/notify/sms/webhook";
import { DAYTIME, makeHarness, type Harness } from "@/lib/notify/testing";
import { FALLBACK_BENCHMARKS } from "@/lib/sizing/assumptions";
import type { Intake } from "@/lib/validation";
import { MAX_ATTEMPTS, runCrmRetry, type CrmPusher, type FailedLeadRow, type FailedPartnerRow, type RetryStore, type RowPatch } from "./retry";
import { rebuildJevFactory } from "./wiring";

const NOW = DAYTIME.getTime();
const PHONE = "+14155550100";

const intake = {
  assetType: "ASSISTED_LIVING",
  transaction: "REFINANCE",
  loanAmount: 3_000_000,
  noi: 400_000,
  unitCount: 60,
  occupancyPct: 88,
  timelineDays: 90,
  nonRecourseOnly: false,
  green: false,
  ownerOperator: true,
  notes: "",
  source: "express",
};
const contact = { firstName: "Pat", lastName: "Lee", email: "pat@example.com", phone: "(415) 555-0100", company: "", consent: true };
const decided = decideWithRules(intake as Intake, FALLBACK_BENCHMARKS);

const leadRow = (): FailedLeadRow => ({
  id: "lead-1",
  contact,
  intake,
  decision: decided.decision,
  rationale: decided.rationale,
  engine: "rules",
  latency_ms: 3,
  crm_attempts: 0,
  crm_last_attempt_at: null,
});
const partnerRow = (): FailedPartnerRow => ({
  id: "partner-1",
  profile: { partnerType: "VENDOR", contact, organization: "Acme Appraisal", services: ["PHASE_I_ESA"], markets: "CA" },
  crm_attempts: 0,
  crm_last_attempt_at: null,
});

class FakeStore implements RetryStore {
  leadPatches: RowPatch[] = [];
  constructor(
    private leads: FailedLeadRow[] = [],
    private partners: FailedPartnerRow[] = [],
  ) {}
  async failedLeads(limit: number) {
    return this.leads.filter((r) => r.crm_attempts < MAX_ATTEMPTS).slice(0, limit);
  }
  async failedPartners(limit: number) {
    return this.partners.filter((r) => r.crm_attempts < MAX_ATTEMPTS).slice(0, limit);
  }
  async updateLead(id: string, patch: RowPatch) {
    this.leadPatches.push(patch);
    this.leads = this.leads.filter((r) => !(r.id === id && patch.crm_error === null));
  }
  async updatePartner(id: string, patch: RowPatch) {
    this.partners = this.partners.filter((r) => !(r.id === id && patch.crm_error === null));
  }
  async saveLeadProgress(_id: string, _progress: CrmProgress) {}
  async savePartnerProgress(_id: string, _progress: CrmProgress) {}
}

/** The Twenty REST API behind the real client. */
function stubTwenty(existingPeople: string[] = []) {
  const bodies: { method: string; object: string; body: Record<string, unknown> }[] = [];
  let seq = 0;
  vi.stubEnv("TWENTY_API_URL", "https://twenty.test");
  vi.stubEnv("TWENTY_API_KEY", "test-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const object = url.pathname.replace(/^\/rest\//, "");
      const method = init?.method ?? "GET";
      if (method === "GET") return Response.json({ data: { [object]: object === "people" ? existingPeople.map((id) => ({ id })) : [] } });
      bodies.push({ method, object, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {} });
      if (method === "PATCH") return Response.json({ data: { updatePerson: { id: object.split("/")[1] } } });
      return Response.json({ data: { [`create${object}`]: { id: `${object}-${++seq}` } } });
    }),
  );
  return { bodies, sent: (object: string) => bodies.filter((b) => b.object === object && b.method === "POST").map((b) => b.body) };
}

const realTwenty: CrmPusher = { pushLead, pushPartner };
const noopCrm: CrmPusher = { pushLead: async () => ({ personId: "p" }), pushPartner: async () => ({}) };
const run = (store: RetryStore, crm: CrmPusher, extra: Partial<Parameters<typeof runCrmRetry>[0]> = {}) =>
  runCrmRetry({ store, crm, rebuildJev: rebuildJevFactory(FALLBACK_BENCHMARKS), now: () => NOW, ...extra });

const revoke = (h: Harness, at = new Date(NOW - 3_600_000)) => h.ledger.record(smsConsentEvent("revoked", { phone: PHONE, now: at, source: "msg_stop" }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a CRM push after a STOP reads the consent ledger", () => {
  it("withholds the revoked number and marks the new person smsOptOut", async () => {
    const twenty = stubTwenty();
    const h = makeHarness();
    // The form had consent; the person texted STOP before the push succeeded.
    h.grant({ phone: PHONE, email: "pat@example.com", at: new Date(NOW - 2 * 3_600_000) });
    await revoke(h);

    const summary = await run(new FakeStore([leadRow()]), realTwenty, { smsConsent: smsConsentLookup(h.consent) });
    expect(summary.leads.succeeded).toBe(1);
    const person = twenty.sent("people")[0]!;
    expect(person.smsOptOut).toBe(true);
    expect(person).not.toHaveProperty("phones");
    expect(JSON.stringify(twenty.bodies)).not.toContain("555-0100");
    expect(String(twenty.sent("opportunities")[0]!.nextStep)).toMatch(/^Email borrower/);
    expect((twenty.sent("notes")[0]!.bodyV2 as { markdown: string }).markdown).toMatch(/texts were revoked/);
  });

  it("keeps the phone when the ledger still shows consent", async () => {
    const twenty = stubTwenty();
    const h = makeHarness();
    h.grant({ phone: PHONE, email: "pat@example.com", at: new Date(NOW - 3_600_000) });
    await run(new FakeStore([leadRow()]), realTwenty, { smsConsent: smsConsentLookup(h.consent) });
    expect(twenty.sent("people")[0]).toMatchObject({ smsOptOut: false, phones: { primaryPhoneNumber: "+14155550100" } });
  });

  it("narrows an existing Twenty person when the number was revoked", async () => {
    const twenty = stubTwenty(["person-9"]);
    const h = makeHarness();
    await revoke(h);
    await run(new FakeStore([leadRow()]), realTwenty, { smsConsent: smsConsentLookup(h.consent) });
    expect(twenty.bodies).toContainEqual({ method: "PATCH", object: "people/person-9", body: { smsOptOut: true } });
  });

  it("applies to partner pushes too", async () => {
    const twenty = stubTwenty();
    const h = makeHarness();
    await revoke(h);
    await run(new FakeStore([], [partnerRow()]), realTwenty, { smsConsent: smsConsentLookup(h.consent) });
    expect(twenty.sent("people")[0]).toMatchObject({ smsOptOut: true });
    expect(twenty.sent("people")[0]).not.toHaveProperty("phones");
  });
});

describe("an opt-out the webhook could not mirror is retried by the cron", () => {
  it("queues a STOP when no Twenty person has the number yet, and syncs it once the person exists", async () => {
    const h = makeHarness();
    h.optOut.people = new Set();
    const res = await handleTelnyxWebhook(signed("STOP", "msg_stop"), webhookDeps(h));
    expect(res.status).toBe(200);
    expect(h.ledger.events.at(-1)?.eventType).toBe("revoked");
    expect([...h.optOutSync.rows.values()]).toEqual([expect.objectContaining({ phone: PHONE, optOut: true, status: "pending", attempts: 0 })]);
    expect(h.store.sms.find((s) => s.direction === "inbound")?.error).toMatch(/queued for retry/);

    // First run: still no person (the lead push has not succeeded yet), so the sync fails and backs off.
    const first = await run(new FakeStore(), noopCrm, { optOuts: { queue: h.optOutSync, sink: h.optOut } });
    expect(first.optOuts).toMatchObject({ candidates: 1, failed: 1, synced: 0 });
    expect(h.optOutSync.rows.get(PHONE)).toMatchObject({ status: "pending", attempts: 1, lastError: expect.stringMatching(/No Twenty person/) });

    // Inside the backoff window nothing is retried.
    const early = await run(new FakeStore(), noopCrm, { now: () => NOW + 60_000, optOuts: { queue: h.optOutSync, sink: h.optOut } });
    expect(early.optOuts).toMatchObject({ deferred: 1, failed: 0 });

    // Later the lead push has created the person: the opt-out lands.
    h.optOut.people = new Set([PHONE]);
    const later = await run(new FakeStore(), noopCrm, { now: () => NOW + 2 * 3_600_000, optOuts: { queue: h.optOutSync, sink: h.optOut } });
    expect(later.optOuts).toMatchObject({ synced: 1 });
    expect(h.optOutSync.rows.get(PHONE)).toMatchObject({ status: "synced" });
    expect(h.optOut.calls.at(-1)).toEqual({ phone: PHONE, optOut: true });
  });

  it("queues a STOP during a Twenty outage; a later START that reaches Twenty settles it so the STOP is never re-applied", async () => {
    const h = makeHarness();
    h.grant({ phone: PHONE, at: new Date(NOW - 86_400_000) });
    h.optOut.failWith = new Error("Twenty 502");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await handleTelnyxWebhook(signed("STOP", "msg_stop"), webhookDeps(h));
    spy.mockRestore();
    expect(h.optOutSync.rows.get(PHONE)).toMatchObject({ optOut: true, status: "pending", lastError: expect.stringMatching(/Twenty sync failed/) });

    h.optOut.failWith = null;
    const later = new Date(NOW + 1000);
    h.clock.now = later;
    await handleTelnyxWebhook(signed("START", "msg_start"), webhookDeps(h, { now: () => later }));
    expect(h.optOutSync.rows.get(PHONE)).toMatchObject({ optOut: false, status: "synced" });
    const summary = await run(new FakeStore(), noopCrm, { optOuts: { queue: h.optOutSync, sink: h.optOut } });
    expect(summary.optOuts).toMatchObject({ candidates: 0 });
    expect(h.optOut.calls.at(-1)).toEqual({ phone: PHONE, optOut: false });
  });

  it("runs after the lead pushes, so a person created on the same run is found", async () => {
    const h = makeHarness();
    h.optOut.people = new Set();
    await h.optOutSync.enqueue({ phone: PHONE, optOut: true, reason: "no person yet", at: new Date(NOW - 3_600_000) });
    const order: string[] = [];
    const crm: CrmPusher = {
      async pushLead() {
        order.push("lead");
        h.optOut.people = new Set([PHONE]);
        return { personId: "person-1" };
      },
      pushPartner: async () => ({}),
    };
    const summary = await run(new FakeStore([leadRow()]), crm, { optOuts: { queue: h.optOutSync, sink: h.optOut } });
    expect(order).toEqual(["lead"]);
    expect(summary.optOuts).toMatchObject({ synced: 1 });
  });

  it("gives up after the attempt cap and says so", async () => {
    const h = makeHarness();
    h.optOut.failWith = new Error("Twenty 500");
    await h.optOutSync.enqueue({ phone: PHONE, optOut: true, reason: "test", at: new Date(NOW) });
    h.optOutSync.rows.get(PHONE)!.attempts = MAX_OPTOUT_SYNC_ATTEMPTS - 1;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const summary = await run(new FakeStore(), noopCrm, { optOuts: { queue: h.optOutSync, sink: h.optOut } });
    spy.mockRestore();
    expect(summary.optOuts).toMatchObject({ failed: 1, exhausted: 1 });
    expect(h.optOutSync.rows.get(PHONE)?.status).toBe("exhausted");
  });
});

// --- Telnyx webhook helpers -------------------------------------------------------------

const keys = generateKeyPairSync("ed25519");
const PUBLIC_KEY_B64 = (keys.publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(-32).toString("base64");

function signed(text: string, id: string): Request {
  const raw = JSON.stringify({
    data: { event_type: "message.received", id: `evt_${id}`, payload: { id, direction: "inbound", text, from: { phone_number: PHONE }, to: [{ phone_number: "+13105550199" }] } },
  });
  const timestamp = String(Math.floor(NOW / 1000));
  const signature = sign(null, Buffer.from(`${timestamp}|${raw}`), keys.privateKey).toString("base64");
  return new Request("https://corincommercial.com/api/webhooks/telnyx", {
    method: "POST",
    headers: { "content-type": "application/json", "telnyx-signature-ed25519": signature, "telnyx-timestamp": timestamp },
    body: raw,
  });
}

function webhookDeps(h: Harness, over: Partial<TelnyxWebhookDeps> = {}): TelnyxWebhookDeps {
  return {
    publicKey: PUBLIC_KEY_B64,
    store: h.store,
    notifier: h.notifier,
    ledger: h.ledger,
    consent: h.consent,
    optOut: h.optOut,
    optOutSync: h.optOutSync,
    staffEmails: [],
    now: () => new Date(NOW),
    ...over,
  };
}
