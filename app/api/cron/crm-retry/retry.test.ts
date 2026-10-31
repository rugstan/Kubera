import { afterEach, describe, expect, it, vi } from "vitest";
import { decideWithRules } from "@/lib/ai/jev";
import { pushLead, pushPartner, type CrmProgress } from "@/lib/crm/twenty";
import { FALLBACK_BENCHMARKS } from "@/lib/sizing/assumptions";
import type { Contact, Intake, PartnerRegistration } from "@/lib/validation";
import {
  BASE_BACKOFF_MS,
  MAX_ATTEMPTS,
  MAX_BACKOFF_MS,
  backoffMs,
  isDue,
  runCrmRetry,
  type CrmPusher,
  type FailedLeadRow,
  type FailedPartnerRow,
  type RetryStore,
  type RowPatch,
} from "./retry";
import { rebuildJevFactory } from "./wiring";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

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
const contact = { firstName: "Pat", lastName: "Lee", email: "pat@example.com", phone: "", company: "", consent: true };
const decided = decideWithRules(intake as Intake, FALLBACK_BENCHMARKS);

function leadRow(over: Partial<FailedLeadRow> = {}): FailedLeadRow {
  return {
    id: "lead-1",
    contact,
    intake,
    decision: decided.decision,
    rationale: decided.rationale,
    engine: "rules",
    latency_ms: 3,
    crm_attempts: 0,
    crm_last_attempt_at: null,
    ...over,
  };
}

const partnerProfile = {
  partnerType: "VENDOR",
  contact,
  organization: "Acme Appraisal",
  services: ["PHASE_I_ESA"],
  markets: "CA",
};
function partnerRow(over: Partial<FailedPartnerRow> = {}): FailedPartnerRow {
  return { id: "partner-1", profile: partnerProfile, crm_attempts: 0, crm_last_attempt_at: null, ...over };
}

class FakeStore implements RetryStore {
  leadUpdates: { id: string; patch: RowPatch }[] = [];
  partnerUpdates: { id: string; patch: RowPatch }[] = [];
  constructor(
    private leads: FailedLeadRow[] = [],
    private partners: FailedPartnerRow[] = [],
  ) {}
  async failedLeads(limit: number) {
    // Mirrors the Supabase query: unresolved rows only, as currently stored.
    return this.leads.filter((r) => r.crm_attempts < MAX_ATTEMPTS && !(r as { done?: boolean }).done).slice(0, limit).map((r) => ({ ...r }));
  }
  async failedPartners(limit: number) {
    return this.partners.filter((r) => r.crm_attempts < MAX_ATTEMPTS && !(r as { done?: boolean }).done).slice(0, limit).map((r) => ({ ...r }));
  }
  async updateLead(id: string, patch: RowPatch) {
    this.leadUpdates.push({ id, patch });
    const row = this.leads.find((r) => r.id === id);
    if (row) Object.assign(row, { crm_attempts: patch.crm_attempts, crm_last_attempt_at: patch.crm_last_attempt_at, done: patch.crm_error === null });
  }
  async updatePartner(id: string, patch: RowPatch) {
    this.partnerUpdates.push({ id, patch });
    const row = this.partners.find((r) => r.id === id);
    if (row) Object.assign(row, { crm_attempts: patch.crm_attempts, crm_last_attempt_at: patch.crm_last_attempt_at, done: patch.crm_error === null });
  }
  async saveLeadProgress(id: string, progress: CrmProgress) {
    const row = this.leads.find((r) => r.id === id);
    if (row) row.crm_progress = progress;
  }
  async savePartnerProgress(id: string, progress: CrmProgress) {
    const row = this.partners.find((r) => r.id === id);
    if (row) row.crm_progress = progress;
  }
}

/**
 * Stands in for the Twenty REST API behind the real client: counts creates per
 * object and can fail a given object a set number of times.
 */
function fakeTwenty() {
  const creates: Record<string, number> = {};
  const failures: Record<string, number> = {};
  const bodies: { method: string; object: string; body: Record<string, unknown> }[] = [];
  let people: { id: string }[] = [];
  let seq = 0;
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const object = url.pathname.replace(/^\/rest\//, "");
    const method = init?.method ?? "GET";
    if (method === "GET") return Response.json({ data: { [object]: object === "people" ? people : [] } });
    bodies.push({ method, object, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {} });
    if (method === "PATCH") return Response.json({ data: { updatePerson: { id: object.split("/")[1] } } });
    if ((failures[object] ?? 0) > 0) {
      failures[object]!--;
      return new Response("upstream timeout", { status: 504 });
    }
    creates[object] = (creates[object] ?? 0) + 1;
    return Response.json({ data: { [`create${object}`]: { id: `${object}-${++seq}` } } });
  });
  const sent = (object: string) => bodies.filter((b) => b.object === object && b.method === "POST").map((b) => b.body);
  const setExistingPeople = (ids: string[]) => {
    people = ids.map((id) => ({ id }));
  };
  return { creates, failures, bodies, sent, setExistingPeople, fetchImpl };
}

class FakeCrm implements CrmPusher {
  leadCalls: { intake: Intake; contact: Contact }[] = [];
  partnerCalls: PartnerRegistration[] = [];
  failLeads = false;
  failPartners = false;
  async pushLead(i: Intake, c: Contact) {
    this.leadCalls.push({ intake: i, contact: c });
    if (this.failLeads) throw new Error("Twenty POST /people: 503");
    return { personId: "person-9", opportunityId: "opp-9" };
  }
  async pushPartner(reg: PartnerRegistration) {
    this.partnerCalls.push(reg);
    if (this.failPartners) throw new Error("Twenty POST /companies: 500");
    return { companyId: "company-9" };
  }
}

const rebuildJev = rebuildJevFactory(FALLBACK_BENCHMARKS);
const realTwenty: CrmPusher = { pushLead, pushPartner };
const run = (store: RetryStore, crm: CrmPusher, extra: Partial<Parameters<typeof runCrmRetry>[0]> = {}) =>
  runCrmRetry({ store, crm, rebuildJev, now: () => NOW, ...extra });

describe("backoff", () => {
  it("doubles from 15 minutes and caps at a day", () => {
    expect(backoffMs(0)).toBe(0);
    expect(backoffMs(1)).toBe(BASE_BACKOFF_MS);
    expect(backoffMs(2)).toBe(2 * BASE_BACKOFF_MS);
    expect(backoffMs(3)).toBe(4 * BASE_BACKOFF_MS);
    expect(backoffMs(20)).toBe(MAX_BACKOFF_MS);
  });

  it("treats never-attempted rows as due and respects the window otherwise", () => {
    expect(isDue({ crm_attempts: 0, crm_last_attempt_at: null }, NOW)).toBe(true);
    expect(isDue({ crm_attempts: 1, crm_last_attempt_at: iso(BASE_BACKOFF_MS - 1_000) }, NOW)).toBe(false);
    expect(isDue({ crm_attempts: 1, crm_last_attempt_at: iso(BASE_BACKOFF_MS) }, NOW)).toBe(true);
    expect(isDue({ crm_attempts: 3, crm_last_attempt_at: iso(2 * BASE_BACKOFF_MS) }, NOW)).toBe(false);
    expect(isDue({ crm_attempts: MAX_ATTEMPTS, crm_last_attempt_at: iso(MAX_BACKOFF_MS * 2) }, NOW)).toBe(false);
    expect(isDue({ crm_attempts: 1, crm_last_attempt_at: "not a date" }, NOW)).toBe(true);
  });
});

describe("runCrmRetry", () => {
  it("re-pushes a failed lead, stores the CRM ids and clears the error", async () => {
    const store = new FakeStore([leadRow()]);
    const crm = new FakeCrm();
    const summary = await run(store, crm);

    expect(crm.leadCalls).toHaveLength(1);
    expect(crm.leadCalls[0]!.contact.email).toBe("pat@example.com");
    expect(summary.leads).toMatchObject({ attempted: 1, succeeded: 1, failed: 0 });
    expect(store.leadUpdates).toEqual([
      {
        id: "lead-1",
        patch: {
          crm_error: null,
          crm_attempts: 1,
          crm_last_attempt_at: new Date(NOW).toISOString(),
          twenty_person_id: "person-9",
          twenty_opportunity_id: "opp-9",
        },
      },
    ]);
  });

  it("re-pushes a failed partner registration", async () => {
    const store = new FakeStore([], [partnerRow()]);
    const crm = new FakeCrm();
    const summary = await run(store, crm);

    expect(crm.partnerCalls).toHaveLength(1);
    expect(crm.partnerCalls[0]).toMatchObject({ partnerType: "VENDOR", organization: "Acme Appraisal" });
    expect(summary.partners).toMatchObject({ attempted: 1, succeeded: 1 });
    expect(store.partnerUpdates[0]!.patch).toMatchObject({ crm_error: null, crm_attempts: 1, twenty_company_id: "company-9" });
  });

  it("records the new error and bumps attempts when Twenty is still down", async () => {
    const store = new FakeStore([leadRow({ crm_attempts: 2, crm_last_attempt_at: iso(BASE_BACKOFF_MS * 4) })], [partnerRow()]);
    const crm = new FakeCrm();
    crm.failLeads = true;
    crm.failPartners = true;
    const summary = await run(store, crm);

    expect(summary.leads).toMatchObject({ attempted: 1, succeeded: 0, failed: 1, exhausted: 0 });
    expect(summary.partners).toMatchObject({ attempted: 1, failed: 1 });
    expect(store.leadUpdates[0]!.patch).toMatchObject({ crm_error: "Twenty POST /people: 503", crm_attempts: 3 });
    expect(store.partnerUpdates[0]!.patch).toMatchObject({ crm_error: "Twenty POST /companies: 500", crm_attempts: 1 });
    expect(store.leadUpdates[0]!.patch).not.toHaveProperty("twenty_person_id");
  });

  it("flags a row as exhausted on its final failed attempt", async () => {
    const store = new FakeStore([leadRow({ crm_attempts: MAX_ATTEMPTS - 1, crm_last_attempt_at: iso(MAX_BACKOFF_MS) })]);
    const crm = new FakeCrm();
    crm.failLeads = true;
    const summary = await run(store, crm);
    expect(summary.leads).toMatchObject({ failed: 1, exhausted: 1 });
    expect(store.leadUpdates[0]!.patch.crm_attempts).toBe(MAX_ATTEMPTS);
  });

  it("skips rows still inside their backoff window without calling the CRM", async () => {
    const store = new FakeStore([leadRow({ crm_attempts: 1, crm_last_attempt_at: iso(60_000) })], [partnerRow({ crm_attempts: 2, crm_last_attempt_at: iso(60_000) })]);
    const crm = new FakeCrm();
    const summary = await run(store, crm);
    expect(crm.leadCalls).toHaveLength(0);
    expect(crm.partnerCalls).toHaveLength(0);
    expect(summary.leads).toMatchObject({ candidates: 1, attempted: 0, deferred: 1 });
    expect(summary.partners).toMatchObject({ candidates: 1, attempted: 0, deferred: 1 });
    expect(store.leadUpdates).toEqual([]);
  });

  it("parks rows whose stored payload no longer validates instead of retrying forever", async () => {
    const store = new FakeStore([leadRow({ contact: { firstName: "No", consent: false } })], [partnerRow({ profile: { partnerType: "LENDER" } })]);
    const crm = new FakeCrm();
    const summary = await run(store, crm);
    expect(crm.leadCalls).toHaveLength(0);
    expect(crm.partnerCalls).toHaveLength(0);
    expect(summary.leads.exhausted).toBe(1);
    expect(summary.partners.exhausted).toBe(1);
    expect(store.leadUpdates[0]!.patch).toMatchObject({ crm_attempts: MAX_ATTEMPTS });
    expect(store.leadUpdates[0]!.patch.crm_error).toMatch(/validation/);
  });

  it("caps work per run and reports that it stopped early", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => leadRow({ id: `lead-${i}` }));
    const store = new FakeStore(rows);
    const crm = new FakeCrm();
    const summary = await run(store, crm, { batch: 2 });
    expect(crm.leadCalls).toHaveLength(2);
    expect(summary.stoppedEarly).toBe(true);
  });

  it("stops starting new pushes once the time budget is spent", async () => {
    let t = NOW;
    const store = new FakeStore([leadRow({ id: "a" }), leadRow({ id: "b" }), leadRow({ id: "c" })]);
    const crm = new FakeCrm();
    const originalPush = crm.pushLead.bind(crm);
    crm.pushLead = async (i, c) => {
      t += 20_000;
      return originalPush(i, c);
    };
    const summary = await run(store, crm, { now: () => t, budgetMs: 30_000 });
    expect(crm.leadCalls).toHaveLength(2);
    expect(summary.stoppedEarly).toBe(true);
  });

  it("does nothing when there are no failed rows", async () => {
    const summary = await run(new FakeStore(), new FakeCrm());
    expect(summary).toEqual({
      leads: { candidates: 0, attempted: 0, succeeded: 0, failed: 0, exhausted: 0, deferred: 0 },
      partners: { candidates: 0, attempted: 0, succeeded: 0, failed: 0, exhausted: 0, deferred: 0 },
      stoppedEarly: false,
    });
  });
});

describe("resumable pushes against the Twenty client", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function stubTwenty() {
    const twenty = fakeTwenty();
    vi.stubEnv("TWENTY_API_URL", "https://twenty.test");
    vi.stubEnv("TWENTY_API_KEY", "test-key");
    vi.stubGlobal("fetch", twenty.fetchImpl);
    return twenty;
  }

  it("does not create a second company or opportunity when the push failed after the opportunity", async () => {
    const twenty = stubTwenty();
    // attachNote fails on the first run, after company, person and opportunity exist.
    twenty.failures.notes = 1;
    const store = new FakeStore([leadRow({ contact: { ...contact, company: "Sunrise Care LLC" } })]);

    const first = await run(store, realTwenty);
    expect(first.leads).toMatchObject({ attempted: 1, failed: 1 });
    expect(twenty.creates).toMatchObject({ companies: 1, people: 1, opportunities: 1 });
    expect(twenty.creates.notes).toBeUndefined();
    expect(store.leadUpdates[0]!.patch.crm_error).toMatch(/504/);

    // Second run after the backoff window: resumes from the checkpoint.
    const later = NOW + BASE_BACKOFF_MS;
    const second = await run(store, realTwenty, { now: () => later });
    expect(second.leads).toMatchObject({ attempted: 1, succeeded: 1 });
    expect(twenty.creates).toEqual({ companies: 1, people: 1, opportunities: 1, notes: 1, noteTargets: 1 });
    const done = store.leadUpdates.at(-1)!.patch;
    expect(done).toMatchObject({ crm_error: null, crm_attempts: 2, twenty_person_id: "people-2", twenty_opportunity_id: "opportunities-3" });

    // Nothing left to retry, so a third run creates nothing.
    await run(store, realTwenty, { now: () => later + MAX_BACKOFF_MS });
    expect(twenty.creates).toEqual({ companies: 1, people: 1, opportunities: 1, notes: 1, noteTargets: 1 });
  });

  it("resumes a partner push from its checkpoint without a second company", async () => {
    const twenty = stubTwenty();
    twenty.failures.noteTargets = 1;
    const store = new FakeStore([], [partnerRow()]);

    await run(store, realTwenty);
    expect(twenty.creates).toMatchObject({ companies: 1, people: 1, notes: 1 });
    await run(store, realTwenty, { now: () => NOW + BASE_BACKOFF_MS });
    expect(twenty.creates).toEqual({ companies: 1, people: 1, notes: 1, noteTargets: 1 });
    expect(store.partnerUpdates.at(-1)!.patch).toMatchObject({ crm_error: null, twenty_company_id: "companies-1" });
  });

  it("ignores malformed checkpoint values from the database", async () => {
    const twenty = stubTwenty();
    const store = new FakeStore([leadRow({ crm_progress: { personId: 42, opportunityId: "" } })]);
    await run(store, realTwenty);
    expect(twenty.creates).toEqual({ people: 1, opportunities: 1, notes: 1, noteTargets: 1 });
  });
});

describe("contact consent in the CRM push", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function stubTwenty() {
    const twenty = fakeTwenty();
    vi.stubEnv("TWENTY_API_URL", "https://twenty.test");
    vi.stubEnv("TWENTY_API_KEY", "test-key");
    vi.stubGlobal("fetch", twenty.fetchImpl);
    return twenty;
  }

  const hot = { ...decided.decision, requiresImmediateBrokerCall: true };
  const withPhone = { ...contact, phone: "415-555-0100" };

  it("never tells a broker to call a borrower who gave no phone consent", async () => {
    const twenty = stubTwenty();
    const store = new FakeStore([leadRow({ contact: { ...withPhone, consent: false }, decision: hot })]);
    const summary = await run(store, realTwenty);
    expect(summary.leads).toMatchObject({ succeeded: 1 });

    const [opportunity] = twenty.sent("opportunities");
    expect(opportunity!.nextStep).not.toMatch(/call borrower/i);
    expect(opportunity!.nextStep).toMatch(/^Email borrower/);
    expect(opportunity!.nextStep).toMatch(/no phone\/SMS consent/);

    const [person] = twenty.sent("people");
    expect(person).toMatchObject({ smsOptOut: true });
    expect(person).not.toHaveProperty("phones");

    const [note] = twenty.sent("notes");
    expect((note!.bodyV2 as { markdown: string }).markdown).toContain("Contact consent: none (email only)");
  });

  it("treats a stored contact with no consent field as no consent", async () => {
    const twenty = stubTwenty();
    const { consent: _omitted, ...legacy } = withPhone;
    await run(new FakeStore([leadRow({ contact: legacy, decision: hot })]), realTwenty);
    expect(twenty.sent("opportunities")[0]!.nextStep).not.toMatch(/call borrower/i);
    expect(twenty.sent("people")[0]).toMatchObject({ smsOptOut: true });
  });

  it("keeps the call next step and the phone number when consent was given", async () => {
    const twenty = stubTwenty();
    await pushLead(intake as Intake, withPhone, rebuildJev(intake as Intake, { decision: hot, rationale: [], engine: "rules", latency_ms: 1 }), { consentEventId: "consent-7" });
    expect(twenty.sent("opportunities")[0]!.nextStep).toBe("Call borrower today — Jev flagged immediate broker call");
    expect(twenty.sent("people")[0]).toMatchObject({ smsOptOut: false, phones: { primaryPhoneNumber: "415-555-0100" } });
    expect((twenty.sent("notes")[0]!.bodyV2 as { markdown: string }).markdown).toContain("consent event consent-7");
  });

  it("marks an existing person email-only when a later submission has no consent", async () => {
    const twenty = stubTwenty();
    twenty.setExistingPeople(["person-existing"]);
    await pushLead(intake as Intake, { ...withPhone, consent: false }, rebuildJev(intake as Intake, { decision: hot, rationale: [], engine: "rules", latency_ms: 1 }));
    expect(twenty.creates.people).toBeUndefined();
    expect(twenty.bodies).toContainEqual({ method: "PATCH", object: "people/person-existing", body: { smsOptOut: true } });
  });

  it("does not clear an existing opt-out when a later submission has consent", async () => {
    const twenty = stubTwenty();
    twenty.setExistingPeople(["person-existing"]);
    await pushLead(intake as Intake, withPhone, rebuildJev(intake as Intake, { decision: hot, rationale: [], engine: "rules", latency_ms: 1 }));
    expect(twenty.bodies.filter((b) => b.method === "PATCH")).toEqual([]);
  });

  it("records a partner without consent as email only", async () => {
    const twenty = stubTwenty();
    await run(new FakeStore([], [partnerRow({ profile: { ...partnerProfile, contact: { ...withPhone, consent: false } } })]), realTwenty);
    const [person] = twenty.sent("people");
    expect(person).toMatchObject({ smsOptOut: true });
    expect(person).not.toHaveProperty("phones");
    expect((twenty.sent("notes")[0]!.bodyV2 as { markdown: string }).markdown).toContain("Contact consent: none (email only)");
  });
});

describe("rebuildJevFactory", () => {
  it("keeps the persisted decision and rationale while recomputing the indicative quote", () => {
    const stored = { decision: { ...decided.decision, requiresImmediateBrokerCall: true }, rationale: ["stored reason"], engine: "jev-remote" as const, latency_ms: 77 };
    const jev = rebuildJev(intake as Intake, stored);
    expect(jev.decision.requiresImmediateBrokerCall).toBe(true);
    expect(jev.rationale).toEqual(["stored reason"]);
    expect(jev.engine).toBe("jev-remote");
    expect(jev.latencyMs).toBe(77);
    expect(jev.primaryQuote).not.toBeNull();
  });
});
