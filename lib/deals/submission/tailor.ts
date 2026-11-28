// Per-lender fit (spec 5.6): which facts of the request sit inside a lender's
// recorded appetite, which sit outside it, and which dimensions the lender has
// not recorded. The fit tailors only the email's greeting, FIT and EXCEPTION
// lines; every lender sees the same figures, summary and documents.
//
// Fair lending (spec 6.5): the input is TailorDeal, built from deal facts
// only. It has no field for any principal, sponsor or personal attribute, so
// lender choice and tailoring cannot read one.

import { matchLenders } from "@/lib/agents/lenders/matcher";
import { ASSET_CLASS_LABELS, type AssetClass, type CreditBox, type DealProfile, type LienPosition } from "@/lib/agents/lenders/types";
import { lenderStaleness } from "../lenders";
import { LENDER_LOAN_TYPE_LABELS, type LenderLoanType } from "../loan-types";
import type { DealProgram, LenderPanelEntry } from "../types";
import { playbookLoanTypes } from "./playbooks";
import { playbookOf } from "./requirements";
import { fmt, metricOf } from "./summary";
import { SUBMISSION_ASSET_TYPE_LABELS, type IsoDate, type LenderFit, type Metric, type RecourseRequest, type SubmissionAssetType, type SubmissionContext, type SubmissionLienPosition, type SubmissionPlaybook } from "./types";

/** The deal facts a lender's fit is judged on. Nothing personal. */
export type TailorDeal = {
  dealId: string;
  program: DealProgram;
  playbook: SubmissionPlaybook;
  loanAmountCents: number | null;
  propertyState: string | null;
  assetType: SubmissionAssetType | null;
  recourse: RecourseRequest | null;
  lienPosition: SubmissionLienPosition | null;
  requestedTermMonths: number | null;
  targetCloseDate: IsoDate | null;
  /** Hotel brand, when the deal is a hotel. */
  franchise: string | null;
  now: Date;
};

export function tailorDealFrom(ctx: SubmissionContext): TailorDeal {
  const p = ctx.profile;
  return {
    dealId: ctx.deal.id,
    program: ctx.deal.program,
    playbook: playbookOf(ctx),
    loanAmountCents: ctx.deal.loanAmountCents,
    propertyState: ctx.deal.propertyState?.toUpperCase() ?? null,
    assetType: p?.assetType ?? null,
    recourse: p?.recourse ?? null,
    lienPosition: p?.lienPosition ?? null,
    requestedTermMonths: p?.requestedTermMonths ?? null,
    targetCloseDate: p?.targetCloseDate ?? null,
    franchise: p?.programDetails.hotel?.brand ?? null,
    now: ctx.now,
  };
}

const SENIOR: readonly string[] = ["senior", "assisted", "memory", "skilled", "nursing", "healthcare", "care", "rcfe", "snf"];
const HOTEL: readonly string[] = ["hotel", "hospitality", "lodging", "motel"];
const ASSET_KEYWORDS: Record<SubmissionAssetType, readonly string[]> = {
  ASSISTED_LIVING: SENIOR,
  MEMORY_CARE: SENIOR,
  RCFE: SENIOR,
  SNF: SENIOR,
  HOTEL_FLAGGED: HOTEL,
  HOTEL_BOUTIQUE: HOTEL,
  HOTEL_TO_SENIOR_CONVERSION: [...HOTEL, ...SENIOR],
  MULTIFAMILY: ["multifamily", "multi_family", "apartment"],
  MIXED_USE: ["mixed", "retail", "multifamily", "commercial"],
  COMMERCIAL: ["commercial", "office", "retail", "industrial"],
  RESIDENTIAL_2_4: ["residential", "2_4", "1_4", "sfr", "single_family", "investor", "rental"],
  SFR_1_4: ["residential", "1_4", "sfr", "single_family", "investor", "rental"],
  OFFICE: ["office", "commercial"],
  INDUSTRIAL: ["industrial", "warehouse", "flex", "logistics", "commercial"],
  RETAIL: ["retail", "shopping", "commercial"],
  SELF_STORAGE: ["storage", "commercial"],
  MEDICAL_OFFICE: ["medical", "office", "healthcare", "commercial"],
  MANUFACTURED_HOUSING: ["manufactured", "mobile", "mhc"],
  LAND: ["land", "lot", "entitle"],
};

/** The matcher's asset class for a submission asset type (construction playbooks are CONSTRUCTION). */
export function assetClassFor(playbook: SubmissionPlaybook, asset: SubmissionAssetType | null): AssetClass | null {
  if (playbook === "construction") return "CONSTRUCTION";
  if (!asset) return null;
  if (["ASSISTED_LIVING", "MEMORY_CARE", "RCFE", "SNF", "HOTEL_TO_SENIOR_CONVERSION"].includes(asset)) return "SENIOR_LIVING";
  if (asset === "HOTEL_FLAGGED" || asset === "HOTEL_BOUTIQUE") return "HOSPITALITY";
  if (asset === "MULTIFAMILY" || asset === "RESIDENTIAL_2_4" || asset === "SFR_1_4") return "MULTIFAMILY";
  if (asset === "LAND") return null;
  return "COMMERCIAL";
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_");
const listJoin = (items: readonly string[]) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
const assetLabel = (a: SubmissionAssetType) => SUBMISSION_ASSET_TYPE_LABELS[a];
const DAY = 86_400_000;

/** The DSCR the playbook leads with (rental and SBA have their own; on mezz and C-PACE it is the combined one). */
function dscrMetric(playbook: SubmissionPlaybook, metrics: readonly Metric[]): Metric | null {
  if (playbook === "dscr_rental") return metricOf(metrics, "dscr_rental");
  if (playbook === "sba_7a" || playbook === "sba_504") return metricOf(metrics, "global_dscr");
  return metricOf(metrics, "dscr_in_place");
}

const isStack = (playbook: SubmissionPlaybook) => playbook === "mezz_pref" || playbook === "c_pace";

/**
 * The leverage a lender's limits are tested on: this loan's LTV and LTC, or on
 * mezz and C-PACE the combined (senior plus this loan) LTV and LTC, the last
 * dollar a subordinate lender is exposed to.
 */
function leverage(playbook: SubmissionPlaybook, metrics: readonly Metric[]): { ltv: Metric | null; ltc: Metric | null; ltvLabel: string; ltcLabel: string; prefix: string } {
  if (isStack(playbook)) return { ltv: metricOf(metrics, "combined_ltv"), ltc: metricOf(metrics, "combined_ltc"), ltvLabel: "Combined LTV", ltcLabel: "Combined LTC", prefix: "Combined " };
  return { ltv: metricOf(metrics, "ltv_as_is"), ltc: metricOf(metrics, "ltc"), ltvLabel: "LTV", ltcLabel: "LTC", prefix: "" };
}

const lienFor = (l: SubmissionLienPosition | null): LienPosition | null => (l === "first" || l === "second" ? l : null);

/** The matcher's deal profile from the submission (computed ratios, never typed ones). */
export function submissionDealProfile(deal: TailorDeal, metrics: readonly Metric[]): DealProfile {
  const close = deal.targetCloseDate ? Math.ceil((Date.parse(`${deal.targetCloseDate}T00:00:00Z`) - deal.now.getTime()) / DAY) : null;
  return {
    dealId: deal.dealId,
    program: deal.program,
    loanAmountCents: deal.loanAmountCents,
    propertyState: deal.propertyState,
    assetClass: assetClassFor(deal.playbook, deal.assetType),
    // Mezz and C-PACE: the combined figures (the matcher tests the last dollar).
    ltvPct: leverage(deal.playbook, metrics).ltv?.value ?? null,
    ltcPct: leverage(deal.playbook, metrics).ltc?.value ?? null,
    dscr: dscrMetric(deal.playbook, metrics)?.value ?? null,
    debtYieldPct: metricOf(metrics, "debt_yield_in_place")?.value ?? null,
    lienPosition: lienFor(deal.lienPosition) ?? (deal.lienPosition ? "second" : "first"),
    requiresNonRecourse: deal.recourse === "non_recourse",
    targetCloseDays: close !== null && close > 0 ? close : null,
    franchise: deal.franchise,
  };
}

type BoxCheck = { matches: string[]; exceptions: string[]; unknown: string[] };

function checkBox(box: CreditBox, deal: TailorDeal, metrics: readonly Metric[]): BoxCheck {
  const out: BoxCheck = { matches: [], exceptions: [], unknown: [] };
  const assetClass = assetClassFor(deal.playbook, deal.assetType);
  if (box.assetClasses.length && assetClass && !box.assetClasses.includes(assetClass)) {
    out.exceptions.push(`${ASSET_CLASS_LABELS[assetClass]} is outside this credit box's asset classes (${listJoin(box.assetClasses.map((a) => ASSET_CLASS_LABELS[a]))})`);
  }
  const limit = (label: string, m: Metric | null, max: number | null, kind: "max" | "min", unit: (n: number) => string, untested = false) => {
    if (max === null) {
      out.unknown.push(`${kind === "max" ? "maximum" : "minimum"} ${label}`);
      return;
    }
    if (!m || m.value === null) {
      // A limit the lender recorded but this request cannot be tested on yet is listed, never silently passed.
      if (untested) out.unknown.push(`${label} against your ${unit(max)} ${kind === "max" ? "maximum" : "minimum"} (not computed yet)`);
      return;
    }
    const bad = kind === "max" ? m.value > max : m.value < max;
    if (bad) out.exceptions.push(`${label} ${unit(m.value)} vs ${unit(max)} ${kind === "max" ? "maximum" : "minimum"}`);
    else out.matches.push(kind === "max" ? `${label} ${unit(m.value)} within your ${unit(max)} maximum` : `${label} ${unit(m.value)} meets your ${unit(max)} minimum`);
  };
  const lev = leverage(deal.playbook, metrics);
  const stack = isStack(deal.playbook);
  limit(lev.ltvLabel, lev.ltv, box.maxLtvPct, "max", fmt.pct, stack);
  if (box.maxLtcPct !== null) limit(lev.ltcLabel, lev.ltc, box.maxLtcPct, "max", fmt.pct, stack);
  limit(`${lev.prefix}DSCR`, dscrMetric(deal.playbook, metrics), box.minDscr, "min", fmt.x, stack);
  if (box.minDebtYieldPct !== null) limit(`${lev.prefix}${stack ? "debt yield" : "Debt yield"}`, metricOf(metrics, "debt_yield_in_place"), box.minDebtYieldPct, "min", fmt.pct, stack);

  if (deal.recourse && box.recourse) {
    const needsLess = (deal.recourse === "non_recourse" && box.recourse !== "non_recourse" && box.recourse !== "negotiable") || (deal.recourse === "partial" && box.recourse === "full");
    if (needsLess) out.exceptions.push(`${deal.recourse === "non_recourse" ? "Non-recourse" : "Partial recourse"} requested; this credit box is ${box.recourse === "full" ? "full recourse" : "partial recourse"}`);
  }
  const lien = lienFor(deal.lienPosition);
  if (lien && box.lienPositions.length && !box.lienPositions.includes(lien)) out.exceptions.push(`${lien === "first" ? "First" : "Second"} lien requested; this credit box lends ${listJoin(box.lienPositions)} lien`);
  if (deal.requestedTermMonths !== null && box.maxTermMonths !== null && deal.requestedTermMonths > box.maxTermMonths) out.exceptions.push(`${deal.requestedTermMonths}-month term vs ${box.maxTermMonths}-month maximum`);
  const profile = submissionDealProfile(deal, metrics);
  if (profile.targetCloseDays !== null && box.typicalCloseDays !== null && profile.targetCloseDays < box.typicalCloseDays) out.exceptions.push(`Target close in ${profile.targetCloseDays} days vs your typical ${box.typicalCloseDays}`);
  return out;
}

/**
 * The lender's fit for this deal. `boxes` may be every credit box: only the
 * lender's approved boxes for the deal program are read, and the best one
 * (fewest exceptions) is reported.
 */
export function lenderFit(lender: LenderPanelEntry, boxes: readonly CreditBox[], deal: TailorDeal, metrics: readonly Metric[]): LenderFit {
  const matches: string[] = [];
  const exceptions: string[] = [];
  const unknown: string[] = [];

  // Loan type
  const wanted: readonly LenderLoanType[] = playbookLoanTypes[deal.playbook];
  if (!lender.loanTypes.length) unknown.push("loan types");
  else {
    const both = wanted.filter((t) => lender.loanTypes.includes(t));
    if (both.length) matches.push(...both.map((t) => LENDER_LOAN_TYPE_LABELS[t]));
    else exceptions.push(`${listJoin(wanted.map((t) => LENDER_LOAN_TYPE_LABELS[t]))} is not among your recorded loan types (${listJoin(lender.loanTypes.map((t) => LENDER_LOAN_TYPE_LABELS[t]))})`);
  }

  // Size
  const loan = deal.loanAmountCents;
  const { minLoanCents: min, maxLoanCents: max } = lender;
  if (min === null && max === null) unknown.push("loan size range");
  else if (loan !== null && loan > 0) {
    if (min !== null && loan < min) exceptions.push(`${fmt.usdCompact(loan)} is below your ${fmt.usdCompact(min)} minimum`);
    else if (max !== null && loan > max) exceptions.push(`${fmt.usdCompact(loan)} is above your ${fmt.usdCompact(max)} maximum`);
    else matches.push(`${min !== null && max !== null ? `${fmt.usdCompact(min)}–${fmt.usdCompact(max)}` : min !== null ? `${fmt.usdCompact(min)} minimum` : `Up to ${fmt.usdCompact(max!)}`} covers ${fmt.usdCompact(loan)}`);
  }

  // State (empty = nationwide)
  if (deal.propertyState) {
    if (!lender.states.length) matches.push("Lends nationwide");
    else if (lender.states.includes(deal.propertyState)) matches.push(`Lends in ${deal.propertyState}`);
    else exceptions.push(`${deal.propertyState} is outside your recorded states (${listJoin(lender.states)})`);
  }

  // Asset type (free-form on the panel)
  if (deal.assetType) {
    if (!lender.assetTypes.length) unknown.push("asset types");
    else {
      const keys = [norm(deal.assetType), ...ASSET_KEYWORDS[deal.assetType]];
      const hit = lender.assetTypes.some((a) => keys.some((k) => norm(a).includes(k)));
      if (hit) matches.push(`Lends on ${assetLabel(deal.assetType).toLowerCase()}`);
      else exceptions.push(`${assetLabel(deal.assetType)} is not among your recorded asset types (${listJoin(lender.assetTypes.map((a) => a.replace(/_/g, " ")))})`);
    }
  }

  // Approved credit box
  const own = boxes.filter((b) => b.status === "approved" && b.lenderId === lender.id && b.programs.includes(deal.program));
  let score: number | null = null;
  if (!own.length) unknown.push("credit box (leverage and coverage limits)");
  else {
    const checks = own.map((b) => ({ b, c: checkBox(b, deal, metrics) }));
    checks.sort((x, y) => x.c.exceptions.length - y.c.exceptions.length || y.c.matches.length - x.c.matches.length || x.b.id.localeCompare(y.b.id));
    const best = checks[0]!.c;
    matches.push(...best.matches);
    exceptions.push(...best.exceptions);
    unknown.push(...best.unknown);
    const ranked = matchLenders({ profile: submissionDealProfile(deal, metrics), boxes: own, lenders: [lender], now: deal.now }).ranked;
    score = ranked[0]?.score ?? null;
  }

  return { lenderId: lender.id, matches, exceptions, unknown, staleness: lenderStaleness(lender, deal.now), score };
}
