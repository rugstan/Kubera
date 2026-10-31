// Display helpers shared by the calculators. Pure and locale-fixed so server
// and client render the same text.

const usdWhole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export const usd = (n: number): string => (Number.isFinite(n) ? usdWhole.format(Math.round(n)) : "n/a");
/** Percent from a fraction: pctOf(0.0725, 2) -> "7.25%". */
export const pctOf = (fraction: number, digits = 1): string => (Number.isFinite(fraction) ? `${(fraction * 100).toFixed(digits)}%` : "n/a");
/** A value already in percentage points: points(6.5, 2) -> "6.50%". */
export const points = (n: number, digits = 2): string => (Number.isFinite(n) ? `${n.toFixed(digits)}%` : "n/a");
/** Coverage multiple: multiple(1.2345) -> "1.23x". */
export const multiple = (n: number): string => (Number.isFinite(n) ? `${n.toFixed(2)}x` : "n/a");

/** Parses a typed number such as "1,250,000" or "$4.5". Returns null for blanks and non-numbers. */
export function parseNumber(raw: string | number | null | undefined): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (raw === null || raw === undefined) return null;
  const cleaned = raw.replace(/[$,%\s]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

/** Result of a calculator run: either the numbers, or one message per bad field. */
export type CalcOutcome<T, K extends string> = { ok: true; result: T } | { ok: false; errors: FieldErrors<K> };

export function requirePositive<K extends string>(errors: FieldErrors<K>, key: K, value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) errors[key] = `${label} must be greater than zero.`;
}

export function requireRange<K extends string>(errors: FieldErrors<K>, key: K, value: number, min: number, max: number, label: string, unit = ""): void {
  if (!Number.isFinite(value) || value < min || value > max) errors[key] = `${label} must be between ${min}${unit} and ${max}${unit}.`;
}
