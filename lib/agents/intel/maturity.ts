// Recorded-mortgage data for refinance-maturity prospecting (WS-S).
//
// A MaturityProvider answers one question: which properties in these ZIP
// codes have a recorded mortgage that matures inside a window? The real
// client is ATTOM's Property API (env-gated on ATTOM_API_KEY, the same key
// the property-facts layer uses); tests and fake mode use FakeMaturityProvider.
// The interface is small on purpose so another vendor (Reonomy) is one class.
//
// VERIFY before the first real scan:
//   - ATTOM field paths below against the subscription's data dictionary
//   - that the ATTOM agreement permits using recorded-mortgage data to
//     identify prospects for solicitation, and caching it in `prospects`
//   - the `propertytype` filter values per endpoint
// The client never throws: transport, HTTP and parse failures come back as a
// SourceOutcome with a short code (the URL, which carries no key but may name
// a ZIP, is never included).

import { asArray, asRecord, dig, firstNum, firstStr, getJson, isoDate, logOnce, positive, type FetchLike } from "@/lib/data/http";
import { parseMortgages } from "@/lib/data/attom";
import { failed, notConfigured, notFound, ok, type SourceOutcome } from "@/lib/data/types";
import type { MailingAddress, MaturityRecord, OwnerKind, PropertyType } from "./types";

export type MaturityQuery = {
  /** Five-digit ZIP codes to search. */
  zips: string[];
  /** Property types to include; empty or missing = all the provider can filter. */
  propertyTypes?: PropertyType[];
  /** Window around today, in months. Negative `fromMonths` includes recently matured loans. */
  fromMonths: number;
  toMonths: number;
  /** Skip loans whose original amount is known and below this (dollars). */
  minLoanAmount?: number;
  /** Cap on records returned. */
  maxResults?: number;
};

export interface MaturityProvider {
  readonly name: "attom" | "reonomy" | "fake";
  search(query: MaturityQuery, now: Date): Promise<SourceOutcome<MaturityRecord[]>>;
}

export function windowDates(q: Pick<MaturityQuery, "fromMonths" | "toMonths">, now: Date): { from: string; to: string } {
  const shift = (months: number) => {
    const d = new Date(now.getTime());
    d.setUTCMonth(d.getUTCMonth() + months);
    return d.toISOString().slice(0, 10);
  };
  return { from: shift(q.fromMonths), to: shift(q.toMonths) };
}

export function inWindow(record: Pick<MaturityRecord, "loan">, q: Pick<MaturityQuery, "fromMonths" | "toMonths">, now: Date): boolean {
  const { from, to } = windowDates(q, now);
  return record.loan.maturityDate >= from && record.loan.maturityDate <= to;
}

// ---------------------------------------------------------------------------
// Classification helpers

/** Property type from the provider's use description ("APARTMENT", "NURSING HOME", "HOTEL/MOTEL"...). */
export function propertyTypeFromText(text: string | undefined | null): PropertyType {
  const t = (text ?? "").toLowerCase();
  if (!t) return "other";
  if (/nursing|assisted|congregate|senior|care facility|hospital|convalescent|retirement/.test(t)) return "senior_housing";
  if (/hotel|motel|lodging|inn\b|resort/.test(t)) return "hotel";
  if (/apartment|multi.?family|multi.?fam|duplex|triplex|fourplex|residential income/.test(t)) return "multifamily";
  if (/mixed/.test(t)) return "mixed_use";
  if (/storage/.test(t)) return "self_storage";
  if (/office/.test(t)) return "office";
  if (/industrial|warehouse|manufactur|distribution/.test(t)) return "industrial";
  if (/retail|shopping|store|restaurant|strip|supermarket|bank branch|commercial/.test(t)) return "retail";
  if (/church|school|special|auto|gas station|car wash|theater|golf/.test(t)) return "special_purpose";
  return "other";
}

const ENTITY = /\b(llc|l\.l\.c|inc|incorporated|corp|corporation|company|co\.?|ltd|lp|l\.p|llp|partners|partnership|holdings|properties|investments|investors|capital|realty|ventures|group|associates|enterprises|fund|reit|bank|association)\b/i;
const TRUST = /\b(trust|trustee|estate of|living trust)\b/i;

export function ownerKindOf(name: string | null, corporateIndicator?: unknown): OwnerKind {
  if (!name) return "unknown";
  const flag = typeof corporateIndicator === "string" ? corporateIndicator.trim().toUpperCase() : "";
  if (flag === "Y") return "entity";
  if (TRUST.test(name)) return "unknown";
  if (ENTITY.test(name)) return "entity";
  return flag === "N" ? "individual" : name.includes(" ") ? "individual" : "unknown";
}

/** "123 MAIN ST, LOS ANGELES, CA 90012" to parts. */
export function parseOneLineAddress(line: string | undefined | null): MailingAddress | null {
  if (!line) return null;
  const parts = line.split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const last = parts.at(-1) ?? "";
  const m = /^([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?$/.exec(last);
  if (parts.length >= 3 && m) return { line1: parts[0]!, city: parts.at(-2)!, state: m[1]!.toUpperCase(), zip: m[2]! };
  return { line1: parts[0]!, city: parts[1] ?? null, state: null, zip: null };
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(Llc|Lp|Llp|Inc|Rsd)\b/g, (w) => w.toUpperCase());
}

// ---------------------------------------------------------------------------
// ATTOM

const ATTOM_BASE = "https://api.gateway.attomdata.com/propertyapi/v1.0.0";

/** ATTOM `propertytype` filter values (VERIFY against the subscription). */
const ATTOM_TYPE_FILTER: Partial<Record<PropertyType, string>> = {
  multifamily: "APARTMENT",
  hotel: "HOTEL/MOTEL",
  senior_housing: "NURSING HOME",
  retail: "RETAIL TRADE",
  office: "OFFICE BUILDING",
  industrial: "INDUSTRIAL",
};

/** One ATTOM property with its recorded mortgage and owner to a MaturityRecord; the mortgage chosen is the earliest maturity inside the window. */
export function parseAttomMaturity(property: unknown, q: Pick<MaturityQuery, "fromMonths" | "toMonths">, now: Date, asOf: string): MaturityRecord | undefined {
  const p = asRecord(property);
  if (!p) return undefined;
  const line1 = firstStr(dig(p, "address", "line1"));
  if (!line1) return undefined;
  const { from, to } = windowDates(q, now);
  const mortgage = parseMortgages(p.mortgage)
    .filter((m) => m.maturityDate && m.maturityDate >= from && m.maturityDate <= to)
    .sort((a, b) => a.maturityDate!.localeCompare(b.maturityDate!))[0];
  if (!mortgage?.maturityDate) return undefined;

  const owner1 = asRecord(dig(p, "owner", "owner1"));
  const ownerName = firstStr(owner1?.fullName, [owner1?.firstNameAndMi, owner1?.lastName].filter(Boolean).join(" "));
  const typeText = [dig(p, "summary", "proptype"), dig(p, "summary", "propsubtype"), dig(p, "summary", "propertyType"), dig(p, "summary", "propclass")].map((v) => firstStr(v)).filter(Boolean).join(" ");
  const mailing = parseOneLineAddress(firstStr(dig(p, "owner", "mailingAddressOneLine"), dig(p, "owner", "mailingaddressoneline")));
  const state = firstStr(dig(p, "address", "countrySubd"))?.toUpperCase() ?? null;
  const sale = dig(p, "sale");

  return {
    source: "attom",
    sourceRef: firstStr(dig(p, "identifier", "attomId"), dig(p, "identifier", "Id")) ?? null,
    address: { line1: titleCase(line1), city: firstStr(dig(p, "address", "locality")) ?? null, state: state && /^[A-Z]{2}$/.test(state) ? state : null, zip: firstStr(dig(p, "address", "postal1"))?.slice(0, 5) ?? null },
    apn: firstStr(dig(p, "identifier", "apn")) ?? null,
    propertyType: propertyTypeFromText(typeText),
    units: positive(dig(p, "building", "summary", "unitsCount")) ?? positive(dig(p, "building", "summary", "unitscount")) ?? null,
    buildingSqft: positive(dig(p, "building", "size", "universalSize")) ?? positive(dig(p, "building", "size", "universalsize")) ?? null,
    yearBuilt: positive(dig(p, "summary", "yearbuilt")) ?? positive(dig(p, "summary", "yearBuilt")) ?? null,
    ownerName: ownerName ? titleCase(ownerName) : null,
    ownerKind: ownerKindOf(ownerName ?? null, dig(p, "owner", "corporateIndicator")),
    mailing,
    loan: {
      lender: mortgage.lender ?? null,
      originalAmount: mortgage.originalAmount ?? null,
      originationDate: mortgage.originationDate ?? null,
      maturityDate: mortgage.maturityDate,
      ratePct: mortgage.interestRatePct ?? null,
      loanType: mortgage.loanType ?? null,
    },
    lastSaleDate: isoDate(dig(sale, "saleTransDate")) ?? isoDate(dig(sale, "saleAmountData", "saleRecDate")) ?? null,
    lastSalePrice: positive(dig(sale, "saleAmountData", "saleAmt")) ?? positive(dig(sale, "amount", "saleamt")) ?? null,
    dataAsOf: asOf,
  };
}

export class AttomMaturityClient implements MaturityProvider {
  readonly name = "attom" as const;

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl?: FetchLike,
    private readonly baseUrl: string = ATTOM_BASE,
    private readonly opts: { pageSize?: number; maxPagesPerZip?: number } = {},
  ) {}

  async search(query: MaturityQuery, now: Date): Promise<SourceOutcome<MaturityRecord[]>> {
    const zips = [...new Set(query.zips.map((z) => z.trim()).filter((z) => /^\d{5}$/.test(z)))];
    if (!zips.length) return failed("no-valid-zip");
    const pageSize = Math.min(Math.max(this.opts.pageSize ?? 100, 1), 200);
    const maxPages = Math.max(this.opts.maxPagesPerZip ?? 3, 1);
    const cap = query.maxResults ?? 500;
    const types = query.propertyTypes?.length ? query.propertyTypes.map((t) => ATTOM_TYPE_FILTER[t]).filter((v): v is string => Boolean(v)) : [undefined];
    const asOf = now.toISOString().slice(0, 10);
    const out: MaturityRecord[] = [];
    let anySuccess = false;
    let lastError = "";

    outer: for (const zip of zips) {
      for (const type of types.length ? types : [undefined]) {
        for (let page = 1; page <= maxPages; page++) {
          const params = new URLSearchParams({ postalcode: zip, page: String(page), pagesize: String(pageSize) });
          if (type) params.set("propertytype", type);
          const res = await getJson(`${this.baseUrl}/property/detailmortgageowner?${params.toString()}`, { headers: { apikey: this.apiKey }, fetchImpl: this.fetchImpl });
          if (!res.ok) {
            // 404 = no results for this ZIP/type; anything else is an error worth reporting if nothing succeeds.
            if (res.status === 404) break;
            lastError = res.error;
            break;
          }
          anySuccess = true;
          const properties = asArray(asRecord(res.data)?.property);
          for (const prop of properties) {
            const rec = parseAttomMaturity(prop, query, now, asOf);
            if (!rec) continue;
            if (query.minLoanAmount !== undefined && rec.loan.originalAmount !== null && rec.loan.originalAmount < query.minLoanAmount) continue;
            out.push(rec);
            if (out.length >= cap) break outer;
          }
          const total = firstNum(dig(res.data, "status", "total"));
          if (properties.length < pageSize || (total !== undefined && page * pageSize >= total)) break;
        }
      }
    }
    if (!out.length) return anySuccess || !lastError ? notFound() : failed(lastError);
    return ok(out);
  }
}

// ---------------------------------------------------------------------------
// Fake

/** In-memory provider for tests and fake mode: filters its records by ZIP, window, type and minimum loan. */
export class FakeMaturityProvider implements MaturityProvider {
  readonly name = "fake" as const;
  readonly queries: MaturityQuery[] = [];

  constructor(
    private readonly records: readonly MaturityRecord[],
    private readonly failure?: string,
  ) {}

  async search(query: MaturityQuery, now: Date): Promise<SourceOutcome<MaturityRecord[]>> {
    this.queries.push(structuredClone(query));
    if (this.failure) return failed(this.failure);
    const zips = new Set(query.zips);
    const types = query.propertyTypes?.length ? new Set(query.propertyTypes) : null;
    const rows = this.records
      .filter((r) => (r.address.zip ? zips.has(r.address.zip) : false))
      .filter((r) => !types || types.has(r.propertyType))
      .filter((r) => inWindow(r, query, now))
      .filter((r) => query.minLoanAmount === undefined || r.loan.originalAmount === null || r.loan.originalAmount >= query.minLoanAmount)
      .slice(0, query.maxResults ?? 500)
      .map((r) => structuredClone(r));
    return rows.length ? ok(rows) : notFound();
  }
}

// ---------------------------------------------------------------------------
// Env wiring

type Env = Record<string, string | undefined>;

/** ATTOM when ATTOM_API_KEY is set (MATURITY_PROVIDER=attom|auto); otherwise null and the scan reports "not configured". */
export function maturityProviderFromEnv(env: Env = process.env, fetchImpl?: FetchLike): MaturityProvider | null {
  const choice = (env.MATURITY_PROVIDER ?? "auto").trim().toLowerCase();
  if (choice === "off") return null;
  const key = env.ATTOM_API_KEY?.trim();
  if (!key) {
    logOnce("intel:ATTOM_API_KEY", "intel: ATTOM_API_KEY not set; refinance-maturity scans are disabled");
    return null;
  }
  if (choice !== "auto" && choice !== "attom") {
    logOnce(`intel:provider:${choice}`, `intel: MATURITY_PROVIDER=${choice} has no adapter; only attom is built`);
    return null;
  }
  return new AttomMaturityClient(key, fetchImpl);
}

export { notConfigured };
