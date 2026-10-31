import { beforeEach, describe, expect, it } from "vitest";
import { FakeApprovalGate, closedApprovalGate } from "@/lib/compliance/approval-gate";
import { FakeEsignProvider } from "@/lib/esign/fake";
import { gatedCrmSink } from "./deal-record";
import type { DocumentSpec } from "./mlds";
import {
  DisclosureBlockedError,
  applyEsignEvent,
  currentMldsStatus,
  generateMlds,
  holdForCounsel,
  openMldsCase,
  recordUetaConsent,
  releaseFromCounsel,
  retentionDate,
  sendMlds,
  supersedeSigned,
  type SendDeps,
} from "./service";
import { MemoryDisclosureStore, MemoryDocumentStorage } from "./store";
import { sampleMldsInput } from "./test-fixtures";
import { UETA_CONSENT_VERSION } from "./ueta";

const LEAD = "11111111-1111-4111-8111-111111111111";
const OPP = "33333333-3333-4333-8333-333333333333";
let clock = new Date("2026-11-02T18:00:00Z");
const now = () => clock;
const render = async (doc: DocumentSpec) => new TextEncoder().encode(`%PDF-1.4 ${JSON.stringify(doc)}`);

let store: MemoryDisclosureStore;
let storage: MemoryDocumentStorage;
let provider: FakeEsignProvider;
let gate: FakeApprovalGate;
let crmGate: FakeApprovalGate;
let crmWrites: { twentyOpportunityId: string; title: string }[];

function sendDeps(over: Partial<SendDeps> = {}): SendDeps {
  return {
    store,
    provider,
    gate,
    now,
    templateId: "tmpl_mlds",
    brokerSigner: { name: "Neeli Khanna", email: "neeli@kuberacommercial.com" },
    approvedTemplate: true,
    deal: gatedCrmSink(crmGate, async (w) => {
      crmWrites.push(w);
    }),
    ...over,
  };
}

async function openCase() {
  const { record } = await openMldsCase(
    { store, now },
    { leadId: LEAD, twentyOpportunityId: OPP, facts: { kuberaRole: "broker", collateral: { realPropertyLien: true } }, applicationCompletedAt: clock, actor: "staff:neeli" },
  );
  if (!record) throw new Error("expected a record");
  return record;
}

async function generated(approvedTemplate = true) {
  const r = await openCase();
  return (await generateMlds({ store, storage, render, now, approvedTemplate }, r.id, sampleMldsInput, "staff:neeli")).record;
}

async function consentAll(id: string) {
  for (const b of sampleMldsInput.borrowers) {
    await recordUetaConsent({ store, now }, id, { textVersion: UETA_CONSENT_VERSION, consentedAt: clock.toISOString(), email: b.email, ip: "203.0.113.5", userAgent: "vitest" });
  }
}

async function sent() {
  const r = await generated();
  await consentAll(r.id);
  const result = await sendMlds(sendDeps(), r.id, "staff:neeli");
  if (!result.sent) throw new Error("expected send");
  return result.record;
}

beforeEach(() => {
  clock = new Date("2026-11-02T18:00:00Z");
  store = new MemoryDisclosureStore();
  storage = new MemoryDocumentStorage();
  provider = new FakeEsignProvider();
  gate = new FakeApprovalGate("approved");
  crmGate = new FakeApprovalGate("approved");
  crmWrites = [];
});

describe("openMldsCase", () => {
  it("opens a required MLDS with its due date", async () => {
    const r = await openCase();
    expect(r.status).toBe("required");
    expect(r.dueAt).toBe("2026-11-06T07:59:59.999Z");
    expect((await store.events(r.id)).map((e) => e.eventType)).toEqual(["opened"]);
  });

  it("is idempotent per lead", async () => {
    const a = await openCase();
    const b = await openCase();
    expect(b.id).toBe(a.id);
    expect(store.rows.size).toBe(1);
  });

  it("opens nothing when no MLDS is required", async () => {
    const { record, requirement } = await openMldsCase(
      { store, now },
      { leadId: LEAD, facts: { kuberaRole: "broker", collateral: { realPropertyLien: false }, program: "SBA_7A" }, applicationCompletedAt: clock, actor: "staff" },
    );
    expect(record).toBeNull();
    expect(requirement.flags[0]?.code).toBe("cfl_license_review");
  });

  it("opens deals naming Kubera as originator in held_for_counsel", async () => {
    const { record } = await openMldsCase(
      { store, now },
      { leadId: LEAD, facts: { kuberaRole: "broker", collateral: { realPropertyLien: true }, namesKuberaAsOriginator: true }, applicationCompletedAt: clock, actor: "staff" },
    );
    expect(record?.status).toBe("held_for_counsel");
    expect(record?.heldReason).toMatch(/originator/);
  });

  it("requires a deal reference", async () => {
    await expect(openMldsCase({ store, now }, { facts: { kuberaRole: "broker", collateral: { realPropertyLien: true } }, applicationCompletedAt: clock, actor: "x" })).rejects.toThrow(/reference/);
  });
});

describe("generateMlds", () => {
  it("renders, stores the PDF by hash and moves to generated", async () => {
    const r = await generated();
    expect(r.status).toBe("generated");
    expect(r.documentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.documentPath).toBe(`disclosures/${r.id}/mlds-${r.documentSha256?.slice(0, 16)}.pdf`);
    expect(storage.objects.get(r.documentPath as string)?.contentType).toBe("application/pdf");
    expect(r.flags).not.toContain("draft_template");
  });

  it("marks draft templates", async () => {
    const r = await generated(false);
    expect(r.flags).toContain("draft_template");
  });

  it("regenerates before sending", async () => {
    const r = await generated();
    const again = await generateMlds({ store, storage, render, now, approvedTemplate: true }, r.id, { ...sampleMldsInput, preparedOn: "2026-11-03" }, "staff");
    expect(again.record.status).toBe("generated");
    expect(again.record.documentSha256).not.toBe(r.documentSha256);
  });

  it("refuses held and sent disclosures", async () => {
    const s = await sent();
    await expect(generateMlds({ store, storage, render, now }, s.id, sampleMldsInput, "staff")).rejects.toMatchObject({ reason: "invalid_status" });
    const r2 = await openMldsCase({ store, now }, { dealId: "44444444-4444-4444-8444-444444444444", facts: { kuberaRole: "broker", collateral: { realPropertyLien: true }, tableFundedInKuberaName: true }, applicationCompletedAt: clock, actor: "x" });
    await expect(generateMlds({ store, storage, render, now }, r2.record?.id as string, sampleMldsInput, "staff")).rejects.toMatchObject({ reason: "held_for_counsel" });
  });
});

describe("sendMlds", () => {
  it("refuses a draft template", async () => {
    const r = await generated(false);
    await consentAll(r.id);
    await expect(sendMlds(sendDeps({ approvedTemplate: false }), r.id, "staff")).rejects.toMatchObject({ reason: "template_not_approved" });
    expect(gate.requests).toHaveLength(0);
  });

  it("requires UETA consent from every borrower", async () => {
    const r = await generated();
    await recordUetaConsent({ store, now }, r.id, { textVersion: UETA_CONSENT_VERSION, consentedAt: clock.toISOString(), email: "CFO@sunrise.example" });
    await expect(sendMlds(sendDeps(), r.id, "staff")).rejects.toMatchObject({ reason: "ueta_consent_missing", message: expect.stringContaining("priya@sunrise.example") });
  });

  it("rejects unknown consent text versions", async () => {
    const r = await generated();
    await expect(recordUetaConsent({ store, now }, r.id, { textVersion: "made-up", consentedAt: clock.toISOString(), email: "a@b.co" })).rejects.toThrow(/Unknown UETA/);
  });

  it("does not send while the approval is pending, rejected or expired", async () => {
    for (const status of ["pending", "rejected", "expired"] as const) {
      store = new MemoryDisclosureStore();
      gate = new FakeApprovalGate(status);
      const r = await generated();
      await consentAll(r.id);
      const result = await sendMlds(sendDeps(), r.id, "staff");
      expect(result.sent).toBe(false);
      expect(provider.requests.size).toBe(0);
      expect((await store.get(r.id))?.status).toBe("generated");
      expect((await store.events(r.id)).at(-1)?.eventType).toBe(`send_${status}`);
    }
  });

  it("never sends through the default closed gate", async () => {
    const r = await generated();
    await consentAll(r.id);
    const result = await sendMlds(sendDeps({ gate: closedApprovalGate }), r.id, "staff");
    expect(result.sent).toBe(false);
    expect(provider.requests.size).toBe(0);
  });

  it("sends once approved, with borrowers then the broker as signers and prefilled figures", async () => {
    const r = await sent();
    expect(r.status).toBe("sent");
    expect(r.provider).toBe("fake");
    const req = provider.requests.get(r.providerRequestId as string);
    expect(req?.input.templateId).toBe("tmpl_mlds");
    expect(req?.input.recipients.map((x) => x.role)).toEqual(["Borrower 1", "Borrower 2", "Broker"]);
    expect(req?.input.fields.broker_comp_lender).toBe("$42,500.00");
    expect(gate.requests[0]).toMatchObject({ kind: "mlds_send", templateId: "tmpl_mlds", idempotencyKey: expect.stringContaining(`esign_send:${r.id}:`) });
    expect(crmWrites).toEqual([expect.objectContaining({ twentyOpportunityId: OPP, title: "MLDS (RE 882): sent" })]);
  });

  it("is idempotent once sent", async () => {
    const r = await sent();
    const again = await sendMlds(sendDeps(), r.id, "staff");
    expect(again.sent).toBe(true);
    expect(provider.requests.size).toBe(1);
  });

  it("reports a missing provider", async () => {
    const r = await generated();
    await consentAll(r.id);
    await expect(sendMlds(sendDeps({ provider: null }), r.id, "staff")).rejects.toBeInstanceOf(DisclosureBlockedError);
  });
});

describe("applyEsignEvent", () => {
  it("stores the signed copy, sets 3-year retention and records the audit trail", async () => {
    const r = await sent();
    clock = new Date("2026-11-03T19:00:00Z");
    const hook = provider.webhook(r.providerRequestId as string, "completed", { at: new Date("2026-11-03T18:30:00Z") });
    const event = provider.parseWebhook(hook.body);
    if (!event) throw new Error("no event");
    const result = await applyEsignEvent({ store, storage, provider, now, deal: sendDeps().deal }, event);
    expect(result.outcome).toBe("transitioned");
    const row = await store.get(r.id);
    expect(row?.status).toBe("signed");
    expect(row?.signedAt).toBe("2026-11-03T18:30:00.000Z");
    expect(row?.retainUntil).toBe("2029-11-03");
    expect(row?.signedDocumentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(storage.objects.has(row?.signedDocumentPath as string)).toBe(true);
    expect((await store.events(r.id)).map((e) => e.eventType)).toEqual(["opened", "generate", "ueta_consent", "ueta_consent", "send", "esign_completed"]);
    expect(await currentMldsStatus(store, { leadId: LEAD })).toBe("signed");
    expect(crmWrites.map((w) => w.title)).toEqual(["MLDS (RE 882): sent", "MLDS (RE 882): signed"]);
  });

  it("ignores redelivered webhooks", async () => {
    const r = await sent();
    const event = provider.parseWebhook(provider.webhook(r.providerRequestId as string, "completed").body);
    if (!event) throw new Error("no event");
    await applyEsignEvent({ store, storage, provider, now }, event);
    expect((await applyEsignEvent({ store, storage, provider, now }, event)).outcome).toBe("duplicate");
  });

  it("records intermediate events without changing status", async () => {
    const r = await sent();
    const event = provider.parseWebhook(provider.webhook(r.providerRequestId as string, "viewed").body);
    if (!event) throw new Error("no event");
    const result = await applyEsignEvent({ store, storage, provider, now }, event);
    expect(result.outcome).toBe("recorded");
    expect((await store.get(r.id))?.status).toBe("sent");
  });

  it("voids declined requests back to generated and requires a fresh approval to resend", async () => {
    const r = await sent();
    const event = provider.parseWebhook(provider.webhook(r.providerRequestId as string, "declined").body);
    if (!event) throw new Error("no event");
    const result = await applyEsignEvent({ store, storage, provider, now }, event);
    expect(result).toMatchObject({ outcome: "transitioned", from: "sent", to: "generated" });
    const row = await store.get(r.id);
    expect(row?.providerRequestId).toBeNull();
    await sendMlds(sendDeps(), r.id, "staff");
    expect(gate.requests.map((a) => a.idempotencyKey.split(":").at(-1))).toEqual(["1", "2"]);
  });

  it("returns unknown_request for requests it did not send", async () => {
    await sent();
    const other = await provider.createFromTemplate({ templateId: "t", requestName: "x", recipients: [{ role: "Borrower 1", name: "A", email: "a@b.co" }], fields: {}, reference: "x" });
    const event = provider.parseWebhook(provider.webhook(other.requestId, "completed").body);
    if (!event) throw new Error("no event");
    expect((await applyEsignEvent({ store, storage, provider, now }, event)).outcome).toBe("unknown_request");
  });
});

describe("counsel hold and supersede", () => {
  it("holds, blocks sending, then releases to required", async () => {
    const r = await generated();
    const held = await holdForCounsel({ store, now }, r.id, "Lender is an affiliate", "staff:neeli");
    expect(held.status).toBe("held_for_counsel");
    await expect(sendMlds(sendDeps(), r.id, "staff")).rejects.toMatchObject({ reason: "held_for_counsel" });
    const released = await releaseFromCounsel({ store, now }, r.id, "jdoe", "Affiliate is a separate CFL licensee");
    expect(released.status).toBe("required");
    expect(released.heldReason).toBeNull();
  });

  it("supersedes a signed MLDS and opens a new one linked to it", async () => {
    const r = await sent();
    const event = provider.parseWebhook(provider.webhook(r.providerRequestId as string, "completed").body);
    if (!event) throw new Error("no event");
    await applyEsignEvent({ store, storage, provider, now }, event);
    const next = await supersedeSigned({ store, now }, r.id, "Rate changed", "staff");
    expect(next.status).toBe("required");
    expect(next.supersedesId).toBe(r.id);
    expect((await store.get(r.id))?.status).toBe("superseded");
    expect(await currentMldsStatus(store, { leadId: LEAD })).toBe("required");
  });
});

describe("retention date", () => {
  it("is three years after the Pacific signing date", () => {
    expect(retentionDate(new Date("2026-11-03T18:30:00Z"))).toBe("2029-11-03");
    expect(retentionDate(new Date("2027-01-01T05:00:00Z"))).toBe("2029-12-31");
    expect(retentionDate(new Date("2028-02-29T20:00:00Z"))).toBe("2031-03-01");
  });
});
