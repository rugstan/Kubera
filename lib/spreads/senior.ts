// Senior housing census and payor mix: occupancy (by care level), payor mix
// by residents and by revenue, average rates, and the flags HUD 232 and
// seniors lenders look at first (occupancy below stabilization, Medicaid
// concentration, thin private pay).

import { HUD } from "@/lib/sizing/assumptions";
import { SENIOR } from "./assumptions";

export const CARE_LEVELS = ["IL", "AL", "MC", "SNF", "RESPITE", "OTHER"] as const;
export type CareLevel = (typeof CARE_LEVELS)[number];
export const PAYORS = ["PRIVATE", "MEDICAID", "MEDICARE", "VA", "LTC_INSURANCE", "MANAGED_CARE", "OTHER"] as const;
export type Payor = (typeof PAYORS)[number];

export type CensusRow = { room: string; careLevel?: string | null; payor?: string | null; status?: string | null; monthlyRate?: number | null; residents?: number | null };

export function normalizeCareLevel(s: string | null | undefined): CareLevel {
  const n = (s ?? "").toLowerCase();
  if (/\b(il|independent)/.test(n)) return "IL";
  if (/\b(mc|memory|alz|dementia)/.test(n)) return "MC";
  if (/\b(snf|skilled|nursing|ltc)\b|\bsn\b/.test(n)) return "SNF";
  if (/respite/.test(n)) return "RESPITE";
  if (/\b(al|assisted|rcfe|personal care)/.test(n)) return "AL";
  return "OTHER";
}

export function normalizePayor(s: string | null | undefined): Payor | "VACANT" {
  const n = (s ?? "").toLowerCase();
  if (/vacant|empty|available/.test(n)) return "VACANT";
  if (/medicaid|medi-cal|medi cal|waiver|alw\b|ssi/.test(n)) return "MEDICAID";
  if (/medicare/.test(n)) return "MEDICARE";
  if (/\bva\b|veteran/.test(n)) return "VA";
  if (/ltc|long[\s-]?term care insurance|ltci/.test(n)) return "LTC_INSURANCE";
  if (/managed|hmo|mco|advantage/.test(n)) return "MANAGED_CARE";
  if (/private|self|family|cash/.test(n)) return "PRIVATE";
  return "OTHER";
}

export type CensusResult = {
  capacity: number;
  capacityBasis: "licensed_beds" | "units";
  occupied: number;
  occupancy: number;
  byCareLevel: { careLevel: CareLevel; units: number; occupied: number; avgMonthlyRate: number | null }[];
  payorMixByResidents: Partial<Record<Payor, number>>;
  payorMixByRevenue: Partial<Record<Payor, number>>;
  avgRateByPayor: Partial<Record<Payor, number>>;
  monthlyRevenue: number;
  annualizedRevenue: number;
  flags: string[];
};

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function censusMetrics(rows: CensusRow[], opts: { licensedBeds?: number | null; totalUnits?: number | null } = {}): CensusResult {
  const flags: string[] = [];
  const parsed = rows.map((row) => {
    const payor = normalizePayor(row.payor);
    const vacant = payor === "VACANT" || /vacant|empty|available/i.test(row.status ?? "") || row.residents === 0;
    return { careLevel: normalizeCareLevel(row.careLevel), payor: vacant ? null : (payor as Payor), vacant, residents: vacant ? 0 : Math.max(1, row.residents ?? 1), rate: row.monthlyRate ?? null };
  });
  const residents = parsed.reduce((s, p) => s + p.residents, 0);
  const occupiedUnits = parsed.filter((p) => !p.vacant).length;
  const useBeds = Boolean(opts.licensedBeds && opts.licensedBeds > 0);
  const capacity = useBeds ? opts.licensedBeds! : opts.totalUnits && opts.totalUnits > 0 ? opts.totalUnits : parsed.length;
  const occupied = useBeds ? residents : occupiedUnits;
  const occupancy = capacity ? occupied / capacity : 0;

  const byLevel = new Map<CareLevel, { units: number; occupied: number; rateSum: number; rateN: number }>();
  const resByPayor = new Map<Payor, number>();
  const revByPayor = new Map<Payor, number>();
  const rateByPayor = new Map<Payor, { sum: number; n: number }>();
  let monthly = 0;
  for (const p of parsed) {
    const l = byLevel.get(p.careLevel) ?? { units: 0, occupied: 0, rateSum: 0, rateN: 0 };
    l.units++;
    if (!p.vacant) {
      l.occupied++;
      if (p.rate !== null) {
        l.rateSum += p.rate;
        l.rateN++;
      }
    }
    byLevel.set(p.careLevel, l);
    if (p.vacant || !p.payor) continue;
    resByPayor.set(p.payor, (resByPayor.get(p.payor) ?? 0) + p.residents);
    if (p.rate !== null) {
      monthly += p.rate;
      revByPayor.set(p.payor, (revByPayor.get(p.payor) ?? 0) + p.rate);
      const rp = rateByPayor.get(p.payor) ?? { sum: 0, n: 0 };
      rp.sum += p.rate;
      rp.n++;
      rateByPayor.set(p.payor, rp);
    }
  }
  const share = (m: Map<Payor, number>, total: number) => Object.fromEntries([...m.entries()].map(([k, v]) => [k, total ? r4(v / total) : 0])) as Partial<Record<Payor, number>>;
  const payorMixByResidents = share(resByPayor, residents);
  const payorMixByRevenue = share(revByPayor, monthly);
  if (occupancy < HUD.section232.stabilizedOccupancy) flags.push("below_hud_232_stabilized_occupancy");
  if ((payorMixByResidents.MEDICAID ?? 0) > SENIOR.medicaidConcentrationPct) flags.push("medicaid_concentration");
  if ((payorMixByResidents.PRIVATE ?? 0) < SENIOR.privatePayMinPct) flags.push("private_pay_below_30pct");
  if (parsed.some((p) => !p.vacant && p.rate === null)) flags.push("rates_missing");
  return {
    capacity,
    capacityBasis: useBeds ? "licensed_beds" : "units",
    occupied,
    occupancy: r4(occupancy),
    byCareLevel: CARE_LEVELS.filter((c) => byLevel.has(c)).map((c) => {
      const l = byLevel.get(c)!;
      return { careLevel: c, units: l.units, occupied: l.occupied, avgMonthlyRate: l.rateN ? r2(l.rateSum / l.rateN) : null };
    }),
    payorMixByResidents,
    payorMixByRevenue,
    avgRateByPayor: Object.fromEntries([...rateByPayor.entries()].map(([k, v]) => [k, r2(v.sum / v.n)])) as Partial<Record<Payor, number>>,
    monthlyRevenue: r2(monthly),
    annualizedRevenue: r2(monthly * 12),
    flags,
  };
}
