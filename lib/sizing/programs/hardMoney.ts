// Hard money: short-term, interest-only private loans sized on the asset
// (as-is value, cost and after-repair value) rather than income. Kubera
// arranges the loan as broker; a private lender funds it as lender of record,
// holds the rehab holdback and any interest reserve, and services it.

import type { Benchmarks } from "@/lib/rates";
import { BANK_PERM, BROKER_FEE, HARD_MONEY, type ExperienceTier, type HardMoneyGridRow } from "./assumptions";
import { AGENCY, SPREADS, mid } from "../assumptions";
import { bridgeExitCopy, bridgeExitTest } from "./bridgeExit";
import { sizeDscr2to4, sizeDscr5Plus } from "./dscrInvestor";
import { bindingOf, buildSizerQuote, floor1k, fmt, ioTranche, months, pickSizerBestFit } from "./quote";
import type { ExitTest, SizerConstraint, SizerQuote, SizerResult } from "./types";

export type HardMoneyStrategy = "FIX_AND_FLIP" | "BRIDGE";
export type HardMoneyPropertyType = "RESIDENTIAL_1_4" | "MULTIFAMILY" | "COMMERCIAL";

export type HardMoneyInputs = {
  strategy: HardMoneyStrategy;
  purpose: "PURCHASE" | "REFINANCE";
  propertyType: HardMoneyPropertyType;
  units: number;
  /** Contract price on a purchase; as-is value on a refinance. */
  purchasePrice: number;
  /** Appraised as-is value; defaults to the purchase price. */
  asIsValue?: number;
  rehabBudget: number;
  /** After-repair value (as-stabilized value on a bridge). Defaults to the as-is value. */
  arv?: number;
  loanAmount: number;
  /** Comparable projects the sponsor completed in the last 36 months. */
  completedProjects: number;
  termMonths: number;
  /** Months the sponsor expects to hold before sale or refinance. */
  holdMonths: number;
  /** Months of interest the lender holds back from the loan (0 = paid monthly). */
  interestReserveMonths: number;
  /** "Dutch" interest accrues on the full commitment; otherwise on the outstanding balance. */
  interestBasis: "OUTSTANDING" | "FULL_COMMITMENT";
  /** Liens paid off at closing on a refinance. */
  existingPayoff?: number;
  /** Bridge exit on 5+ units or commercial: stabilized NOI. */
  stabilizedNoi?: number;
  /** Bridge exit on 1–4 units: gross monthly rent and monthly taxes, insurance and HOA. */
  monthlyRent?: number;
  monthlyTaxesInsuranceHoa?: number;
  /** Guarantor credit score, for the DSCR take-out. */
  fico?: number;
};

export type HardMoneyBreakdown = {
  tier: ExperienceTier;
  grid: HardMoneyGridRow;
  loanAmount: number;
  binding: SizerConstraint;
  initialAdvance: number;
  rehabHoldback: number;
  interestReserve: number;
  points: number;
  closingCosts: number;
  monthlyInterestFull: number;
  interestOverHold: number;
  minimumInterest: number;
  interestCharged: number;
  interestFromReserve: number;
  interestOutOfPocket: number;
  extensions: number;
  extensionFees: number;
  exitFee: number;
  /** Cash the sponsor brings for price (or payoff), rehab not held back, and closing costs. */
  equityRequired: number;
  /** Net cash to the borrower at closing on a refinance. */
  cashOut: number;
  asIsLtv: number;
  ltc: number;
  ltarv: number;
  /** Fix-and-flip only. */
  netSaleProceeds?: number;
  profit?: number;
  returnOnCash?: number;
};

export const EXPERIENCE_LABEL: Record<ExperienceTier, string> = {
  NEW: "First project",
  EMERGING: "1–4 projects",
  EXPERIENCED: "5+ projects",
};

export function hardMoneyTier(completedProjects: number): ExperienceTier {
  const t = HARD_MONEY.tierThresholds;
  if (completedProjects >= t.EXPERIENCED) return "EXPERIENCED";
  if (completedProjects >= t.EMERGING) return "EMERGING";
  return "NEW";
}

const clampTerm = (m: number) => Math.min(HARD_MONEY.maxTermMonths, Math.max(HARD_MONEY.minTermMonths, Math.round(m || HARD_MONEY.minTermMonths)));

/** Pure sizing math for the hard money box; the quote wraps it for display. */
export function hardMoneyBreakdown(i: HardMoneyInputs): HardMoneyBreakdown {
  const tier = hardMoneyTier(i.completedProjects);
  const g = HARD_MONEY.grid[i.strategy][tier];
  const r = g.ratePct / 100;
  const purchase = i.purpose === "PURCHASE";
  const asIs = i.asIsValue || i.purchasePrice;
  const arv = i.arv || asIs;
  const rehab = Math.max(0, i.rehabBudget);
  const term = clampTerm(i.termMonths);
  const hold = Math.max(1, Math.round(i.holdMonths || term));
  const reserveMonths = Math.max(0, Math.min(term, Math.round(i.interestReserveMonths)));

  const advanceBasis = purchase ? Math.min(i.purchasePrice, asIs) : asIs;
  const costBasis = (purchase ? i.purchasePrice : asIs) + rehab;
  const maxInitial = advanceBasis * g.maxInitialPct;
  const maxHoldback = rehab * g.rehabFundedPct;
  // The reserve is sized on the full commitment, so it is a fixed share k of the loan.
  const k = (reserveMonths * r) / 12;

  const { amount, binding } = bindingOf({
    REQUESTED: i.loanAmount,
    ADVANCE: (maxInitial + maxHoldback) / (1 - k),
    LTC: costBasis * g.maxLtc,
    LTARV: arv * g.maxLtarv,
    PROGRAM_CAP: HARD_MONEY.maxLoan,
  });
  const loan = floor1k(amount);
  const interestReserve = loan * k;
  // Rehab is funded first; a smaller commitment comes out of the initial advance.
  const rehabHoldback = Math.min(maxHoldback, loan - interestReserve);
  const initialAdvance = loan - interestReserve - rehabHoldback;

  const points = (loan * g.points) / 100;
  const closingCosts = points + HARD_MONEY.lenderFixedFees + HARD_MONEY.thirdPartyCosts + loan * BROKER_FEE.hardMoney;

  const full = i.interestBasis === "FULL_COMMITMENT";
  const monthlyInterestFull = (loan * r) / 12;
  // Non-Dutch: holdback and reserve are drawn evenly over the hold, so on average half is outstanding.
  const avgBalance = full ? loan : initialAdvance + (rehabHoldback + interestReserve) / 2;
  const interestOverHold = (avgBalance * r * hold) / 12;
  const minimumInterest = ((full ? loan : initialAdvance) * r * g.minInterestMonths) / 12;
  const interestCharged = Math.max(interestOverHold, minimumInterest);
  const interestFromReserve = Math.min(interestReserve, interestCharged);
  const interestOutOfPocket = interestCharged - interestFromReserve;

  const extensions = Math.min(HARD_MONEY.maxExtensions, Math.ceil(Math.max(0, hold - term) / HARD_MONEY.extensionMonths));
  const extensionFees = extensions * g.extensionFeePct * loan;
  const exitFee = g.exitFeePct * loan;

  const acquisition = purchase ? i.purchasePrice : (i.existingPayoff ?? 0);
  const net = acquisition + rehab + closingCosts - initialAdvance - rehabHoldback;

  const b: HardMoneyBreakdown = {
    tier,
    grid: g,
    loanAmount: loan,
    binding,
    initialAdvance,
    rehabHoldback,
    interestReserve,
    points,
    closingCosts,
    monthlyInterestFull,
    interestOverHold,
    minimumInterest,
    interestCharged,
    interestFromReserve,
    interestOutOfPocket,
    extensions,
    extensionFees,
    exitFee,
    equityRequired: Math.max(0, net),
    cashOut: purchase ? 0 : Math.max(0, -net),
    asIsLtv: asIs > 0 ? initialAdvance / asIs : 0,
    ltc: costBasis > 0 ? loan / costBasis : 0,
    ltarv: arv > 0 ? loan / arv : 0,
  };

  if (i.strategy === "FIX_AND_FLIP") {
    const netSaleProceeds = arv * (1 - HARD_MONEY.sellingCostPct);
    const allInCost = costBasis + closingCosts + interestCharged + extensionFees + exitFee;
    const profit = netSaleProceeds - allInCost;
    const cashInvested = b.equityRequired + interestOutOfPocket + extensionFees;
    b.netSaleProceeds = netSaleProceeds;
    b.profit = profit;
    b.returnOnCash = cashInvested > 0 ? profit / cashInvested : 0;
  }
  return b;
}

function saleExit(b: HardMoneyBreakdown, arv: number): ExitTest {
  const net = b.netSaleProceeds ?? 0;
  const payoff = b.loanAmount + b.exitFee;
  const margin = arv > 0 ? (b.profit ?? 0) / arv : 0;
  const result = net < payoff || (b.profit ?? 0) < 0 ? "FAIL" : margin >= HARD_MONEY.minFlipMarginPct ? "PASS" : "MARGINAL";
  return {
    kind: "SALE",
    label: "Sale exit",
    result,
    payoff,
    proceeds: net,
    shortfall: Math.max(0, payoff - net),
    lines: [
      { label: "Net sale proceeds", value: `${fmt.money(net)} (after ${fmt.pct(HARD_MONEY.sellingCostPct, 0)} selling costs)` },
      { label: "Projected profit", value: `${fmt.money(b.profit ?? 0)} (${fmt.pct(margin)} of ARV)` },
      { label: "Return on cash invested", value: fmt.pct(b.returnOnCash ?? 0) },
    ],
  };
}

function takeoutFromDscr(payoff: number, dscr: SizerQuote, label: string): ExitTest {
  const proceeds = dscr.eligible ? dscr.loanAmount : 0;
  const result = proceeds >= payoff ? "PASS" : proceeds >= payoff * 0.95 ? "MARGINAL" : "FAIL";
  return {
    kind: "DSCR_REFINANCE",
    label,
    result,
    payoff,
    proceeds,
    shortfall: Math.max(0, payoff - proceeds),
    lines: [
      { label: "DSCR take-out proceeds", value: fmt.money(proceeds) },
      { label: "Take-out rate", value: dscr.eligible ? `${dscr.ratePct.toFixed(2)}%, 30-yr` : "—" },
      { label: "Paydown at refinance", value: fmt.money(Math.max(0, payoff - proceeds)) },
    ],
  };
}

const HM_CLOSE = "Many close in 10–21 days after a complete file, subject to appraisal and title; not guaranteed";

export function sizeHardMoney(i: HardMoneyInputs, rates: Benchmarks): SizerResult {
  const b = hardMoneyBreakdown(i);
  const g = b.grid;
  const asIs = i.asIsValue || i.purchasePrice;
  const arv = i.arv || asIs;
  const costBasis = (i.purpose === "PURCHASE" ? i.purchasePrice : asIs) + Math.max(0, i.rehabBudget);
  const term = clampTerm(i.termMonths);
  const hold = Math.max(1, Math.round(i.holdMonths || term));
  const flip = i.strategy === "FIX_AND_FLIP";
  const quotes: SizerQuote[] = [];
  const notes: string[] = [];
  const warnings: string[] = [];

  // Exit: sale for a flip; DSCR refinance for rentals; bridge exit test for income property.
  let exit: ExitTest | undefined;
  let takeout: SizerQuote | undefined;
  const dscrInputs = {
    purpose: "RATE_TERM" as const,
    value: arv,
    loanAmount: b.loanAmount + b.exitFee,
    fico: i.fico ?? 720,
  };
  if (flip) {
    exit = saleExit(b, arv);
  } else if (i.propertyType === "RESIDENTIAL_1_4") {
    takeout = sizeDscr2to4({ ...dscrInputs, units: Math.max(2, i.units), monthlyRent: i.monthlyRent, monthlyTaxesInsuranceHoa: i.monthlyTaxesInsuranceHoa }, rates);
    exit = takeoutFromDscr(b.loanAmount + b.exitFee, takeout, "DSCR refinance exit");
    if (i.units < 2) takeout = undefined;
  } else if ((i.stabilizedNoi ?? 0) > 0) {
    const multifamily = i.propertyType === "MULTIFAMILY";
    const t = bridgeExitTest({
      payoff: b.loanAmount + b.exitFee,
      stabilizedNoi: i.stabilizedNoi ?? 0,
      takeoutRatePct: multifamily ? rates.tenYear + mid(SPREADS.agency) : rates.fiveYear + BANK_PERM.spread,
      takeoutAmortYears: multifamily ? AGENCY.amortYears : BANK_PERM.amortYears,
    });
    exit = t;
    const copy = bridgeExitCopy(t);
    notes.push(...copy.notes);
    warnings.push(...copy.warnings);
    if (multifamily && i.units >= 5) {
      takeout = sizeDscr5Plus({ ...dscrInputs, units: i.units, noi: i.stabilizedNoi }, rates);
    }
  } else {
    warnings.push("Enter stabilized NOI to run the bridge exit test.");
  }

  if (exit && exit.kind !== "BRIDGE_REFINANCE") {
    if (exit.result === "FAIL") warnings.push(flip ? `Sale exit fails: projected net sale proceeds do not leave a profit after financing costs.` : `Refinance exit falls ${fmt.money(exit.shortfall)} short of the payoff.`);
    else if (exit.result === "MARGINAL") warnings.push(flip ? `Thin margin: projected profit is under ${fmt.pct(HARD_MONEY.minFlipMarginPct, 0)} of ARV.` : "Refinance exit is tight: the DSCR take-out barely covers the payoff.");
  }
  if (hold > term + HARD_MONEY.maxExtensions * HARD_MONEY.extensionMonths)
    warnings.push(`A ${months(hold)} hold runs past the ${months(term)} term plus ${HARD_MONEY.maxExtensions} extensions.`);
  if (b.tier === "NEW") warnings.push("First-time sponsors get lower leverage and higher pricing; a co-sponsor with a track record can improve terms.");
  if (b.rehabHoldback > 0 && b.rehabHoldback < i.rehabBudget) warnings.push(`The lender holds back ${fmt.pct(b.rehabHoldback / i.rehabBudget, 0)} of the rehab budget; you fund the rest.`);
  if (b.loanAmount > 0 && b.loanAmount < HARD_MONEY.minLoan) warnings.push(`Below the ${fmt.money(HARD_MONEY.minLoan)} minimum private lenders on our panel take.`);

  if (b.rehabHoldback > 0) notes.push("The lender of record holds the rehab holdback and releases it as work is completed; Kubera has no role in draws.");
  if (b.interestReserve > 0) notes.push("The interest reserve is held by the lender of record and pays monthly interest.");
  notes.push("Arranged by Kubera as broker; the private lender funds at closing and is the lender of record.");
  notes.push("Secured by real property, so a Mortgage Loan Disclosure Statement (RE 882) is required; Kubera's compensation is disclosed on it.");

  const terms = [
    { label: "Sponsor experience", value: EXPERIENCE_LABEL[b.tier] },
    { label: "Initial advance", value: `${fmt.money(b.initialAdvance)} (${fmt.pct(b.asIsLtv)} of as-is)` },
    { label: "Rehab holdback", value: fmt.money(b.rehabHoldback) },
    { label: "Interest reserve", value: b.interestReserve > 0 ? `${fmt.money(b.interestReserve)} (${months(Math.round(i.interestReserveMonths))})` : "None — interest paid monthly" },
    { label: "LTC / LTARV", value: `${fmt.pct(b.ltc)} / ${fmt.pct(b.ltarv)}` },
    { label: "Points", value: `${g.points.toFixed(2)} (${fmt.money(b.points)})` },
    { label: "Interest accrues on", value: i.interestBasis === "FULL_COMMITMENT" ? "Full commitment (Dutch)" : "Outstanding balance" },
    { label: "Minimum interest", value: `${months(g.minInterestMonths)} (${fmt.money(b.minimumInterest)})` },
    { label: `Interest over ${months(hold)}`, value: fmt.money(b.interestCharged) },
    { label: "Extensions", value: `${HARD_MONEY.maxExtensions} × ${HARD_MONEY.extensionMonths} months at ${fmt.pct(g.extensionFeePct, 2)}${b.extensions ? ` (${b.extensions} needed: ${fmt.money(b.extensionFees)})` : ""}` },
    { label: "Exit fee", value: `${fmt.pct(g.exitFeePct, 2)} (${fmt.money(b.exitFee)})` },
    { label: "Default rate (lender of record's note)", value: `Up to ${HARD_MONEY.defaultRatePct}%` },
    ...(i.purpose === "REFINANCE" && b.cashOut > 0 ? [{ label: "Net cash at closing", value: fmt.money(b.cashOut) }] : []),
  ];

  quotes.push(
    buildSizerQuote({
      id: "HARD_MONEY",
      name: flip ? "Hard money (fix-and-flip)" : "Hard money bridge",
      short: `${months(term)} interest-only, private lender`,
      requested: i.loanAmount,
      loanAmount: b.loanAmount,
      binding: b.binding,
      tranches: [ioTranche("Fixed-rate hard money loan (interest-only)", b.loanAmount, g.ratePct)],
      annualFee: { label: "No guarantee fee", amount: 0 },
      closingBreakdown: [
        { label: `Lender points (${g.points.toFixed(2)})`, amount: b.points },
        { label: "Lender underwriting & doc fees", amount: HARD_MONEY.lenderFixedFees },
        { label: "Appraisal, title & escrow", amount: HARD_MONEY.thirdPartyCosts },
        { label: "Kubera advisory fee (est.)", amount: b.loanAmount * BROKER_FEE.hardMoney },
      ],
      noi: flip ? 0 : (i.stabilizedNoi ?? (i.monthlyRent ? Math.max(0, i.monthlyRent - (i.monthlyTaxesInsuranceHoa ?? 0)) * 12 : 0)),
      value: costBasis,
      leverageBasis: "LTC",
      termLabel: `${months(term)} + extensions`,
      amortLabel: "Interest-only",
      recourse: "Full recourse (personal guaranty)",
      closeTimeline: HM_CLOSE,
      advisoryFeePct: BROKER_FEE.hardMoney,
      eligible: b.loanAmount >= HARD_MONEY.minLoan && costBasis > 0,
      notes,
      warnings,
      equityRequired: b.equityRequired,
      horizonYears: term / 12,
      interim: true,
      terms,
      exit,
      accent: b.tier === "EXPERIENCED" ? "emerald" : undefined,
    }),
  );
  if (takeout) quotes.push({ ...takeout, short: `Take-out after stabilization · ${takeout.short}` });

  const metrics = [
    { label: "As-is value", value: fmt.money(asIs) },
    { label: flip ? "After-repair value" : "As-stabilized value", value: fmt.money(arv) },
    { label: "Sponsor tier", value: EXPERIENCE_LABEL[b.tier] },
  ];
  // The hard money loan is the request; the take-out is shown alongside, never picked over it.
  const best = pickSizerBestFit(quotes.filter((q) => q.id === "HARD_MONEY"));
  return { quotes, bestFit: best, value: costBasis, valueEstimated: false, metrics };
}
