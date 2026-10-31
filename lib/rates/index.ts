import { cacheLife, cacheTag } from "next/cache";
import { FALLBACK_BENCHMARKS, SPREADS } from "@/lib/sizing/assumptions";

export type Benchmarks = {
  fiveYear: number;
  tenYear: number;
  sofr30: number;
  prime: number;
};

export type TickerItem = {
  key: string;
  label: string;
  /** Display string, e.g. "4.12%" or "5.55%–5.95%". */
  value: string;
  /** Day-over-day change in basis points, when the series has history. */
  changeBps?: number;
  derived: boolean;
};

export type MarketSnapshot = {
  benchmarks: Benchmarks;
  items: TickerItem[];
  asOf: string;
  /** False when one or more series fell back to indicative values. */
  live: boolean;
};

// FRED publishes these series as keyless CSV. They update once per business
// day, so a 15-minute cache is ample and keeps us well inside fair use.
const SERIES: Record<keyof Benchmarks, string> = {
  fiveYear: "DGS5",
  tenYear: "DGS10",
  sofr30: "SOFR30DAYAVG",
  prime: "DPRIME",
};

type Observation = { date: string; value: number };

async function fetchFredSeries(id: string): Promise<Observation[]> {
  const since = new Date(Date.now() - 21 * 86_400_000).toISOString().slice(0, 10);
  const res = await fetch(
    `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${since}`,
    { signal: AbortSignal.timeout(4_000) },
  );
  if (!res.ok) throw new Error(`FRED ${id}: HTTP ${res.status}`);
  return parseFredCsv(await res.text());
}

export function parseFredCsv(csv: string): Observation[] {
  return csv
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => {
      const [date = "", raw = ""] = line.split(",");
      return { date, value: Number.parseFloat(raw) };
    })
    .filter((o) => Number.isFinite(o.value));
}

const pct = (n: number) => `${n.toFixed(2)}%`;
const range = (lo: number, hi: number) => `${lo.toFixed(2)}%–${hi.toFixed(2)}%`;

export function buildTicker(b: Benchmarks, changes: Partial<Record<keyof Benchmarks, number>> = {}): TickerItem[] {
  const s = SPREADS;
  return [
    { key: "ust5", label: "5-Yr Treasury", value: pct(b.fiveYear), changeBps: changes.fiveYear, derived: false },
    { key: "ust10", label: "10-Yr Treasury", value: pct(b.tenYear), changeBps: changes.tenYear, derived: false },
    { key: "sofr", label: "30-Day SOFR", value: pct(b.sofr30), changeBps: changes.sofr30, derived: false },
    { key: "prime", label: "WSJ Prime", value: pct(b.prime), changeBps: changes.prime, derived: false },
    {
      key: "hud232",
      label: "HUD 232/223(f)",
      value: range(b.tenYear + s.hud232.lo, b.tenYear + s.hud232.hi),
      derived: true,
    },
    { key: "greenMip", label: "HUD Green MIP", value: "0.25%", derived: true },
    {
      key: "sba504",
      label: "SBA 504 25-Yr Eff.",
      value: range(b.tenYear + s.sba504Effective.lo, b.tenYear + s.sba504Effective.hi),
      derived: true,
    },
    {
      key: "cmbs",
      label: "Hotel CMBS",
      value: `T+${Math.round(s.hotelCmbs.lo * 100)}–${Math.round(s.hotelCmbs.hi * 100)}`,
      derived: true,
    },
    {
      key: "bridge",
      label: "Bridge",
      value: `S+${Math.round(s.bridge.lo * 100)}–${Math.round(s.bridge.hi * 100)}`,
      derived: true,
    },
  ];
}

/** Benchmarks plus derived program rates, cached for 15 minutes and tagged so the cron can refresh it. */
export async function getMarketSnapshot(): Promise<MarketSnapshot> {
  "use cache";
  cacheLife("rates");
  cacheTag("rates");

  const keys = Object.keys(SERIES) as (keyof Benchmarks)[];
  const results = await Promise.allSettled(keys.map((k) => fetchFredSeries(SERIES[k])));

  const benchmarks = { ...FALLBACK_BENCHMARKS };
  const changes: Partial<Record<keyof Benchmarks, number>> = {};
  let live = true;
  let asOf = "";

  results.forEach((r, i) => {
    const key = keys[i]!;
    const obs = r.status === "fulfilled" ? r.value : [];
    const last = obs.at(-1);
    if (!last) {
      live = false;
      return;
    }
    benchmarks[key] = last.value;
    const prev = obs.at(-2);
    if (prev) changes[key] = Math.round((last.value - prev.value) * 100);
    if (last.date > asOf) asOf = last.date;
  });

  return { benchmarks, items: buildTicker(benchmarks, changes), asOf: asOf || new Date().toISOString().slice(0, 10), live };
}
