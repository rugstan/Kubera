// Debt service coverage calculator. Same payment math as the loan sizer
// (lib/sizing/finance.ts): a level monthly payment, or interest-only when the
// amortization is zero.

import { AGENCY, CMBS, HUD, SBA } from "@/lib/sizing/assumptions";
import { debtConstant, monthlyPayment } from "@/lib/sizing/finance";
import { requirePositive, requireRange, type CalcOutcome, type FieldErrors } from "./format";

export type DscrInputs = {
  /** Net operating income, annual. */
  noi: number;
  loanAmount: number;
  /** Note rate in percentage points, e.g. 6.25. */
  ratePct: number;
  /** Amortization in years; 0 means interest-only. */
  amortYears: number;
  /** The coverage a lender would require, e.g. 1.25. */
  targetDscr: number;
  /** Property value, optional; adds loan-to-value. */
  value?: number;
};

export type DscrResult = {
  monthlyPayment: number;
  annualDebtService: number;
  /** Annual debt service per dollar of loan. */
  constant: number;
  dscr: number;
  meetsTarget: boolean;
  debtYield: number;
  ltv?: number;
  /** Largest loan the NOI supports at the target coverage and this rate and amortization. */
  maxLoanAtTarget: number;
  /** NOI the requested loan needs to reach the target coverage. */
  noiNeededForTarget: number;
  /** Room (positive) or shortfall (negative) between NOI and the NOI the loan needs. */
  noiCushion: number;
  /** Fraction NOI could fall before coverage drops to 1.00x. */
  noiDeclineToBreakEven: number;
};

export type DscrField = "noi" | "loanAmount" | "ratePct" | "amortYears" | "targetDscr" | "value";

/** Coverage minimums the sizer uses, for the "typical lender" presets. */
export const DSCR_PRESETS = [
  { id: "hud232", label: "HUD 232/223(f) senior housing", targetDscr: HUD.section232.refi.minDscr, amortYears: HUD.section232.refi.termYears, source: "HUD Section 232 assumptions" },
  { id: "hud-mf", label: "HUD 223(f) multifamily, market rate", targetDscr: HUD.multifamily.s223f.minDscr, amortYears: HUD.multifamily.s223f.termYears, source: "HUD Mortgagee Letter 2025-03" },
  { id: "agency", label: "Fannie Mae / Freddie Mac multifamily", targetDscr: AGENCY.minDscr, amortYears: AGENCY.amortYears, source: "Agency small-balance assumptions" },
  { id: "sba", label: "SBA 504 / 7(a)", targetDscr: SBA.minDscr, amortYears: SBA.cdcAmortYears, source: "SBA SOP 50 10" },
  { id: "cmbs", label: "Hotel CMBS", targetDscr: CMBS.minDscr, amortYears: CMBS.amortYears, source: "CMBS assumptions" },
] as const;

export function validateDscr(i: DscrInputs): FieldErrors<DscrField> {
  const e: FieldErrors<DscrField> = {};
  requirePositive(e, "noi", i.noi, "Net operating income");
  requirePositive(e, "loanAmount", i.loanAmount, "Loan amount");
  requireRange(e, "ratePct", i.ratePct, 0.1, 25, "Interest rate", "%");
  requireRange(e, "amortYears", i.amortYears, 0, 40, "Amortization", " years");
  requireRange(e, "targetDscr", i.targetDscr, 1, 3, "Target coverage", "x");
  if (i.value !== undefined && !(i.value > 0)) e.value = "Property value must be greater than zero, or left blank.";
  return e;
}

export function calcDscr(i: DscrInputs): CalcOutcome<DscrResult, DscrField> {
  const errors = validateDscr(i);
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const constant = debtConstant(i.ratePct, i.amortYears);
  const annualDebtService = i.loanAmount * constant;
  const monthly = i.amortYears === 0 ? annualDebtService / 12 : monthlyPayment(i.loanAmount, i.ratePct, i.amortYears);
  const dscr = i.noi / annualDebtService;
  const noiNeeded = annualDebtService * i.targetDscr;
  return {
    ok: true,
    result: {
      monthlyPayment: monthly,
      annualDebtService,
      constant,
      dscr,
      meetsTarget: dscr >= i.targetDscr,
      debtYield: i.noi / i.loanAmount,
      ltv: i.value ? i.loanAmount / i.value : undefined,
      maxLoanAtTarget: i.noi / i.targetDscr / constant,
      noiNeededForTarget: noiNeeded,
      noiCushion: i.noi - noiNeeded,
      noiDeclineToBreakEven: Math.max(0, 1 - annualDebtService / i.noi),
    },
  };
}
