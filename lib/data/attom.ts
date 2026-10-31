import { asArray, asRecord, dig, firstNum, firstStr, getJson, isoDate, outcomeFromFailure, positive, stripUndefined, type FetchLike } from "./http";
import {
  notFound,
  ok,
  type DeedClient,
  type DeedMortgageRecord,
  type MortgageRecord,
  type PropertyAddress,
  type SalesComp,
  type SalesCompQuery,
  type SourceOutcome,
} from "./types";

// ATTOM Property API v1.0.0. The payload readers accept both the camelCase
// (`yearBuilt`) and lower-case (`yearbuilt`) spellings ATTOM uses across
// endpoints. VERIFY field paths against the subscription's data dictionary,
// and confirm the license permits caching normalized values in property_facts.

const BASE_URL = "https://api.gateway.attomdata.com/propertyapi/v1.0.0";

function address2(a: PropertyAddress): string {
  const region = [a.state ?? "CA", a.zip].filter(Boolean).join(" ");
  return [a.city, region].filter(Boolean).join(", ");
}

const MORTGAGE_KEYS = ["FirstConcurrent", "SecondConcurrent", "ThirdConcurrent"] as const;

export function parseMortgages(mortgage: unknown): MortgageRecord[] {
  const m = asRecord(mortgage);
  if (!m) return [];
  const out: MortgageRecord[] = [];
  for (const key of MORTGAGE_KEYS) {
    const row = asRecord(m[key]);
    if (!row) continue;
    const rec = stripUndefined<MortgageRecord>({
      lender: firstStr(row.lenderLastName, row.lenderName, row.lenderFullName),
      originalAmount: positive(row.amount),
      originationDate: isoDate(row.date),
      maturityDate: isoDate(row.dueDate),
      interestRatePct: positive(row.interestRate),
      loanType: firstStr(row.loanTypeCode, row.interestRateType),
    });
    if (Object.keys(rec).length > 0) out.push(rec);
  }
  return out;
}

export function parseAttomDetail(property: unknown): DeedMortgageRecord | undefined {
  const p = asRecord(property);
  if (!p) return undefined;
  const lat = firstNum(dig(p, "location", "latitude"));
  const lon = firstNum(dig(p, "location", "longitude"));
  const owner1 = asRecord(dig(p, "owner", "owner1"));
  const acres = positive(dig(p, "lot", "lotSize1")) ?? positive(dig(p, "lot", "lotsize1"));
  const rec: DeedMortgageRecord = {
    apn: firstStr(dig(p, "identifier", "apn")),
    ownerOfRecord: firstStr(owner1?.fullName, [owner1?.firstNameAndMi, owner1?.lastName].filter(Boolean).join(" ")),
    yearBuilt: positive(dig(p, "summary", "yearbuilt")) ?? positive(dig(p, "summary", "yearBuilt")) ?? positive(dig(p, "building", "summary", "yearBuilt")),
    units: positive(dig(p, "building", "summary", "unitsCount")) ?? positive(dig(p, "building", "summary", "unitscount")),
    buildingSqft: positive(dig(p, "building", "size", "universalSize")) ?? positive(dig(p, "building", "size", "universalsize")) ?? positive(dig(p, "building", "size", "bldgSize")),
    lotAcres: acres,
    assessedTotal: positive(dig(p, "assessment", "assessed", "assdTtlValue")),
    annualTaxes: positive(dig(p, "assessment", "tax", "taxAmt")),
    lastSalePrice: positive(dig(p, "sale", "saleAmountData", "saleAmt")) ?? positive(dig(p, "sale", "amount", "saleamt")),
    lastSaleDate: isoDate(dig(p, "sale", "saleTransDate")) ?? isoDate(dig(p, "sale", "saleAmountData", "saleRecDate")) ?? isoDate(dig(p, "sale", "salesearchdate")),
    mortgages: parseMortgages(p.mortgage),
  };
  if (lat !== undefined && lon !== undefined) rec.coordinates = { lat, lon };
  return stripUndefined(rec);
}

export function parseSalesComp(property: unknown): SalesComp | undefined {
  const p = asRecord(property);
  if (!p) return undefined;
  const address = firstStr(dig(p, "address", "oneLine"), dig(p, "address", "line1"));
  if (!address) return undefined;
  const salePrice = positive(dig(p, "sale", "amount", "saleamt")) ?? positive(dig(p, "sale", "saleAmountData", "saleAmt"));
  const units = positive(dig(p, "building", "summary", "unitsCount")) ?? positive(dig(p, "building", "summary", "unitscount"));
  return stripUndefined<SalesComp>({
    address,
    saleDate: isoDate(dig(p, "sale", "salesearchdate")) ?? isoDate(dig(p, "sale", "saleTransDate")),
    salePrice,
    units,
    yearBuilt: positive(dig(p, "summary", "yearbuilt")) ?? positive(dig(p, "building", "summary", "yearBuilt")),
    buildingSqft: positive(dig(p, "building", "size", "universalsize")) ?? positive(dig(p, "building", "size", "universalSize")),
    pricePerUnit: salePrice !== undefined && units !== undefined ? Math.round(salePrice / units) : undefined,
    distanceMiles: positive(dig(p, "location", "distance")),
  });
}

export class AttomClient implements DeedClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl?: FetchLike,
    private readonly baseUrl: string = BASE_URL,
  ) {}

  private get headers(): Record<string, string> {
    return { apikey: this.apiKey };
  }

  async deedAndMortgage(address: PropertyAddress): Promise<SourceOutcome<DeedMortgageRecord>> {
    const url = `${this.baseUrl}/property/detailmortgageowner?address1=${encodeURIComponent(address.line1)}&address2=${encodeURIComponent(address2(address))}`;
    const res = await getJson(url, { headers: this.headers, fetchImpl: this.fetchImpl });
    if (!res.ok) return outcomeFromFailure(res);
    // ATTOM answers 200 with status.code 1 ("no results") when the address is unknown.
    const first = asArray(asRecord(res.data)?.property)[0];
    const rec = parseAttomDetail(first);
    return rec && Object.keys(rec).length > 1 ? ok(rec) : notFound();
  }

  async salesComps(query: SalesCompQuery): Promise<SourceOutcome<SalesComp[]>> {
    const params = new URLSearchParams({
      latitude: String(query.center.lat),
      longitude: String(query.center.lon),
      radius: String(query.radiusMiles ?? 3),
      propertytype: "APARTMENT",
      orderby: "salesearchdate desc",
      pagesize: String(Math.min(Math.max(query.limit ?? 10, 1), 50)),
    });
    if (query.since) params.set("startsalesearchdate", query.since.replaceAll("-", "/"));
    const res = await getJson(`${this.baseUrl}/sale/snapshot?${params.toString()}`, { headers: this.headers, fetchImpl: this.fetchImpl });
    if (!res.ok) return outcomeFromFailure(res);
    let comps = asArray(asRecord(res.data)?.property)
      .map(parseSalesComp)
      .filter((c): c is SalesComp => c !== undefined);
    if (query.minUnits !== undefined) comps = comps.filter((c) => c.units === undefined || c.units >= query.minUnits!);
    if (comps.length === 0) return notFound();
    return ok(comps);
  }
}
