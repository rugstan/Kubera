// Forbearance / extension / modification workflow (gate H, SB 1146).
//
// Since 2025-01-01 each forbearance, extension or modification must itself be
// arranged by a licensed broker for the Civ. Code §1916.1 analysis to reach
// it. Every change is evaluated with lib/compliance/gates.ts, recorded as its
// own `broker_of_record` row (child of the loan-level file), and:
//   - pre-SB 1146 changes → held for counsel;
//   - lender/servicer-only negotiation → no exemption representation, and the
//     lender gets written notice — an outbound message, so it goes through the
//     broker approval gate and never sends on a timed-out approval;
//   - Kubera-arranged changes above the cap → blocked until every element and
//     designated-officer approval are recorded.
// Locked deal terms change only through a documented modification.

import { isApproved, peekApproval, type ApprovalDecision, type ApprovalGate, type OutboundAction } from "@/lib/compliance/approval-gate";
import { evaluateModification, type ModificationEvaluation } from "@/lib/compliance/gates";
import { modificationFactsSchema, type ModificationFacts } from "@/lib/compliance/schemas";
import { brokerOfRecordRow } from "@/lib/disclosures/broker-of-record";
import { changeFee } from "./ledger";
import type { LenderMailer } from "./packages";
import { assertEditable } from "./stages";
import type { DealDeskStore } from "./store";
import type { Clock, Deal, LoanBrokerOfRecord, ModificationRecord, ModificationStatus } from "./types";

export const LENDER_NO_EXEMPTION_NOTICE_TEMPLATE_ID = "lender_no_exemption_notice_v1";

export class ModificationError extends Error {
  constructor(
    readonly reason: "deal_not_found" | "no_loan_record" | "not_found" | "invalid_status" | "officer_license" | "terms_not_allowed",
    message: string,
  ) {
    super(message);
    this.name = "ModificationError";
  }
}

export function modificationStatusFor(e: ModificationEvaluation): ModificationStatus {
  switch (e.status) {
    case "held_for_counsel":
      return "held_for_counsel";
    case "no_exemption_representation":
      return e.lenderNoticeRequired ? "pending_lender_notice" : "no_exemption_representation";
    case "incomplete":
      return e.blocking ? "blocked" : "incomplete";
    case "documented":
      return "documented";
  }
}

function loanContext(loan: LoanBrokerOfRecord) {
  return { lender: loan.lender, fedDiscountRatePct: loan.fedDiscountRatePct, collateral: loan.collateral };
}

function borRow(deal: Deal, loan: LoanBrokerOfRecord, facts: ModificationFacts): Record<string, unknown> {
  const f = modificationFactsSchema.parse(facts);
  return brokerOfRecordRow({
    recordKind: f.kind,
    dealId: deal.id,
    ...(deal.leadId ? { leadId: deal.leadId } : {}),
    ...(deal.twentyOpportunityId ? { twentyOpportunityId: deal.twentyOpportunityId } : {}),
    lender: loan.lender,
    collateral: loan.collateral,
    noteRatePct: f.noteRatePct,
    fedDiscountRatePct: loan.fedDiscountRatePct,
    ...(f.lenderCharges ? { lenderCharges: f.lenderCharges } : {}),
    elements: f.elements,
    parentId: loan.id,
    effectiveDate: f.effectiveDate,
    arrangedBy: f.arrangedBy,
    otherBroker: f.otherBroker,
    agreementRecitesBrokerArrangement: f.agreementRecitesBrokerArrangement,
    lenderNoticeSentAt: f.lenderNoticeSentAt,
  });
}

export type ModificationDeps = { store: DealDeskStore; gate: ApprovalGate; now: Clock; mailer?: LenderMailer | null };

export type ChangeFeeInput = { principalCents: number; pct?: number; flatCents?: number; payer: "borrower" | "lender" };

async function reevaluate(deps: Pick<ModificationDeps, "store" | "now">, m: ModificationRecord, facts: ModificationFacts, actor: string, extra: Partial<ModificationRecord> = {}): Promise<ModificationRecord> {
  const deal = await deps.store.getDeal(m.dealId);
  const loan = await deps.store.getLoanBrokerOfRecord(m.dealId);
  if (!deal || !loan) throw new ModificationError("no_loan_record", "The deal or its loan-level broker-of-record file is missing");
  const evaluation = evaluateModification(facts, loanContext(loan));
  const status = modificationStatusFor(evaluation);
  if (m.brokerOfRecordId) await deps.store.updateBrokerOfRecordRow(m.brokerOfRecordId, borRow(deal, loan, facts));
  return deps.store.updateModification(m.id, { ...extra, facts, evaluation, status, flags: [...new Set(evaluation.flags.map((f) => f.code))] }, actor, deps.now());
}

/**
 * Re-runs gate H on every open change after the loan-level file changed (a new
 * lender category, rate cap inputs or collateral change the result). Applied
 * and withdrawn changes are history and keep their evaluation.
 */
export async function reevaluateOpenModifications(deps: Pick<ModificationDeps, "store" | "now">, dealId: string, actor: string): Promise<ModificationRecord[]> {
  const open = (await deps.store.listModifications(dealId)).filter((m) => m.status !== "withdrawn" && !m.termsAppliedAt);
  const out: ModificationRecord[] = [];
  for (const m of open) out.push(await reevaluate(deps, m, m.facts, actor));
  return out;
}

/** The written no-exemption notice exactly as the broker approves it. */
export function lenderNoticeText(deal: Pick<Deal, "title">, m: Pick<ModificationRecord, "kind" | "facts">): string {
  return [
    `Re: ${deal.title} — ${m.kind} effective ${m.facts.effectiveDate}`,
    "",
    `Kubera Commercial, Inc. did not negotiate or arrange this ${m.kind}. It was negotiated directly between the lender or servicer and the borrower.`,
    "Kubera makes no representation that any exemption from California usury limits (including Civ. Code §1916.1) applies to it. Please consult your counsel.",
  ].join("\n");
}

export function lenderNoticeKey(modificationId: string): string {
  return `lender_notice:no_exemption:${modificationId}`;
}

function lenderNoticeAction(deal: Deal, loan: LoanBrokerOfRecord, m: ModificationRecord, actor: string): OutboundAction {
  const text = lenderNoticeText(deal, m);
  return {
    kind: "lender_notice",
    idempotencyKey: lenderNoticeKey(m.id),
    summary: `Send ${loan.lender.name} written notice that Kubera did not arrange the ${m.kind} on "${deal.title}"`,
    templateId: LENDER_NO_EXEMPTION_NOTICE_TEMPLATE_ID,
    payload: { modificationId: m.id, dealId: deal.id, lender: loan.lender.name, text },
    requestedBy: actor,
  };
}

/** Asks the gate, turning a changed-payload conflict (deal title or lender renamed) into a staff-readable error. */
async function ask(fn: () => Promise<ApprovalDecision>): Promise<ApprovalDecision> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Error && err.name === "ApprovalConflictError") {
      throw new ModificationError(
        "invalid_status",
        "The notice text changed after approval was requested (the deal title, lender or effective date was edited). Send the approved notice from your mailbox and click Notice sent, or ask a broker to cancel the old approval.",
      );
    }
    throw err;
  }
}

export type LenderNoticeOutcome =
  | { notice: "not_required" }
  /** Waiting on the broker, or the broker rejected / let it expire: nothing was sent. */
  | { notice: "pending" | "rejected" | "expired"; reason?: string }
  /** Approved and emailed to the lender's contact. */
  | { notice: "sent" }
  /** Approved, but no mailer or lender contact: staff send `text` to the lender and record "Notice sent". */
  | { notice: "approved_send_manually"; text: string; why: "no_mailer" | "no_contact" | "already_executed" };

export type LenderNoticeResult = { modification: ModificationRecord } & LenderNoticeOutcome;

/**
 * Requests (or re-checks) approval for the lender's written no-exemption
 * notice. The approval is claimed only when the notice is emailed in the same
 * call; otherwise an approved notice is recorded on the modification
 * (lenderNoticeApprovedAt) and handed to staff to send.
 */
async function lenderNotice(deps: ModificationDeps, m: ModificationRecord, actor: string): Promise<LenderNoticeResult> {
  if (m.status !== "pending_lender_notice") return { modification: m, notice: "not_required" };
  const deal = await deps.store.getDeal(m.dealId);
  const loan = await deps.store.getLoanBrokerOfRecord(m.dealId);
  if (!deal || !loan) return { modification: m, notice: "not_required" };
  const action = lenderNoticeAction(deal, loan, m, actor);
  const text = lenderNoticeText(deal, m);
  const now = deps.now();

  const peeked = await ask(() => peekApproval(deps.gate, action));
  if (!isApproved(peeked)) {
    const approvalId = "approvalId" in peeked ? (peeked.approvalId ?? null) : null;
    const modification = await deps.store.updateModification(m.id, { lenderNoticeApprovalKey: action.idempotencyKey, lenderNoticeApprovalId: approvalId }, actor, now);
    return { modification, notice: peeked.status, ...(peeked.status === "rejected" && peeked.reason ? { reason: peeked.reason } : {}) };
  }

  const contact = (await deps.store.listLenders()).find((l) => l.name === loan.lender.name)?.contactEmail ?? null;
  if (deps.mailer && contact && !peeked.executedAt) {
    // Claim the approval right before the send.
    const claimed = await ask(() => deps.gate.request(action));
    if (isApproved(claimed)) {
      await deps.mailer.send({ to: contact, subject: `Notice regarding the ${m.kind} on ${deal.title}`, text, idempotencyKey: action.idempotencyKey });
      await deps.store.updateModification(m.id, { lenderNoticeApprovalKey: action.idempotencyKey, lenderNoticeApprovalId: claimed.approvalId, lenderNoticeApprovedAt: peeked.decidedAt.toISOString() }, actor, now);
      return { modification: await markNoticeSent(deps, m.id, deps.now(), actor), notice: "sent" };
    }
  }

  // Approved, but it is not going out from here: record the approval so staff can send it.
  const modification = await deps.store.updateModification(
    m.id,
    { lenderNoticeApprovalKey: action.idempotencyKey, lenderNoticeApprovalId: peeked.approvalId, lenderNoticeApprovedAt: m.lenderNoticeApprovedAt ?? peeked.decidedAt.toISOString() },
    actor,
    now,
  );
  const why = !deps.mailer ? "no_mailer" : !contact ? "no_contact" : "already_executed";
  return { modification, notice: "approved_send_manually", text, why };
}

/** One line for staff describing a lender-notice check. */
export function lenderNoticeMessage(r: LenderNoticeResult): string {
  switch (r.notice) {
    case "not_required":
      return `No lender notice is pending (status: ${r.modification.status.replace(/_/g, " ")}).`;
    case "pending":
      return "The lender notice is waiting for broker approval in the approvals queue; nothing was sent.";
    case "rejected":
      return `A broker rejected the lender notice${r.reason ? ` (${r.reason})` : ""}; nothing was sent.`;
    case "expired":
      return "The lender notice approval expired; nothing was sent. Ask a broker to approve a new request.";
    case "sent":
      return "Approved lender notice emailed to the lender; recorded as sent.";
    case "approved_send_manually":
      return `A broker approved the lender notice, but ${r.why === "no_mailer" ? "outbound email is not configured" : r.why === "no_contact" ? "the lender has no contact email on the panel" : "its approval was already used"}. Send the approved notice text shown below from your mailbox, then click Notice sent.`;
  }
}

export async function submitModification(
  deps: ModificationDeps,
  input: { dealId: string; facts: ModificationFacts; actor: string; fee?: ChangeFeeInput },
): Promise<ModificationRecord> {
  const deal = await deps.store.getDeal(input.dealId);
  if (!deal) throw new ModificationError("deal_not_found", `Deal ${input.dealId} not found`);
  const loan = await deps.store.getLoanBrokerOfRecord(deal.id);
  if (!loan) throw new ModificationError("no_loan_record", "Record the loan-level broker-of-record file (gate H) before any forbearance, extension or modification");
  const facts = modificationFactsSchema.parse(input.facts) as ModificationFacts;
  const evaluation = evaluateModification(facts, loanContext(loan));
  const now = deps.now();
  const borId = await deps.store.insertBrokerOfRecordRow(borRow(deal, loan, facts));
  let m = await deps.store.insertModification(
    {
      dealId: deal.id,
      kind: facts.kind,
      status: modificationStatusFor(evaluation),
      parentBrokerOfRecordId: loan.id,
      brokerOfRecordId: borId,
      facts,
      evaluation,
      flags: [...new Set(evaluation.flags.map((f) => f.code))],
      lenderNoticeApprovalKey: null,
      lenderNoticeApprovalId: null,
      lenderNoticeApprovedAt: null,
      lenderNoticeSentAt: facts.lenderNoticeSentAt ?? null,
      officerApprovedBy: facts.elements?.officerApproval?.name ?? null,
      officerApprovedAt: facts.elements?.officerApproval?.approvedAt ?? null,
      feeEntryId: null,
      termsAppliedAt: null,
    },
    input.actor,
    now,
  );
  m = (await lenderNotice(deps, m, input.actor)).modification;

  // Kubera's compensation for arranging the change (projected until it closes).
  if (input.fee && facts.arrangedBy === "kubera" && (input.fee.flatCents !== undefined || input.fee.pct !== undefined)) {
    const entry = await deps.store.insertFeeEntry(changeFee({ dealId: deal.id, kind: facts.kind, modificationId: m.id, ...input.fee }), input.actor, now);
    m = await deps.store.updateModification(m.id, { feeEntryId: entry.id }, input.actor, now);
  }
  return m;
}

async function load(store: DealDeskStore, id: string): Promise<ModificationRecord> {
  const m = await store.getModification(id);
  if (!m) throw new ModificationError("not_found", `Modification ${id} not found`);
  return m;
}

/** Designated-officer approval (the staff action is restricted to the officer by the caller). */
export async function recordOfficerApproval(deps: ModificationDeps, id: string, officer: { name: string; dreLicense: string }, actor: string): Promise<ModificationRecord> {
  if (!/^\d{8}$/.test(officer.dreLicense)) throw new ModificationError("officer_license", "The designated officer's 8-digit DRE license is required");
  const m = await load(deps.store, id);
  if (m.status === "held_for_counsel" || m.status === "withdrawn") throw new ModificationError("invalid_status", `Cannot approve a ${m.status} ${m.kind}`);
  const at = deps.now().toISOString();
  const facts: ModificationFacts = { ...m.facts, elements: { ...(m.facts.elements ?? { negotiationLog: [], businessPurposeCertified: false }), officerApproval: { name: officer.name, dreLicense: officer.dreLicense, approvedAt: at } } };
  return reevaluate(deps, m, facts, actor, { officerApprovedBy: officer.name, officerApprovedAt: at });
}

async function markNoticeSent(deps: ModificationDeps, id: string, at: Date, actor: string): Promise<ModificationRecord> {
  const m = await load(deps.store, id);
  if (m.status !== "pending_lender_notice") throw new ModificationError("invalid_status", "No lender notice is pending for this change");
  const facts: ModificationFacts = { ...m.facts, lenderNoticeSentAt: at.toISOString() };
  return reevaluate(deps, m, facts, actor, { lenderNoticeSentAt: at.toISOString() });
}

/**
 * Staff delivered the written notice to the lender from their own mailbox.
 * When a broker approved it in the queue, the approval is marked executed now,
 * so the queue's audit trail matches what actually went out.
 */
export async function recordLenderNoticeSent(deps: ModificationDeps, id: string, at: Date, actor: string): Promise<ModificationRecord> {
  const m = await load(deps.store, id);
  if (m.status !== "pending_lender_notice") throw new ModificationError("invalid_status", "No lender notice is pending for this change");
  const [deal, loan] = await Promise.all([deps.store.getDeal(m.dealId), deps.store.getLoanBrokerOfRecord(m.dealId)]);
  if (deal && loan && m.lenderNoticeApprovalKey) {
    try {
      const action = lenderNoticeAction(deal, loan, m, actor);
      if (isApproved(await peekApproval(deps.gate, action))) await deps.gate.request(action);
    } catch (err) {
      // The record of the delivery matters more than the queue bookkeeping.
      console.warn("[deals] could not mark the lender-notice approval executed", err instanceof Error ? err.message : err);
    }
  }
  return markNoticeSent(deps, id, at, actor);
}

/** Re-check approval for a pending lender notice (after a broker approves it in the queue). */
export async function retryLenderNotice(deps: ModificationDeps, id: string, actor: string): Promise<LenderNoticeResult> {
  return lenderNotice(deps, await load(deps.store, id), actor);
}

/** Update the evaluated facts (e.g. engagement agreement or negotiation log recorded) and re-run gate H. */
export async function updateModificationFacts(deps: ModificationDeps, id: string, facts: ModificationFacts, actor: string): Promise<ModificationRecord> {
  const m = await load(deps.store, id);
  if (m.status === "withdrawn") throw new ModificationError("invalid_status", "This change was withdrawn");
  const parsed = modificationFactsSchema.parse(facts) as ModificationFacts;
  if (parsed.kind !== m.kind) throw new ModificationError("invalid_status", "The kind of change cannot be edited; withdraw and submit a new one");
  const updated = await reevaluate(deps, m, parsed, actor);
  return (await lenderNotice(deps, updated, actor)).modification;
}

const TERMS_ALLOWED: ReadonlySet<ModificationStatus> = new Set(["documented", "no_exemption_representation"]);

/**
 * Applies the changed economic terms to the deal under this modification's
 * override reference. The note rate is always the one gate H evaluated
 * (m.facts.noteRatePct): a different rate would bypass the above-cap block and
 * officer approval, so it is refused; record the new rate on the change with
 * updateModificationFacts (which re-runs gate H) instead.
 */
export async function applyModificationTerms(
  deps: ModificationDeps,
  id: string,
  patch: Pick<Partial<Deal>, "loanAmountCents" | "lockedTerms">,
  actor: string,
): Promise<{ modification: ModificationRecord; deal: Deal }> {
  const m = await load(deps.store, id);
  if (!TERMS_ALLOWED.has(m.status)) throw new ModificationError("terms_not_allowed", `Terms change only after the ${m.kind} is documented (status: ${m.status.replace(/_/g, " ")})`);
  if (m.termsAppliedAt) throw new ModificationError("invalid_status", "These terms were already applied");
  const requested = patch.lockedTerms?.noteRatePct;
  if (requested !== undefined && requested !== null && Number(requested) !== m.facts.noteRatePct) {
    throw new ModificationError(
      "terms_not_allowed",
      `Gate H evaluated this ${m.kind} at ${m.facts.noteRatePct}%; ${String(requested)}% was never evaluated. Update the change's rate (gate H runs again) before applying it.`,
    );
  }
  const deal = await deps.store.getDeal(m.dealId);
  if (!deal) throw new ModificationError("deal_not_found", "Deal not found");
  const next: Partial<Deal> = { ...patch, lockOverrideRef: m.id };
  next.lockedTerms = { ...(deal.lockedTerms ?? {}), ...(patch.lockedTerms ?? {}), noteRatePct: m.facts.noteRatePct };
  assertEditable(deal, next);
  const now = deps.now();
  const updatedDeal = await deps.store.updateDeal(deal.id, deal.recordVersion, next, actor, now);
  const modification = await deps.store.updateModification(m.id, { termsAppliedAt: now.toISOString() }, actor, now);
  return { modification, deal: updatedDeal };
}

export async function withdrawModification(deps: ModificationDeps, id: string, actor: string): Promise<ModificationRecord> {
  const m = await load(deps.store, id);
  if (m.termsAppliedAt) throw new ModificationError("invalid_status", "Applied changes cannot be withdrawn");
  return deps.store.updateModification(m.id, { status: "withdrawn" }, actor, deps.now());
}
