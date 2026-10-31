import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanAddress, normalizeAddress, normalizeApn } from "./address";
import { buildDataClients, NO_CLIENTS, dataClients, setDataClients } from "./clients";
import { FakeDeedClient, FakeEntityClient, FakeFloodClient, FakeParcelClient, FakeRentCompClient, FakeRentEstimateClient } from "./fakes";
import { ADDRESS, DEED, FLOOD_X, PARCEL, RENT_COMPS } from "./fixtures";
import { resetLogOnce } from "./http";
import { FIELD_PRIORITY, mergePropertyFacts, pickFact, sameOwner } from "./merge";
import { getPropertyFacts } from "./property-facts";
import { InMemoryPropertyFactsStore } from "./store";
import { fromRow, toRow } from "./store-supabase";
import { SOURCE_NAMES, type DataClients } from "./types";

const NOW = new Date("2026-10-31T12:00:00Z");
const now = () => NOW;

function world() {
  const regrid = new FakeParcelClient().set(ADDRESS, PARCEL);
  const attom = new FakeDeedClient().set(ADDRESS, DEED);
  attom.comps = [{ address: "99 Olive St", salePrice: 4_800_000, units: 16, pricePerUnit: 300_000 }];
  const entity = new FakeEntityClient().set({ name: "Wilshire Holdings LLC", jurisdiction: "us_ca", companyNumber: "2019", status: "Active", active: true });
  const fema = new FakeFloodClient().set(PARCEL.coordinates!, FLOOD_X);
  const hellodata = new FakeRentCompClient().set(ADDRESS, RENT_COMPS);
  const rentometer = new FakeRentEstimateClient().set({ bedrooms: 1, median: 2_100 }).set({ bedrooms: 2, median: 2_700 });
  const clients: DataClients = { regrid, opencorporates: entity, fema, attom, hellodata, rentometer };
  return { regrid, attom, entity, fema, hellodata, rentometer, clients };
}

describe("address normalization", () => {
  it("gives the same key for the same address typed two ways", () => {
    const a = normalizeAddress({ line1: "1234 Wilshire Boulevard, Suite 4", city: "Los  Angeles", state: "California", zip: "90017-1234" });
    const b = normalizeAddress({ line1: "1234 wilshire blvd ste 4", city: "los angeles", state: "CA", zip: "90017" });
    expect(a).toBe(b);
    expect(a).toBe("1234 wilshire blvd ste 4|los angeles|ca|90017");
  });

  it("defaults state to CA and cleans whitespace", () => {
    expect(cleanAddress({ line1: "  1  Main   St ", city: " Fresno " })).toEqual({ line1: "1 Main St", city: "Fresno", state: "CA" });
  });

  it("compares APNs without punctuation or leading zeros", () => {
    expect(normalizeApn("5143-012-007")).toBe(normalizeApn("5143012007"));
    expect(normalizeApn("0123-456")).toBe(normalizeApn("123456"));
  });
});

describe("pickFact and sameOwner", () => {
  it("scores confidence by agreement and records alternates", () => {
    expect(pickFact([{ source: "regrid", value: 1972 }]).fact).toMatchObject({ value: 1972, confidence: "medium" });
    expect(pickFact([{ source: "regrid", value: 1972 }, { source: "attom", value: 1972 }]).fact).toMatchObject({ confidence: "high" });
    const conflict = pickFact([{ source: "regrid", value: 1972 }, { source: "attom", value: 1985 }]);
    expect(conflict.conflict).toBe(true);
    expect(conflict.fact).toMatchObject({ value: 1972, source: "regrid", confidence: "low", alternates: [{ value: 1985, source: "attom" }] });
    expect(pickFact([])).toEqual({ conflict: false });
  });

  it("treats reordered names and entity suffixes as the same owner", () => {
    expect(sameOwner("SMITH JOHN", "John Smith")).toBe(true);
    expect(sameOwner("Wilshire Holdings, L.L.C.", "WILSHIRE HOLDINGS LLC")).toBe(true);
    expect(sameOwner("Wilshire Holdings LLC", "Olive Holdings LLC")).toBe(false);
  });

  it("documents the source priority for every merged field", () => {
    expect(FIELD_PRIORITY.owner[0]).toBe("attom");
    expect(FIELD_PRIORITY.yearBuilt[0]).toBe("regrid");
    expect(FIELD_PRIORITY.units[0]).toBe("attom");
  });
});

describe("getPropertyFacts with fakes", () => {
  it("merges every source into one record with provenance", async () => {
    const { clients } = world();
    const f = await getPropertyFacts(ADDRESS, { clients, now });
    expect(f.apn).toMatchObject({ value: "5143-012-007", source: "regrid", confidence: "high" });
    expect(f.owner).toMatchObject({ source: "attom", confidence: "high" });
    expect(f.yearBuilt).toMatchObject({ value: 1972, confidence: "high" });
    expect(f.units).toMatchObject({ value: 24, confidence: "high" });
    expect(f.buildingSqft?.value).toBe(22_000);
    expect(f.assessedValue?.value).toEqual({ total: 2_450_000, land: 980_000, improvements: 1_470_000 });
    expect(f.annualTaxes?.value).toBe(29_400);
    expect(f.lastSale?.value).toEqual({ price: 2_900_000, date: "2014-06-12" });
    expect(f.mortgages?.value[0]?.lender).toBe("Pacific Mutual Bank");
    expect(f.ownerEntity?.value).toMatchObject({ active: true, status: "Active" });
    expect(f.flood?.value.zone).toBe("X");
    expect(f.rentComps?.value.medianRent).toBe(2_725);
    expect(f.expenseBenchmarks?.value.opexPerUnit).toBe(6_900);
    expect(f.rentEstimates?.value.map((e) => e.bedrooms)).toEqual([1, 2]);
    expect(f.salesComps?.value[0]?.pricePerUnit).toBe(300_000);
    expect(f.county?.value).toBe("Los Angeles");
    expect(f.flags).toEqual([]);
    expect(f.fromCache).toBe(false);
    for (const s of SOURCE_NAMES) expect(f.sources[s].status).toBe("ok");
    expect(f.expiresAt).toBe(new Date(NOW.getTime() + 30 * 86_400_000).toISOString());
  });

  it("calls flood, comps and entity lookups with what the first stage found", async () => {
    const w = world();
    await getPropertyFacts(ADDRESS, { clients: w.clients, now });
    expect(w.fema.calls).toEqual([PARCEL.coordinates]);
    expect(w.entity.calls).toEqual([{ name: "Wilshire Holdings LLC", jurisdiction: "us_ca" }]);
    expect(w.rentometer.calls).toHaveLength(2);
    expect(w.attom.calls).toHaveLength(2); // deed + sales comps
  });

  it("degrades when sources are not configured and never throws", async () => {
    const regridOnly: DataClients = { ...NO_CLIENTS, regrid: world().regrid };
    const f = await getPropertyFacts(ADDRESS, { clients: regridOnly, now });
    expect(f.sources.regrid.status).toBe("ok");
    expect(f.sources.attom.status).toBe("not_configured");
    expect(f.sources.fema_nfhl.status).toBe("not_configured");
    expect(f.yearBuilt).toMatchObject({ value: 1972, confidence: "medium" });
    expect(f.flood).toBeUndefined();
    const none = await getPropertyFacts(ADDRESS, { clients: NO_CLIENTS, now });
    expect(none.apn).toBeUndefined();
    expect(Object.values(none.sources).every((s) => s.status === "not_configured")).toBe(true);
  });

  it("keeps the other sources when one fails, flags the gap and shortens the cache life", async () => {
    const w = world();
    w.attom.failure = { error: "http-503" };
    const f = await getPropertyFacts(ADDRESS, { clients: w.clients, now });
    expect(f.sources.attom).toEqual({ status: "error", detail: "http-503" });
    expect(f.apn?.source).toBe("regrid");
    expect(f.flags.map((x) => x.code)).toContain("sources_incomplete");
    expect(f.expiresAt).toBe(new Date(NOW.getTime() + 3_600_000).toISOString());
  });

  it("survives a client that throws", async () => {
    const w = world();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    w.clients.regrid = { lookupByAddress: async () => Promise.reject(new Error("boom")) };
    const f = await getPropertyFacts(ADDRESS, { clients: w.clients, now });
    expect(f.sources.regrid).toEqual({ status: "error", detail: "client-exception" });
    expect(f.yearBuilt?.source).toBe("attom");
    spy.mockRestore();
  });

  it("skips flood and comps without coordinates unless the caller supplies them", async () => {
    const w = world();
    w.regrid.set(ADDRESS, { ...PARCEL, coordinates: undefined });
    w.attom.set(ADDRESS, { ...DEED, coordinates: undefined });
    const f = await getPropertyFacts(ADDRESS, { clients: w.clients, now });
    expect(f.sources.fema_nfhl).toEqual({ status: "skipped", detail: "no coordinates" });
    expect(w.fema.calls).toHaveLength(0);
    const g = await getPropertyFacts(ADDRESS, { clients: w.clients, now, coordinates: PARCEL.coordinates, force: true });
    expect(g.sources.fema_nfhl.status).toBe("ok");
  });

  it("flags conflicting year built, units and APN with both values visible", async () => {
    const w = world();
    w.attom.set(ADDRESS, { ...DEED, yearBuilt: 1985, units: 20, apn: "9999-999-999" });
    const f = await getPropertyFacts(ADDRESS, { clients: w.clients, now });
    const codes = f.flags.map((x) => x.code);
    expect(codes).toEqual(expect.arrayContaining(["conflict_year_built", "conflict_units", "conflict_apn"]));
    expect(f.yearBuilt).toMatchObject({ value: 1972, source: "regrid", confidence: "low", alternates: [{ value: 1985, source: "attom" }] });
    expect(f.units).toMatchObject({ value: 20, source: "attom", confidence: "low" });
  });

  it("flags owners that differ between deed and assessor, and sqft that differ by more than 15%", async () => {
    const w = world();
    w.attom.set(ADDRESS, { ...DEED, ownerOfRecord: "Olive Capital LLC", buildingSqft: 30_000 });
    const f = await getPropertyFacts(ADDRESS, { clients: w.clients, now });
    expect(f.flags.map((x) => x.code)).toEqual(expect.arrayContaining(["conflict_owner", "conflict_building_sqft"]));
  });

  it("rejects implausible values instead of merging them", async () => {
    const w = world();
    w.regrid.set(ADDRESS, { ...PARCEL, yearBuilt: 1066, units: 99_999 });
    w.attom.set(ADDRESS, { ...DEED, yearBuilt: undefined, units: undefined });
    const f = await getPropertyFacts(ADDRESS, { clients: w.clients, now });
    expect(f.yearBuilt).toBeUndefined();
    expect(f.units).toBeUndefined();
  });

  it("flags flood hazard areas, inactive owner entities and unverifiable entities", async () => {
    const w = world();
    w.fema.set(PARCEL.coordinates!, { zone: "AE", specialFloodHazardArea: true });
    w.entity.set({ name: "Wilshire Holdings LLC", jurisdiction: "us_ca", companyNumber: "2019", status: "Suspended", active: false });
    const f = await getPropertyFacts(ADDRESS, { clients: w.clients, now });
    expect(f.flags.map((x) => x.code)).toEqual(expect.arrayContaining(["flood_hazard_area", "owner_entity_inactive"]));

    const w2 = world();
    w2.clients.opencorporates = new FakeEntityClient(); // knows no entities
    const g = await getPropertyFacts(ADDRESS, { clients: w2.clients, now });
    expect(g.flags.map((x) => x.code)).toContain("owner_entity_unverified");
  });

  it("skips the registry for personal owners", async () => {
    const w = world();
    w.regrid.set(ADDRESS, { ...PARCEL, owner: "John Q Smith" });
    w.attom.set(ADDRESS, { ...DEED, ownerOfRecord: "John Q Smith" });
    const f = await getPropertyFacts(ADDRESS, { clients: w.clients, now });
    expect(w.entity.calls).toHaveLength(0);
    expect(f.sources.opencorporates).toEqual({ status: "skipped", detail: "owner is not an entity" });
    expect(f.ownerEntity).toBeUndefined();
  });

  it("flags properties outside California so the CA rules are not applied", async () => {
    const w = world();
    const reno = { line1: "10 Virginia St", city: "Reno", state: "NV", zip: "89501" };
    w.regrid.set(reno, { ...PARCEL, state: "NV", coordinates: { lat: 39.53, lon: -119.81 } });
    const f = await getPropertyFacts(reno, { clients: w.clients, now });
    expect(f.flags.map((x) => x.code)).toContain("outside_california");
  });

  it("flags a missing parcel", async () => {
    const w = world();
    const f = await getPropertyFacts({ line1: "1 Nowhere Rd", city: "Los Angeles" }, { clients: { ...NO_CLIENTS, regrid: w.regrid }, now });
    expect(f.flags.map((x) => x.code)).toContain("no_parcel_match");
  });
});

describe("property_facts cache", () => {
  it("serves the second lookup from cache without calling providers", async () => {
    const w = world();
    const store = new InMemoryPropertyFactsStore();
    const first = await getPropertyFacts(ADDRESS, { clients: w.clients, store, now });
    expect(first.fromCache).toBe(false);
    const callsAfterFirst = w.regrid.calls.length;
    const second = await getPropertyFacts({ ...ADDRESS, line1: "1234 WILSHIRE BOULEVARD" }, { clients: w.clients, store, now });
    expect(second.fromCache).toBe(true);
    expect(w.regrid.calls.length).toBe(callsAfterFirst);
    expect(second.apn).toEqual(first.apn);
  });

  it("refetches after expiry and when forced", async () => {
    const w = world();
    const store = new InMemoryPropertyFactsStore();
    await getPropertyFacts(ADDRESS, { clients: w.clients, store, now });
    const later = () => new Date(NOW.getTime() + 31 * 86_400_000);
    expect((await getPropertyFacts(ADDRESS, { clients: w.clients, store, now: later })).fromCache).toBe(false);
    expect((await getPropertyFacts(ADDRESS, { clients: w.clients, store, now: later })).fromCache).toBe(true);
    expect((await getPropertyFacts(ADDRESS, { clients: w.clients, store, now: later, force: true })).fromCache).toBe(false);
  });

  it("does not cache a lookup that produced no data", async () => {
    const store = new InMemoryPropertyFactsStore();
    await getPropertyFacts(ADDRESS, { clients: NO_CLIENTS, store, now });
    expect(store.puts).toBe(0);
  });

  it("honors ttlDays and survives a failing cache", async () => {
    const w = world();
    const f = await getPropertyFacts(ADDRESS, { clients: w.clients, now, ttlDays: 7 });
    expect(f.expiresAt).toBe(new Date(NOW.getTime() + 7 * 86_400_000).toISOString());
    const broken = {
      get: async () => Promise.reject(new Error("db down")),
      put: async () => Promise.reject(new Error("db down")),
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const g = await getPropertyFacts(ADDRESS, { clients: w.clients, store: broken, now });
    expect(g.apn?.value).toBe("5143-012-007");
    spy.mockRestore();
  });

  it("round-trips through the Supabase row mapping", async () => {
    const f = await getPropertyFacts(ADDRESS, { clients: world().clients, now });
    const row = toRow(f);
    expect(row).toMatchObject({ address_key: f.addressKey, apn: "5143-012-007", county: "Los Angeles", fetched_at: f.fetchedAt, expires_at: f.expiresAt });
    expect(JSON.parse(JSON.stringify(fromRow(row)))).toEqual({ ...f, fromCache: true });
  });
});

describe("env-gated clients", () => {
  const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
  beforeEach(() => {
    resetLogOnce();
    spy.mockClear();
  });
  afterEach(() => setDataClients(undefined));

  it("leaves unkeyed sources null, logs each missing key once and keeps FEMA on", () => {
    const c = buildDataClients({});
    expect(c).toMatchObject({ regrid: null, opencorporates: null, attom: null, hellodata: null, rentometer: null });
    expect(c.fema).not.toBeNull();
    buildDataClients({});
    expect(spy).toHaveBeenCalledTimes(5);
  });

  it("builds a client for each key and lets FEMA be disabled", () => {
    const c = buildDataClients({ REGRID_API_TOKEN: "a", OPENCORPORATES_API_TOKEN: "b", ATTOM_API_KEY: "c", HELLODATA_API_KEY: "d", RENTOMETER_API_KEY: "e", FEMA_NFHL_ENABLED: "false" });
    expect(c.regrid && c.opencorporates && c.attom && c.hellodata && c.rentometer).toBeTruthy();
    expect(c.fema).toBeNull();
  });

  it("lets tests inject clients", () => {
    setDataClients(NO_CLIENTS);
    expect(dataClients()).toBe(NO_CLIENTS);
  });
});

describe("mergePropertyFacts", () => {
  it("is pure: the same input gives the same output", () => {
    const raw = { parcel: { status: "ok" as const, data: PARCEL }, deed: { status: "ok" as const, data: DEED } };
    const ctx = { address: ADDRESS, addressKey: normalizeAddress(ADDRESS), now: NOW, ttlMs: 1000, degradedTtlMs: 10 };
    expect(mergePropertyFacts(raw, ctx)).toEqual(mergePropertyFacts(raw, ctx));
  });
});
