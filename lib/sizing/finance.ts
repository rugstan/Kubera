/** Level monthly payment on a fully amortizing loan. */
export function monthlyPayment(principal: number, annualRatePct: number, amortYears: number): number {
  if (principal <= 0) return 0;
  const r = annualRatePct / 100 / 12;
  const n = amortYears * 12;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - (1 + r) ** -n);
}

/** Annual debt service per dollar of loan. Interest-only when amortYears is 0. */
export function debtConstant(annualRatePct: number, amortYears: number): number {
  if (amortYears === 0) return annualRatePct / 100;
  return monthlyPayment(1, annualRatePct, amortYears) * 12;
}

export const round = (n: number, to = 1_000) => Math.floor(n / to) * to;

export type Constraint = "REQUESTED" | "LTV" | "LTC" | "DSCR" | "DEBT_YIELD" | "PROGRAM_CAP";

/** Smallest of the candidate limits, with the constraint that binds. */
export function bindingLimit(limits: Partial<Record<Constraint, number>>): { amount: number; binding: Constraint } {
  let best: { amount: number; binding: Constraint } = { amount: Infinity, binding: "REQUESTED" };
  for (const [k, v] of Object.entries(limits) as [Constraint, number][]) {
    if (Number.isFinite(v) && v < best.amount) best = { amount: Math.max(0, v), binding: k };
  }
  return best;
}
