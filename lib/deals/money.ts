// Integer-cent arithmetic for compensation records. Percentages are applied
// with banker-free half-up rounding to the cent, once, at the entry level.

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

export function assertCents(n: number, label = "amount"): number {
  if (!Number.isSafeInteger(n) || n < 0) throw new MoneyError(`${label} must be a non-negative whole number of cents`);
  return n;
}

/** Dollars (as typed by staff, e.g. "12,500.50") to cents. */
export function dollarsToCents(input: string | number): number {
  const s = typeof input === "number" ? input.toFixed(2) : input.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new MoneyError(`Not a dollar amount: ${String(input)}`);
  const [whole, frac = ""] = s.split(".") as [string, string?];
  return assertCents(Number(whole) * 100 + Number((frac ?? "").padEnd(2, "0")));
}

/** `pct` percent of `baseCents`, rounded half-up to the cent. 1 = 1%. */
export function percentOf(baseCents: number, pct: number): number {
  assertCents(baseCents, "base");
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new MoneyError("percent must be between 0 and 100");
  // Work in micro-percent integers to avoid binary-fraction drift (0.75% of $10M).
  const micro = Math.round(pct * 1_000_000);
  const numerator = BigInt(baseCents) * BigInt(micro);
  const denominator = 100n * 1_000_000n;
  return Number((numerator * 2n + denominator) / (denominator * 2n));
}

export function sumCents(values: number[]): number {
  return values.reduce((a, b) => a + assertCents(b), 0);
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatCents(cents: number): string {
  return usd.format(cents / 100);
}
