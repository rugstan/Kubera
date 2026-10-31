// SBA 504 structure calculator: the bank first lien, the CDC debenture and the
// borrower's equity injection for a project cost. Percentages, caps and fees
// are the sizer's (lib/sizing/assumptions.ts); the 10-year debenture rate is a
// Treasury-plus-spread estimate the person can overwrite.

import { ASSUMPTIONS_REVIEWED, SBA } from "@/lib/sizing/assumptions";
import { debtConstant, monthlyPayment } from "@/lib/sizing/finance";
import { requirePositive, requireRange, type CalcOutcome, type FieldErrors } from "./format";

export type Sba504Inputs = {
  /** Total project cost: purchase price or construction cost plus soft costs. */
  projectCost: number;
  /** Hotels, care facilities and other special-purpose property add 5 points of equity. */
  specialPurpose: boolean;
  /** A start-up or new-construction project adds another 5 points. */
  newBusiness: boolean;
  /** Energy-efficient or manufacturing projects qualify for the higher debenture cap. */
  higherCap: boolean;
  /** Bank first-lien rate in percentage points. */
  bankRatePct: number;
  /** CDC debenture rate in percentage points, before ongoing SBA and servicing fees. */
  cdcRatePct: number;
  /** Net operating income of the property or business, optional; adds coverage. */
  noi?: number;
};

export type Sba504Tranche = { label: string; amount: number; share: number; ratePct: number; annualDebtService: number; monthlyPayment: number };

export type Sba504Result = {
  tranches: [bank: Sba504Tranche, cdc: Sba504Tranche];
  equityPct: number;
  equityRequired: number;
  /** Equity above the program minimum because the debenture cap binds. */
  equityAboveMinimum: number;
  capBinds: boolean;
  debentureCap: number;
  totalDebt: number;
  blendedRatePct: number;
  /** Ongoing SBA, CDC servicing and CSA fees on the debenture. */
  annualDebentureFees: number;
  /** Upfront debenture fees (financed into the debenture). */
  upfrontDebentureFees: number;
  annualPrincipalInterest: number;
  annualAllIn: number;
  monthlyPrincipalInterest: number;
  dscr?: number;
  meetsMinimumDscr?: boolean;
  minDscr: number;
  asOf: string;
};

export type Sba504Field = "projectCost" | "bankRatePct" | "cdcRatePct" | "noi";

export function calcSba504(i: Sba504Inputs): CalcOutcome<Sba504Result, Sba504Field> {
  const errors: FieldErrors<Sba504Field> = {};
  requirePositive(errors, "projectCost", i.projectCost, "Project cost");
  requireRange(errors, "bankRatePct", i.bankRatePct, 0.1, 25, "Bank rate", "%");
  requireRange(errors, "cdcRatePct", i.cdcRatePct, 0.1, 25, "Debenture rate", "%");
  if (i.noi !== undefined && !(i.noi > 0)) errors.noi = "Net operating income must be greater than zero, or left blank.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const equityPct = SBA.equity.base + (i.specialPurpose ? SBA.equity.specialPurpose : 0) + (i.newBusiness ? SBA.equity.newBusiness : 0);
  const cdcShare = 1 - SBA.bankFirstPct - equityPct;
  const debentureCap = i.higherCap ? SBA.cdcCapGreen : SBA.cdcCap;
  const uncapped = i.projectCost * cdcShare;
  const cdcAmount = Math.min(uncapped, debentureCap);
  const bankAmount = i.projectCost * SBA.bankFirstPct;
  const capBinds = uncapped > debentureCap;
  const equityMinimum = i.projectCost * equityPct;
  const equityRequired = i.projectCost - bankAmount - cdcAmount;

  const tranche = (label: string, amount: number, ratePct: number): Sba504Tranche => ({
    label,
    amount,
    share: amount / i.projectCost,
    ratePct,
    annualDebtService: amount * debtConstant(ratePct, SBA.bankAmortYears),
    monthlyPayment: monthlyPayment(amount, ratePct, SBA.bankAmortYears),
  });
  const bank = tranche("Bank first lien (50%)", bankAmount, i.bankRatePct);
  const cdc = tranche("SBA 504 debenture (CDC second lien)", cdcAmount, i.cdcRatePct);

  const annualPrincipalInterest = bank.annualDebtService + cdc.annualDebtService;
  const annualDebentureFees = cdcAmount * SBA.annualDebentureFees;
  const annualAllIn = annualPrincipalInterest + annualDebentureFees;
  const totalDebt = bankAmount + cdcAmount;
  const dscr = i.noi ? i.noi / annualAllIn : undefined;

  return {
    ok: true,
    result: {
      tranches: [bank, cdc],
      equityPct,
      equityRequired,
      equityAboveMinimum: Math.max(0, equityRequired - equityMinimum),
      capBinds,
      debentureCap,
      totalDebt,
      blendedRatePct: (bankAmount * i.bankRatePct + cdcAmount * i.cdcRatePct) / totalDebt,
      annualDebentureFees,
      upfrontDebentureFees: cdcAmount * SBA.upfrontDebentureFees,
      annualPrincipalInterest,
      annualAllIn,
      monthlyPrincipalInterest: bank.monthlyPayment + cdc.monthlyPayment,
      dscr,
      meetsMinimumDscr: dscr === undefined ? undefined : dscr >= SBA.minDscr,
      minDscr: SBA.minDscr,
      asOf: ASSUMPTIONS_REVIEWED,
    },
  };
}
