// All-in cost of a lender quote: one comparable number per offer, from the
// borrower's cash flows over the expected hold.
//
//   t0       + loan − origination − lender fees − third-party reports − borrower-paid
//              broker fee − upfront MIP − reserves the lender requires at closing
//   month m  − interest (and principal once amortizing) − monthly MIP − reserve deposits
//   exit     − balance − prepayment premium − exit fee + reserves released at payoff
//
// The all-in rate is the annualized internal rate of those flows. Prepayment is
// priced at the hold month (pushed to the end of a lockout, capped at
// maturity). Yield maintenance and defeasance are estimates from the rate
// differential to the reinvestment rate; every assumption is returned with the
// result so the comparison view can show it. Pure functions, no I/O.

import type { AllInAssumptions, AllInCost, QuoteTerms } from "./types";

/** Customary yield-maintenance floor (VERIFY per term sheet: commonly 1% of the balance prepaid). */
export const YIELD_MAINTENANCE_FLOOR_PCT = 1;
/** Defeasance transaction costs (consultant, legal, accountant, rating) — VERIFY with the desk: ~$75,000. */
export const DEFEASANCE_TRANSACTION_COST_CENTS = 7_500_000;
/** Default hold when the desk does not set one: the term, capped at 10 years. */
export const DEFAULT_MAX_HOLD_MONTHS = 120;

export class AllInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AllInError";
  }
}

export function defaultAssumptions(terms: Pick<QuoteTerms, "termMonths" | "ratePct">, over: Partial<AllInAssumptions> = {}): AllInAssumptions {
  return {
    holdMonths: Math.min(terms.termMonths, DEFAULT_MAX_HOLD_MONTHS),
    // Without a quoted Treasury, assume reinvestment 1.5 points under the coupon (VERIFY at pricing).
    reinvestmentRatePct: Math.max(0, terms.ratePct - 1.5),
    noiCents: null,
    ...over,
  };
}

/** Level monthly payment that amortizes `principal` over `months` at a monthly rate. */
export function amortizingPayment(principal: number, monthlyRate: number, months: number): number {
  if (months <= 0) throw new AllInError("Amortization must be at least one month");
  if (monthlyRate === 0) return principal / months;
  return (principal * monthlyRate) / (1 - (1 + monthlyRate) ** -months);
}

/** Present value of 1 per month for `months` at a monthly rate. */
function annuityFactor(monthlyRate: number, months: number): number {
  if (months <= 0) return 0;
  if (monthlyRate === 0) return months;
  return (1 - (1 + monthlyRate) ** -months) / monthlyRate;
}

function npv(flows: number[], rate: number): number {
  let total = 0;
  for (let m = 0; m < flows.length; m += 1) total += flows[m]! / (1 + rate) ** m;
  return total;
}

/**
 * Monthly internal rate of return by bisection (robust for the one sign change
 * of a loan: proceeds first, payments after). Null when there is no root in range.
 */
export function monthlyIrr(flows: number[]): number | null {
  let lo = -0.0099;
  let hi = 0.25;
  let fLo = npv(flows, lo);
  const fHi = npv(flows, hi);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || Math.sign(fLo) === Math.sign(fHi)) return null;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    const fMid = npv(flows, mid);
    if (Math.abs(fMid) < 1e-7 || hi - lo < 1e-12) return mid;
    if (Math.sign(fMid) === Math.sign(fLo)) {
      lo = mid;
      fLo = fMid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

function validate(t: QuoteTerms): void {
  if (!(t.loanAmountCents > 0)) throw new AllInError("Loan amount must be positive");
  if (!(t.termMonths >= 1)) throw new AllInError("Term must be at least one month");
  if (!(t.ratePct >= 0 && t.ratePct < 40)) throw new AllInError("Rate must be between 0% and 40%");
  if (t.ioMonths < 0 || t.ioMonths > t.termMonths) throw new AllInError("Interest-only months must be within the term");
  if (t.amortizationMonths !== null && t.amortizationMonths < 1) throw new AllInError("Amortization must be at least one month (or interest-only)");
  for (const [k, v] of Object.entries({ originationFeePct: t.originationFeePct, exitFeePct: t.exitFeePct, mipUpfrontPct: t.mipUpfrontPct, mipAnnualPct: t.mipAnnualPct })) {
    if (!(v >= 0 && v <= 20)) throw new AllInError(`${k} must be between 0 and 20`);
  }
  for (const [k, v] of Object.entries({ lenderFeesCents: t.lenderFeesCents, thirdPartyCostsCents: t.thirdPartyCostsCents, brokerFeeCents: t.brokerFeeCents, upfrontReservesCents: t.upfrontReservesCents, monthlyReservesCents: t.monthlyReservesCents })) {
    if (!(Number.isInteger(v) && v >= 0)) throw new AllInError(`${k} must be whole cents, zero or more`);
  }
}

const round = (n: number) => Math.round(n);

export function computeAllIn(terms: QuoteTerms, assumptionsIn?: Partial<AllInAssumptions>): AllInCost {
  validate(terms);
  const assumptions = defaultAssumptions(terms, assumptionsIn);
  if (!(assumptions.holdMonths >= 1)) throw new AllInError("Hold must be at least one month");
  const warnings: string[] = [];
  const loan = terms.loanAmountCents;
  const r = terms.ratePct / 1200;
  const mipMonthly = terms.mipAnnualPct / 1200;

  // Exit month: hold, pushed past a lockout, never past maturity.
  let exitMonth = Math.min(Math.round(assumptions.holdMonths), terms.termMonths);
  if (terms.prepay.kind === "lockout" && terms.prepay.months && exitMonth < terms.termMonths && exitMonth < terms.prepay.months) {
    const pushed = Math.min(terms.prepay.months, terms.termMonths);
    warnings.push(`Prepayment is locked out for ${terms.prepay.months} months; priced at month ${pushed} instead of the ${exitMonth}-month hold.`);
    exitMonth = pushed;
  }
  if (assumptions.holdMonths > terms.termMonths) warnings.push(`The ${assumptions.holdMonths}-month hold is longer than the ${terms.termMonths}-month term: priced to maturity; a refinance would be needed.`);

  const upfrontBreakdown = {
    origination: round((loan * terms.originationFeePct) / 100),
    lenderFees: terms.lenderFeesCents,
    thirdParty: terms.thirdPartyCostsCents,
    brokerFee: terms.brokerFeeCents,
    mipUpfront: round((loan * terms.mipUpfrontPct) / 100),
  };
  const upfrontCosts = upfrontBreakdown.origination + upfrontBreakdown.lenderFees + upfrontBreakdown.thirdParty + upfrontBreakdown.brokerFee + upfrontBreakdown.mipUpfront;
  const netProceeds = loan - upfrontCosts - terms.upfrontReservesCents;
  if (netProceeds <= 0) throw new AllInError("Upfront costs and reserves exceed the loan amount");

  const amortizes = terms.amortizationMonths !== null;
  const amortPayment = amortizes ? amortizingPayment(loan, r, terms.amortizationMonths!) : null;
  const ioPayment = loan * r;

  const flows: number[] = [netProceeds];
  let balance = loan;
  let totalInterest = 0;
  let totalMip = 0;
  let firstYear = 0;
  for (let m = 1; m <= exitMonth; m += 1) {
    const interest = balance * r;
    const mip = balance * mipMonthly;
    let principal = 0;
    if (amortizes && m > terms.ioMonths && balance > 0) principal = Math.min(balance, amortPayment! - interest);
    const debtService = interest + principal;
    if (m <= 12) firstYear += debtService;
    totalInterest += interest;
    totalMip += mip;
    balance -= principal;
    flows.push(-(debtService + mip + terms.monthlyReservesCents));
  }
  if (balance < 0.5) balance = 0;

  // Prepayment premium at exit (none at maturity).
  let prepay = 0;
  const remaining = terms.termMonths - exitMonth;
  if (remaining > 0 && balance > 0) {
    const reinvest = assumptions.reinvestmentRatePct / 1200;
    const differential = Math.max(0, r - reinvest);
    switch (terms.prepay.kind) {
      case "step_down": {
        const year = Math.floor((exitMonth - 1) / 12);
        prepay = (balance * (terms.prepay.schedule[year] ?? 0)) / 100;
        break;
      }
      case "yield_maintenance":
        prepay = Math.max((balance * YIELD_MAINTENANCE_FLOOR_PCT) / 100, balance * differential * annuityFactor(reinvest, remaining));
        warnings.push(`Yield maintenance estimated at a ${assumptions.reinvestmentRatePct.toFixed(2)}% reinvestment rate with a ${YIELD_MAINTENANCE_FLOOR_PCT}% floor.`);
        break;
      case "defeasance":
        prepay = balance * differential * annuityFactor(reinvest, remaining) + DEFEASANCE_TRANSACTION_COST_CENTS;
        warnings.push(`Defeasance estimated at a ${assumptions.reinvestmentRatePct.toFixed(2)}% reinvestment rate plus transaction costs.`);
        break;
      case "minimum_interest":
        if (terms.prepay.months && exitMonth < terms.prepay.months) prepay = balance * r * (terms.prepay.months - exitMonth);
        break;
      case "lockout":
      case "none":
        break;
    }
  }
  const exitFee = (balance * terms.exitFeePct) / 100;
  const reservesReleased = terms.upfrontReservesCents + terms.monthlyReservesCents * exitMonth;
  flows[exitMonth] = flows[exitMonth]! - balance - prepay - exitFee + reservesReleased;

  const irr = monthlyIrr(flows);
  let allInRatePct: number;
  let effectiveAnnualRatePct: number;
  if (irr === null) {
    warnings.push("The cash flows have no internal rate in range; the note rate is shown instead.");
    allInRatePct = terms.ratePct;
    effectiveAnnualRatePct = ((1 + r) ** 12 - 1) * 100;
  } else {
    allInRatePct = irr * 1200;
    effectiveAnnualRatePct = ((1 + irr) ** 12 - 1) * 100;
  }

  const stabilizedAnnualDebtService = amortizes ? amortPayment! * 12 : ioPayment * 12;
  const annualMip = (loan * terms.mipAnnualPct) / 100;
  const noi = assumptions.noiCents;
  const dscr = noi !== null && stabilizedAnnualDebtService + annualMip > 0 ? noi / (stabilizedAnnualDebtService + annualMip) : null;
  const debtYieldPct = noi !== null ? (noi / loan) * 100 : null;
  if (dscr !== null && terms.minDscr !== null && dscr < terms.minDscr) warnings.push(`DSCR ${dscr.toFixed(2)}x at this structure is below the lender's ${terms.minDscr.toFixed(2)}x minimum; expect the amount to be sized down.`);
  if (debtYieldPct !== null && terms.minDebtYieldPct !== null && debtYieldPct < terms.minDebtYieldPct) warnings.push(`Debt yield ${debtYieldPct.toFixed(2)}% is below the lender's ${terms.minDebtYieldPct.toFixed(2)}% minimum.`);
  if (terms.rateType === "floating") warnings.push("Floating rate: priced at today's index for the whole hold; the cost moves with the index.");

  return {
    assumptions,
    exitMonth,
    upfrontCostsCents: upfrontCosts,
    upfrontBreakdown,
    netProceedsCents: round(netProceeds),
    upfrontReservesCents: terms.upfrontReservesCents,
    ioPaymentCents: round(ioPayment),
    amortizingPaymentCents: amortPayment === null ? null : round(amortPayment),
    firstYearDebtServiceCents: round(firstYear),
    stabilizedAnnualDebtServiceCents: round(stabilizedAnnualDebtService),
    totalInterestCents: round(totalInterest),
    totalMipCents: round(totalMip),
    prepayCostCents: round(prepay),
    exitFeeCents: round(exitFee),
    balanceAtExitCents: round(balance),
    totalCostCents: round(totalInterest + totalMip + upfrontCosts + prepay + exitFee),
    allInRatePct: Math.round(allInRatePct * 10_000) / 10_000,
    effectiveAnnualRatePct: Math.round(effectiveAnnualRatePct * 10_000) / 10_000,
    dscr: dscr === null ? null : Math.round(dscr * 1000) / 1000,
    debtYieldPct: debtYieldPct === null ? null : Math.round(debtYieldPct * 1000) / 1000,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Comparison

export type ComparableQuote = { id: string; lenderName: string; status: string; terms: QuoteTerms };

export type ComparisonRow = {
  id: string;
  lenderName: string;
  terms: QuoteTerms;
  allIn: AllInCost | null;
  error: string | null;
  rank: number | null;
  badges: string[];
  flags: string[];
};

/**
 * Prices every quote under the same assumptions and ranks them by all-in rate
 * (lowest first). Badges: lowest all-in, most proceeds, fastest close.
 */
export function compareQuotes(quotes: ComparableQuote[], assumptions: Partial<AllInAssumptions> = {}, opts: { today?: string; targetCloseDays?: number | null } = {}): ComparisonRow[] {
  const rows: ComparisonRow[] = quotes.map((q) => {
    const flags: string[] = [];
    if (q.terms.recourse === "full") flags.push("Full recourse");
    if (q.terms.prepay.kind === "lockout") flags.push(`Prepay lockout ${q.terms.prepay.months ?? "?"} months`);
    if (q.terms.rateType === "floating") flags.push("Floating rate");
    if (opts.today && q.terms.expiresOn && q.terms.expiresOn < opts.today) flags.push("Quote expired");
    if (opts.targetCloseDays && q.terms.timelineDays && q.terms.timelineDays > opts.targetCloseDays) flags.push(`Quoted ${q.terms.timelineDays} days to close (target ${opts.targetCloseDays})`);
    if (q.status === "needs_review") flags.push("Parsed terms need review");
    try {
      const holdMonths = assumptions.holdMonths ?? Math.min(q.terms.termMonths, DEFAULT_MAX_HOLD_MONTHS);
      return { id: q.id, lenderName: q.lenderName, terms: q.terms, allIn: computeAllIn(q.terms, { ...assumptions, holdMonths }), error: null, rank: null, badges: [], flags };
    } catch (err) {
      return { id: q.id, lenderName: q.lenderName, terms: q.terms, allIn: null, error: err instanceof Error ? err.message : String(err), rank: null, badges: [], flags };
    }
  });
  const priced = rows.filter((r) => r.allIn);
  priced.sort((a, b) => a.allIn!.allInRatePct - b.allIn!.allInRatePct || b.allIn!.netProceedsCents - a.allIn!.netProceedsCents || a.lenderName.localeCompare(b.lenderName));
  priced.forEach((r, i) => (r.rank = i + 1));
  if (priced.length > 1) {
    priced[0]!.badges.push("Lowest all-in cost");
    const most = [...priced].sort((a, b) => b.allIn!.netProceedsCents - a.allIn!.netProceedsCents)[0]!;
    most.badges.push("Most net proceeds");
    const timed = priced.filter((r) => r.terms.timelineDays !== null);
    if (timed.length > 1) [...timed].sort((a, b) => a.terms.timelineDays! - b.terms.timelineDays!)[0]!.badges.push("Fastest close");
  }
  return [...priced, ...rows.filter((r) => !r.allIn)];
}
