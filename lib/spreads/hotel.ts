// Hotel STR metrics: trailing-twelve occupancy, ADR and RevPAR weighted by
// room nights (never averages of monthly ratios), and the penetration indices
// against the competitive set (MPI, ARI, RGI).

export type StrMonth = {
  month: string; // YYYY-MM
  occupancy?: number | null; // fraction
  adr?: number | null;
  revpar?: number | null;
  roomsAvailable?: number | null;
  roomsSold?: number | null;
  roomRevenue?: number | null;
  compOccupancy?: number | null;
  compAdr?: number | null;
  compRevpar?: number | null;
};

export type StrPeriod = {
  months: number;
  roomsAvailable: number;
  roomsSold: number;
  roomRevenue: number;
  occupancy: number;
  adr: number;
  revpar: number;
  comp: { occupancy: number; adr: number; revpar: number } | null;
  /** Penetration indices (100 = fair share). */
  mpi: number | null;
  ari: number | null;
  rgi: number | null;
};

export type StrResult = { ttm: StrPeriod; prior: StrPeriod | null; revparGrowth: number | null; firstMonth: string; lastMonth: string; flags: string[] };

const has = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);
const r = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function period(months: StrMonth[], rooms: number): StrPeriod {
  let avail = 0;
  let sold = 0;
  let rev = 0;
  let compDays = 0;
  let compOccDays = 0;
  let compRevDays = 0;
  let compComplete = months.length > 0;
  for (const m of months) {
    const days = daysInMonth(m.month);
    const a = has(m.roomsAvailable) ? m.roomsAvailable : rooms * days;
    const s = has(m.roomsSold) ? m.roomsSold : has(m.occupancy) ? m.occupancy * a : 0;
    const rv = has(m.roomRevenue) ? m.roomRevenue : has(m.adr) ? m.adr * s : has(m.revpar) ? m.revpar * a : 0;
    avail += a;
    sold += s;
    rev += rv;
    const cOcc = has(m.compOccupancy) ? m.compOccupancy : null;
    const cAdr = has(m.compAdr) ? m.compAdr : cOcc && has(m.compRevpar) ? m.compRevpar / cOcc : null;
    if (cOcc === null || cAdr === null) compComplete = false;
    else {
      // Comp set weighted by days (its own supply is not in the report).
      compDays += days;
      compOccDays += cOcc * days;
      compRevDays += cOcc * cAdr * days;
    }
  }
  const occ = avail ? sold / avail : 0;
  const adr = sold ? rev / sold : 0;
  const revpar = avail ? rev / avail : 0;
  const comp = compComplete && compDays ? { occupancy: compOccDays / compDays, adr: compOccDays ? compRevDays / compOccDays : 0, revpar: compRevDays / compDays } : null;
  return {
    months: months.length,
    roomsAvailable: Math.round(avail),
    roomsSold: Math.round(sold),
    roomRevenue: r(rev, 2),
    occupancy: r(occ, 4),
    adr: r(adr, 2),
    revpar: r(revpar, 2),
    comp: comp ? { occupancy: r(comp.occupancy, 4), adr: r(comp.adr, 2), revpar: r(comp.revpar, 2) } : null,
    mpi: comp && comp.occupancy ? r((occ / comp.occupancy) * 100, 1) : null,
    ari: comp && comp.adr ? r((adr / comp.adr) * 100, 1) : null,
    rgi: comp && comp.revpar ? r((revpar / comp.revpar) * 100, 1) : null,
  };
}

export function strMetrics(monthsIn: StrMonth[], rooms: number): StrResult {
  const months = [...new Map(monthsIn.filter((m) => /^\d{4}-\d{2}$/.test(m.month)).map((m) => [m.month, m])).values()].sort((a, b) => a.month.localeCompare(b.month));
  const flags: string[] = [];
  const ttmMonths = months.slice(-12);
  const priorMonths = months.length >= 24 ? months.slice(-24, -12) : [];
  if (ttmMonths.length < 12) flags.push("fewer_than_12_months");
  const ttm = period(ttmMonths, rooms);
  const prior = priorMonths.length === 12 ? period(priorMonths, rooms) : null;
  if (ttm.rgi !== null && ttm.rgi < 100) flags.push("revpar_below_fair_share");
  if (!ttm.comp) flags.push("comp_set_missing");
  return {
    ttm,
    prior,
    revparGrowth: prior && prior.revpar ? r(ttm.revpar / prior.revpar - 1, 4) : null,
    firstMonth: ttmMonths[0]?.month ?? "",
    lastMonth: ttmMonths[ttmMonths.length - 1]?.month ?? "",
    flags,
  };
}
