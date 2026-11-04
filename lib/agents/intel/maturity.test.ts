import { describe, expect, it } from "vitest";
import { AttomMaturityClient, FakeMaturityProvider, inWindow, maturityProviderFromEnv, ownerKindOf, parseAttomMaturity, parseOneLineAddress, propertyTypeFromText, windowDates } from "./maturity";
import { NOW, maturityRecord, plusMonths } from "./testing";

const attomProperty = (over: { dueDate?: string; amount?: number; type?: string; owner?: Record<string, unknown>; state?: string } = {}) => ({
  identifier: { apn: "5555-001-002", attomId: 12345 },
  address: { line1: "100 EXAMPLE AVE", locality: "Los Angeles", countrySubd: over.state ?? "CA", postal1: "90001" },
  summary: { proptype: over.type ?? "APARTMENT", yearbuilt: 1978 },
  building: { summary: { unitsCount: 48 }, size: { universalSize: 41000 } },
  owner: { owner1: { fullName: "EXAMPLE COURT PARTNERS LLC" }, corporateIndicator: "Y", mailingAddressOneLine: "200 SAMPLE PLAZA, PASADENA, CA 91101", ...over.owner },
  mortgage: { FirstConcurrent: { amount: over.amount ?? 7_400_000, date: "2017-01-15", dueDate: over.dueDate ?? plusMonths(8), interestRate: 4.1, lenderLastName: "SAMPLE COMMUNITY BANK", loanTypeCode: "FIX" } },
  sale: { saleAmountData: { saleAmt: 11_200_000 }, saleTransDate: "2016-12-20" },
});

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

describe("classification helpers", () => {
  it("maps provider use descriptions to property types", () => {
    expect(propertyTypeFromText("APARTMENT")).toBe("multifamily");
    expect(propertyTypeFromText("Nursing Home / Assisted Living")).toBe("senior_housing");
    expect(propertyTypeFromText("HOTEL/MOTEL")).toBe("hotel");
    expect(propertyTypeFromText("Warehouse")).toBe("industrial");
    expect(propertyTypeFromText("Office building")).toBe("office");
    expect(propertyTypeFromText("Self storage")).toBe("self_storage");
    expect(propertyTypeFromText("Mixed use")).toBe("mixed_use");
    expect(propertyTypeFromText("Shopping center")).toBe("retail");
    expect(propertyTypeFromText("")).toBe("other");
  });

  it("separates entities from people, and leaves trusts unknown", () => {
    expect(ownerKindOf("Example Court Partners LLC")).toBe("entity");
    expect(ownerKindOf("Jane Q Sample")).toBe("individual");
    expect(ownerKindOf("Sample Family Trust")).toBe("unknown");
    expect(ownerKindOf("Whoever", "Y")).toBe("entity");
    expect(ownerKindOf(null)).toBe("unknown");
  });

  it("parses a one-line mailing address", () => {
    expect(parseOneLineAddress("200 SAMPLE PLAZA, PASADENA, CA 91101-1234")).toEqual({ line1: "200 SAMPLE PLAZA", city: "PASADENA", state: "CA", zip: "91101" });
    expect(parseOneLineAddress("PO BOX 5")).toEqual({ line1: "PO BOX 5", city: null, state: null, zip: null });
    expect(parseOneLineAddress(undefined)).toBeNull();
  });
});

describe("windows", () => {
  it("computes dates around today", () => {
    expect(windowDates({ fromMonths: -6, toMonths: 18 }, NOW)).toEqual({ from: "2026-05-05", to: "2028-05-05" });
    expect(inWindow(maturityRecord({ loan: { maturityDate: plusMonths(8) } }), { fromMonths: 0, toMonths: 12 }, NOW)).toBe(true);
    expect(inWindow(maturityRecord({ loan: { maturityDate: plusMonths(30) } }), { fromMonths: 0, toMonths: 12 }, NOW)).toBe(false);
  });
});

describe("parseAttomMaturity", () => {
  it("builds a record from an ATTOM property with its mortgage and owner", () => {
    const r = parseAttomMaturity(attomProperty(), { fromMonths: 0, toMonths: 18 }, NOW, "2026-11-05")!;
    expect(r).toMatchObject({
      source: "attom",
      sourceRef: "12345",
      apn: "5555-001-002",
      propertyType: "multifamily",
      units: 48,
      ownerKind: "entity",
      mailing: { line1: "200 SAMPLE PLAZA", city: "PASADENA", state: "CA", zip: "91101" },
      address: { line1: "100 Example Ave", city: "Los Angeles", state: "CA", zip: "90001" },
      loan: { originalAmount: 7_400_000, maturityDate: plusMonths(8), ratePct: 4.1 },
      dataAsOf: "2026-11-05",
    });
    expect(r.ownerName).toBe("Example Court Partners LLC");
    expect(r.lastSalePrice).toBe(11_200_000);
  });

  it("ignores a property whose mortgage matures outside the window or that has no address", () => {
    expect(parseAttomMaturity(attomProperty({ dueDate: plusMonths(40) }), { fromMonths: 0, toMonths: 18 }, NOW, "x")).toBeUndefined();
    expect(parseAttomMaturity({ ...attomProperty(), address: {} }, { fromMonths: 0, toMonths: 18 }, NOW, "x")).toBeUndefined();
    expect(parseAttomMaturity("nope", { fromMonths: 0, toMonths: 18 }, NOW, "x")).toBeUndefined();
  });
});

describe("AttomMaturityClient", () => {
  const q = { zips: ["90001"], fromMonths: 0, toMonths: 18 };

  it("searches each ZIP and type with the API key header and returns matching records", async () => {
    const seen: { url: string; key: string | null }[] = [];
    const client = new AttomMaturityClient("KEY", async (url, init) => {
      seen.push({ url: String(url), key: new Headers(init?.headers).get("apikey") });
      return json({ status: { total: 2 }, property: [attomProperty(), attomProperty({ dueDate: plusMonths(60) })] });
    });
    const out = await client.search({ ...q, propertyTypes: ["multifamily", "hotel"] }, NOW);
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    expect(out.data).toHaveLength(2); // one in-window property per type request
    expect(seen).toHaveLength(2);
    expect(seen[0]!.key).toBe("KEY");
    expect(seen[0]!.url).toContain("postalcode=90001");
    expect(seen[0]!.url).toContain("propertytype=APARTMENT");
    expect(seen[1]!.url).toContain("propertytype=HOTEL%2FMOTEL");
  });

  it("pages until a short page and honors the minimum loan amount and the result cap", async () => {
    let calls = 0;
    const client = new AttomMaturityClient(
      "KEY",
      async () => {
        calls++;
        return json({ property: Array.from({ length: 2 }, (_, i) => attomProperty({ amount: i === 0 ? 500_000 : 3_000_000 })) });
      },
      undefined,
      { pageSize: 2, maxPagesPerZip: 3 },
    );
    const out = await client.search({ ...q, minLoanAmount: 1_000_000, maxResults: 2 }, NOW);
    expect(calls).toBe(2); // stops once the cap is reached
    expect(out.status === "ok" && out.data.every((r) => (r.loan.originalAmount ?? 0) >= 1_000_000)).toBe(true);
    expect(out.status === "ok" && out.data).toHaveLength(2);
  });

  it("reports a provider failure as an error without throwing, and 404 as no results", async () => {
    expect(await new AttomMaturityClient("KEY", async () => new Response("", { status: 401 })).search(q, NOW)).toEqual({ status: "error", error: "http-401" });
    expect(await new AttomMaturityClient("KEY", async () => new Response("", { status: 404 })).search(q, NOW)).toEqual({ status: "not_found" });
    expect(await new AttomMaturityClient("KEY", async () => Promise.reject(new Error("socket"))).search(q, NOW)).toEqual({ status: "error", error: "network-error" });
    expect(await new AttomMaturityClient("KEY").search({ ...q, zips: ["abc"] }, NOW)).toEqual({ status: "error", error: "no-valid-zip" });
  });
});

describe("FakeMaturityProvider", () => {
  const rows = [maturityRecord(), maturityRecord({ address: { line1: "2 Other St", zip: "91201" }, propertyType: "hotel" }), maturityRecord({ address: { line1: "3 Far St" }, loan: { maturityDate: plusMonths(40) } })];

  it("filters by ZIP, type, window and minimum loan", async () => {
    const p = new FakeMaturityProvider(rows);
    const all = await p.search({ zips: ["90001", "91201"], fromMonths: 0, toMonths: 18 }, NOW);
    expect(all.status === "ok" && all.data).toHaveLength(2);
    const hotels = await p.search({ zips: ["90001", "91201"], propertyTypes: ["hotel"], fromMonths: 0, toMonths: 18 }, NOW);
    expect(hotels.status === "ok" && hotels.data.map((r) => r.address.line1)).toEqual(["2 Other St"]);
    expect((await p.search({ zips: ["90001"], fromMonths: 0, toMonths: 18, minLoanAmount: 50_000_000 }, NOW)).status).toBe("not_found");
    expect(p.queries).toHaveLength(3);
  });

  it("can be told to fail", async () => {
    expect(await new FakeMaturityProvider([], "provider down").search({ zips: ["90001"], fromMonths: 0, toMonths: 18 }, NOW)).toEqual({ status: "error", error: "provider down" });
  });
});

describe("maturityProviderFromEnv", () => {
  it("is off without a key, and ATTOM with one", () => {
    expect(maturityProviderFromEnv({})).toBeNull();
    expect(maturityProviderFromEnv({ ATTOM_API_KEY: "k" })?.name).toBe("attom");
    expect(maturityProviderFromEnv({ ATTOM_API_KEY: "k", MATURITY_PROVIDER: "off" })).toBeNull();
    expect(maturityProviderFromEnv({ ATTOM_API_KEY: "k", MATURITY_PROVIDER: "reonomy" })).toBeNull();
  });
});
