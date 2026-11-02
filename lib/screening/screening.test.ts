import { describe, expect, it } from "vitest";
import type { StaffIdentity } from "@/lib/checklists/staff";
import { addPrincipal } from "@/lib/principals/service";
import { MemoryPrincipalStore } from "@/lib/principals/store";
import { DEAL_ID, TEST_KEYRING } from "@/lib/principals/test-fixtures";
import { FakeSanctionsClient, FAKE_LIST_VERSION } from "./fake";
import { sanctionsClientFromEnv } from "./index";
import { jaroWinkler, nameSimilarity, normalizeName } from "./match";
import { OpenSanctionsClient } from "./opensanctions";
import { canDisposition, classifyResponse, screeningGate } from "./policy";
import { dealScreeningGate, dispositionScreening, screenDeal, ScreeningReviewError, type DealHoldSink } from "./service";
import { MemoryDealHoldStore, MemoryScreeningStore } from "./store";
import type { ScreeningRecord } from "./types";

const NOW = new Date("2026-11-03T12:00:00Z");
const broker: StaffIdentity = { id: "u1", email: "broker@corincommercial.com", name: "Broker", role: "broker", dreLicense: "01234567" };
const analyst: StaffIdentity = { ...broker, id: "u2", email: "analyst@corincommercial.com", role: "analyst" };

describe("name matching", () => {
  it("normalizes and compares names regardless of order, accents and entity suffixes", () => {
    expect(normalizeName("José  Núñez, LLC")).toEqual(["jose", "nunez"]);
    expect(jaroWinkler("martha", "marhta")).toBeCloseTo(0.961, 3);
    expect(nameSimilarity("Petrov, Ivan", "IVAN PETROV")).toBe(1);
    expect(nameSimilarity("Ivan Petrov", "Ivan Petrova")).toBeGreaterThan(0.9);
    expect(nameSimilarity("Ana Ruiz", "Ivan Petrov")).toBeLessThan(0.6);
  });
});

describe("screening policy", () => {
  const response = (scores: number[], providerMatch: boolean | null = null) => ({ provider: "fake", listVersion: "v1", listsChecked: ["us_ofac_sdn"], screenedAt: NOW.toISOString(), matches: scores.map((score, i) => ({ entryId: `e${i}`, name: "X", score, lists: [], programs: [], birthDates: [], countries: [], providerMatch })) });

  it("treats any score at or above the threshold, or a provider match flag, as a possible match", () => {
    expect(classifyResponse(response([]))).toEqual({ result: "clear", matchScore: null, disposition: "not_required" });
    expect(classifyResponse(response([0.55]))).toEqual({ result: "clear", matchScore: 0.55, disposition: "not_required" });
    expect(classifyResponse(response([0.71]))).toMatchObject({ result: "potential_match", disposition: "pending_review" });
    expect(classifyResponse(response([0.4], true))).toMatchObject({ result: "potential_match" });
  });

  it("allows only forward review decisions", () => {
    expect(canDisposition("pending_review", "false_positive")).toBe(true);
    expect(canDisposition("escalated", "confirmed_match")).toBe(true);
    expect(canDisposition("confirmed_match", "false_positive")).toBe(false);
    expect(canDisposition("false_positive", "pending_review")).toBe(false);
    expect(canDisposition("not_required", "confirmed_match")).toBe(false);
  });

  const rec = (over: Partial<ScreeningRecord>): ScreeningRecord => ({ id: "s", dealId: DEAL_ID, principalId: "p1", subjectKind: "individual", subjectName: "Ana", purpose: "initial", provider: "fake", listVersion: "v1", listsChecked: [], result: "clear", matchScore: null, matches: [], error: null, disposition: "not_required", reviewer: null, reviewedAt: null, reviewNote: null, requestedBy: "x", screenedAt: NOW.toISOString(), createdAt: NOW.toISOString(), ...over });

  it("requires every subject cleared within the rescreen window before closing", () => {
    const subjects = [{ principalId: "p1", name: "Ana" }, { principalId: "p2", name: "Ben" }];
    const old = rec({ id: "a", screenedAt: "2026-10-01T00:00:00Z" });
    const g1 = screeningGate({ subjects, screenings: [old], now: NOW });
    expect(g1.held).toBe(false);
    expect(g1.clearForClosing).toBe(false);
    expect(g1.blocking.map((b) => b.reason)).toEqual([expect.stringMatching(/Rescreen before closing/), "Not screened yet."]);
    const g2 = screeningGate({ subjects, screenings: [old, rec({ id: "b", screenedAt: "2026-11-02T00:00:00Z" }), rec({ id: "c", principalId: "p2", subjectName: "Ben", screenedAt: "2026-11-02T00:00:00Z" })], now: NOW });
    expect(g2.clearForClosing).toBe(true);
    // A provider outage never clears anyone.
    const g3 = screeningGate({ subjects: [subjects[0]!], screenings: [rec({ result: "error", error: "down", listVersion: null })], now: NOW });
    expect(g3.blocking[0]!.reason).toMatch(/did not complete/);
  });

  it("holds on an unresolved possible match even when a later screening is clear", () => {
    const subjects = [{ principalId: "p1", name: "Ana" }];
    const hit = rec({ id: "h", result: "potential_match", matchScore: 0.93, disposition: "pending_review", screenedAt: "2026-11-01T00:00:00Z" });
    const g = screeningGate({ subjects, screenings: [hit, rec({ id: "later", screenedAt: "2026-11-02T00:00:00Z" })], now: NOW });
    expect(g.held).toBe(true);
    expect(g.clearForClosing).toBe(false);
    expect(g.holdReasons[0]).toMatch(/possible sanctions match \(score 0.93\)/);
    const confirmed = screeningGate({ subjects, screenings: [{ ...hit, disposition: "confirmed_match" }], now: NOW });
    expect(confirmed.counselReview).toBe(true);
    const cleared = screeningGate({ subjects, screenings: [{ ...hit, disposition: "false_positive", screenedAt: "2026-11-02T00:00:00Z" }], now: NOW });
    expect(cleared.held).toBe(false);
    expect(cleared.clearForClosing).toBe(true);
  });
});

async function setup() {
  const principals = new MemoryPrincipalStore();
  const pdeps = { principals, keyring: TEST_KEYRING, now: () => NOW };
  const b = await addPrincipal(pdeps, { dealId: DEAL_ID, kind: "entity", legalName: "Harbor View LLC", roles: ["borrower_entity"] });
  const ivan = await addPrincipal(pdeps, { dealId: DEAL_ID, parentId: b.principal.id, kind: "individual", legalName: "Ivan Petrov", roles: ["managing_member"], ownershipPct: 50, citizenship: "other" }, { dob: "1965-03-02" });
  const ana = await addPrincipal(pdeps, { dealId: DEAL_ID, parentId: b.principal.id, kind: "individual", legalName: "Ana Ruiz", roles: ["member"], ownershipPct: 50 });
  const client = new FakeSanctionsClient([{ entryId: "OFAC-12345", name: "PETROV, Ivan", kind: "individual", birthDates: ["1965-03-02"], programs: ["RUSSIA-EO14024"] }], { now: () => NOW });
  const events: string[] = [];
  const sink: DealHoldSink = { held: async (h) => void events.push(`held:${h.reason}`), released: async () => void events.push("released") };
  const deps = { client, screenings: new MemoryScreeningStore(), holds: new MemoryDealHoldStore(), principals, keyring: TEST_KEYRING, sink, now: () => NOW };
  return { deps, b: b.principal, ivan: ivan.principal, ana: ana.principal, client, events };
}

describe("screening service", () => {
  it("an OFAC hit holds the deal until a broker reviews it", async () => {
    const { deps, ivan, client, events } = await setup();
    const { records, gate } = await screenDeal(deps, { dealId: DEAL_ID, purpose: "initial", requestedBy: "broker@corincommercial.com" });
    expect(records).toHaveLength(3);
    // Name, birth date (decrypted for the lookup only) and country go to the provider.
    expect(client.calls.find((c) => c.name === "Ivan Petrov")).toEqual({ kind: "individual", name: "Ivan Petrov", dateOfBirth: "1965-03-02", countries: undefined });
    const hit = records.find((r) => r.principalId === ivan.id)!;
    expect(hit).toMatchObject({ result: "potential_match", disposition: "pending_review", listVersion: FAKE_LIST_VERSION, provider: "fake" });
    expect(hit.matches[0]).toMatchObject({ entryId: "OFAC-12345", programs: ["RUSSIA-EO14024"] });
    expect(gate.held).toBe(true);
    expect(await deps.holds.active(DEAL_ID)).toEqual([expect.objectContaining({ reason: "sanctions_potential_match", sourceId: hit.id })]);
    expect(events).toEqual(["held:sanctions_potential_match"]);

    await expect(dispositionScreening(deps, { screeningId: hit.id, to: "false_positive", reviewer: analyst, note: "DOB differs from the SDN entry." })).rejects.toThrow(ScreeningReviewError);
    await expect(dispositionScreening(deps, { screeningId: hit.id, to: "false_positive", reviewer: broker, note: "short" })).rejects.toThrow(/at least 10/);
    await dispositionScreening(deps, { screeningId: hit.id, to: "escalated", reviewer: analyst, note: "Same name and DOB; needs a broker." });
    expect((await dealScreeningGate(deps, DEAL_ID)).held).toBe(true);

    await dispositionScreening(deps, { screeningId: hit.id, to: "false_positive", reviewer: broker, note: "Passport shows a different place of birth and middle name." });
    expect(await deps.holds.active(DEAL_ID)).toEqual([]);
    const g = await dealScreeningGate(deps, DEAL_ID);
    expect(g.held).toBe(false);
    expect(g.clearForClosing).toBe(true);
    expect(events).toEqual(["held:sanctions_potential_match", "released"]);
    await expect(dispositionScreening(deps, { screeningId: hit.id, to: "confirmed_match", reviewer: broker, note: "Changed my mind about this one." })).rejects.toThrow(/cannot be marked/);
  });

  it("a confirmed match keeps the deal held and adds a counsel hold", async () => {
    const { deps, ivan } = await setup();
    const { records } = await screenDeal(deps, { dealId: DEAL_ID, purpose: "initial", requestedBy: "system" });
    const hit = records.find((r) => r.principalId === ivan.id)!;
    await dispositionScreening(deps, { screeningId: hit.id, to: "confirmed_match", reviewer: broker, note: "Name, DOB and nationality all match the SDN entry." });
    const holds = await deps.holds.active(DEAL_ID);
    expect(holds.map((h) => h.reason).sort()).toEqual(["sanctions_confirmed_match", "sanctions_potential_match"]);
    // Confirmed-match holds are released only by counsel.
    expect(await deps.holds.release("screening", hit.id, "x", "y", NOW)).toBe(1);
    expect((await deps.holds.active(DEAL_ID)).map((h) => h.reason)).toEqual(["sanctions_confirmed_match"]);
    expect((await dealScreeningGate(deps, DEAL_ID)).counselReview).toBe(true);
  });

  it("records an error, never a clear, when the provider is down or not configured", async () => {
    const { deps, client } = await setup();
    client.failNext = true;
    const first = await screenDeal(deps, { dealId: DEAL_ID, purpose: "initial", requestedBy: "system" });
    expect(first.records[0]).toMatchObject({ result: "error", error: "fake provider outage", disposition: "not_required" });
    const none = await screenDeal({ ...deps, client: null }, { dealId: DEAL_ID, purpose: "manual", requestedBy: "system" });
    expect(none.records.every((r) => r.result === "error" && /not configured/.test(r.error!))).toBe(true);
    expect(none.gate.clearForClosing).toBe(false);
  });
});

describe("OpenSanctions client", () => {
  it("is env-gated", () => {
    expect(sanctionsClientFromEnv({})).toBeNull();
    expect(sanctionsClientFromEnv({ OPENSANCTIONS_API_KEY: "k" })).toBeInstanceOf(OpenSanctionsClient);
  });

  it("sends only name, birth date and country and records the list version", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith("/catalog")) return new Response(JSON.stringify({ datasets: [{ name: "sanctions", version: "20261102120000-abc", children: ["us_ofac_sdn", "us_ofac_cons", "un_sc_sanctions"] }] }), { status: 200 });
      return new Response(
        JSON.stringify({ responses: { q: { status: 200, results: [{ id: "NK-1", caption: "Ivan PETROV", schema: "Person", score: 0.92, match: true, datasets: ["us_ofac_sdn"], properties: { birthDate: ["1965-03-02"], topics: ["sanction"], nationality: ["ru"] } }] } } }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const client = new OpenSanctionsClient({ apiKey: "secret-key", fetchImpl, now: () => NOW });
    const res = await client.screen({ kind: "individual", name: "Ivan Petrov", dateOfBirth: "1965-03-02", countries: ["ru"] });
    expect(calls[0]!.url).toBe("https://api.opensanctions.org/match/sanctions?threshold=0.5&limit=10");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("ApiKey secret-key");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ queries: { q: { schema: "Person", properties: { name: ["Ivan Petrov"], birthDate: ["1965-03-02"], nationality: ["ru"] } } } });
    expect(res).toMatchObject({ provider: "opensanctions", listVersion: "sanctions@20261102120000-abc", listsChecked: ["sanctions", "us_ofac_sdn", "us_ofac_cons", "un_sc_sanctions"] });
    expect(res.matches[0]).toEqual({ entryId: "NK-1", name: "Ivan PETROV", score: 0.92, lists: ["us_ofac_sdn"], programs: ["sanction"], birthDates: ["1965-03-02"], countries: ["ru"], providerMatch: true });
    expect(classifyResponse(res).result).toBe("potential_match");
  });

  it("raises ScreeningUnavailableError on HTTP failures", async () => {
    const client = new OpenSanctionsClient({ apiKey: "k", fetchImpl: (async () => new Response("no", { status: 429 })) as unknown as typeof fetch });
    await expect(client.screen({ kind: "entity", name: "Acme" })).rejects.toThrow(/HTTP 429/);
  });
});
