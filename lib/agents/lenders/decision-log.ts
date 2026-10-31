// Reason-code logging for lender matching (AB): every ranking the desk shows
// and every submission becomes one `decision.lender_match` agent_events row
// with the ranked candidates, the knock-outs and the static LENDER_ROUTING
// fallback, each with stable reason codes (lib/agents/core/decisions.ts).
// Manual override submissions carry the broker's override reason.

import { createHash } from "node:crypto";
import { recordLenderMatchDecision, staticRoutingCandidates, type LenderCandidate, type LenderMatchReason } from "@/lib/agents/core/decisions";
import type { AgentEventStore } from "@/lib/agents/core/events";
import { boxStaleness } from "./credit-box";
import type { MatchResult } from "./matcher";
import type { CreditBox, DealProfile } from "./types";

type Code = LenderMatchReason;

function boxCodes(box: CreditBox, now: Date): Code[] {
  if (!box.verifiedAt) return ["lender_match.box_unverified"];
  return [boxStaleness(box, now).stale ? "lender_match.box_stale" : "lender_match.box_verified"];
}

/** Codes for a ranked (eligible) candidate: which limits were tested and cleared. */
export function eligibleCodes(box: CreditBox, deal: DealProfile, brokerFriendly: boolean, now: Date): Code[] {
  const out: Code[] = ["lender_match.program_fit"];
  if (deal.loanAmountCents !== null && (box.minLoanCents !== null || box.maxLoanCents !== null)) out.push("lender_match.loan_size_in_range");
  if (deal.ltvPct !== null && box.maxLtvPct !== null) out.push("lender_match.ltv_within_box");
  if (deal.ltcPct !== null && box.maxLtcPct !== null) out.push("lender_match.ltc_within_box");
  if (deal.dscr !== null && box.minDscr !== null) out.push("lender_match.dscr_meets_min");
  if (deal.debtYieldPct !== null && box.minDebtYieldPct !== null) out.push("lender_match.debt_yield_meets_min");
  if (deal.propertyState && box.states.length) out.push("lender_match.state_covered");
  if (deal.assetClass && box.assetClasses.length) out.push("lender_match.vertical_match");
  if (deal.requiresNonRecourse) out.push("lender_match.recourse_compatible");
  if (brokerFriendly) out.push("lender_match.broker_friendly");
  out.push(...boxCodes(box, now));
  return out;
}

/** Codes for a knocked-out candidate, mirroring matcher.knockouts plus the panel checks. */
export function knockoutCodes(box: CreditBox, deal: DealProfile, lender: { active: boolean; programs: readonly string[] } | null, now: Date): Code[] {
  const out: Code[] = [];
  const amt = deal.loanAmountCents;
  if (!box.programs.includes(deal.program)) out.push("lender_match.program_mismatch");
  if (amt !== null && box.minLoanCents !== null && amt < box.minLoanCents) out.push("lender_match.loan_below_min");
  if (amt !== null && box.maxLoanCents !== null && amt > box.maxLoanCents) out.push("lender_match.loan_above_max");
  if (deal.propertyState && box.states.length && !box.states.includes(deal.propertyState.toUpperCase())) out.push("lender_match.state_not_covered");
  if (deal.assetClass && box.assetClasses.length && !box.assetClasses.includes(deal.assetClass)) out.push("lender_match.vertical_mismatch");
  if (deal.ltvPct !== null && box.maxLtvPct !== null && deal.ltvPct > box.maxLtvPct) out.push("lender_match.ltv_exceeds_box");
  if (deal.ltcPct !== null && box.maxLtcPct !== null && deal.ltcPct > box.maxLtcPct) out.push("lender_match.ltc_exceeds_box");
  if (deal.dscr !== null && box.minDscr !== null && deal.dscr < box.minDscr) out.push("lender_match.dscr_below_min");
  if (deal.debtYieldPct !== null && box.minDebtYieldPct !== null && deal.debtYieldPct < box.minDebtYieldPct) out.push("lender_match.debt_yield_below_min");
  if (!box.lienPositions.includes(deal.lienPosition)) out.push("lender_match.lien_position_mismatch");
  if (deal.requiresNonRecourse && box.recourse === "full") out.push("lender_match.recourse_mismatch");
  if (!lender) out.push("lender_match.lender_missing");
  else if (!lender.active) out.push("lender_match.lender_inactive");
  else if (!lender.programs.includes(deal.program)) out.push("lender_match.panel_program_mismatch");
  out.push(...boxCodes(box, now));
  return out;
}

/** The ranking as reason-coded candidates: ranked first, then knock-outs, or the static routing fallback. */
export function matchDecisionCandidates(match: MatchResult, now: Date): LenderCandidate[] {
  const out: LenderCandidate[] = match.ranked.map((c, i) => ({
    lenderId: c.lender.id,
    rank: i + 1,
    score: c.score,
    eligible: true,
    reasons: eligibleCodes(c.box, match.profile, c.lender.brokerFriendly, now),
    source: "credit_box" as const,
  }));
  for (const e of match.excluded) {
    out.push({ lenderId: e.lender?.id ?? `box:${e.box.id}`, rank: out.length + 1, score: 0, eligible: false, reasons: knockoutCodes(e.box, match.profile, e.lender, now), source: "credit_box" });
  }
  if (match.usedFallback) {
    const start = out.length;
    for (const c of staticRoutingCandidates(match.fallback.map((f) => f.lender?.id ?? f.name))) {
      const f = match.fallback[c.rank - 1];
      out.push({ ...c, rank: start + c.rank, reasons: f && !f.lender ? [...c.reasons, "lender_match.not_on_panel"] : c.reasons });
    }
  }
  return out;
}

export type LogLenderMatchInput = {
  dealId: string;
  match: MatchResult;
  now: Date;
  context: "view" | "submission";
  submittedLenderIds?: readonly string[];
  override?: { lenderIds: readonly string[]; reason: string } | null;
};

function digestOf(input: LogLenderMatchInput, candidates: readonly LenderCandidate[]): string {
  const body = JSON.stringify([input.match.profile, candidates.map((c) => [c.lenderId, c.rank, c.score, c.eligible, c.reasons])]);
  return createHash("sha256").update(body).digest("hex");
}

/**
 * Appends the decision event. A "view" ranking identical to the deal's last
 * logged one is skipped (the desk re-renders the same ranking often). Best
 * effort: a missing or failing event log never blocks the desk or a
 * submission (the submission itself is still gated and recorded).
 */
export async function logLenderMatch(events: AgentEventStore | null | undefined, input: LogLenderMatchInput): Promise<"recorded" | "unchanged" | "unavailable" | "failed"> {
  if (!events) return "unavailable";
  try {
    const candidates = matchDecisionCandidates(input.match, input.now);
    const digest = digestOf(input, candidates);
    if (input.context === "view") {
      const [last] = await events.list({ dealId: input.dealId, eventType: "decision.lender_match", limit: 1 });
      if (last && last.detail.digest === digest && last.detail.context === "view") return "unchanged";
    }
    await recordLenderMatchDecision(events, {
      dealId: input.dealId,
      programId: input.match.profile.program,
      candidates,
      context: input.context,
      submittedLenderIds: input.submittedLenderIds,
      override: input.override ?? null,
      digest,
    });
    return "recorded";
  } catch (err) {
    console.warn("[lenders] lender-match decision log failed", err instanceof Error ? err.message : err);
    return "failed";
  }
}
