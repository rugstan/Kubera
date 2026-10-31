// Multifamily rent-roll normalization: unit mix, physical and economic
// occupancy, gross potential rent at market, loss to lease, concessions,
// delinquency, lease expirations, and the rent-control flags from WS-Z
// (lib/rules/california) that limit how fast loss to lease can be recovered.

import { evaluateRentControl, type OwnerType, type RentControlResult } from "@/lib/rules/california";

export type RentRollUnit = {
  unit: string;
  unitType?: string | null;
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  status?: string | null;
  marketRent?: number | null;
  inPlaceRent?: number | null;
  concession?: number | null;
  balanceDue?: number | null;
  leaseStart?: string | null;
  leaseEnd?: string | null;
};

export type UnitStatus = "occupied" | "notice" | "vacant" | "model" | "down" | "employee";

export function normalizeUnitStatus(s: string | null | undefined, inPlaceRent: number | null | undefined): UnitStatus {
  const n = (s ?? "").toLowerCase();
  if (/notice|ntv|moving/.test(n)) return "notice";
  if (/model/.test(n)) return "model";
  if (/down|offline|off-line|renovat|uninhabit/.test(n)) return "down";
  if (/employee|staff|manager|admin|courtesy/.test(n)) return "employee";
  if (/vacant|vac\b|available|unrented|unocc|not occupied/.test(n)) return "vacant";
  if (/occ|leased|current|rented/.test(n)) return "occupied";
  return inPlaceRent && inPlaceRent > 0 ? "occupied" : "vacant";
}

export type RentControlFacts = {
  state?: string;
  county?: string;
  city?: string;
  unincorporated?: boolean;
  yearBuilt?: number;
  certificateOfOccupancyDate?: string;
  ownerType?: OwnerType;
  deedRestrictedAffordable?: boolean;
};

export type UnitMixLine = {
  type: string;
  units: number;
  occupied: number;
  avgSqft: number | null;
  avgMarketRent: number | null;
  avgInPlaceRent: number | null;
  /** (market - in-place) / market for occupied units of this type. */
  lossToLeasePct: number | null;
};

export type RentRollResult = {
  asOf: string;
  units: number;
  occupiedUnits: number;
  physicalOccupancy: number;
  economicOccupancy: number;
  /** Annual, at market rent for every unit. */
  grossPotentialRent: number;
  /** Annual in-place rent of occupied (incl. notice) units. */
  inPlaceRent: number;
  /** Annual (market - in-place) on occupied units; negative is gain to lease. */
  lossToLease: number;
  lossToLeasePct: number;
  /** Annual market rent of vacant, model, down and employee units. */
  vacancyLoss: number;
  /** Annual concessions. */
  concessions: number;
  /** Non-revenue units (model, down, employee). */
  nonRevenueUnits: number;
  delinquency: { totalBalance: number; units: number; pctOfMonthlyRent: number };
  expiringNext12Months: number;
  monthToMonth: number;
  unitMix: UnitMixLine[];
  rentControl: (RentControlResult & { recoverableLossToLeasePerYear: number | null }) | null;
  flags: string[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
const num = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? n : null);

function typeKey(u: RentRollUnit): string {
  if (num(u.beds) !== null) return `${u.beds}x${num(u.baths) ?? "?"}`;
  return (u.unitType ?? "").trim() || "unknown";
}

function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function normalizeRentRoll(unitsIn: RentRollUnit[], opts: { asOf: string; rentControl?: RentControlFacts }): RentRollResult {
  const flags: string[] = [];
  const units = unitsIn.map((u) => ({ ...u, s: normalizeUnitStatus(u.status, u.inPlaceRent) }));
  // Market rent missing on a unit: the average market rent of its type (flagged).
  const byType = new Map<string, number[]>();
  for (const u of units) if (num(u.marketRent) !== null) byType.set(typeKey(u), [...(byType.get(typeKey(u)) ?? []), u.marketRent!]);
  let imputed = 0;
  const market = (u: (typeof units)[number]) => {
    if (num(u.marketRent) !== null) return u.marketRent!;
    const peers = byType.get(typeKey(u));
    if (peers?.length) {
      imputed++;
      return peers.reduce((s, x) => s + x, 0) / peers.length;
    }
    if (num(u.inPlaceRent) !== null) {
      imputed++;
      return u.inPlaceRent!;
    }
    return 0;
  };
  const marketOf = new Map(units.map((u) => [u, market(u)]));
  if (imputed) flags.push("market_rent_imputed");

  const occupiedLike = (s: UnitStatus) => s === "occupied" || s === "notice";
  const occ = units.filter((u) => occupiedLike(u.s));
  const nonRevenue = units.filter((u) => u.s === "model" || u.s === "down" || u.s === "employee");
  const vacantLike = units.filter((u) => u.s === "vacant" || u.s === "model" || u.s === "down");
  const gprMonthly = units.reduce((s, u) => s + marketOf.get(u)!, 0);
  const inPlaceMonthly = occ.reduce((s, u) => s + (num(u.inPlaceRent) ?? 0), 0);
  const ltlMonthly = occ.reduce((s, u) => s + (marketOf.get(u)! - (num(u.inPlaceRent) ?? 0)), 0);
  const occMarketMonthly = occ.reduce((s, u) => s + marketOf.get(u)!, 0);
  const vacancyMonthly = vacantLike.reduce((s, u) => s + marketOf.get(u)!, 0) + units.filter((u) => u.s === "employee").reduce((s, u) => s + marketOf.get(u)!, 0);
  const concessionsMonthly = units.reduce((s, u) => s + Math.abs(num(u.concession) ?? 0), 0);
  const delinquent = units.filter((u) => (num(u.balanceDue) ?? 0) > 0);
  const totalBalance = delinquent.reduce((s, u) => s + u.balanceDue!, 0);

  const horizon = addMonths(opts.asOf, 12);
  const expiring = occ.filter((u) => u.leaseEnd && u.leaseEnd > opts.asOf && u.leaseEnd <= horizon).length;
  const mtm = occ.filter((u) => !u.leaseEnd || u.leaseEnd <= opts.asOf).length;

  const mix = new Map<string, (typeof units)[number][]>();
  for (const u of units) mix.set(typeKey(u), [...(mix.get(typeKey(u)) ?? []), u]);
  const unitMix: UnitMixLine[] = [...mix.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([type, list]) => {
      const o = list.filter((u) => occupiedLike(u.s));
      const sq = list.map((u) => num(u.sqft)).filter((x): x is number => x !== null);
      const mk = list.map((u) => marketOf.get(u)!);
      const ip = o.map((u) => num(u.inPlaceRent)).filter((x): x is number => x !== null);
      const oMarket = o.reduce((s, u) => s + marketOf.get(u)!, 0);
      const oInPlace = o.reduce((s, u) => s + (num(u.inPlaceRent) ?? 0), 0);
      return {
        type,
        units: list.length,
        occupied: o.length,
        avgSqft: sq.length ? Math.round(sq.reduce((s, x) => s + x, 0) / sq.length) : null,
        avgMarketRent: mk.length ? r2(mk.reduce((s, x) => s + x, 0) / mk.length) : null,
        avgInPlaceRent: ip.length ? r2(ip.reduce((s, x) => s + x, 0) / ip.length) : null,
        lossToLeasePct: oMarket ? r4((oMarket - oInPlace) / oMarket) : null,
      };
    });

  const lossToLease = ltlMonthly * 12;
  const inPlaceAnnual = inPlaceMonthly * 12;
  let rentControl: RentRollResult["rentControl"] = null;
  if (opts.rentControl?.state) {
    const rc = opts.rentControl;
    const res = evaluateRentControl({
      asOf: opts.asOf,
      state: rc.state,
      ...(rc.county ? { county: rc.county } : {}),
      ...(rc.city ? { city: rc.city } : {}),
      ...(rc.unincorporated !== undefined ? { unincorporated: rc.unincorporated } : {}),
      propertyType: units.length >= 3 ? "multifamily" : units.length === 2 ? "duplex" : "single_family",
      units: units.length,
      ...(rc.yearBuilt ? { yearBuilt: rc.yearBuilt } : {}),
      ...(rc.certificateOfOccupancyDate ? { certificateOfOccupancyDate: rc.certificateOfOccupancyDate } : {}),
      owner: { type: rc.ownerType ?? "unknown" },
      ...(rc.deedRestrictedAffordable ? { deedRestrictedAffordable: true } : {}),
    });
    const recoverable = res.annualCapPct === null ? null : r2(Math.max(0, Math.min(lossToLease, (inPlaceAnnual * res.annualCapPct) / 100)));
    rentControl = { ...res, recoverableLossToLeasePerYear: recoverable };
    if (res.annualCapPct !== null) {
      flags.push(res.regime === "local_ordinance" || res.regime === "local_unmodeled" ? "local_rent_control" : "ab1482_rent_cap");
      if (lossToLease > 0 && recoverable !== null && recoverable < lossToLease) flags.push("loss_to_lease_capped_by_rent_control");
    }
    if (res.regime === "regulatory_agreement") flags.push("rents_restricted_by_regulatory_agreement");
    for (const f of res.flags) flags.push(`rent_control:${f.code}`);
  }

  if (units.length && occ.length / units.length < 0.85) flags.push("physical_occupancy_below_85pct");
  if (inPlaceMonthly && totalBalance / inPlaceMonthly > 0.05) flags.push("delinquency_above_5pct");
  if (gprMonthly && concessionsMonthly * 12 > gprMonthly * 12 * 0.02) flags.push("concessions_above_2pct");

  return {
    asOf: opts.asOf,
    units: units.length,
    occupiedUnits: occ.length,
    physicalOccupancy: units.length ? r4(occ.length / units.length) : 0,
    economicOccupancy: gprMonthly ? r4((inPlaceMonthly - concessionsMonthly) / gprMonthly) : 0,
    grossPotentialRent: r2(gprMonthly * 12),
    inPlaceRent: r2(inPlaceAnnual),
    lossToLease: r2(lossToLease),
    lossToLeasePct: occMarketMonthly ? r4(ltlMonthly / occMarketMonthly) : 0,
    vacancyLoss: r2(vacancyMonthly * 12),
    concessions: r2(concessionsMonthly * 12),
    nonRevenueUnits: nonRevenue.length,
    delinquency: { totalBalance: r2(totalBalance), units: delinquent.length, pctOfMonthlyRent: inPlaceMonthly ? r4(totalBalance / inPlaceMonthly) : 0 },
    expiringNext12Months: expiring,
    monthToMonth: mtm,
    unitMix,
    rentControl,
    flags,
  };
}
