import { addressQuery } from "./regrid";
import { asArray, asRecord, dig, firstNum, firstStr, getJson, median, outcomeFromFailure, positive, stripUndefined, type FetchLike } from "./http";
import {
  notFound,
  ok,
  type ExpenseBenchmarks,
  type PropertyAddress,
  type RentComp,
  type RentCompClient,
  type RentCompsRecord,
  type RentEstimate,
  type RentEstimateClient,
  type SourceOutcome,
} from "./types";

// --- HelloData (rent comps and expense benchmarks) --------------------------------
// VERIFY the endpoint path and field names against the HelloData API reference
// for the account's plan; the reader accepts the common spellings of each field.

const HELLODATA_BASE_URL = "https://api.hellodata.ai";

function pct(v: unknown): number | undefined {
  const n = firstNum(v);
  if (n === undefined) return undefined;
  // Providers send either 0.94 or 94; both mean 94 percent.
  return n > 0 && n <= 1 ? Math.round(n * 1000) / 10 : n;
}

export function parseRentComp(raw: unknown): RentComp | undefined {
  const c = asRecord(raw);
  if (!c) return undefined;
  const comp = stripUndefined<RentComp>({
    name: firstStr(c.building_name, c.name),
    address: firstStr(c.street_address, c.address),
    bedrooms: firstNum(c.beds, c.bedrooms),
    rent: positive(c.effective_rent) ?? positive(c.asking_rent) ?? positive(c.rent),
    sqft: positive(c.sqft) ?? positive(c.square_feet),
    distanceMiles: positive(c.distance_miles) ?? positive(c.distance),
    yearBuilt: positive(c.year_built),
    occupancyPct: pct(c.occupancy_pct ?? c.occupancy),
    concessionPct: pct(c.concession_pct ?? c.concession),
  });
  return comp.rent !== undefined || comp.address !== undefined || comp.name !== undefined ? comp : undefined;
}

export function parseExpenseBenchmarks(raw: unknown): ExpenseBenchmarks | undefined {
  const e = asRecord(raw);
  if (!e) return undefined;
  const bench = stripUndefined<ExpenseBenchmarks>({
    opexPerUnit: positive(e.opex_per_unit) ?? positive(e.total_per_unit),
    taxesPerUnit: positive(e.taxes_per_unit),
    insurancePerUnit: positive(e.insurance_per_unit),
    utilitiesPerUnit: positive(e.utilities_per_unit),
    repairsPerUnit: positive(e.repairs_per_unit) ?? positive(e.repairs_maintenance_per_unit),
    payrollPerUnit: positive(e.payroll_per_unit),
    managementFeePct: pct(e.management_fee_pct),
    sampleSize: positive(e.sample_size),
  });
  return Object.keys(bench).length > 0 ? bench : undefined;
}

export class HelloDataClient implements RentCompClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl?: FetchLike,
    private readonly baseUrl: string = HELLODATA_BASE_URL,
  ) {}

  async rentComps(address: PropertyAddress, opts: { bedrooms?: number } = {}): Promise<SourceOutcome<RentCompsRecord>> {
    const params = new URLSearchParams({ address: addressQuery(address) });
    if (opts.bedrooms !== undefined) params.set("bedrooms", String(opts.bedrooms));
    const res = await getJson(`${this.baseUrl}/property/comps?${params.toString()}`, { headers: { "x-api-key": this.apiKey }, fetchImpl: this.fetchImpl });
    if (!res.ok) return outcomeFromFailure(res);
    const root = asRecord(res.data);
    const comps = asArray(root?.comps ?? dig(root, "data", "comps"))
      .map(parseRentComp)
      .filter((c): c is RentComp => c !== undefined);
    const expenseBenchmarks = parseExpenseBenchmarks(root?.expense_benchmarks ?? dig(root, "data", "expense_benchmarks"));
    if (comps.length === 0 && !expenseBenchmarks) return notFound();
    const rents = comps.map((c) => c.rent).filter((r): r is number => r !== undefined);
    const perSqft = comps.filter((c) => c.rent !== undefined && c.sqft !== undefined).map((c) => c.rent! / c.sqft!);
    return ok(
      stripUndefined<RentCompsRecord>({
        comps,
        medianRent: median(rents),
        medianRentPerSqft: perSqft.length ? Math.round(median(perSqft)! * 100) / 100 : undefined,
        expenseBenchmarks,
      }),
    );
  }
}

// --- Rentometer (rent estimate by bedroom count) ------------------------------------

const RENTOMETER_BASE_URL = "https://www.rentometer.com/api/v1";

export function parseRentometer(raw: unknown, bedrooms: number): RentEstimate | undefined {
  const r = asRecord(raw);
  if (!r) return undefined;
  const est = stripUndefined<RentEstimate>({
    bedrooms,
    mean: positive(r.mean),
    median: positive(r.median),
    min: positive(r.min),
    max: positive(r.max),
    percentile25: positive(r.percentile_25),
    percentile75: positive(r.percentile_75),
    sampleSize: positive(r.samples) ?? positive(r.sample_size),
  });
  return est.mean !== undefined || est.median !== undefined ? est : undefined;
}

export class RentometerClient implements RentEstimateClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl?: FetchLike,
    private readonly baseUrl: string = RENTOMETER_BASE_URL,
  ) {}

  async estimate(address: PropertyAddress, opts: { bedrooms: number; bathrooms?: number; buildingType?: string }): Promise<SourceOutcome<RentEstimate>> {
    const params = new URLSearchParams({
      api_key: this.apiKey,
      address: addressQuery(address),
      bedrooms: String(opts.bedrooms),
      building_type: opts.buildingType ?? "apartment",
    });
    if (opts.bathrooms !== undefined) params.set("baths", String(opts.bathrooms));
    const res = await getJson(`${this.baseUrl}/summary?${params.toString()}`, { fetchImpl: this.fetchImpl });
    if (!res.ok) return outcomeFromFailure(res);
    const est = parseRentometer(res.data, opts.bedrooms);
    return est ? ok(est) : notFound();
  }
}
