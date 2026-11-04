import { describe, expect, it } from "vitest";
import { MemoryAgentEventStore } from "@/lib/agents/core/events";
import { FakeMaturityProvider } from "./maturity";
import { MemoryProspectStore, ProspectStoreError } from "./prospect-store";
import { ProspectingError, addSuppressionValue, dedupeKeyOf, marketRateFromEnv, scanProspects, suppressProspect, toScanned, validateQuery } from "./prospects";
import { isSuppressed, maskLabel, suppressionHash, suppressionKeys } from "./suppression";
import { NOW, maturityRecord, plusMonths } from "./testing";

const query = { zips: ["90001", "91201"], fromMonths: 0, toMonths: 18 };

function setup(records = [maturityRecord(), maturityRecord({ address: { line1: "55 Sample Blvd", zip: "91201" }, apn: "0000-000-002", propertyType: "senior_housing", ownerName: "Sample Care Holdings LP", loan: { maturityDate: plusMonths(4) } })]) {
  const store = new MemoryProspectStore();
  const events = new MemoryAgentEventStore(() => NOW);
  const provider = new FakeMaturityProvider(records);
  return { store, events, provider, deps: { provider, store, events, now: () => NOW, marketRatePct: 6.25 } };
}

describe("validateQuery", () => {
  it("accepts a sane query and dedupes ZIPs", () => {
    expect(validateQuery({ zips: ["90001", " 90001 "], fromMonths: -3, toMonths: 12 }).zips).toEqual(["90001"]);
  });
  it.each([
    [{ zips: [], fromMonths: 0, toMonths: 12 }, /at least one ZIP/],
    [{ zips: ["9000"], fromMonths: 0, toMonths: 12 }, /five-digit/],
    [{ zips: ["90001"], fromMonths: 12, toMonths: 0 }, /before its end/],
    [{ zips: ["90001"], fromMonths: -50, toMonths: 0 }, /limited to 36 months/],
    [{ zips: ["90001"], fromMonths: 0, toMonths: 12, minLoanAmount: -1 }, /positive/],
    [{ zips: Array.from({ length: 30 }, (_, i) => String(90000 + i)), fromMonths: 0, toMonths: 12 }, /at most 25/],
  ])("rejects %j", (q, message) => {
    expect(() => validateQuery(q)).toThrow(ProspectingError);
    expect(() => validateQuery(q)).toThrow(message);
  });
});

describe("scanProspects", () => {
  it("stores scored prospects, records the scan and logs an agent event without PII", async () => {
    const { deps, store, events, provider } = setup();
    const r = await scanProspects(deps, { query, actor: "staff:ana@corin.test" });
    expect(r).toMatchObject({ status: "completed", found: 2, created: 2, updated: 0, skipped: 0, suppressed: 0 });
    const rows = await store.listProspects();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.score).toBeGreaterThanOrEqual(rows[1]!.score);
    expect(rows.every((p) => p.status === "new" && p.scoreFactors.length === 6 && p.loanOriginalCents !== null)).toBe(true);
    expect(rows.find((p) => p.apn === "0000-000-001")).toMatchObject({ loanOriginalCents: 740_000_000, recommendedProgram: "hud_223f", windowBucket: "months_6_12", scanId: r.status === "completed" ? r.scan.id : null });
    expect(provider.queries[0]).toMatchObject({ zips: ["90001", "91201"], maxResults: 500 });
    const scans = await store.listScans();
    expect(scans[0]).toMatchObject({ status: "completed", provider: "fake", found: 2, createdCount: 2, startedBy: "staff:ana@corin.test" });
    const ev = events.all().find((e) => e.eventType === "prospect.scan_completed")!;
    expect(ev).toMatchObject({ agent: "prospecting", outcome: "recorded" });
    expect(JSON.stringify(ev.detail)).not.toMatch(/Example|Sample|Ave|Blvd/);
  });

  it("is idempotent and never overwrites what staff entered", async () => {
    const { deps, store } = setup();
    await scanProspects(deps, { query, actor: "a" });
    const [first] = await store.listProspects();
    await store.updateStaff(first!.id, { contactName: "Pat Owner", contactEmail: "pat@example.com", status: "reviewing", notes: "Called the CPA", assignedTo: "ana" }, "staff:ana", NOW);
    const again = await scanProspects(deps, { query, actor: "a" });
    expect(again).toMatchObject({ status: "completed", created: 0, updated: 2 });
    expect(await store.listProspects()).toHaveLength(2);
    expect(await store.getProspect(first!.id)).toMatchObject({ contactName: "Pat Owner", contactEmail: "pat@example.com", status: "reviewing", notes: "Called the CPA", assignedTo: "ana" });
  });

  it("refreshes machine-owned columns when the data changes", async () => {
    const { store, provider } = setup();
    await scanProspects({ provider, store, now: () => NOW }, { query, actor: "a" });
    const p = (await store.listProspects()).find((x) => x.apn === "0000-000-001")!;
    const changed = new FakeMaturityProvider([maturityRecord({ loan: { ratePct: 3.0, lender: "New Lender" } })]);
    await scanProspects({ provider: changed, store, now: () => NOW }, { query, actor: "a" });
    expect(await store.getProspect(p.id)).toMatchObject({ loanRatePct: 3, loanLender: "New Lender" });
  });

  it("stores a property that matches the do-not-contact list as do_not_contact", async () => {
    const { deps, store } = setup();
    await store.addSuppression({ kind: "owner", valueHash: suppressionHash("owner", "Example Court Partners, L.L.C."), label: maskLabel("owner", "Example Court Partners LLC"), reason: "opt_out", createdBy: "staff" }, NOW);
    const r = await scanProspects(deps, { query, actor: "a" });
    expect(r).toMatchObject({ status: "completed", suppressed: 1 });
    const rows = await store.listProspects();
    expect(rows.find((p) => p.apn === "0000-000-001")!.status).toBe("do_not_contact");
    expect(rows.find((p) => p.apn === "0000-000-002")!.status).toBe("new");
  });

  it("reports a provider failure on the scan row and stores nothing", async () => {
    const store = new MemoryProspectStore();
    const r = await scanProspects({ provider: new FakeMaturityProvider([], "http-503"), store, now: () => NOW }, { query, actor: "a" });
    expect(r).toMatchObject({ status: "failed", error: "http-503" });
    expect(await store.listProspects()).toEqual([]);
    expect((await store.listScans())[0]).toMatchObject({ status: "failed", error: "http-503" });
  });

  it("returns not_configured when no provider is set up, and completes empty on no results", async () => {
    const store = new MemoryProspectStore();
    expect(await scanProspects({ provider: null, store, now: () => NOW }, { query, actor: "a" })).toEqual({ status: "not_configured" });
    const empty = await scanProspects({ provider: new FakeMaturityProvider([]), store, now: () => NOW }, { query, actor: "a" });
    expect(empty).toMatchObject({ status: "completed", found: 0, created: 0 });
  });

  it("skips a record that cannot be scored", async () => {
    const { store } = setup();
    const bad = maturityRecord({ loan: { maturityDate: plusMonths(8) } });
    const provider = new FakeMaturityProvider([bad]);
    // A record the provider returned with an unreadable date is skipped, not fatal.
    const sneaky = { search: async () => ({ status: "ok" as const, data: [{ ...bad, loan: { ...bad.loan, maturityDate: "soon" } }, bad] }), name: "fake" as const };
    const r = await scanProspects({ provider: sneaky, store, now: () => NOW }, { query, actor: "a" });
    expect(r).toMatchObject({ status: "completed", found: 2, created: 1, skipped: 1 });
    void provider;
  });
});

describe("dedupeKeyOf and toScanned", () => {
  it("keys on the parcel (or normalized address) plus the maturity date", () => {
    const a = maturityRecord();
    expect(dedupeKeyOf(a)).toBe(dedupeKeyOf(maturityRecord({ ownerName: "Someone Else" })));
    expect(dedupeKeyOf(a)).not.toBe(dedupeKeyOf(maturityRecord({ loan: { maturityDate: plusMonths(9) } })));
    const noApn = maturityRecord({ apn: null, address: { line1: "100 Example Avenue" } });
    expect(dedupeKeyOf(noApn)).toBe(dedupeKeyOf(maturityRecord({ apn: null, address: { line1: "100 EXAMPLE AVE." } })));
    expect(dedupeKeyOf(a)).toMatch(/^p1-[0-9a-f]{40}$/);
  });

  it("converts dollars to whole cents", () => {
    const s = toScanned(maturityRecord({ loan: { originalAmount: 1_234_567.89 } }), null, { now: NOW, marketRatePct: 6.25 });
    expect(s.loanOriginalCents).toBe(123_456_789);
  });
});

describe("do-not-contact list", () => {
  it("suppresses a prospect's own email, owner and addresses and marks it", async () => {
    const { deps, store } = setup();
    await scanProspects(deps, { query, actor: "a" });
    const p = (await store.listProspects())[0]!;
    await store.updateStaff(p.id, { contactEmail: "Pat@Owner.example" }, "staff", NOW);
    const r = await suppressProspect({ store, now: () => NOW }, p.id, "opt_out", "staff:ana");
    expect(r.prospect.status).toBe("do_not_contact");
    expect(r.added.map((s) => s.kind).sort()).toEqual(["address", "address", "email", "owner"]);
    expect(r.added.every((s) => s.createdBy === "staff:ana" && s.reason === "opt_out")).toBe(true);
    expect(JSON.stringify(r.added)).not.toMatch(/pat@owner/i);
    const again = await store.getProspect(p.id);
    expect((await isSuppressed(store, again!)).suppressed).toBe(true);
    // A second suppression is idempotent.
    await suppressProspect({ store, now: () => NOW }, p.id, "opt_out", "staff:ana");
    expect((await store.listSuppressions()).length).toBe(4);
  });

  it("adds one value (an unsubscribe reply) and marks every matching prospect", async () => {
    const { deps, store } = setup();
    await scanProspects(deps, { query, actor: "a" });
    const p = (await store.listProspects())[0]!;
    await store.updateStaff(p.id, { contactEmail: "pat@owner.example" }, "staff", NOW);
    const r = await addSuppressionValue({ store, now: () => NOW }, { kind: "email", value: " PAT@owner.example ", reason: "opt_out", actor: "system:unsubscribe" });
    expect(r.prospectsMarked).toBe(1);
    expect(r.suppression.label).toBe("p***@owner.example");
    expect((await store.getProspect(p.id))!.status).toBe("do_not_contact");
    await expect(addSuppressionValue({ store }, { kind: "email", value: "nope", reason: "opt_out", actor: "x" })).rejects.toThrow(/email address/);
  });

  it("normalizes values so spelling variants match, and does not match free-mail domains", () => {
    expect(suppressionHash("email", "A@B.com")).toBe(suppressionHash("email", " a@b.COM "));
    expect(suppressionHash("owner", "Example Court Partners, LLC")).toBe(suppressionHash("owner", "EXAMPLE COURT PARTNERS LLC"));
    expect(suppressionHash("address", "100 Example Avenue 90001")).toBe(suppressionHash("address", "100 EXAMPLE AVE. 90001"));
    const keys = suppressionKeys({ contactEmail: "x@gmail.com", ownerName: null, addressLine1: "1 A St", zip: "90001", mailing: null });
    expect(keys.map((k) => k.kind)).toEqual(["email", "address"]);
    expect(suppressionKeys({ contactEmail: "x@corp.example", ownerName: null, addressLine1: "1 A St", zip: null, mailing: null }).map((k) => k.kind)).toContain("domain");
  });
});

describe("staff edits and filters", () => {
  it("validates edits like the table does", async () => {
    const { deps, store } = setup();
    await scanProspects(deps, { query, actor: "a" });
    const p = (await store.listProspects())[0]!;
    await expect(store.updateStaff(p.id, { contactEmail: "not-an-email" }, "s", NOW)).rejects.toThrow(ProspectStoreError);
    await expect(store.updateStaff(p.id, { notes: "x".repeat(4_001) }, "s", NOW)).rejects.toThrow(/Notes/);
    expect(await store.updateStaff("00000000-0000-4000-8000-000000000000", { notes: "x" }, "s", NOW)).toBeNull();
  });

  it("filters by status, program, window, score and text", async () => {
    const { deps, store } = setup();
    await scanProspects(deps, { query, actor: "a" });
    expect(await store.listProspects({ program: "bridge" })).toHaveLength(1);
    expect(await store.listProspects({ window: "months_6_12" })).toHaveLength(1);
    expect(await store.listProspects({ q: "sample blvd" })).toHaveLength(1);
    expect(await store.listProspects({ minScore: 101 })).toHaveLength(0);
    const p = (await store.listProspects())[0]!;
    await store.updateStaff(p.id, { status: "not_a_fit" }, "s", NOW);
    expect(await store.listProspects({ status: "active" })).toHaveLength(1);
    expect((await store.countByStatus()).not_a_fit).toBe(1);
  });
});

describe("marketRateFromEnv", () => {
  it("uses the configured rate when sane, the default otherwise", () => {
    expect(marketRateFromEnv({ PROSPECT_MARKET_RATE_PCT: "5.5" })).toBe(5.5);
    expect(marketRateFromEnv({ PROSPECT_MARKET_RATE_PCT: "abc" })).toBe(6.25);
    expect(marketRateFromEnv({ PROSPECT_MARKET_RATE_PCT: "99" })).toBe(6.25);
    expect(marketRateFromEnv({})).toBe(6.25);
  });
});
