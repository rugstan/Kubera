// Ground-up construction: senior loan sized on the lesser of loan-to-cost,
// as-completed value, debt yield and coverage at stabilization, with the
// interest reserve and financing fees carried inside the budget (so the loan
// and the cost it is measured against are solved together). Each lender
// channel gets its own capital stack and a take-out test at stabilization.
//
// Corin's role ends at closing: the lender of record funds and administers
// the loan. Nothing here models draws, inspections, lien waivers or servicing.

import type { Benchmarks } from "@/lib/rates";
import { AGENCY, HUD, SPREADS, mid } from "../assumptions";
import { debtConstant } from "../finance";
import { sizeMultifamily } from "../programs";
import { BANK_PERM, BROKER_FEE, CONSTRUCTION, type ConstructionLender, type ExperienceTier } from "./assumptions";
import { bindingOf, buildSizerQuote, floor1k, fmt, ioTranche, months, pickSizerBestFit } from "./quote";
import type { CapitalStack, ExitTest, SizerConstraint, SizerProgramId, SizerQuote, SizerResult, StackLayer } from "./types";

export type ConstructionAsset = "MULTIFAMILY" | "MIXED_USE" | "COMMERCIAL" | "HOTEL";
export type TakeoutKind = "AGENCY" | "HUD_223F" | "BANK_PERM";

export type ConstructionInputs = {
  assetType: ConstructionAsset;
  units: number;
  /** Land purchase price or contributed land basis. */
  landCost: number;
  hardCosts: number;
  softCosts: number;
  /** Hard-cost contingency share; raised to the lender minimum when below it. */
  contingencyPct: number;
  /** Developer fee share of hard + soft costs; capped at what lenders allow in the budget. */
  developerFeePct: number;
  /** A guaranteed-maximum-price contract lowers the contingency lenders require. */
  gmpContract: boolean;
  constructionMonths: number;
  leaseUpMonths: number;
  stabilizedNoi: number;
  /** As-completed (as-stabilized) value; estimated from a cap rate when blank. */
  asCompletedValue?: number;
  /** Senior loan requested. */
  loanAmount: number;
  /** Comparable ground-up projects the sponsor has completed. */
  completedProjects: number;
  /** Fill the stack with mezzanine debt up to this combined LTC (0 = none). */
  mezzTargetLtc: number;
  /** Fill with preferred equity up to this combined LTC (0 = none). */
  prefTargetLtc: number;
  /** C-PACE assessment financing requested (0 = none). */
  cpaceAmount: number;
  takeout?: TakeoutKind;
};

export type ConstructionBudget = {
  contingencyPct: number;
  developerFeePct: number;
  contingency: number;
  developerFee: number;
  /** Land, hard, soft, contingency and developer fee: everything except financing costs. */
  baseCost: number;
  asCompletedValue: number;
  valueEstimated: boolean;
  adjustments: string[];
};

export type ConstructionBreakdown = {
  lender: ConstructionLender;
  tier: ExperienceTier;
  ratePct: number;
  maxLtc: number;
  maxAsCompletedLtv: number;
  loanAmount: number;
  binding: SizerConstraint;
  /** Fixed-point iterations the interest-reserve solve took. */
  iterations: number;
  interestReserve: number;
  points: number;
  brokerFee: number;
  fixedFees: number;
  totalCost: number;
  ltc: number;
  asCompletedLtv: number;
  yieldOnCost: number;
  termMonths: number;
  stack: CapitalStack;
  takeout: ExitTest & { kindOfTakeout: TakeoutKind; permRatePct: number; permDscr: number };
};

export function constructionTier(completedProjects: number): ExperienceTier {
  const t = CONSTRUCTION.experience.tierThresholds;
  if (completedProjects >= t.EXPERIENCED) return "EXPERIENCED";
  if (completedProjects >= t.EMERGING) return "EMERGING";
  return "NEW";
}

export function constructionBudget(i: ConstructionInputs): ConstructionBudget {
  const adjustments: string[] = [];
  const minContingency = i.gmpContract ? CONSTRUCTION.minContingencyGmp : CONSTRUCTION.minContingencyNoGmp;
  let contingencyPct = Math.max(0, i.contingencyPct);
  if (contingencyPct < minContingency) {
    adjustments.push(`Contingency raised to the ${fmt.pct(minContingency, 0)} of hard costs lenders require${i.gmpContract ? " with a GMP contract" : " without a GMP contract"}.`);
    contingencyPct = minContingency;
  }
  let developerFeePct = Math.max(0, i.developerFeePct);
  if (developerFeePct > CONSTRUCTION.maxDeveloperFeePct) {
    adjustments.push(`Developer fee capped at ${fmt.pct(CONSTRUCTION.maxDeveloperFeePct, 0)} of hard and soft costs in the lender budget; any excess is usually deferred.`);
    developerFeePct = CONSTRUCTION.maxDeveloperFeePct;
  }
  const contingency = i.hardCosts * contingencyPct;
  const developerFee = (i.hardCosts + i.softCosts) * developerFeePct;
  const baseCost = i.landCost + i.hardCosts + i.softCosts + contingency + developerFee;
  const valueEstimated = !i.asCompletedValue;
  const asCompletedValue = i.asCompletedValue || i.stabilizedNoi / CONSTRUCTION.capRate[i.assetType];
  return { contingencyPct, developerFeePct, contingency, developerFee, baseCost, asCompletedValue, valueEstimated, adjustments };
}

export function defaultTakeout(i: Pick<ConstructionInputs, "assetType" | "units">): TakeoutKind {
  return i.assetType === "MULTIFAMILY" && i.units >= 5 ? "AGENCY" : "BANK_PERM";
}

/** Permanent loan box for the take-out test: rate, amortization (with MIP folded into the constant), max LTV and min DSCR. */
export function takeoutBox(kind: TakeoutKind, rates: Benchmarks): { ratePct: number; constant: number; maxLtv: number; minDscr: number; label: string } {
  if (kind === "AGENCY") {
    const ratePct = rates.tenYear + mid(SPREADS.agency);
    return { ratePct, constant: debtConstant(ratePct, AGENCY.amortYears), maxLtv: AGENCY.maxLtv, minDscr: AGENCY.minDscr, label: "Agency (Fannie / Freddie)" };
  }
  if (kind === "HUD_223F") {
    const p = HUD.multifamily.s223f;
    const ratePct = rates.tenYear + mid(SPREADS.hudMultifamily);
    return { ratePct, constant: debtConstant(ratePct, p.termYears) + HUD.multifamily.mip.annual, maxLtv: p.maxLtv, minDscr: p.minDscr, label: "HUD 223(f)" };
  }
  const ratePct = rates.fiveYear + BANK_PERM.spread;
  return { ratePct, constant: debtConstant(ratePct, BANK_PERM.amortYears), maxLtv: BANK_PERM.maxLtv, minDscr: BANK_PERM.minDscr, label: "Bank permanent loan" };
}

/**
 * Solves loan = min(static caps, LTC × (base cost + fixed fees + c × loan)) by
 * fixed-point iteration, where c is points + advisory fee + interest-reserve
 * factor. Each step raises the loan toward the fixed point; since LTC × c < 1
 * the iteration converges (the closed form is LTC × (base + fixed) / (1 − LTC × c)).
 */
export function solveLoanWithinLtc(args: { staticCap: number; ltc: number; baseCost: number; fixedFees: number; costPerDollar: number }): { loan: number; ltcBinds: boolean; iterations: number } {
  let loan = 0;
  let iterations = 0;
  for (; iterations < 200; iterations++) {
    const ltcLimit = args.ltc * (args.baseCost + args.fixedFees + args.costPerDollar * loan);
    const next = Math.min(args.staticCap, ltcLimit);
    if (Math.abs(next - loan) < 0.005) {
      loan = next;
      break;
    }
    loan = next;
  }
  const ltcAtLoan = args.ltc * (args.baseCost + args.fixedFees + args.costPerDollar * loan);
  return { loan, ltcBinds: ltcAtLoan < args.staticCap - 0.01, iterations: iterations + 1 };
}

function buildStack(i: ConstructionInputs, totalCost: number, senior: number, seniorRatePct: number): { stack: CapitalStack; notes: string[] } {
  const notes: string[] = [];
  const cfg = CONSTRUCTION;
  const cpaceEligible = i.assetType !== "MULTIFAMILY" || i.units >= 5;
  let cpace = cpaceEligible ? Math.min(Math.max(0, i.cpaceAmount), cfg.cpace.maxPctOfCost * totalCost) : 0;
  if (i.cpaceAmount > 0 && !cpaceEligible) notes.push("C-PACE is available for multifamily only at five or more units.");
  else if (i.cpaceAmount > cpace) notes.push(`C-PACE limited to about ${fmt.pct(cfg.cpace.maxPctOfCost, 0)} of project cost.`);

  const mezzTarget = Math.min(Math.max(0, i.mezzTargetLtc), cfg.mezz.maxCombinedLtc);
  let mezz = mezzTarget > 0 ? Math.max(0, mezzTarget * totalCost - senior - cpace) : 0;
  const prefTarget = Math.min(Math.max(0, i.prefTargetLtc), cfg.pref.maxCombinedLtc);
  let pref = prefTarget > 0 ? Math.max(0, prefTarget * totalCost - senior - cpace - mezz) : 0;

  // Keep the sponsor's minimum common equity: give back preferred equity first, then mezzanine, then C-PACE.
  let excess = cfg.minCommonEquityPct * totalCost - (totalCost - senior - cpace - mezz - pref);
  for (const take of ["pref", "mezz", "cpace"] as const) {
    if (excess <= 0) break;
    const have = take === "pref" ? pref : take === "mezz" ? mezz : cpace;
    const cut = Math.min(have, excess);
    if (take === "pref") pref -= cut;
    else if (take === "mezz") mezz -= cut;
    else cpace -= cut;
    excess -= cut;
  }
  const common = Math.max(0, totalCost - senior - cpace - mezz - pref);

  const raw: Omit<StackLayer, "pctOfCost" | "cumulativePct">[] = [
    { kind: "SENIOR", label: "Senior construction loan", amount: senior, costPct: seniorRatePct, flags: [] },
    { kind: "C_PACE", label: "C-PACE assessment", amount: cpace, costPct: cfg.cpace.ratePct, flags: [] },
    // An equity-pledge mezzanine loan is not secured by real property (gate H).
    { kind: "MEZZANINE", label: "Mezzanine loan (equity pledge)", amount: mezz, costPct: cfg.mezz.ratePct, flags: ["usury_exemption_unavailable"] },
    { kind: "PREFERRED_EQUITY", label: "Preferred equity", amount: pref, costPct: cfg.pref.returnPct, flags: [] },
    { kind: "COMMON_EQUITY", label: "Sponsor common equity", amount: common, costPct: null, flags: [] },
  ];
  let cumulative = 0;
  const layers: StackLayer[] = raw
    .filter((l) => l.amount > 0.005 || l.kind === "SENIOR" || l.kind === "COMMON_EQUITY")
    .map((l) => {
      cumulative += l.amount;
      return { ...l, pctOfCost: totalCost > 0 ? l.amount / totalCost : 0, cumulativePct: totalCost > 0 ? cumulative / totalCost : 0 };
    });
  if (cpace > 0) notes.push("C-PACE is a property-tax assessment senior to the mortgage; the senior lender must consent.");
  if (mezz > 0) notes.push("Mezzanine debt secured by a pledge of ownership interests is not real-property secured; California usury treatment needs counsel review.");
  return { stack: { totalCost, layers }, notes };
}

const LENDER_COPY: Record<ConstructionLender, { id: SizerProgramId; name: string; short: string; recourse: SizerQuote["recourse"]; close: string }> = {
  BANK: { id: "CONSTRUCTION_BANK", name: "Bank construction loan", short: "Floating, recourse, lowest cost", recourse: "Full recourse (personal guaranty)", close: "60–90 days after a complete file; not guaranteed" },
  DEBT_FUND: { id: "CONSTRUCTION_DEBT_FUND", name: "Debt fund construction", short: "Floating, higher leverage, non-recourse", recourse: "Non-recourse (standard carve-outs)", close: "45–75 days after a complete file; not guaranteed" },
  PRIVATE: { id: "CONSTRUCTION_PRIVATE", name: "Private construction", short: "Fixed rate, highest leverage", recourse: "Full recourse (personal guaranty)", close: "Often 3–5 weeks after a complete file; not guaranteed" },
};

export const CONSTRUCTION_EXPERIENCE_LABEL: Record<ExperienceTier, string> = {
  NEW: "First ground-up project",
  EMERGING: "1–3 completed projects",
  EXPERIENCED: "4+ completed projects",
};

export function constructionBreakdown(i: ConstructionInputs, lender: ConstructionLender, rates: Benchmarks): ConstructionBreakdown {
  const budget = constructionBudget(i);
  const box = CONSTRUCTION.boxes[lender];
  const tier = constructionTier(i.completedProjects);
  const adj = CONSTRUCTION.experience[tier];
  const ratePct = (box.spread !== null ? rates.sofr30 + box.spread : (box.fixedRatePct ?? 0)) + adj.spreadAdd;
  const r = ratePct / 100;
  const maxLtc = box.maxLtc - adj.leverageCut;
  const maxAsCompletedLtv = box.maxAsCompletedLtv - adj.leverageCut;
  const reserveFactor = (r * (CONSTRUCTION.avgOutstandingDuringConstruction * i.constructionMonths + i.leaseUpMonths)) / 12;
  const costPerDollar = box.points / 100 + BROKER_FEE.construction + reserveFactor;

  const takeoutKind = i.takeout ?? defaultTakeout(i);
  const perm = takeoutBox(takeoutKind, rates);
  // Coverage at stabilization is tested at the higher of the note rate and the take-out rate.
  const stressConstant = debtConstant(Math.max(ratePct, perm.ratePct), 30);

  const statics = bindingOf({
    REQUESTED: i.loanAmount,
    AS_COMPLETED_LTV: budget.asCompletedValue * maxAsCompletedLtv,
    ...(box.minDebtYield !== null ? { DEBT_YIELD: i.stabilizedNoi / box.minDebtYield } : {}),
    ...(box.minDscrAtStabilization !== null ? { DSCR: i.stabilizedNoi / box.minDscrAtStabilization / stressConstant } : {}),
    PROGRAM_CAP: box.maxLoan,
  });
  const solved = solveLoanWithinLtc({ staticCap: statics.amount, ltc: maxLtc, baseCost: budget.baseCost, fixedFees: box.fixedFees, costPerDollar });
  const loanAmount = floor1k(solved.loan);
  const binding: SizerConstraint = solved.ltcBinds ? "LTC" : statics.binding;

  const interestReserve = loanAmount * reserveFactor;
  const points = (loanAmount * box.points) / 100;
  const brokerFee = loanAmount * BROKER_FEE.construction;
  const totalCost = budget.baseCost + box.fixedFees + points + brokerFee + interestReserve;
  const { stack } = buildStack(i, totalCost, loanAmount, ratePct);

  const cpace = stack.layers.find((l) => l.kind === "C_PACE")?.amount ?? 0;
  const mezz = stack.layers.find((l) => l.kind === "MEZZANINE")?.amount ?? 0;
  const cpaceAssessment = cpace * debtConstant(CONSTRUCTION.cpace.ratePct, CONSTRUCTION.cpace.termYears);
  const permNoi = Math.max(0, i.stabilizedNoi - cpaceAssessment);
  const permProceeds = Math.max(0, Math.min(perm.maxLtv * budget.asCompletedValue, permNoi / perm.minDscr / perm.constant));
  const payoff = loanAmount + mezz;
  const result = permProceeds >= payoff ? "PASS" : permProceeds >= payoff * 0.95 ? "MARGINAL" : "FAIL";
  const permDscr = payoff > 0 ? permNoi / (payoff * perm.constant) : 0;

  return {
    lender,
    tier,
    ratePct,
    maxLtc,
    maxAsCompletedLtv,
    loanAmount,
    binding,
    iterations: solved.iterations,
    interestReserve,
    points,
    brokerFee,
    fixedFees: box.fixedFees,
    totalCost,
    ltc: totalCost > 0 ? loanAmount / totalCost : 0,
    asCompletedLtv: budget.asCompletedValue > 0 ? loanAmount / budget.asCompletedValue : 0,
    yieldOnCost: totalCost > 0 ? i.stabilizedNoi / totalCost : 0,
    termMonths: i.constructionMonths + i.leaseUpMonths + CONSTRUCTION.termCushionMonths,
    stack,
    takeout: {
      kind: "CONSTRUCTION_TAKEOUT",
      label: `Take-out test (${perm.label})`,
      result,
      payoff,
      proceeds: permProceeds,
      shortfall: Math.max(0, payoff - permProceeds),
      kindOfTakeout: takeoutKind,
      permRatePct: perm.ratePct,
      permDscr,
      lines: [
        { label: "Permanent loan at stabilization", value: `${fmt.money(permProceeds)} at ${perm.ratePct.toFixed(2)}%` },
        { label: mezz > 0 ? "Senior + mezzanine to retire" : "Construction loan to retire", value: fmt.money(payoff) },
        { label: "Coverage on the take-out", value: `${fmt.ratio(permDscr)} (needs ${fmt.ratio(perm.minDscr)})` },
        ...(cpaceAssessment > 0 ? [{ label: "C-PACE assessment deducted from NOI", value: `${fmt.money(cpaceAssessment)} / yr` }] : []),
      ],
    },
  };
}

function constructionQuote(i: ConstructionInputs, lender: ConstructionLender, rates: Benchmarks): SizerQuote {
  const b = constructionBreakdown(i, lender, rates);
  const budget = constructionBudget(i);
  const copy = LENDER_COPY[lender];
  const box = CONSTRUCTION.boxes[lender];
  const { notes: stackNotes } = buildStack(i, b.totalCost, b.loanAmount, b.ratePct);
  const perm = takeoutBox(b.takeout.kindOfTakeout, rates);
  const warnings: string[] = [...budget.adjustments];
  if (lender === "BANK" && b.tier === "NEW") warnings.push("Banks rarely lend on a first ground-up project without an experienced co-sponsor.");
  if (b.takeout.result === "FAIL") warnings.push(`Take-out test fails: the ${perm.label.toLowerCase()} retires about ${fmt.money(b.takeout.proceeds)}, ${fmt.money(b.takeout.shortfall)} short of the payoff.`);
  else if (b.takeout.result === "MARGINAL") warnings.push("Take-out is tight: permanent proceeds cover the payoff with little room.");
  if (b.takeout.kindOfTakeout === "HUD_223F") warnings.push("HUD 223(f) needs three years since completion; a bridge or mini-perm usually carries the gap.");
  if (i.loanAmount > box.maxLoan) warnings.push(`Above the ${fmt.money(box.maxLoan)} this channel typically lends.`);

  const common = b.stack.layers.find((l) => l.kind === "COMMON_EQUITY")?.amount ?? 0;
  const stabilizedConstant = debtConstant(Math.max(b.ratePct, perm.ratePct), 30);
  return buildSizerQuote({
    id: copy.id,
    name: copy.name,
    short: copy.short,
    requested: i.loanAmount,
    loanAmount: b.loanAmount,
    binding: b.binding,
    tranches: [ioTranche(box.spread !== null ? "Construction loan (SOFR + spread, interest-only)" : "Construction loan (fixed, interest-only)", b.loanAmount, b.ratePct)],
    annualFee: { label: "No guarantee fee", amount: 0 },
    closingBreakdown: [
      { label: `Lender points (${box.points.toFixed(2)})`, amount: b.points },
      { label: "Lender legal, plan & cost review, title", amount: b.fixedFees },
      { label: "Corin advisory fee (est.)", amount: b.brokerFee },
    ],
    noi: i.stabilizedNoi,
    coverageDebtService: b.loanAmount * stabilizedConstant,
    value: b.totalCost,
    leverageBasis: "LTC",
    termLabel: `${months(b.termMonths)} + extensions`,
    amortLabel: "Interest-only during construction",
    recourse: copy.recourse,
    closeTimeline: copy.close,
    advisoryFeePct: BROKER_FEE.construction,
    eligible: i.hardCosts > 0 && b.loanAmount > 0,
    notes: [
      ...(lender !== "PRIVATE" ? ["Completion and cost-overrun guaranties are standard."] : []),
      "The lender of record funds and administers the loan; Corin's role ends at closing.",
      ...stackNotes,
    ],
    warnings,
    equityRequired: common,
    horizonYears: b.termMonths / 12,
    interim: true,
    terms: [
      { label: "Total project cost", value: `${fmt.money(b.totalCost)} (incl. financing)` },
      { label: "Interest reserve (in budget)", value: fmt.money(b.interestReserve) },
      { label: "Contingency", value: `${fmt.money(budget.contingency)} (${fmt.pct(budget.contingencyPct, 0)} of hard costs)` },
      { label: "Developer fee", value: `${fmt.money(budget.developerFee)} (${fmt.pct(budget.developerFeePct, 1)})` },
      { label: "Max LTC / as-completed LTV", value: `${fmt.pct(b.maxLtc)} / ${fmt.pct(b.maxAsCompletedLtv)}` },
      { label: "As-completed LTV", value: fmt.pct(b.asCompletedLtv) },
      { label: "Yield on cost", value: fmt.pct(b.yieldOnCost, 2) },
      { label: "Sponsor experience", value: CONSTRUCTION_EXPERIENCE_LABEL[b.tier] },
    ],
    stack: b.stack,
    exit: b.takeout,
    accent: lender === "BANK" ? "emerald" : undefined,
  });
}

export function sizeConstruction(i: ConstructionInputs, rates: Benchmarks): SizerResult {
  const budget = constructionBudget(i);
  const quotes: SizerQuote[] = [];

  // Multifamily also gets HUD 221(d)(4): construction-to-permanent, non-recourse.
  if ((i.assetType === "MULTIFAMILY" || i.assetType === "MIXED_USE") && i.units >= 5) {
    const mf = sizeMultifamily(
      {
        assetType: i.assetType,
        units: i.units,
        sqft: 0,
        loanAmount: i.loanAmount,
        noi: i.stabilizedNoi,
        value: budget.asCompletedValue,
        totalCost: budget.baseCost,
        transaction: "CONSTRUCTION",
        affordable: false,
        green: false,
      },
      rates,
    );
    const hud = mf.quotes.find((q) => q.id === "HUD_221D4_223F_MULTIFAMILY");
    if (hud) quotes.push({ ...hud, terms: [{ label: "Total project cost", value: `${fmt.money(budget.baseCost)} before HUD financing costs` }] });
  }
  for (const lender of ["BANK", "DEBT_FUND", "PRIVATE"] as const) quotes.push(constructionQuote(i, lender, rates));

  const metrics = [
    { label: budget.valueEstimated ? "As-completed value (from cap rate)" : "As-completed value", value: fmt.money(budget.asCompletedValue) },
    { label: "Untrended yield on cost", value: budget.baseCost > 0 ? fmt.pct(i.stabilizedNoi / budget.baseCost, 2) : "—" },
    ...(i.units > 0 ? [{ label: "Cost / unit", value: fmt.money(budget.baseCost / i.units) }] : []),
  ];
  return { quotes, bestFit: pickSizerBestFit(quotes), value: budget.baseCost, valueEstimated: budget.valueEstimated, metrics };
}
