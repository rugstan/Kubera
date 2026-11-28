// Lender outreach from a match: the matcher decides who may be submitted to
// (ranked, or a written override reason the approving broker sees), and the
// lender-ready submission (lib/deals/submission/send.ts) does the rest:
// prepareSubmission runs the readiness gate, locks the deal summary built from
// the stored profile into the package version, and writes each lender's exact
// email; sendPreparedToLender then asks the broker approval gate (Global rule
// 2) per lender, with the email approved by hash. The share link is minted,
// and mail sent, ONLY after approval; a pending, rejected or expired approval
// sends nothing. There is no other way to send: no submission skips the
// readiness gate.
//
// A lender the matcher did not rank (knocked out, or no approved credit box),
// or whose recorded box the request falls outside, is submitted only with a
// written override reason.

import { PackageError, assertDealCanGoToLenders, outreachMessage, type DealHoldReader, type LenderMailer, type SendPackageResult } from "@/lib/deals/packages";
import type { AgentEventStore } from "@/lib/agents/core/events";
import type { ApprovalGate } from "@/lib/compliance/approval-gate";
import type { DocumentStorage } from "@/lib/disclosures/store";
import type { DealDeskStore } from "@/lib/deals/store";
import { prepareSubmission, sendPreparedToLender, type SubmissionSendDeps } from "@/lib/deals/submission/send";
import type { EmailAdvisor, LenderFit, TargetStage } from "@/lib/deals/submission/types";
import type { LenderPanelEntry, PackageItem } from "@/lib/deals/types";
import { logLenderMatch } from "./decision-log";
import { matchLenders, type MatchCandidate, type MatchResult } from "./matcher";
import type { CreditBoxStore } from "./store";
import type { DealProfile } from "./types";

export type OutreachDeps = {
  desk: DealDeskStore;
  boxes: CreditBoxStore;
  gate: ApprovalGate;
  mailer: LenderMailer | null;
  storage: DocumentStorage;
  baseUrl: string;
  now: () => Date;
  /** Open sanctions holds (WS-U); null = not configured, so nothing is submitted (fails closed). */
  holds: DealHoldReader | null;
  /** agent_events (AB): the ranking, knock-outs and overrides behind each submission are logged with reason codes. */
  events?: AgentEventStore | null;
  /**
   * The lender-ready submission (lib/deals/submission/send.ts): the summary
   * store, the deal-summary PDF renderer, the context loader and the metrics
   * function (lib/deals/runtime.ts submissionSendDeps).
   */
  submission: Pick<SubmissionSendDeps, "summaries" | "renderPdf" | "loadContext" | "computeMetrics">;
};

export type SubmitInput = {
  dealId: string;
  profile: DealProfile;
  lenderIds: string[];
  /** Vault documents (already verified clean and hashed); the deal summary is added. */
  items: PackageItem[];
  actor: string;
  allowStaleLender?: boolean;
  /** Required to submit to a lender the matcher did not rank, or whose recorded box the request falls outside. */
  overrideReason?: string | null;
  note?: string | null;
  /** What the lender is asked for (default Screen). */
  targetStage?: TargetStage;
  /** The advisor who signs the email. */
  advisor: EmailAdvisor;
  /** Why to send with required items missing (20–1,000 characters). */
  readinessOverrideReason?: string | null;
};

export type SubmitOutcome =
  | { lenderId: string; lenderName: string; ok: true; result: SendPackageResult; message: string; matched: boolean }
  | { lenderId: string; lenderName: string; ok: false; error: string };

export type SubmitResult = { outcomes: SubmitOutcome[]; summaryItem: PackageItem | null; match: MatchResult };

export class OutreachError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutreachError";
  }
}

export async function submitToLenders(deps: OutreachDeps, input: SubmitInput): Promise<SubmitResult> {
  const lenderIds = [...new Set(input.lenderIds)];
  if (!lenderIds.length) throw new OutreachError("Choose at least one lender");
  if (lenderIds.length > 25) throw new OutreachError("Submit to at most 25 lenders at a time");
  const deal = await deps.desk.getDeal(input.dealId);
  if (!deal) throw new OutreachError(`Deal ${input.dealId} not found`);
  // A held (OFAC), closed, withdrawn or lost deal goes to no lender; checked
  // again inside each submission and before any share link is minted.
  try {
    await assertDealCanGoToLenders(deps, deal);
  } catch (err) {
    if (err instanceof PackageError) throw new OutreachError(err.message);
    throw err;
  }
  const now = deps.now();
  const [boxes, lenders, outreach] = await Promise.all([deps.boxes.listBoxes(), deps.desk.listLenders(), deps.desk.listOutreach(deal.id)]);
  const match = matchLenders({ profile: { ...input.profile, dealId: deal.id, program: deal.program }, boxes, lenders, outreach, now });
  const ranked = new Map(match.ranked.map((c) => [c.lender.id, c]));
  const override = input.overrideReason?.trim() || null;

  const { outcomes, summaryItem } = await submitPrepared(deps, input, { lenderIds, lenders, match, ranked, override });
  await logSubmission(deps, deal.id, match, now, outcomes, override);
  return { outcomes, summaryItem, match };
}

async function logSubmission(deps: OutreachDeps, dealId: string, match: MatchResult, now: Date, outcomes: SubmitOutcome[], override: string | null): Promise<void> {
  const submitted = outcomes.filter((o) => o.ok);
  const overridden = submitted.filter((o) => o.ok && !o.matched).map((o) => o.lenderId);
  await logLenderMatch(deps.events, {
    dealId,
    match,
    now,
    context: "submission",
    submittedLenderIds: submitted.map((o) => o.lenderId),
    override: overridden.length && override ? { lenderIds: overridden, reason: override } : null,
  });
}

/**
 * The lender-ready path: the matcher still decides who may be submitted to
 * (ranked, or an override reason); prepareSubmission builds the summary, locks
 * the package and writes each lender's exact email; each lender then goes
 * through the approval gate with that submission. A lender whose recorded box
 * the request falls outside also needs the override reason.
 */
async function submitPrepared(
  deps: OutreachDeps,
  input: SubmitInput,
  m: { lenderIds: string[]; lenders: LenderPanelEntry[]; match: MatchResult; ranked: Map<string, MatchCandidate>; override: string | null },
): Promise<{ outcomes: SubmitOutcome[]; summaryItem: PackageItem | null }> {
  const outcomes: SubmitOutcome[] = [];
  const advisor = input.advisor;
  if (!advisor?.name?.trim() || !advisor.email?.trim()) throw new OutreachError("Name the advisor who signs the lender email");
  // Who may be submitted to is decided before anything is stored: ranked by the
  // matcher (or an override reason), and inside the lender's recorded box (or the same reason).
  const admit = (lender: LenderPanelEntry, fit: LenderFit): string | null => {
    if (!m.ranked.get(lender.id) && !m.override) {
      const ex = m.match.excluded.find((e) => e.lender?.id === lender.id);
      return `Not a match${ex ? `: ${ex.failures.join("; ")}` : " (no approved credit box covers this deal)"}. Add an override reason to submit anyway.`;
    }
    return fit.exceptions.length && !m.override ? `Outside ${lender.name}'s recorded box: ${fit.exceptions.join("; ")}. Add an override reason to submit anyway.` : null;
  };
  const sendDeps: SubmissionSendDeps = { ...deps.submission, desk: deps.desk, storage: deps.storage, boxes: deps.boxes, gate: deps.gate, now: deps.now, baseUrl: deps.baseUrl, mailer: deps.mailer, holds: deps.holds };
  let prepared;
  try {
    prepared = await prepareSubmission(sendDeps, { dealId: input.dealId, targetStage: input.targetStage ?? "screen", lenderIds: m.lenderIds, items: input.items, advisor, actor: input.actor, overrideReason: input.readinessOverrideReason, admit });
  } catch (err) {
    if (err instanceof PackageError) throw new OutreachError(err.message);
    throw err;
  }
  for (const s of prepared.skipped) outcomes.push({ lenderId: s.lenderId, lenderName: s.lenderName, ok: false, error: s.error });
  const locked = prepared.locked;
  if (!locked) return { outcomes, summaryItem: null };
  for (const p of prepared.lenders) {
    const candidate = m.ranked.get(p.lender.id);
    const why = candidate ? `match ${candidate.score}/100 (${candidate.reasons.slice(0, 3).join("; ")})` : `override: ${m.override}`;
    const note = [why, candidate && p.fit.exceptions.length ? `fit override: ${m.override}` : null, input.note?.trim()].filter(Boolean).join(" — ");
    try {
      const result = await sendPreparedToLender(sendDeps, locked, p, { dealId: input.dealId, actor: input.actor, allowStaleLender: input.allowStaleLender, note });
      outcomes.push({ lenderId: p.lender.id, lenderName: p.lender.name, ok: true, result, message: outreachMessage(result), matched: Boolean(candidate) });
    } catch (err) {
      if (err instanceof PackageError) outcomes.push({ lenderId: p.lender.id, lenderName: p.lender.name, ok: false, error: err.message });
      else throw err;
    }
  }
  return { outcomes, summaryItem: locked.summaryItem };
}
