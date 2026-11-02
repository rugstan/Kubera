// Calendar-date helpers for reports. Corin is a California business, so a
// timestamp belongs to the day and month it fell on in Pacific time.

import { RANGE_KEYS, type RangeKey, type ReportWindow } from "./types";

export const DAY_MS = 86_400_000;

const laFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" });

/** YYYY-MM-DD in Pacific time for an ISO timestamp (or a YYYY-MM-DD date, returned as is). */
export function laDate(value: string | Date): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return laFormat.format(typeof value === "string" ? new Date(value) : value);
}

export const monthOf = (date: string): string => date.slice(0, 7);

/** Whole days from `a` to `b` as a fraction (b - a), never negative. */
export function daysBetween(a: string | Date, b: string | Date): number {
  const diff = (typeof b === "string" ? Date.parse(b) : b.getTime()) - (typeof a === "string" ? Date.parse(a) : a.getTime());
  return Math.max(0, diff) / DAY_MS;
}

/** Date arithmetic on YYYY-MM-DD strings (UTC, so no DST surprises). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Inclusive day count between two YYYY-MM-DD dates. */
export function daysInclusive(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

export function inWindow(date: string, w: Pick<ReportWindow, "from" | "to">): boolean {
  return date >= w.from && date <= w.to;
}

export const RANGE_LABELS: Record<RangeKey, string> = {
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "365d": "Last 12 months",
  ytd: "Year to date",
};

export function parseRange(value: unknown): RangeKey {
  return (RANGE_KEYS as readonly string[]).includes(String(value)) ? (value as RangeKey) : "90d";
}

/** The window ending today (Pacific) for a range key. */
export function resolveWindow(key: RangeKey, now: Date): ReportWindow {
  const to = laDate(now);
  const from = key === "ytd" ? `${to.slice(0, 4)}-01-01` : addDays(to, -(key === "30d" ? 29 : key === "90d" ? 89 : 364));
  return { key, label: RANGE_LABELS[key], from, to };
}

/** Every YYYY-MM from the window's first month to its last. */
export function monthsIn(w: Pick<ReportWindow, "from" | "to">): string[] {
  const out: string[] = [];
  let [y, m] = w.from.split("-").map(Number) as [number, number];
  const [ty, tm] = w.to.split("-").map(Number) as [number, number];
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** Nearest-rank percentile of a list (0 < p <= 100); null for an empty list. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

export const mean = (values: readonly number[]): number | null => (values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length);

/** One decimal place, for days. */
export const round1 = (n: number): number => Math.round(n * 10) / 10;
