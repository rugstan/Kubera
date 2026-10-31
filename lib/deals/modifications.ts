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

import { isApproved, type ApprovalGate } from "@/lib/compliance/approval-gate";
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

async function reevaluate(deps: ModificationDeps, m: ModificationRecord, facts: ModificationFacts, actor: string, extra: Partial<ModificationRecord> = {}): Promise<ModificationRecord> {
  const deal = await deps.store.getDeal(m.dealId);
  const loan = await deps.store.getLoanBrokerOfRecord(m.dealId);
  if (!deal || !loan) throw new ModificationError("no_loan_record", "The deal or its loan-level broker-of-record file is missing");
  const evaluation = evaluateModification(facts, loanContext(loan));
  const status = modificationStatusFor(evaluation);
  if (m.brokerOfRecordId) await deps.store.updateBrokerOfRecordRow(m.brokerOfRecordId, borRow(deal, loan, facts));
  return deps.store.updateModification(m.id, { ...extra, facts, evaluation, status, flags: [...new Set(evaluation.flags.map((f) => f.code))] }, actor, deps.now());
}

/** Requests (or re-checks) approval for the lender's written no-exemption notice and sends it once approved. */
async function lenderNotice(deps: ModificationDeps, m: ModificationRecord, actor: string): Promise<ModificationRecord> {
  if (m.status !== "pending_lender_notice") return m;
  const deal = await deps.store.getDeal(m.dealId);
  const loan = await deps.store.getLoanBrokerOfRecord(m.dealId);
  if (!deal || !loan) return m;
  const key = `lender_notice:no_exemption:${m.id}`;
  const text = [
    `Re: ${deal.title} — ${m.kind} effective ${m.facts.effectiveDate}`,
    "",
    `Kubera Commercial, Inc. did not negotiate or arrange this ${m.kind}. It was negotiated directly between the lender or servicer and the borrower.`,
    "Kubera makes no representation that any exemption from California usury limits (including Civ. Code §1916.1) applies to it. Please consult your counsel.",
  ].join("\n");
  const decision = await deps.gate.request({
    kind: "lender_notice",
    idempotencyKey: key,
    summary: `Send ${loan.lender.name} written notice that Kubera did not arrange the ${m.kind} on "${deal.title}"`,
    templateId: LENDER_NO_EXEMPTION_NOTICE_TEMPLATE_ID,
    payload: { modificationId: m.id, dealId: deal.id, lender: loan.lender.name, text },
    requestedBy: actor,
  });
  let updated = await deps.store.updateModification(m.id, { lenderNoticeApprovalKey: key }, actor, deps.now());
  if (!isApproved(decision) || !deps.mailer) return updated;
  const lenders = await deps.store.listLenders();
  const contact = lenders.find((l) => l.name === loan.lender.name)?.contactEmail;
  if (!contact) return updated;
  await deps.mailer.send({ to: contact, subject: `Notice regarding the ${m.kind} on ${deal.title}`, text, idempotencyKey: key });
  updated = await recordLenderNoticeSent(deps, m.id, deps.now(), actor);
  return updated;
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
      lenderNoticeSentAt: facts.lenderNoticeSentAt ?? null,
      officerApprovedBy: facts.elements?.officerApproval?.name ?? null,
      officerApprovedAt: facts.elements?.officerApproval?.approvedAt ?? null,
      feeEntryId: null,
      termsAppliedAt: null,
    },
    input.actor,
    now,
  );
  m = await lenderNotice(deps, m, input.actor);

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

/** Written notice to the lender was delivered (by the approved mailer or by the broker). */
export async function recordLenderNoticeSent(deps: ModificationDeps, id: string, at: Date, actor: string): Promise<ModificationRecord> {
  const m = await load(deps.store, id);
  if (m.status !== "pending_lender_notice") throw new ModificationError("invalid_status", "No lender notice is pending for this change");
  const facts: ModificationFacts = { ...m.facts, lenderNoticeSentAt: at.toISOString() };
  return reevaluate(deps, m, facts, actor, { lenderNoticeSentAt: at.toISOString() });
}

/** Re-check approval for a pending lender notice (after a broker approves it in the queue). */
export async function retryLenderNotice(deps: ModificationDeps, id: string, actor: string): Promise<ModificationRecord> {
  return lenderNotice(deps, await load(deps.store, id), actor);
}

/** Update the evaluated facts (e.g. engagement agreement or negotiation log recorded) and re-run gate H. */
export async function updateModificationFacts(deps: ModificationDeps, id: string, facts: ModificationFacts, actor: string): Promise<ModificationRecord> {
  const m = await load(deps.store, id);
  if (m.status === "withdrawn") throw new ModificationError("invalid_status", "This change was withdrawn");
  const parsed = modificationFactsSchema.parse(facts) as ModificationFacts;
  if (parsed.kind !== m.kind) throw new ModificationError("invalid_status", "The kind of change cannot be edited; withdraw and submit a new one");
  const updated = await reevaluate(deps, m, parsed, actor);
  return lenderNotice(deps, updated, actor);
}

const TERMS_ALLOWED: ReadonlySet<ModificationStatus> = new Set(["documented", "no_exemption_representation"]);

/** Applies the changed economic terms to the deal under this modification's override reference. */
export async function applyModificationTerms(
  deps: ModificationDeps,
  id: string,
  patch: Pick<Partial<Deal>, "loanAmountCents" | "lockedTerms">,
  actor: string,
): Promise<{ modification: ModificationRecord; deal: Deal }> {
  const m = await load(deps.store, id);
  if (!TERMS_ALLOWED.has(m.status)) throw new ModificationError("terms_not_allowed", `Terms change only after the ${m.kind} is documented (status: ${m.status.replace(/_/g, " ")})`);
  if (m.termsAppliedAt) throw new ModificationError("invalid_status", "These terms were already applied");
  const deal = await deps.store.getDeal(m.dealId);
  if (!deal) throw new ModificationError("deal_not_found", "Deal not found");
  const next: Partial<Deal> = { ...patch, lockOverrideRef: m.id };
  if (patch.lockedTerms) next.lockedTerms = { ...(deal.lockedTerms ?? {}), ...patch.lockedTerms };
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
