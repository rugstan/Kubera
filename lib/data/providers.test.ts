import { describe, expect, it, vi } from "vitest";
import { AttomClient, parseAttomDetail, parseMortgages, parseSalesComp } from "./attom";
import { FemaNfhlClient, isSpecialFloodHazardArea, parseFloodFeature } from "./fema";
import { getJson, isoDate, median, num } from "./http";
import { OpenCorporatesClient, looksLikeEntity, normalizeEntityName, parseCompany, pickExactMatch } from "./opencorporates";
import { RegridClient, addressQuery, parseRegridFeature } from "./regrid";
import { HelloDataClient, RentometerClient, parseExpenseBenchmarks, parseRentComp, parseRentometer } from "./rent";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fetchReturning = (body: unknown, status = 200) => vi.fn(async (..._args: unknown[]) => json(body, status));
const asFetch = (f: ReturnType<typeof fetchReturning>) => f as unknown as (input: string, init?: RequestInit) => Promise<Response>;
const urlOf = (f: ReturnType<typeof fetchReturning>) => String(f.mock.calls[0]![0]);

describe("http helpers", () => {
  it("reads numbers and dates tolerantly", () => {
    expect(num("$1,250,000")).toBe(1_250_000);
    expect(num("")).toBeUndefined();
    expect(num("abc")).toBeUndefined();
    expect(isoDate("2024-03-05T00:00:00Z")).toBe("2024-03-05");
    expect(isoDate("3/5/2024")).toBe("2024-03-05");
    expect(isoDate("garbage")).toBeUndefined();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeUndefined();
  });

  it("returns error codes instead of throwing", async () => {
    expect(await getJson("https://x.test", { fetchImpl: async () => json({}, 500) })).toEqual({ ok: false, status: 500, error: "http-500" });
    expect(await getJson("https://x.test", { fetchImpl: async () => new Response("<html>", { status: 200 }) })).toMatchObject({ ok: false, error: "invalid-json" });
    expect(await getJson("https://x.test", { fetchImpl: async () => Promise.reject(new Error("ECONNRESET")) })).toEqual({ ok: false, error: "network-error" });
    const timeout = Object.assign(new Error("t"), { name: "TimeoutError" });
    expect(await getJson("https://x.test", { fetchImpl: async () => Promise.reject(timeout) })).toEqual({ ok: false, error: "timeout" });
  });
});

describe("Regrid", () => {
  const feature = {
    properties: {
      fields: {
        parcelnumb: "5143-012-007",
        owner: "WILSHIRE HOLDINGS LLC",
        lat: "34.0522",
        lon: "-118.2437",
        county: "Los Angeles",
        scity: "Los Angeles",
        state2: "ca",
        szip5: "90017",
        yearbuilt: 1972,
        numunits: 24,
        numstories: 3,
        ll_bldg_footprint_sqft: 7200,
        ll_gisacre: 0.42,
        usedesc: "Apartments",
        parval: "2450000",
        saleprice: 2900000,
        saledate: "2014-06-12",
        yearbuilt_zero: 0,
      },
    },
  };

  it("parses a parcel feature, approximating gross area from footprint and stories", () => {
    const p = parseRegridFeature(feature)!;
    expect(p).toMatchObject({ apn: "5143-012-007", owner: "WILSHIRE HOLDINGS LLC", yearBuilt: 1972, units: 24, buildingSqft: 21_600, state: "CA", assessedTotal: 2_450_000 });
    expect(p.coordinates).toEqual({ lat: 34.0522, lon: -118.2437 });
  });

  it("treats zero placeholders as missing and rejects out-of-range coordinates", () => {
    const p = parseRegridFeature({ properties: { fields: { parcelnumb: "1", yearbuilt: 0, numunits: 0, lat: 120, lon: 10 } } })!;
    expect(p.yearBuilt).toBeUndefined();
    expect(p.units).toBeUndefined();
    expect(p.coordinates).toBeUndefined();
  });

  it("builds the address query and passes the token", async () => {
    expect(addressQuery({ line1: "1 Main St", city: "Fresno", zip: "93721" })).toBe("1 Main St, Fresno, CA, 93721");
    const f = fetchReturning({ parcels: { features: [feature] } });
    const out = await new RegridClient("tok", asFetch(f)).lookupByAddress({ line1: "1 Main St", city: "Fresno" });
    expect(out.status).toBe("ok");
    expect(urlOf(f)).toContain("app.regrid.com/api/v2/parcels/address");
    expect(urlOf(f)).toContain("token=tok");
  });

  it("maps no features to not_found, 404 to not_found and 500 to error", async () => {
    const c = (f: ReturnType<typeof fetchReturning>) => new RegridClient("t", asFetch(f));
    expect((await c(fetchReturning({ parcels: { features: [] } })).lookupByAddress({ line1: "x" })).status).toBe("not_found");
    expect((await c(fetchReturning({}, 404)).lookupByAddress({ line1: "x" })).status).toBe("not_found");
    expect(await c(fetchReturning({}, 500)).lookupByAddress({ line1: "x" })).toEqual({ status: "error", error: "http-500" });
  });

  it("never puts the token in an error", async () => {
    const out = await new RegridClient("secret-token", asFetch(fetchReturning({}, 401))).lookupByAddress({ line1: "x" });
    expect(JSON.stringify(out)).not.toContain("secret-token");
  });
});

describe("OpenCorporates", () => {
  const company = (over: Record<string, unknown> = {}) => ({
    company: {
      name: "WILSHIRE HOLDINGS LLC",
      company_number: "201912345678",
      jurisdiction_code: "us_ca",
      current_status: "Active",
      incorporation_date: "2019-04-02",
      company_type: "Limited Liability Company",
      opencorporates_url: "https://opencorporates.com/companies/us_ca/201912345678",
      ...over,
    },
  });

  it("recognizes entity names and normalizes suffixes", () => {
    expect(looksLikeEntity("Wilshire Holdings LLC")).toBe(true);
    expect(looksLikeEntity("Smith Family Trust")).toBe(true);
    expect(looksLikeEntity("John Q Smith")).toBe(false);
    expect(normalizeEntityName("Wilshire Holdings, L.L.C.")).toBe(normalizeEntityName("WILSHIRE HOLDINGS LLC"));
  });

  it("parses status and activity", () => {
    expect(parseCompany(company())).toMatchObject({ name: "WILSHIRE HOLDINGS LLC", active: true, status: "Active", jurisdiction: "us_ca" });
    expect(parseCompany(company({ current_status: "Suspended - FTB" }))?.active).toBe(false);
    expect(parseCompany(company({ current_status: "Active", dissolution_date: "2024-01-01" }))?.active).toBe(false);
    expect(parseCompany(company({ company_number: undefined }))).toBeUndefined();
  });

  it("only accepts an exact normalized-name match, preferring an active one", () => {
    const dissolved = parseCompany(company({ current_status: "Dissolved", company_number: "1" }))!;
    const active = parseCompany(company({ company_number: "2" }))!;
    const other = parseCompany(company({ name: "WILSHIRE HOLDINGS II LLC", company_number: "3" }))!;
    expect(pickExactMatch("Wilshire Holdings LLC", [dissolved, other, active])).toBe(active);
    expect(pickExactMatch("Wilshire Holdings LLC", [other])).toBeUndefined();
  });

  it("searches California and returns not_found when nothing matches exactly", async () => {
    const f = fetchReturning({ results: { companies: [company()] } });
    const hit = await new OpenCorporatesClient("tok", asFetch(f)).searchEntity("Wilshire Holdings LLC");
    expect(hit.status).toBe("ok");
    expect(urlOf(f)).toContain("jurisdiction_code=us_ca");
    const miss = await new OpenCorporatesClient("tok", asFetch(fetchReturning({ results: { companies: [company()] } }))).searchEntity("Other Name LLC");
    expect(miss.status).toBe("not_found");
  });
});

describe("FEMA NFHL", () => {
  it("classifies special flood hazard areas", () => {
    expect(isSpecialFloodHazardArea("AE")).toBe(true);
    expect(isSpecialFloodHazardArea("X")).toBe(false);
    expect(isSpecialFloodHazardArea("X", "T")).toBe(true);
    expect(parseFloodFeature({ attributes: { FLD_ZONE: "AE", SFHA_TF: "T", STATIC_BFE: 112.5, DFIRM_ID: "06037C" } })).toMatchObject({ zone: "AE", specialFloodHazardArea: true, baseFloodElevationFt: 112.5 });
    expect(parseFloodFeature({ attributes: { FLD_ZONE: "X", STATIC_BFE: -9999 } })?.baseFloodElevationFt).toBeUndefined();
    expect(parseFloodFeature({ attributes: {} })).toBeUndefined();
  });

  it("queries the point as lon,lat and prefers the hazardous overlapping zone", async () => {
    const f = fetchReturning({ features: [{ attributes: { FLD_ZONE: "X", SFHA_TF: "F" } }, { attributes: { FLD_ZONE: "AE", SFHA_TF: "T" } }] });
    const out = await new FemaNfhlClient(asFetch(f)).lookup({ lat: 34.05, lon: -118.24 });
    expect(out).toMatchObject({ status: "ok", data: { zone: "AE" } });
    expect(decodeURIComponent(urlOf(f))).toContain("geometry=-118.24,34.05");
  });

  it("handles empty results and ArcGIS error bodies", async () => {
    expect((await new FemaNfhlClient(asFetch(fetchReturning({ features: [] }))).lookup({ lat: 1, lon: 1 })).status).toBe("not_found");
    expect((await new FemaNfhlClient(asFetch(fetchReturning({ error: { code: 500 } }))).lookup({ lat: 1, lon: 1 })).status).toBe("error");
  });
});

describe("ATTOM", () => {
  const property = {
    identifier: { apn: "5143012007" },
    location: { latitude: "34.0523", longitude: "-118.2436" },
    summary: { yearbuilt: 1972 },
    building: { summary: { unitsCount: 24 }, size: { universalSize: 22000 } },
    lot: { lotSize1: 0.42 },
    assessment: { assessed: { assdTtlValue: 2450000 }, tax: { taxAmt: 29400 } },
    sale: { saleTransDate: "2014-06-12", saleAmountData: { saleAmt: 2900000 } },
    owner: { owner1: { fullName: "Wilshire Holdings LLC" } },
    mortgage: {
      FirstConcurrent: { lenderLastName: "Pacific Mutual Bank", amount: 1800000, date: "2019-08-01", dueDate: "2029-08-01", interestRate: 4.25 },
      SecondConcurrent: {},
    },
  };

  it("parses detail, mortgage and ownership", () => {
    const d = parseAttomDetail(property)!;
    expect(d).toMatchObject({ apn: "5143012007", ownerOfRecord: "Wilshire Holdings LLC", yearBuilt: 1972, units: 24, buildingSqft: 22_000, annualTaxes: 29_400, lastSalePrice: 2_900_000 });
    expect(d.coordinates).toEqual({ lat: 34.0523, lon: -118.2436 });
    expect(d.mortgages).toEqual([{ lender: "Pacific Mutual Bank", originalAmount: 1_800_000, originationDate: "2019-08-01", maturityDate: "2029-08-01", interestRatePct: 4.25 }]);
    expect(parseMortgages(undefined)).toEqual([]);
  });

  it("computes price per unit on sales comps", () => {
    const c = parseSalesComp({ address: { oneLine: "99 Olive St, Los Angeles, CA" }, sale: { amount: { saleamt: 4_800_000 }, salesearchdate: "2026-03-01" }, building: { summary: { unitsCount: 16 } } })!;
    expect(c).toMatchObject({ address: "99 Olive St, Los Angeles, CA", salePrice: 4_800_000, units: 16, pricePerUnit: 300_000, saleDate: "2026-03-01" });
    expect(parseSalesComp({ sale: {} })).toBeUndefined();
  });

  it("sends the api key as a header, not in the URL", async () => {
    const f = fetchReturning({ property: [property] });
    const out = await new AttomClient("key123", asFetch(f)).deedAndMortgage({ line1: "1234 Wilshire Blvd", city: "Los Angeles", zip: "90017" });
    expect(out.status).toBe("ok");
    expect(urlOf(f)).not.toContain("key123");
    expect((f.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ apikey: "key123" });
    expect(decodeURIComponent(urlOf(f))).toContain("address2=Los Angeles, CA 90017");
  });

  it("returns not_found for an empty property list and filters comps by unit count", async () => {
    expect((await new AttomClient("k", asFetch(fetchReturning({ property: [] }))).deedAndMortgage({ line1: "x" })).status).toBe("not_found");
    const comps = fetchReturning({
      property: [
        { address: { oneLine: "A" }, sale: { amount: { saleamt: 1 } }, building: { summary: { unitsCount: 3 } } },
        { address: { oneLine: "B" }, sale: { amount: { saleamt: 1 } }, building: { summary: { unitsCount: 12 } } },
      ],
    });
    const out = await new AttomClient("k", asFetch(comps)).salesComps({ center: { lat: 34, lon: -118 }, minUnits: 5, since: "2024-01-01" });
    expect(out).toMatchObject({ status: "ok", data: [{ address: "B" }] });
    expect(urlOf(comps)).toContain("startsalesearchdate=2024%2F01%2F01");
  });
});

describe("HelloData and Rentometer", () => {
  it("parses rent comps and expense benchmarks with percent normalization", () => {
    expect(parseRentComp({ building_name: "Grand Court", beds: 2, effective_rent: "2650", sqft: 900, occupancy: 0.94, concession_pct: 3 })).toMatchObject({ name: "Grand Court", rent: 2650, occupancyPct: 94, concessionPct: 3 });
    expect(parseRentComp({ unrelated: true })).toBeUndefined();
    expect(parseExpenseBenchmarks({ opex_per_unit: 6900, management_fee_pct: 0.04 })).toEqual({ opexPerUnit: 6900, managementFeePct: 4 });
    expect(parseExpenseBenchmarks({})).toBeUndefined();
  });

  it("computes median rent and rent per square foot", async () => {
    const f = fetchReturning({
      comps: [
        { street_address: "A", beds: 2, effective_rent: 2600, sqft: 1000 },
        { street_address: "B", beds: 2, effective_rent: 3000, sqft: 1000 },
        { street_address: "C", beds: 2, effective_rent: 2800, sqft: 1000 },
      ],
      expense_benchmarks: { opex_per_unit: 7000 },
    });
    const out = await new HelloDataClient("k", asFetch(f)).rentComps({ line1: "1 Main", city: "LA" }, { bedrooms: 2 });
    expect(out).toMatchObject({ status: "ok", data: { medianRent: 2800, medianRentPerSqft: 2.8, expenseBenchmarks: { opexPerUnit: 7000 } } });
    expect((f.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ "x-api-key": "k" });
    expect((await new HelloDataClient("k", asFetch(fetchReturning({ comps: [] }))).rentComps({ line1: "x" })).status).toBe("not_found");
  });

  it("parses Rentometer summaries per bedroom count", async () => {
    expect(parseRentometer({ mean: 2500, median: 2450, percentile_25: 2200, percentile_75: 2800, samples: 41 }, 2)).toEqual({ bedrooms: 2, mean: 2500, median: 2450, percentile25: 2200, percentile75: 2800, sampleSize: 41 });
    expect(parseRentometer({}, 2)).toBeUndefined();
    const f = fetchReturning({ mean: 2500, median: 2450 });
    const out = await new RentometerClient("k", asFetch(f)).estimate({ line1: "1 Main", city: "LA" }, { bedrooms: 2, bathrooms: 1 });
    expect(out.status).toBe("ok");
    expect(urlOf(f)).toContain("bedrooms=2");
    expect(urlOf(f)).toContain("baths=1");
  });
});
