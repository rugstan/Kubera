// Lender matcher: ranks panel lenders for a deal from their approved credit
// boxes, with the reasons behind every score and the knock-outs behind every
// exclusion. Deterministic and pure — the same deal and boxes always rank the
// same way, so a broker can see exactly why a lender is (or is not) suggested.
//
// When no approved credit box covers the deal's program, the matcher falls
// back to the static LENDER_ROUTING table (lib/ai/lenders.ts, via Jev's
// lendersFor) so the desk still gets a starting list, clearly labelled as such.
//
// Matching suggests; it never sends. Outreach goes through lender_outreach and
// the broker approval gate (outreach.ts).

import { lendersFor } from "@/lib/ai/jev";
import { EXEMPT_LENDER_CATEGORIES } from "@/lib/compliance/schemas";
import type { DealProgram, LenderOutreach, LenderPanelEntry } from "@/lib/deals/types";
import { boxStaleness } from "./credit-box";
import { ASSET_CLASS_LABELS, type CreditBox, type DealProfile } from "./types";

/** Sizer / Jev program ids whose static routing stands in for a deal-desk program. */
export const FALLBACK_PROGRAM_IDS: Record<DealProgram, readonly string[]> = {
  HUD_232: ["HUD_232_223F", "HUD_232_NEW_CONST", "BRIDGE_TO_HUD_232"],
  HUD_MULTIFAMILY: ["HUD_221D4_223F_MULTIFAMILY", "HUD_223A7"],
  SBA_7A: ["SBA_504_PLUS_7A_10M_STACK"],
  SBA_504: ["SBA_504_STANDARD", "SBA_504_PLUS_7A_10M_STACK"],
  HOTEL_CMBS: ["HOSPITALITY_CMBS_NON_RECOURSE"],
  PIP_BRIDGE: ["HOSPITALITY_PIP_BRIDGE"],
  AGENCY: ["AGENCY_FANNIE_FREDDIE", "AGENCY_FANNIE_MAE", "AGENCY_FREDDIE_MAC"],
  BANK_LIFE_CO: [],
  PRIVATE_BRIDGE: ["WHITE_LABEL_CRE_BRIDGE", "BRIDGE_TO_HUD_232"],
  HARD_MONEY: ["HARD_MONEY"],
  CONSTRUCTION: ["CONSTRUCTION_BANK", "CONSTRUCTION_DEBT_FUND", "CONSTRUCTION_PRIVATE"],
};

/** Score weights (sum of the maximums is 100). */
export const WEIGHTS = { eligible: 40, leverage: 25, relationship: 13, freshness: 7, speed: 5, size: 5, recourse: 5 } as const;

export type LenderStats = { submissions: number; termSheets: number };

export type MatchCandidate = {
  lender: LenderPanelEntry;
  box: CreditBox;
  score: number;
  reasons: string[];
  warnings: string[];
};

export type Exclusion = { lender: LenderPanelEntry | null; box: CreditBox; failures: string[] };

export type FallbackSuggestion = { name: string; lender: LenderPanelEntry | null; reason: string };

export type MatchResult = {
  profile: DealProfile;
  ranked: MatchCandidate[];
  excluded: Exclusion[];
  /** Static routing suggestions when no approved box covers the program. */
  fallback: FallbackSuggestion[];
  usedFallback: boolean;
  /** Metrics the deal is missing, so their box limits were not tested. */
  untested: string[];
};

const pct = (n: number) => `${Number(n.toFixed(2))}%`;
const x = (n: number) => `${n.toFixed(2)}x`;
const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Hard knock-outs: a deal outside any of these limits is not sent to the lender. */
export function knockouts(box: CreditBox, deal: DealProfile): string[] {
  const out: string[] = [];
  if (!box.programs.includes(deal.program)) out.push("Program not in the credit box");
  const amt = deal.loanAmountCents;
  if (amt !== null && box.minLoanCents !== null && amt < box.minLoanCents) out.push(`Loan ${usd(amt)} is under the ${usd(box.minLoanCents)} minimum`);
  if (amt !== null && box.maxLoanCents !== null && amt > box.maxLoanCents) out.push(`Loan ${usd(amt)} is over the ${usd(box.maxLoanCents)} maximum`);
  if (deal.propertyState && box.states.length && !box.states.includes(deal.propertyState.toUpperCase())) out.push(`Does not lend in ${deal.propertyState.toUpperCase()}`);
  if (deal.assetClass && box.assetClasses.length && !box.assetClasses.includes(deal.assetClass)) out.push(`No appetite for ${ASSET_CLASS_LABELS[deal.assetClass].toLowerCase()}`);
  if (deal.ltvPct !== null && box.maxLtvPct !== null && deal.ltvPct > box.maxLtvPct) out.push(`LTV ${pct(deal.ltvPct)} exceeds the ${pct(box.maxLtvPct)} maximum`);
  if (deal.ltcPct !== null && box.maxLtcPct !== null && deal.ltcPct > box.maxLtcPct) out.push(`LTC ${pct(deal.ltcPct)} exceeds the ${pct(box.maxLtcPct)} maximum`);
  if (deal.dscr !== null && box.minDscr !== null && deal.dscr < box.minDscr) out.push(`DSCR ${x(deal.dscr)} is below the ${x(box.minDscr)} minimum`);
  if (deal.debtYieldPct !== null && box.minDebtYieldPct !== null && deal.debtYieldPct < box.minDebtYieldPct) out.push(`Debt yield ${pct(deal.debtYieldPct)} is below the ${pct(box.minDebtYieldPct)} minimum`);
  if (!box.lienPositions.includes(deal.lienPosition)) out.push(`Does not take a ${deal.lienPosition} lien`);
  if (deal.requiresNonRecourse && box.recourse === "full") out.push("Requires full recourse; the borrower needs non-recourse");
  return out;
}

/** 0..1 cushion of a metric against a limit, scaled so `full` of headroom earns full credit. */
const cushion = (headroom: number, full: number) => Math.max(0, Math.min(1, headroom / full));

function scoreBox(box: CreditBox, lender: LenderPanelEntry, deal: DealProfile, now: Date, stats: LenderStats | undefined): { score: number; reasons: string[]; warnings: string[] } {
  const reasons: string[] = [`Credit box covers ${deal.program.replace(/_/g, " ").toLowerCase()}`];
  const warnings: string[] = [];
  let score: number = WEIGHTS.eligible;

  // Leverage and coverage fit (25): cushion against each tested limit; untested limits earn half.
  const parts: number[] = [];
  if (box.maxLtvPct !== null) {
    if (deal.ltvPct !== null) {
      parts.push(cushion(box.maxLtvPct - deal.ltvPct, 10));
      reasons.push(`LTV ${pct(deal.ltvPct)} within ${pct(box.maxLtvPct)}`);
    } else parts.push(0.5);
  }
  if (box.maxLtcPct !== null && deal.ltcPct !== null) {
    parts.push(cushion(box.maxLtcPct - deal.ltcPct, 10));
    reasons.push(`LTC ${pct(deal.ltcPct)} within ${pct(box.maxLtcPct)}`);
  }
  if (box.minDscr !== null) {
    if (deal.dscr !== null) {
      parts.push(cushion((deal.dscr - box.minDscr) / box.minDscr, 0.2));
      reasons.push(`DSCR ${x(deal.dscr)} clears ${x(box.minDscr)}`);
    } else parts.push(0.5);
  }
  if (box.minDebtYieldPct !== null) {
    if (deal.debtYieldPct !== null) {
      parts.push(cushion(deal.debtYieldPct - box.minDebtYieldPct, 3));
      reasons.push(`Debt yield ${pct(deal.debtYieldPct)} clears ${pct(box.minDebtYieldPct)}`);
    } else parts.push(0.5);
  }
  score += WEIGHTS.leverage * (parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0.5);

  // Relationship (13): broker-friendly, compensation / fee agreement, past term sheets.
  if (lender.brokerFriendly) {
    score += 5;
    reasons.push("Broker-friendly");
  }
  if (lender.feeSplitKind !== "none" && lender.feeAgreementRef) {
    score += 3;
    reasons.push("Fee agreement on file");
  } else if ((box.brokerCompensationPct ?? 0) > 0) {
    score += 1;
    warnings.push("Lender states it pays broker compensation, but no signed fee agreement is on the panel record.");
  }
  if (stats && stats.submissions > 0) {
    const rate = stats.termSheets / stats.submissions;
    score += 5 * rate;
    reasons.push(`${stats.termSheets} term sheet${stats.termSheets === 1 ? "" : "s"} from ${stats.submissions} submission${stats.submissions === 1 ? "" : "s"}`);
  }

  // Freshness (7).
  const fresh = boxStaleness(box, now);
  const lenderFresh = boxStaleness(lender, now);
  if (fresh.stale) warnings.push(`Credit box: ${fresh.reason}`);
  else score += fresh.ageDays !== null && fresh.ageDays <= 90 ? WEIGHTS.freshness : 3;
  if (lenderFresh.stale) warnings.push(`Lender panel: ${lenderFresh.reason}`);

  // Speed (5).
  if (deal.targetCloseDays !== null && box.typicalCloseDays !== null) {
    if (box.typicalCloseDays <= deal.targetCloseDays) {
      score += WEIGHTS.speed;
      reasons.push(`Typically closes in ${box.typicalCloseDays} days`);
    } else warnings.push(`Typically closes in ${box.typicalCloseDays} days; the borrower needs ${deal.targetCloseDays}.`);
  } else if (box.typicalCloseDays !== null) score += 2.5;

  // Size sweet spot (5): not pressed against either edge of the range.
  if (deal.loanAmountCents !== null && box.maxLoanCents !== null) {
    const min = box.minLoanCents ?? 0;
    const span = box.maxLoanCents - min;
    const pos = span > 0 ? (deal.loanAmountCents - min) / span : 0.5;
    if (pos >= 0.1 && pos <= 0.8) {
      score += WEIGHTS.size;
      reasons.push("Loan size is mid-range for the lender");
    } else score += 2;
  } else score += 2.5;

  // Recourse (5).
  if (deal.requiresNonRecourse) {
    if (box.recourse === "non_recourse") {
      score += WEIGHTS.recourse;
      reasons.push("Non-recourse");
    } else if (box.recourse === "negotiable" || box.recourse === "partial") score += 2.5;
    else if (box.recourse === null) warnings.push("Recourse terms not recorded in the box.");
  } else score += 2.5;

  if (deal.franchise && box.franchiseRequirements) warnings.push(`Flag requirements: ${box.franchiseRequirements}`);
  if (!EXEMPT_LENDER_CATEGORIES.has(lender.category) || !lender.categoryEvidenceRef) warnings.push("Not an evidenced exempt lender category: the usury gate applies above the art. XV cap.");
  if (!lender.contactEmail) warnings.push("No primary contact email or submission inbox on the panel record; the broker sends the share link by hand.");
  return { score: Math.round(Math.min(100, score) * 10) / 10, reasons, warnings };
}

/** Submission and term-sheet counts per lender from the outreach history. */
export function lenderStats(outreach: readonly LenderOutreach[]): Map<string, LenderStats> {
  const m = new Map<string, LenderStats>();
  for (const o of outreach) {
    if (!["sent", "declined", "term_sheet"].includes(o.status)) continue;
    const s = m.get(o.lenderId) ?? { submissions: 0, termSheets: 0 };
    s.submissions += 1;
    if (o.status === "term_sheet") s.termSheets += 1;
    m.set(o.lenderId, s);
  }
  return m;
}

export function untestedMetrics(boxes: readonly CreditBox[], deal: DealProfile): string[] {
  const u = new Set<string>();
  for (const b of boxes) {
    if (b.maxLtvPct !== null && deal.ltvPct === null) u.add("LTV");
    if (b.maxLtcPct !== null && deal.ltcPct === null && deal.program === "CONSTRUCTION") u.add("LTC");
    if (b.minDscr !== null && deal.dscr === null) u.add("DSCR");
    if (b.minDebtYieldPct !== null && deal.debtYieldPct === null) u.add("debt yield");
    if (b.assetClasses.length && deal.assetClass === null) u.add("asset class");
    if (b.states.length && !deal.propertyState) u.add("property state");
    if ((b.minLoanCents !== null || b.maxLoanCents !== null) && deal.loanAmountCents === null) u.add("loan amount");
  }
  return [...u];
}

export function matchLenders(input: { profile: DealProfile; boxes: readonly CreditBox[]; lenders: readonly LenderPanelEntry[]; outreach?: readonly LenderOutreach[]; now: Date }): MatchResult {
  const { profile, now } = input;
  const byId = new Map(input.lenders.map((l) => [l.id, l]));
  const stats = lenderStats(input.outreach ?? []);
  const approved = input.boxes.filter((b) => b.status === "approved");
  const best = new Map<string, MatchCandidate>();
  const excluded: Exclusion[] = [];

  for (const box of approved) {
    const lender = box.lenderId ? (byId.get(box.lenderId) ?? null) : null;
    if (!box.programs.includes(profile.program)) continue; // not a candidate at all
    const failures = knockouts(box, profile);
    if (!lender) failures.push("Linked panel lender is missing");
    else if (!lender.active) failures.push("Lender is inactive on the panel");
    else if (!lender.programs.includes(profile.program)) failures.push("Panel record has no appetite for this program (update the panel)");
    if (failures.length || !lender) {
      excluded.push({ lender, box, failures });
      continue;
    }
    const scored = scoreBox(box, lender, profile, now, stats.get(lender.id));
    const prev = best.get(lender.id);
    // A lender with several boxes (e.g. programs or regions) ranks on its best one.
    if (!prev || scored.score > prev.score) best.set(lender.id, { lender, box, ...scored });
  }

  const ranked = [...best.values()].sort((a, b) => b.score - a.score || a.lender.name.localeCompare(b.lender.name));
  // Drop exclusions of lenders that matched on another box.
  const excludedOnly = excluded.filter((e) => !e.lender || !best.has(e.lender.id));
  const covered = approved.some((b) => b.programs.includes(profile.program));
  const fallback = covered ? [] : fallbackSuggestions(profile.program, input.lenders);
  return { profile, ranked, excluded: excludedOnly, fallback, usedFallback: !covered, untested: untestedMetrics(approved.filter((b) => b.programs.includes(profile.program)), profile) };
}

/** LENDER_ROUTING names for the program, resolved to panel lenders by name where possible. */
export function fallbackSuggestions(program: DealProgram, lenders: readonly LenderPanelEntry[]): FallbackSuggestion[] {
  const names: string[] = [];
  for (const id of FALLBACK_PROGRAM_IDS[program]) for (const n of lendersFor(id)) if (!names.includes(n)) names.push(n);
  return names.map((code) => {
    const name = code
      .split("_")
      .map((w) => (["SBF", "CDC"].includes(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()))
      .join(" ");
    const key = normalize(name);
    const lender = lenders.find((l) => l.active && (normalize(l.name) === key || normalize(l.name).startsWith(key) || key.startsWith(normalize(l.name)))) ?? null;
    return {
      name: lender?.name ?? name,
      lender,
      reason: lender ? "Static routing table (no approved credit box covers this program yet)" : "Static routing table; not on the lender panel — add it before sending",
    };
  });
}
