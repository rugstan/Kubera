// Small date helpers for the California rules. Dates travel as ISO strings
// (YYYY-MM-DD) so comparisons are lexical and the rules never read the clock:
// callers pass `asOf`.

export type DateInput = string | Date;

export function toIsoDate(d: DateInput): string {
  if (d instanceof Date) {
    if (Number.isNaN(d.getTime())) throw new RangeError("Invalid date");
    return d.toISOString().slice(0, 10);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d.trim());
  if (!m) throw new RangeError(`Expected an ISO date (YYYY-MM-DD), got "${d}"`);
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) throw new RangeError(`Not a calendar date: "${d}"`);
  return iso;
}

/** Add whole years to an ISO date (Feb 29 rolls to Feb 28 in non-leap years). */
export function addYears(iso: string, years: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y + years, m - 1, d));
  if (target.getUTCMonth() !== m - 1) target.setUTCDate(0); // Feb 29 -> Feb 28
  return target.toISOString().slice(0, 10);
}

export const yearOf = (iso: string): number => Number(iso.slice(0, 4));
export const monthOf = (iso: string): number => Number(iso.slice(5, 7));

/** Row whose [effectiveFrom, effectiveTo] period (inclusive) contains `iso`. */
export function rowFor<T extends { effectiveFrom: string; effectiveTo: string }>(rows: readonly T[], iso: string): T | undefined {
  return rows.find((r) => r.effectiveFrom <= iso && iso <= r.effectiveTo);
}

/** Latest row that ended before `iso` (used when the table has not been updated yet). */
export function latestRowBefore<T extends { effectiveTo: string }>(rows: readonly T[], iso: string): T | undefined {
  return [...rows].filter((r) => r.effectiveTo < iso).sort((a, b) => b.effectiveTo.localeCompare(a.effectiveTo))[0];
}

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
