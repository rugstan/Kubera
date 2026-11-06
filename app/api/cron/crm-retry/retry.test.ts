import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decideWithRules } from "@/lib/ai/jev";
import { pushLead, pushPartner, type CrmProgress } from "@/lib/crm/twenty";
import { FALLBACK_BENCHMARKS } from "@/lib/sizing/assumptions";
import type { Contact, Intake, PartnerRegistration } from "@/lib/validation";
import {
  BASE_BACKOFF_MS,
  FIRST_PUSH_GRACE_MS,
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
import { pendingFilter, rebuildJevFactory, supabaseRetryStore } from "./wiring";

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
    expect(twenty.sent("people")[0]).toMatchObject({ smsOptOut: false, phones: { primaryPhoneNumber: "+14155550100" } });
    expect((twenty.sent("notes")[0]!.bodyV2 as { markdown: string }).markdown).toContain("consent event consent-7");
  });

  it("sends Twenty an E.164 number, and keeps a number it cannot normalize out of the CRM without failing the lead", async () => {
    const twenty = stubTwenty();
    await pushLead(intake as Intake, { ...withPhone, phone: "(415) 555-0100" }, rebuildJev(intake as Intake, { decision: hot, rationale: [], engine: "rules", latency_ms: 1 }), { consentEventId: "consent-8" });
    expect(twenty.sent("people")[0]).toMatchObject({ phones: { primaryPhoneNumber: "+14155550100" } });

    const later = stubTwenty();
    await pushLead(intake as Intake, { ...withPhone, phone: "555-0100" }, rebuildJev(intake as Intake, { decision: hot, rationale: [], engine: "rules", latency_ms: 1 }), { consentEventId: "consent-9" });
    const [person] = later.sent("people");
    expect(person).toMatchObject({ smsOptOut: false });
    expect(person).not.toHaveProperty("phones");
    expect(later.sent("opportunities")).toHaveLength(1);
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
    // The only PATCH is the opportunity's form fields; the existing person is left alone.
    expect(twenty.bodies.filter((b) => b.method === "PATCH" && b.object.startsWith("people/"))).toEqual([]);
    expect(twenty.bodies.filter((b) => b.method === "PATCH").map((b) => b.object)).toEqual([expect.stringMatching(/^opportunities\//)]);
  });

  it("writes the lead's form fields on the opportunity, with its site id", async () => {
    const twenty = stubTwenty();
    await run(new FakeStore([leadRow()]), realTwenty);
    const patch = twenty.bodies.find((b) => b.method === "PATCH" && b.object.startsWith("opportunities/"));
    expect(patch?.body).toMatchObject({ siteLeadId: expect.any(String), propertyType: (intake as Intake).assetType, leadSource: expect.any(String) });
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

describe("advisor-only (human_review) leads", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const reviewRow = () => leadRow({ engine: "human_review", decision: {} as FailedLeadRow["decision"], rationale: [], latency_ms: 0 });

  it("re-pushes without rebuilding a decision", async () => {
    const rebuild = vi.fn(rebuildJev);
    const seen: unknown[] = [];
    const crm: CrmPusher = {
      async pushLead(_i, _c, jev) {
        seen.push(jev);
        return { personId: "person-1", opportunityId: "opp-1" };
      },
      pushPartner: async () => ({}),
    };
    const summary = await run(new FakeStore([reviewRow()]), crm, { rebuildJev: rebuild });
    expect(summary.leads.succeeded).toBe(1);
    expect(rebuild).not.toHaveBeenCalled();
    expect(seen).toEqual([null]);
  });

  it("creates the deal with no score, probability or commission estimate", async () => {
    const twenty = fakeTwenty();
    vi.stubEnv("TWENTY_API_URL", "https://twenty.test");
    vi.stubEnv("TWENTY_API_KEY", "test-key");
    vi.stubGlobal("fetch", twenty.fetchImpl);
    await run(new FakeStore([reviewRow()]), realTwenty);
    const opp = twenty.sent("opportunities")[0]!;
    expect(opp.name).toMatch(/^Advisor review/);
    expect(opp).not.toHaveProperty("probability");
    expect(opp).not.toHaveProperty("expectedRevenue");
    expect(String(opp.nextStep)).toMatch(/Advisor-only handling/);
    const note = (twenty.sent("notes")[0]!.bodyV2 as { markdown: string }).markdown;
    expect(note).toContain("No automated scoring was run");
    expect(note).not.toContain("Jev decision");
  });
});

/**
 * In-memory stand-in for the Supabase query builder: it evaluates the filters
 * supabaseRetryStore sends (or/is/not/lt, order, limit, update().eq()) against
 * table rows, so these tests exercise the real selection rather than a mirror.
 */
type DbRow = Record<string, unknown>;
function fakeDb(tables: Record<"leads" | "partners", DbRow[]>) {
  const compare = (a: unknown, b: unknown) => {
    if (typeof a === "number" || typeof b === "number") return Number(a) - Number(b);
    const da = Date.parse(String(a));
    const dbt = Date.parse(String(b));
    if (Number.isFinite(da) && Number.isFinite(dbt)) return da - dbt;
    return String(a).localeCompare(String(b));
  };
  const parseValue = (raw: string) => (raw === "null" ? null : raw.replace(/^"(.*)"$/, "$1"));
  const clause = (expr: string): ((r: DbRow) => boolean) => {
    const m = /^(\w+)\.(not\.is|is|lt)\.(.+)$/.exec(expr);
    if (!m) throw new Error(`unsupported or() clause: ${expr}`);
    const [, col, op, raw] = m as unknown as [string, string, string, string];
    const value = parseValue(raw);
    if (op === "is") return (r) => (r[col] ?? null) === value;
    if (op === "not.is") return (r) => (r[col] ?? null) !== value;
    return (r) => r[col] != null && compare(r[col], value) < 0;
  };
  const splitOr = (s: string) => s.match(/(?:[^,"]|"[^"]*")+/g) ?? [];

  return {
    tables,
    from(table: "leads" | "partners") {
      const filters: ((r: DbRow) => boolean)[] = [];
      const orders: { col: string; ascending: boolean; nullsFirst: boolean }[] = [];
      let max = Infinity;
      const query = {
        select: () => query,
        or(expr: string) {
          const parts = splitOr(expr).map(clause);
          filters.push((r) => parts.some((p) => p(r)));
          return query;
        },
        is(col: string, value: null) {
          filters.push((r) => (r[col] ?? null) === value);
          return query;
        },
        lt(col: string, value: unknown) {
          filters.push((r) => r[col] != null && compare(r[col], value) < 0);
          return query;
        },
        order(col: string, opts: { ascending: boolean; nullsFirst?: boolean }) {
          orders.push({ col, ascending: opts.ascending, nullsFirst: opts.nullsFirst ?? !opts.ascending });
          return query;
        },
        limit(n: number) {
          max = n;
          return query;
        },
        then<T>(resolve: (v: { data: DbRow[]; error: null }) => T) {
          const rows = tables[table].filter((r) => filters.every((f) => f(r)));
          rows.sort((a, b) => {
            for (const o of orders) {
              const av = a[o.col] ?? null;
              const bv = b[o.col] ?? null;
              if (av === bv) continue;
              if (av === null) return o.nullsFirst ? -1 : 1;
              if (bv === null) return o.nullsFirst ? 1 : -1;
              const c = compare(av, bv);
              if (c !== 0) return o.ascending ? c : -c;
            }
            return 0;
          });
          return Promise.resolve({ data: rows.slice(0, max).map((r) => ({ ...r })), error: null }).then(resolve);
        },
      };
      return {
        select: () => query,
        update(patch: DbRow) {
          return {
            eq(col: string, value: unknown) {
              for (const r of tables[table]) if (r[col] === value) Object.assign(r, patch);
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
}

describe("first pushes that never finished (no crm_error)", () => {
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

  const lead = (over: DbRow = {}): DbRow => ({ ...leadRow(), crm_progress: {}, crm_error: null, twenty_person_id: null, created_at: iso(30 * 60_000), ...over });
  const partner = (over: DbRow = {}): DbRow => ({ ...partnerRow(), crm_progress: {}, crm_error: null, twenty_company_id: null, created_at: iso(30 * 60_000), ...over });
  const storeFor = (db: ReturnType<typeof fakeDb>) => supabaseRetryStore(db as unknown as SupabaseClient);
  const DAY = 24 * 60 * 60_000;

  it("resumes a lead whose after() push died mid-way (crm_progress set, no crm_error)", async () => {
    const twenty = stubTwenty();
    // The route created the person and checkpointed it, then the instance was killed.
    const db = fakeDb({ leads: [lead({ crm_progress: { personId: "people-1" } })], partners: [] });

    const summary = await run(storeFor(db), realTwenty);
    expect(summary.leads).toMatchObject({ candidates: 1, attempted: 1, succeeded: 1 });
    // The checkpointed person is reused; only the missing steps are created.
    expect(twenty.creates).toEqual({ opportunities: 1, notes: 1, noteTargets: 1 });
    expect(db.tables.leads[0]).toMatchObject({ crm_error: null, crm_attempts: 1, twenty_person_id: "people-1" });

    // Synced now, so the next run leaves it alone.
    const again = await run(storeFor(db), realTwenty, { now: () => NOW + MAX_BACKOFF_MS });
    expect(again.leads.candidates).toBe(0);
    expect(twenty.creates).toEqual({ opportunities: 1, notes: 1, noteTargets: 1 });
  });

  it("pushes leads and partners submitted while Twenty was not configured", async () => {
    const twenty = stubTwenty();
    const db = fakeDb({ leads: [lead({ created_at: iso(3 * DAY) })], partners: [partner({ created_at: iso(3 * DAY) })] });

    const summary = await run(storeFor(db), realTwenty);
    expect(summary.leads).toMatchObject({ attempted: 1, succeeded: 1 });
    expect(summary.partners).toMatchObject({ attempted: 1, succeeded: 1 });
    expect(twenty.creates).toMatchObject({ people: 2, opportunities: 1, companies: 1 });
    expect(db.tables.leads[0]!.twenty_person_id).toBeTruthy();
    expect(db.tables.partners[0]!.twenty_company_id).toBeTruthy();
  });

  it("leaves a fresh row to the route's own push so the two never race", async () => {
    const twenty = stubTwenty();
    const fresh = iso(FIRST_PUSH_GRACE_MS - 60_000);
    const db = fakeDb({ leads: [lead({ created_at: fresh, crm_progress: { personId: "people-1" } })], partners: [partner({ created_at: fresh })] });

    const summary = await run(storeFor(db), realTwenty);
    expect(summary.leads.candidates).toBe(0);
    expect(summary.partners.candidates).toBe(0);
    expect(twenty.fetchImpl).not.toHaveBeenCalled();

    // A recorded failure is retried regardless of age.
    db.tables.leads[0]!.crm_error = "Twenty POST /opportunities: 503";
    const retried = await run(storeFor(db), realTwenty);
    expect(retried.leads).toMatchObject({ candidates: 1, succeeded: 1 });
  });

  it("skips rows already in Twenty or past the attempt cap", async () => {
    stubTwenty();
    const db = fakeDb({
      leads: [lead({ id: "synced", twenty_person_id: "people-7" }), lead({ id: "capped", crm_attempts: MAX_ATTEMPTS, crm_error: "manual" })],
      partners: [partner({ twenty_company_id: "companies-7" })],
    });
    const summary = await run(storeFor(db), realTwenty);
    expect(summary.leads.candidates).toBe(0);
    expect(summary.partners.candidates).toBe(0);
  });

  it("quotes the cutoff timestamp inside the PostgREST or() filter", () => {
    expect(pendingFilter(NOW)).toBe(`crm_error.not.is.null,created_at.lt."${new Date(NOW - FIRST_PUSH_GRACE_MS).toISOString()}"`);
  });
});
