// HUD 223(a)(7): streamlined refinance of an existing FHA-insured
// multifamily loan. The new principal is capped by the original insured
// amount and by the unpaid balance plus eligible costs, and the new payment
// (P&I + MIP) may not exceed the current one. Behind a flag (HUD_223A7.enabled
// or SizerOptions.hud223a7) until a HUD lender confirms the box.

import type { Benchmarks } from "@/lib/rates";
import { HUD, SPREADS, mid } from "../assumptions";
import { debtConstant, monthlyPayment } from "../finance";
import { BROKER_FEE, HUD_223A7 } from "./assumptions";
import { bindingOf, buildSizerQuote, floor1k, fmt } from "./quote";
import type { SizerConstraint, SizerQuote } from "./types";

export type Hud223a7Inputs = {
  unpaidBalance: number;
  originalPrincipal: number;
  existingRatePct: number;
  /** Annual MIP on the existing loan, as a decimal (e.g. 0.0045). */
  existingAnnualMip: number;
  remainingTermYears: number;
  originalProgram: "223F" | "221D4";
  /** Critical repairs financed into the new loan. */
  repairs: number;
  noi: number;
  value?: number;
  /** New term; defaults to the longest allowed (remaining + 12 years, capped by the program). */
  newTermYears?: number;
};

export type Hud223a7Breakdown = {
  ratePct: number;
  newTermYears: number;
  existingDebtService: number;
  newConstant: number;
  pctCosts: number;
  fixedCosts: number;
  refinanceBasis: number;
  loanAmount: number;
  binding: SizerConstraint;
  newDebtService: number;
  annualSavings: number;
  cashToClose: number;
};

export function maxNewTerm(i: Pick<Hud223a7Inputs, "remainingTermYears" | "originalProgram">): number {
  return Math.min(HUD_223A7.maxTermYears[i.originalProgram], Math.ceil(i.remainingTermYears) + HUD_223A7.maxTermExtensionYears);
}

export function hud223a7Breakdown(i: Hud223a7Inputs, rates: Benchmarks): Hud223a7Breakdown {
  const ratePct = rates.tenYear + mid(SPREADS.hudMultifamily) + HUD_223A7.spreadAdj;
  const cap = maxNewTerm(i);
  const newTermYears = Math.max(1, Math.min(cap, Math.round(i.newTermYears ?? cap)));
  const existingDebtService =
    monthlyPayment(i.unpaidBalance, i.existingRatePct, Math.max(i.remainingTermYears, 1 / 12)) * 12 + i.unpaidBalance * i.existingAnnualMip;
  const newConstant = debtConstant(ratePct, newTermYears) + HUD_223A7.annualMip;
  const pctCosts = HUD_223A7.upfrontMip + HUD_223A7.lenderFinancingFeePct + HUD_223A7.applicationFeePct + BROKER_FEE.hud223a7;
  const fixedCosts = HUD_223A7.legalAndTitle + HUD_223A7.thirdPartyReports;
  // Percentage costs are financed too, so the basis solves L = UPB + repairs + fixed + pct × L.
  const refinanceBasis = (i.unpaidBalance + Math.max(0, i.repairs) + fixedCosts) / (1 - pctCosts);
  const { amount, binding } = bindingOf({
    ORIGINAL_PRINCIPAL: i.originalPrincipal,
    REFINANCE_BASIS: refinanceBasis,
    DEBT_SERVICE_TEST: existingDebtService / newConstant,
  });
  const loanAmount = floor1k(amount);
  const newDebtService = loanAmount * newConstant;
  const cashToClose = Math.max(0, i.unpaidBalance + Math.max(0, i.repairs) + fixedCosts + pctCosts * loanAmount - loanAmount);
  return {
    ratePct,
    newTermYears,
    existingDebtService,
    newConstant,
    pctCosts,
    fixedCosts,
    refinanceBasis,
    loanAmount,
    binding,
    newDebtService,
    annualSavings: existingDebtService - newDebtService,
    cashToClose,
  };
}

export function sizeHud223a7(i: Hud223a7Inputs, rates: Benchmarks): SizerQuote {
  const b = hud223a7Breakdown(i, rates);
  const warnings: string[] = [];
  if (b.cashToClose > 0) warnings.push(`Proceeds fall ${fmt.money(b.cashToClose)} short of the payoff and costs; that amount is due at closing.`);
  if (i.repairs > 0) warnings.push("Repairs financed in a 223(a)(7) are limited to critical items the HUD lender's inspection supports.");
  const loan = b.loanAmount;
  return buildSizerQuote({
    id: "HUD_223A7",
    name: "HUD 223(a)(7) refinance",
    short: "Streamlined refinance of an FHA-insured loan",
    // The request is what it takes to retire the existing loan with costs.
    requested: floor1k(b.refinanceBasis),
    loanAmount: loan,
    binding: b.binding === "REFINANCE_BASIS" ? "REQUESTED" : b.binding,
    tranches: [{ label: "HUD 223(a)(7) insured loan", amount: loan, ratePct: b.ratePct, amortYears: b.newTermYears, annualDebtService: loan * debtConstant(b.ratePct, b.newTermYears) }],
    annualFee: { label: `Annual MIP (${(HUD_223A7.annualMip * 100).toFixed(2)}%)`, amount: loan * HUD_223A7.annualMip },
    annualAudit: HUD.annualAuditCost,
    closingBreakdown: [
      { label: "Upfront MIP", amount: loan * HUD_223A7.upfrontMip },
      { label: "Lender financing fee", amount: loan * HUD_223A7.lenderFinancingFeePct },
      { label: "HUD application fee", amount: loan * HUD_223A7.applicationFeePct },
      { label: "Legal & title", amount: HUD_223A7.legalAndTitle },
      { label: "Inspection & reports", amount: HUD_223A7.thirdPartyReports },
      { label: "Corin advisory fee (est.)", amount: loan * BROKER_FEE.hud223a7 },
    ],
    noi: i.noi,
    value: i.value ?? 0,
    leverageBasis: "LTV",
    termLabel: `${b.newTermYears} yrs fixed`,
    amortLabel: `${b.newTermYears} years, fully amortizing`,
    recourse: "Non-recourse",
    closeTimeline: "60–120 days after a complete file; not guaranteed",
    advisoryFeePct: BROKER_FEE.hud223a7,
    eligible: i.unpaidBalance > 0 && i.originalPrincipal > 0,
    notes: [
      "Refinances an existing FHA-insured loan; the new P&I and MIP may not exceed the current payment.",
      `New term up to ${HUD_223A7.maxTermExtensionYears} years beyond the remaining term, within the original program's maximum.`,
    ],
    warnings,
    equityRequired: b.cashToClose,
    accent: "gold",
    terms: [
      { label: "Current P&I + MIP", value: `${fmt.money(b.existingDebtService)} / yr` },
      { label: "New P&I + MIP", value: `${fmt.money(b.newDebtService)} / yr` },
      { label: "Annual savings", value: fmt.money(b.annualSavings) },
      { label: "Original insured principal", value: fmt.money(i.originalPrincipal) },
      { label: "Payoff + eligible costs", value: fmt.money(b.refinanceBasis) },
    ],
  });
}
