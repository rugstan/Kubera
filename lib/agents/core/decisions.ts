// Reason-code logging for automated decisions: the qualifier (Jev) and lender
// matching. Each decision becomes one agent_events row with stable reason
// codes, so staff can see why a lead got its tier or why a lender ranked where
// it did, and reports can count outcomes by reason. Rows carry ids, codes and
// numbers only: no names, contact details or free-text notes.

import type { JevResult } from "@/lib/ai/jev";
import type { AgentEvent, AgentEventStore } from "./events";
import { codeSegment, isReasonCode } from "./reasons";

export const QUALIFIER_AGENT = "qualifier";
export const LENDER_MATCH_AGENT = "lenders.matching";

export type QualifierEngine = JevResult["engine"] | "human_review";

/** Derives the qualifier's reason codes from a Jev decision. Pure. */
export function qualifierReasonCodes(result: Pick<JevResult, "decision" | "primaryQuote" | "engine">, intake: { loanAmount: number; timelineDays: number; noi: number; transaction: string }): string[] {
  const d = result.decision;
  const codes = [
    `qualifier.engine.${codeSegment(result.engine)}`,
    `qualifier.tier.${codeSegment(d.leadUrgencyTier)}`,
    `qualifier.vertical.${codeSegment(d.assetVertical)}`,
    `qualifier.program.${codeSegment(d.primaryProgramFit)}`,
    `qualifier.flag.${codeSegment(d.sizingOptimizationFlag)}`,
  ];
  const q = result.primaryQuote;
  // A financing-page lead has no NOI or value to size, so coverage and income codes would mislead.
  const brokerReview = d.sizingOptimizationFlag === "NEEDS_BROKER_REVIEW";
  if (brokerReview) codes.push("qualifier.broker_review.partial_intake");
  else if (!q) codes.push("qualifier.no_program_fit");
  else {
    if (!q.eligible) codes.push("qualifier.primary_ineligible");
    const coverage = intake.loanAmount > 0 ? q.loanAmount / intake.loanAmount : 0;
    if (coverage < 0.5) codes.push("qualifier.coverage.below_50pct");
    else if (coverage < 0.8) codes.push("qualifier.coverage.50_to_80pct");
    else if (coverage < 0.9) codes.push("qualifier.coverage.80_to_90pct");
    else codes.push("qualifier.coverage.90pct_plus");
    if (q.exit?.result === "FAIL") codes.push("qualifier.exit_shortfall");
  }
  if (!brokerReview && intake.noi <= 0 && !["CONSTRUCTION", "CONVERSION", "HARD_MONEY"].includes(intake.transaction)) codes.push("qualifier.no_in_place_income");
  if (d.requiresImmediateBrokerCall) {
    codes.push("qualifier.call_now");
    if (d.leadUrgencyTier === "TIER_1_INSTITUTIONAL_HOT") codes.push("qualifier.call_now.tier_1");
    if (intake.timelineDays <= 30) codes.push("qualifier.call_now.timeline_30d_or_less");
    if (intake.loanAmount >= 15_000_000) codes.push("qualifier.call_now.loan_15m_plus");
  }
  if (d.greenMipOrGreen504Candidate) codes.push("qualifier.green_504_candidate");
  if (!d.recommendedWholesaleLenders.length) codes.push("qualifier.no_lender_routing");
  return codes;
}

export type QualifierDecisionInput = {
  leadId?: string | null;
  runId?: string | null;
  result: Pick<JevResult, "decision" | "primaryQuote" | "engine" | "latencyMs">;
  intake: { loanAmount: number; timelineDays: number; noi: number; transaction: string; assetType: string; source?: string };
};

/** Records a qualifier decision with its reason codes. */
export async function recordQualifierDecision(events: AgentEventStore, input: QualifierDecisionInput): Promise<AgentEvent> {
  const d = input.result.decision;
  const q = input.result.primaryQuote;
  return events.append({
    eventType: "decision.qualifier",
    agent: QUALIFIER_AGENT,
    task: "qualifier.decision",
    autonomy: "automate",
    leadId: input.leadId ?? null,
    runId: input.runId ?? null,
    outcome: "recorded",
    model: input.result.engine === "jev-remote" ? "jev-remote" : null,
    reasonCodes: qualifierReasonCodes(input.result, input.intake),
    detail: {
      engine: input.result.engine,
      tier: d.leadUrgencyTier,
      program: d.primaryProgramFit,
      secondary: d.secondaryProgramFit,
      flag: d.sizingOptimizationFlag,
      lenders: d.recommendedWholesaleLenders,
      callNow: d.requiresImmediateBrokerCall,
      assetType: input.intake.assetType,
      transaction: input.intake.transaction,
      source: input.intake.source ?? null,
      requestedLoan: Math.round(input.intake.loanAmount),
      sizedLoan: q ? Math.round(q.loanAmount) : 0,
      latencyMs: input.result.latencyMs,
    },
    chain: `decisions:${QUALIFIER_AGENT}`,
  });
}

/** Records that a lead was handled under advisor-only handling: no automated decision ran. */
export async function recordHumanReviewQualifier(events: AgentEventStore, input: { leadId?: string | null; reason: "human_review_only" | "ai_processing_opt_out" }): Promise<AgentEvent> {
  return events.append({
    eventType: "decision.qualifier",
    agent: QUALIFIER_AGENT,
    task: "qualifier.decision",
    autonomy: "audit",
    leadId: input.leadId ?? null,
    outcome: "recorded",
    reasonCodes: ["qualifier.engine.human_review", `qualifier.human_review.${input.reason}`],
    detail: { engine: "human_review" },
    chain: `decisions:${QUALIFIER_AGENT}`,
  });
}

// --- Lender matching ------------------------------------------------------------------------------

/** Codes the lender matcher (WS-M) attaches per candidate. */
export const LENDER_MATCH_REASONS = [
  "lender_match.program_fit",
  "lender_match.program_mismatch",
  "lender_match.loan_size_in_range",
  "lender_match.loan_below_min",
  "lender_match.loan_above_max",
  "lender_match.ltv_within_box",
  "lender_match.ltv_exceeds_box",
  "lender_match.ltc_within_box",
  "lender_match.ltc_exceeds_box",
  "lender_match.dscr_meets_min",
  "lender_match.dscr_below_min",
  "lender_match.debt_yield_meets_min",
  "lender_match.debt_yield_below_min",
  "lender_match.state_covered",
  "lender_match.state_not_covered",
  "lender_match.vertical_match",
  "lender_match.vertical_mismatch",
  "lender_match.recourse_compatible",
  "lender_match.recourse_mismatch",
  "lender_match.broker_friendly",
  "lender_match.box_verified",
  "lender_match.box_unverified",
  "lender_match.box_stale",
  "lender_match.not_approved",
  "lender_match.prior_quote_on_deal",
  "lender_match.declined_before",
  "lender_match.static_routing_fallback",
  "lender_match.lien_position_mismatch",
  "lender_match.lender_missing",
  "lender_match.lender_inactive",
  "lender_match.panel_program_mismatch",
  "lender_match.not_on_panel",
  "lender_match.manual_override",
] as const;
export type LenderMatchReason = (typeof LENDER_MATCH_REASONS)[number];

const KNOWN_LENDER_REASONS: ReadonlySet<string> = new Set(LENDER_MATCH_REASONS);

export type LenderCandidate = {
  /** credit_boxes / lender_panel id, or the static routing name. */
  lenderId: string;
  rank: number;
  score: number;
  eligible: boolean;
  reasons: readonly string[];
  source: "credit_box" | "static_routing";
};

export type LenderMatchDecisionInput = {
  dealId?: string | null;
  runId?: string | null;
  agentVersion?: string | null;
  programId: string;
  candidates: readonly LenderCandidate[];
  /** Where the ranking was computed: shown to staff on the lenders desk, or used for a submission. */
  context?: "view" | "submission";
  /** Lenders a submission went to (ids), when context is "submission". */
  submittedLenderIds?: readonly string[];
  /**
   * Lenders submitted although the matcher did not rank them, with the
   * broker's written reason (staff justification, clipped; never borrower data).
   */
  override?: { lenderIds: readonly string[]; reason: string } | null;
  /** Digest of the ranking, so an unchanged ranking is not logged twice. */
  digest?: string | null;
};

/**
 * Records a lender-match ranking. Each candidate's reasons must come from
 * LENDER_MATCH_REASONS (unknown codes throw: they are programming errors); the
 * event's reason codes are the union, plus per-outcome summary codes.
 */
export async function recordLenderMatchDecision(events: AgentEventStore, input: LenderMatchDecisionInput): Promise<AgentEvent> {
  const seen = new Set<string>();
  const ranked = [...input.candidates].sort((a, b) => a.rank - b.rank);
  for (const c of ranked) {
    for (const r of c.reasons) {
      if (!KNOWN_LENDER_REASONS.has(r)) throw new Error(`unknown lender-match reason "${r}"`);
      seen.add(r);
    }
  }
  const codes = [`lender_match.program.${codeSegment(input.programId)}`, ...seen];
  if (!ranked.some((c) => c.eligible)) codes.push("lender_match.no_eligible_lender");
  if (ranked.some((c) => c.source === "static_routing")) codes.push("lender_match.static_routing_fallback");
  const override = input.override && input.override.lenderIds.length ? input.override : null;
  if (override) codes.push("lender_match.manual_override");
  return events.append({
    eventType: "decision.lender_match",
    agent: LENDER_MATCH_AGENT,
    agentVersion: input.agentVersion ?? null,
    task: "lenders.matching",
    autonomy: "automate",
    dealId: input.dealId ?? null,
    runId: input.runId ?? null,
    outcome: "recorded",
    reasonCodes: [...new Set(codes)].filter(isReasonCode),
    detail: {
      programId: input.programId,
      candidates: ranked.slice(0, 25).map((c) => ({ lenderId: c.lenderId.slice(0, 120), rank: c.rank, score: Math.round(c.score * 1000) / 1000, eligible: c.eligible, source: c.source, reasons: [...c.reasons] })),
      candidateCount: ranked.length,
      context: input.context ?? "view",
      ...(input.submittedLenderIds ? { submittedLenderIds: input.submittedLenderIds.slice(0, 25).map((id) => id.slice(0, 120)) } : {}),
      ...(override ? { override: { lenderIds: override.lenderIds.slice(0, 25).map((id) => id.slice(0, 120)), reason: override.reason.trim().slice(0, 300) } } : {}),
      ...(input.digest ? { digest: input.digest } : {}),
    },
    chain: `decisions:${LENDER_MATCH_AGENT}`,
  });
}

/** The static LENDER_ROUTING fallback (until credit boxes cover a program), as candidates. */
export function staticRoutingCandidates(lenders: readonly string[]): LenderCandidate[] {
  return lenders.map((name, i) => ({ lenderId: name, rank: i + 1, score: 0, eligible: true, reasons: ["lender_match.program_fit", "lender_match.static_routing_fallback"], source: "static_routing" as const }));
}
