// Agency multifamily (Fannie Mae / Freddie Mac): tiered leverage-and-pricing
// grids with a selectable fixed-rate term and optional interest-only period.
// Each grid tier trades leverage for price; the box picks the cheapest tier
// that still covers the request (else the tier with the largest proceeds).

import type { Benchmarks } from "@/lib/rates";
import { AGENCY, BROKER_FEE_PCT, SPREADS, mid } from "../assumptions";
import { debtConstant } from "../finance";
import { AGENCY_GRID, type AgencyTier } from "./assumptions";
import { bindingOf, buildSizerQuote, floor1k, fmt } from "./quote";
import type { SizerConstraint, SizerQuote } from "./types";

export type AgencyLender = "FANNIE" | "FREDDIE";

export type AgencyInputs = {
  /** Multifamily or mixed-use with residential units. */
  residential: boolean;
  units: number;
  loanAmount: number;
  noi: number;
  value: number;
  transaction: "PURCHASE" | "REFINANCE" | "CONSTRUCTION";
  /** Fixed-rate term in years; snapped to the nearest term the lender offers. */
  termYears: number;
  /** Interest-only years (0 = amortizing from day one; ≥ term = full-term IO). */
  ioYears: number;
  green: boolean;
  /** Physical occupancy; agency lenders want ~90% for 90 days. */
  occupancyPct?: number;
};

export type AgencyTierSizing = {
  tier: AgencyTier;
  maxLtv: number;
  minDscr: number;
  ratePct: number;
  maxLoan: number;
  binding: SizerConstraint;
  allowed: boolean;
};

export const AGENCY_TIER_LABEL: Record<AgencyTier, string> = { TIER_2: "Tier 2", TIER_3: "Tier 3", TIER_4: "Tier 4" };

/** Offered term closest to the one asked for (ties go to the shorter term). */
export function snapTerm(lender: AgencyLender, termYears: number): number {
  const terms = lender === "FANNIE" ? AGENCY_GRID.fannie.terms : AGENCY_GRID.freddie.terms;
  return terms.reduce((best, t) => (Math.abs(t - termYears) < Math.abs(best - termYears) ? t : best), terms[0] ?? 10);
}

/** Note rate for a lender, tier and term: matched Treasury + agency spread + grid, term and green adjustments. */
export function agencyRate(lender: AgencyLender, tier: AgencyTier, termYears: number, green: boolean, rates: Benchmarks): number {
  const bench = termYears <= 7 ? rates.fiveYear : rates.tenYear;
  const lenderAdj = lender === "FANNIE" ? AGENCY_GRID.fannie.spreadAdj : AGENCY_GRID.freddie.spreadAdj;
  return (
    bench +
    mid(SPREADS.agency) +
    lenderAdj +
    AGENCY_GRID.tiers[tier].spreadAdj +
    (AGENCY_GRID.termSpreadAdj[termYears] ?? 0) -
    (green ? AGENCY.greenRateDiscountPct : 0)
  );
}

function programCap(lender: AgencyLender, requested: number): number {
  if (lender === "FREDDIE" && requested <= AGENCY_GRID.freddie.smallMax) return AGENCY_GRID.freddie.smallMax;
  return Infinity;
}

/** Every grid tier sized for the deal: max proceeds and the constraint that binds each. */
export function agencyGrid(lender: AgencyLender, i: AgencyInputs, rates: Benchmarks): AgencyTierSizing[] {
  const term = snapTerm(lender, i.termYears);
  const fullIo = i.ioYears >= term;
  return (Object.keys(AGENCY_GRID.tiers) as AgencyTier[]).map((tier) => {
    const t = AGENCY_GRID.tiers[tier];
    const ratePct = agencyRate(lender, tier, term, i.green, rates);
    // Coverage is always tested on the amortizing payment, even during an interest-only period.
    const constant = debtConstant(ratePct, AGENCY_GRID.amortYears);
    const { amount, binding } = bindingOf({
      LTV: i.value * t.maxLtv,
      DSCR: i.noi > 0 ? i.noi / t.minDscr / constant : 0,
      PROGRAM_CAP: programCap(lender, i.loanAmount),
    });
    return { tier, maxLtv: t.maxLtv, minDscr: t.minDscr, ratePct, maxLoan: amount, binding, allowed: !fullIo || AGENCY_GRID.fullIoTiers.includes(tier) };
  });
}

/** Cheapest allowed tier covering the request, else the allowed tier with the largest proceeds. */
export function chooseAgencyTier(grid: AgencyTierSizing[], requested: number): AgencyTierSizing {
  const allowed = grid.filter((g) => g.allowed);
  const covering = allowed.filter((g) => g.maxLoan >= requested);
  if (covering.length) return covering.reduce((a, b) => (b.ratePct < a.ratePct ? b : a));
  return allowed.reduce((a, b) => (b.maxLoan > a.maxLoan || (b.maxLoan === a.maxLoan && b.ratePct < a.ratePct) ? b : a));
}

function programName(lender: AgencyLender, requested: number): string {
  if (lender === "FANNIE") return requested <= AGENCY_GRID.fannie.smallLoanMax ? "Fannie Mae Small Loan" : "Fannie Mae DUS";
  return requested <= AGENCY_GRID.freddie.smallMax ? "Freddie Mac Conventional Small" : "Freddie Mac Conventional";
}

export function sizeAgency(lender: AgencyLender, i: AgencyInputs, rates: Benchmarks): SizerQuote {
  const term = snapTerm(lender, i.termYears);
  const io = Math.max(0, Math.min(term, Math.round(i.ioYears)));
  const grid = agencyGrid(lender, i, rates);
  const pick = chooseAgencyTier(grid, i.loanAmount);
  const { amount, binding } = bindingOf({ REQUESTED: i.loanAmount, [pick.binding]: pick.maxLoan });
  const loan = floor1k(amount);
  const ratePct = pick.ratePct;
  const constant = debtConstant(ratePct, AGENCY_GRID.amortYears);
  const small = lender === "FANNIE" ? i.loanAmount <= AGENCY_GRID.fannie.smallLoanMax : i.loanAmount <= AGENCY_GRID.freddie.smallMax;
  const fixedCosts = small ? (lender === "FANNIE" ? AGENCY_GRID.fannie.smallFixedCosts : AGENCY_GRID.freddie.smallFixedCosts) : AGENCY.fixedCosts;
  const minLoan = lender === "FANNIE" ? AGENCY_GRID.fannie.minLoan : AGENCY_GRID.freddie.smallMin;

  const warnings: string[] = [];
  const construction = i.transaction === "CONSTRUCTION";
  if (!i.residential) warnings.push("Agency debt is for multifamily housing only.");
  if (i.units < AGENCY_GRID.minUnits) warnings.push("Agency programs need five or more units.");
  if (construction) warnings.push("Agency lenders need a stabilized asset — pair with construction debt first.");
  if (i.occupancyPct !== undefined && i.occupancyPct < AGENCY_GRID.minOccupancyPct) warnings.push(`Agency lenders look for ~${AGENCY_GRID.minOccupancyPct}% occupancy for 90 days before rate lock.`);
  if (i.loanAmount < minLoan) warnings.push(lender === "FREDDIE" ? `Below Freddie Mac's ${fmt.money(minLoan)} Conventional Small minimum.` : `Below the ${fmt.money(minLoan)} agency minimum.`);
  if (term !== i.termYears) warnings.push(`${lender === "FANNIE" ? "Fannie Mae" : "Freddie Mac"} offers ${(lender === "FANNIE" ? AGENCY_GRID.fannie.terms : AGENCY_GRID.freddie.terms).join(", ")}-year terms; quoted at ${term} years.`);
  if (io >= term) warnings.push("Full-term interest-only is available at Tier 3 leverage (65% LTV) or lower.");

  const notes = [
    `${AGENCY_TIER_LABEL[pick.tier]} pricing: up to ${fmt.pct(pick.maxLtv, 0)} LTV at ${fmt.ratio(pick.minDscr)} coverage.`,
    ...(lender === "FREDDIE" ? ["Freddie Mac's Small Balance Loan program was reportedly retired in April 2026; Conventional Small is modeled."] : []),
    ...(i.green ? [`Green certification modeled at a ${AGENCY.greenRateDiscountPct.toFixed(2)}% rate discount.`] : []),
  ];

  const ioMonthly = (loan * ratePct) / 100 / 12;
  return buildSizerQuote({
    id: lender === "FANNIE" ? "AGENCY_FANNIE_MAE" : "AGENCY_FREDDIE_MAC",
    name: programName(lender, i.loanAmount),
    short: `${term}-yr fixed, non-recourse`,
    requested: i.loanAmount,
    loanAmount: loan,
    binding,
    tranches: [{ label: `${lender === "FANNIE" ? "Fannie Mae" : "Freddie Mac"} fixed-rate loan`, amount: loan, ratePct, amortYears: AGENCY_GRID.amortYears, annualDebtService: loan * constant }],
    annualFee: { label: "Guarantee fee embedded in rate", amount: 0 },
    closingBreakdown: [
      { label: "Lender origination", amount: loan * AGENCY.originationPct },
      { label: "Reports, legal & title", amount: fixedCosts },
      { label: "Kubera advisory fee (est.)", amount: loan * BROKER_FEE_PCT.AGENCY },
    ],
    noi: i.noi,
    value: i.value,
    leverageBasis: "LTV",
    termLabel: `${term} yrs fixed · yield maintenance`,
    amortLabel: io >= term ? "Full-term interest-only" : io > 0 ? `${io} yrs interest-only, then 30 years` : "30 years",
    recourse: "Non-recourse (standard carve-outs)",
    closeTimeline: "45–60 days after a complete file; not guaranteed",
    advisoryFeePct: BROKER_FEE_PCT.AGENCY,
    eligible: i.residential && i.units >= AGENCY_GRID.minUnits && !construction && i.loanAmount >= minLoan,
    notes,
    warnings,
    terms: [
      ...grid.map((g) => ({
        label: `${AGENCY_TIER_LABEL[g.tier]} · ${fmt.pct(g.maxLtv, 0)} / ${fmt.ratio(g.minDscr)}`,
        value: g.allowed ? `${fmt.money(floor1k(g.maxLoan))} at ${g.ratePct.toFixed(2)}%` : "No full-term IO",
      })),
      ...(io > 0 ? [{ label: io >= term ? "Interest-only payment" : `Interest-only (first ${io} yrs)`, value: `${fmt.money(ioMonthly)} / mo` }] : []),
      { label: "Prepayment", value: "Yield maintenance (step-down options available)" },
    ],
  });
}
