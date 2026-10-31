// DSCR investor rental loans: business-purpose 30-year loans sized on the
// property's rent rather than the borrower's income. Two boxes: 2–4 units
// (coverage = gross rent / PITIA) and 5+ units (coverage = NOI / debt service).

import type { Benchmarks } from "@/lib/rates";
import { debtConstant, monthlyPayment } from "../finance";
import { BROKER_FEE, DSCR_INVESTOR, type CreditTier, type DscrPurpose } from "./assumptions";
import { bindingOf, buildSizerQuote, floor1k, fmt } from "./quote";
import type { SizerQuote } from "./types";

export type DscrInvestorInputs = {
  units: number;
  purpose: DscrPurpose;
  /** Lesser of purchase price and appraised value on a purchase; appraised value otherwise. */
  value: number;
  loanAmount: number;
  /** Middle credit score of the guarantor(s). */
  fico: number;
  /** 2–4 units: gross monthly rent (in-place leases or the appraiser's market rent). */
  monthlyRent?: number;
  /** 2–4 units: monthly property taxes, insurance and HOA dues (the "TIA" in PITIA). */
  monthlyTaxesInsuranceHoa?: number;
  /** 5+ units: underwritten annual NOI. */
  noi?: number;
};

export function creditTier(fico: number): CreditTier | null {
  const t = DSCR_INVESTOR.creditTiers;
  if (fico >= t.A) return "A";
  if (fico >= t.B) return "B";
  if (fico >= t.C) return "C";
  return null;
}

const TIER_LABEL: Record<CreditTier, string> = { A: "740+", B: "700–739", C: "660–699" };
const PURPOSE_LABEL: Record<DscrPurpose, string> = { PURCHASE: "purchase", RATE_TERM: "rate-and-term refinance", CASH_OUT: "cash-out refinance" };

const DSCR_CLOSE = "Often 3–5 weeks after a complete file; not guaranteed";

function closing(loan: number, fixedCosts: number) {
  return [
    { label: "Lender origination", amount: loan * DSCR_INVESTOR.originationPct },
    { label: "Appraisal (with rent schedule), title & lender fees", amount: fixedCosts },
    { label: "Kubera advisory fee (est.)", amount: loan * BROKER_FEE.dscr },
  ];
}

/** 2–4 unit DSCR loan: rent / (P&I + taxes + insurance + HOA) ≥ 1.00. */
export function sizeDscr2to4(i: DscrInvestorInputs, rates: Benchmarks): SizerQuote {
  const box = DSCR_INVESTOR.units2to4;
  const tier = creditTier(i.fico);
  const t = tier ?? "C";
  const ratePct = rates.tenYear + box.spread[t];
  const rent = i.monthlyRent ?? 0;
  const tia = i.monthlyTaxesInsuranceHoa ?? 0;
  const maxLtv = box.maxLtv[i.purpose][t];
  const pmt = monthlyPayment(1, ratePct, DSCR_INVESTOR.amortYears);
  const maxPI = rent / box.minDscr - tia;
  const { amount, binding } = bindingOf({
    REQUESTED: i.loanAmount,
    LTV: i.value * maxLtv,
    DSCR: maxPI > 0 ? maxPI / pmt : 0,
    PROGRAM_CAP: box.maxLoan,
  });
  const loan = floor1k(amount);
  const pi = monthlyPayment(loan, ratePct, DSCR_INVESTOR.amortYears);
  const unitsOk = i.units >= box.minUnits && i.units <= box.maxUnits;
  const warnings: string[] = [];
  if (!unitsOk) warnings.push(i.units < box.minUnits ? "Single-family rentals are outside the 2–4 unit box; an advisor can price them separately." : "Five or more units size on the 5+ unit DSCR box.");
  if (!tier) warnings.push(`DSCR lenders in this box need a ${DSCR_INVESTOR.creditTiers.C}+ credit score.`);
  if (rent <= 0) warnings.push("Enter the gross monthly rent to size on coverage.");
  if (loan > 0 && loan < box.minLoan) warnings.push(`Below the ${fmt.money(box.minLoan)} minimum for this box.`);

  return buildSizerQuote({
    id: "DSCR_INVESTOR_2_4",
    name: "DSCR rental (2–4 units)",
    short: "30-yr fixed, sized on rent",
    requested: i.loanAmount,
    loanAmount: loan,
    binding,
    tranches: [{ label: "30-year fixed DSCR loan", amount: loan, ratePct, amortYears: DSCR_INVESTOR.amortYears, annualDebtService: pi * 12 }],
    closingBreakdown: closing(loan, box.fixedCosts),
    // Coverage is gross rent over PITIA; debt yield uses rent less taxes, insurance and HOA.
    noi: rent * 12,
    coverageDebtService: (pi + tia) * 12,
    debtYieldNoi: Math.max(0, rent - tia) * 12,
    value: i.value,
    leverageBasis: "LTV",
    termLabel: "30 yrs fixed",
    amortLabel: "30 years",
    recourse: "Full recourse (personal guaranty)",
    closeTimeline: DSCR_CLOSE,
    advisoryFeePct: BROKER_FEE.dscr,
    eligible: unitsOk && tier !== null && rent > 0 && loan >= box.minLoan,
    notes: [
      `Credit tier ${TIER_LABEL[t]}: up to ${fmt.pct(maxLtv, 0)} LTV on a ${PURPOSE_LABEL[i.purpose]}.`,
      "Business-purpose loan to an entity or investor; the property may not be owner-occupied.",
    ],
    warnings,
    equityRequired: i.purpose === "PURCHASE" ? Math.max(0, i.value - loan) : undefined,
    horizonYears: 5,
    terms: [
      { label: "Rent / PITIA", value: pi + tia > 0 ? fmt.ratio(rent / (pi + tia)) : "—" },
      { label: "Monthly PITIA", value: fmt.money(pi + tia) },
      { label: "Minimum coverage", value: fmt.ratio(box.minDscr) },
      { label: "Prepayment", value: DSCR_INVESTOR.prepay },
    ],
  });
}

/** 5+ unit DSCR loan: NOI / annual debt service ≥ 1.20. */
export function sizeDscr5Plus(i: DscrInvestorInputs, rates: Benchmarks): SizerQuote {
  const box = DSCR_INVESTOR.units5plus;
  const tier = creditTier(i.fico);
  const t = tier ?? "C";
  const ratePct = rates.tenYear + box.spread[t];
  const noi = i.noi ?? 0;
  const maxLtv = box.maxLtv[i.purpose][t];
  const constant = debtConstant(ratePct, DSCR_INVESTOR.amortYears);
  const { amount, binding } = bindingOf({
    REQUESTED: i.loanAmount,
    LTV: i.value * maxLtv,
    DSCR: noi > 0 ? noi / box.minDscr / constant : 0,
    PROGRAM_CAP: box.maxLoan,
  });
  const loan = floor1k(amount);
  const warnings: string[] = [];
  if (i.units < box.minUnits) warnings.push("Fewer than five units size on the 2–4 unit DSCR box.");
  if (!tier) warnings.push(`DSCR lenders in this box need a ${DSCR_INVESTOR.creditTiers.C}+ credit score.`);
  if (loan > 0 && loan < box.minLoan) warnings.push(`Below the ${fmt.money(box.minLoan)} minimum for this box.`);
  if (i.loanAmount > box.maxLoan) warnings.push(`Above the ${fmt.money(box.maxLoan)} DSCR box — agency or bank debt usually fits better.`);

  return buildSizerQuote({
    id: "DSCR_INVESTOR_5_PLUS",
    name: "DSCR rental (5+ units)",
    short: "30-yr fixed, sized on NOI",
    requested: i.loanAmount,
    loanAmount: loan,
    binding,
    tranches: [{ label: "30-year fixed DSCR loan", amount: loan, ratePct, amortYears: DSCR_INVESTOR.amortYears, annualDebtService: loan * constant }],
    closingBreakdown: closing(loan, box.fixedCosts),
    noi,
    value: i.value,
    leverageBasis: "LTV",
    termLabel: "30 yrs fixed (5/1 ARM available)",
    amortLabel: "30 years",
    recourse: "Full recourse (personal guaranty)",
    closeTimeline: DSCR_CLOSE,
    advisoryFeePct: BROKER_FEE.dscr,
    eligible: i.units >= box.minUnits && tier !== null && noi > 0 && loan >= box.minLoan,
    notes: [`Credit tier ${TIER_LABEL[t]}: up to ${fmt.pct(maxLtv, 0)} LTV on a ${PURPOSE_LABEL[i.purpose]}, ${fmt.ratio(box.minDscr)} minimum coverage.`],
    warnings,
    equityRequired: i.purpose === "PURCHASE" ? Math.max(0, i.value - loan) : undefined,
    horizonYears: 5,
    terms: [
      { label: "Minimum coverage", value: fmt.ratio(box.minDscr) },
      { label: "Prepayment", value: DSCR_INVESTOR.prepay },
    ],
  });
}

/** Routes to the 2–4 or 5+ box by unit count. */
export function sizeDscrInvestor(i: DscrInvestorInputs, rates: Benchmarks): SizerQuote {
  return i.units >= DSCR_INVESTOR.units5plus.minUnits ? sizeDscr5Plus(i, rates) : sizeDscr2to4(i, rates);
}
