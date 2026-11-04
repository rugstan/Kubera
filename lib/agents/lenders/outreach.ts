// Lender outreach from a match: builds the executive summary once, adds it to
// the vault documents, and submits the package to each chosen lender through
// the deal desk's lender_outreach flow (WS-T sendPackageToLender). That flow
// locks the package version, asks the broker approval gate (Global rule 2)
// and mints a share link / sends mail ONLY after approval. A pending,
// rejected or expired approval sends nothing.
//
// A lender the matcher did not rank (knocked out, or no approved credit box)
// is submitted only with a written override reason, which the approving
// broker sees in the approval summary.

import { PackageError, assertDealCanGoToLenders, outreachMessage, sendPackageToLender, type DealHoldReader, type LenderMailer, type SendPackageResult } from "@/lib/deals/packages";
import type { AgentEventStore } from "@/lib/agents/core/events";
import type { ApprovalGate } from "@/lib/compliance/approval-gate";
import type { DocumentStorage } from "@/lib/disclosures/store";
import type { DealDeskStore } from "@/lib/deals/store";
import type { PackageItem } from "@/lib/deals/types";
import { logLenderMatch } from "./decision-log";
import { matchLenders, type MatchResult } from "./matcher";
import { buildExecutiveSummary, sha256Hex, summaryPackageItem, type ExecutiveSummaryInput, type ExecutiveSummarySpec } from "./package";
import type { CreditBoxStore } from "./store";
import type { DealProfile } from "./types";

export type OutreachDeps = {
  desk: DealDeskStore;
  boxes: CreditBoxStore;
  gate: ApprovalGate;
  mailer: LenderMailer | null;
  storage: DocumentStorage;
  renderPdf: (spec: ExecutiveSummarySpec) => Promise<Uint8Array>;
  baseUrl: string;
  now: () => Date;
  /** Open sanctions holds (WS-U); null = not configured, so nothing is submitted (fails closed). */
  holds: DealHoldReader | null;
  /** agent_events (AB): the ranking, knock-outs and overrides behind each submission are logged with reason codes. */
  events?: AgentEventStore | null;
};

export type SubmitInput = {
  dealId: string;
  profile: DealProfile;
  lenderIds: string[];
  /** Vault documents (already verified clean and hashed). */
  items: PackageItem[];
  /** Summary content beyond the deal record; null = no executive summary. */
  summary: Omit<ExecutiveSummaryInput, "deal"> | null;
  actor: string;
  allowStaleLender?: boolean;
  /** Required to submit to a lender the matcher did not rank. */
  overrideReason?: string | null;
  note?: string | null;
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

  // The summary is built and stored once, so every lender gets the same locked version.
  let summaryItem: PackageItem | null = null;
  if (input.summary) {
    const spec = buildExecutiveSummary({ ...input.summary, deal });
    const bytes = await deps.renderPdf(spec);
    const sha = sha256Hex(bytes);
    summaryItem = summaryPackageItem(deal.id, sha);
    await deps.storage.put(summaryItem.storagePath, bytes, "application/pdf");
  }
  const items = summaryItem ? [...input.items, summaryItem] : input.items;
  if (!items.length) throw new OutreachError("Add at least one document or the executive summary");

  const outcomes: SubmitOutcome[] = [];
  for (const lenderId of lenderIds) {
    const lender = lenders.find((l) => l.id === lenderId);
    if (!lender) {
      outcomes.push({ lenderId, lenderName: lenderId, ok: false, error: "Lender not found on the panel" });
      continue;
    }
    const candidate = ranked.get(lenderId);
    if (!candidate && !override) {
      const ex = match.excluded.find((e) => e.lender?.id === lenderId);
      outcomes.push({
        lenderId,
        lenderName: lender.name,
        ok: false,
        error: `Not a match${ex ? `: ${ex.failures.join("; ")}` : " (no approved credit box covers this deal)"}. Add an override reason to submit anyway.`,
      });
      continue;
    }
    const why = candidate ? `match ${candidate.score}/100 (${candidate.reasons.slice(0, 3).join("; ")})` : `override: ${override}`;
    const note = [why, input.note?.trim()].filter(Boolean).join(" — ");
    try {
      const result = await sendPackageToLender(
        { store: deps.desk, gate: deps.gate, now: deps.now, baseUrl: deps.baseUrl, mailer: deps.mailer, holds: deps.holds },
        { dealId: deal.id, lenderId, items, actor: input.actor, allowStaleLender: input.allowStaleLender, note },
      );
      outcomes.push({ lenderId, lenderName: lender.name, ok: true, result, message: outreachMessage(result), matched: Boolean(candidate) });
    } catch (err) {
      if (err instanceof PackageError) outcomes.push({ lenderId, lenderName: lender.name, ok: false, error: err.message });
      else throw err;
    }
  }
  const submitted = outcomes.filter((o) => o.ok);
  const overridden = submitted.filter((o) => o.ok && !o.matched).map((o) => o.lenderId);
  await logLenderMatch(deps.events, {
    dealId: deal.id,
    match,
    now,
    context: "submission",
    submittedLenderIds: submitted.map((o) => o.lenderId),
    override: overridden.length && override ? { lenderIds: overridden, reason: override } : null,
  });
  return { outcomes, summaryItem, match };
}
