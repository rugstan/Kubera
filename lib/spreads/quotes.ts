// DSCR at each lender's loan constant, debt yield and LTV per quote, and the
// largest loan each quote's own tests allow.

import { debtConstant } from "@/lib/sizing/finance";

export type LoanQuote = {
  id: string;
  lender: string;
  loanAmount: number;
  /** Note rate, percent (6.25 = 6.25%). */
  ratePct: number;
  /** 0 = interest-only for the full term. */
  amortYears: number;
  /** Interest-only months before amortization starts. */
  ioMonths?: number;
  termMonths?: number;
  /** Annual premium carried in debt service (HUD MIP, SBA servicing), as a fraction of the loan. */
  annualFeePct?: number;
  minDscr?: number;
  maxLtv?: number;
  minDebtYield?: number;
};

export type QuoteAnalysis = {
  id: string;
  lender: string;
  loanAmount: number;
  /** Annual debt service per dollar on the amortizing payment, fee included. */
  constant: number;
  annualDebtService: number;
  /** During the interest-only period (null when there is none). */
  ioAnnualDebtService: number | null;
  dscr: number;
  dscrDuringIo: number | null;
  debtYield: number;
  ltv: number | null;
  maxLoanByDscr: number | null;
  maxLoanByLtv: number | null;
  maxLoanByDebtYield: number | null;
  maxLoan: number | null;
  binding: "DSCR" | "LTV" | "DEBT_YIELD" | null;
  passes: { dscr: boolean | null; ltv: boolean | null; debtYield: boolean | null };
};

const r = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

export function analyzeQuote(noi: number, value: number | null, q: LoanQuote): QuoteAnalysis {
  const fee = q.annualFeePct ?? 0;
  const constant = debtConstant(q.ratePct, q.amortYears) + fee;
  const ds = q.loanAmount * constant;
  const io = q.ioMonths && q.amortYears > 0 ? q.loanAmount * (q.ratePct / 100 + fee) : null;
  const dscr = ds > 0 ? noi / ds : 0;
  const debtYield = q.loanAmount > 0 ? noi / q.loanAmount : 0;
  const ltv = value && value > 0 ? q.loanAmount / value : null;
  const maxByDscr = q.minDscr ? noi / (q.minDscr * constant) : null;
  const maxByLtv = q.maxLtv && value ? q.maxLtv * value : null;
  const maxByDy = q.minDebtYield ? noi / q.minDebtYield : null;
  const limits: [QuoteAnalysis["binding"], number | null][] = [
    ["DSCR", maxByDscr],
    ["LTV", maxByLtv],
    ["DEBT_YIELD", maxByDy],
  ];
  let binding: QuoteAnalysis["binding"] = null;
  let maxLoan: number | null = null;
  for (const [k, lim] of limits) {
    if (lim !== null && (maxLoan === null || lim < maxLoan)) {
      maxLoan = lim;
      binding = k;
    }
  }
  return {
    id: q.id,
    lender: q.lender,
    loanAmount: q.loanAmount,
    constant: r(constant, 6),
    annualDebtService: r(ds, 2),
    ioAnnualDebtService: io === null ? null : r(io, 2),
    dscr: r(dscr, 4),
    dscrDuringIo: io ? r(noi / io, 4) : null,
    debtYield: r(debtYield, 4),
    ltv: ltv === null ? null : r(ltv, 4),
    maxLoanByDscr: maxByDscr === null ? null : Math.floor(maxByDscr),
    maxLoanByLtv: maxByLtv === null ? null : Math.floor(maxByLtv),
    maxLoanByDebtYield: maxByDy === null ? null : Math.floor(maxByDy),
    maxLoan: maxLoan === null ? null : Math.floor(maxLoan),
    binding,
    passes: {
      dscr: q.minDscr ? dscr + 1e-9 >= q.minDscr : null,
      ltv: q.maxLtv && ltv !== null ? ltv <= q.maxLtv + 1e-9 : null,
      debtYield: q.minDebtYield ? debtYield + 1e-9 >= q.minDebtYield : null,
    },
  };
}

export function analyzeQuotes(noi: number, value: number | null, quotes: LoanQuote[]): QuoteAnalysis[] {
  return quotes.map((q) => analyzeQuote(noi, value, q));
}
