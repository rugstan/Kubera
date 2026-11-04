// The loan-level broker-of-record file (counsel gate H) on the deal desk.
//
// Gate H elements are recorded on every loan Corin brokers: the lender and its
// exempt-lender category (with evidence), the note rate and the charges the
// lender keeps, the Fed discount rate for the art. XV cap, the collateral, the
// arranging licensee, who Corin acts for, the engagement agreement, the
// compensation and its payer, the negotiation log, the business-purpose
// certification and, when a non-exempt lender's effective rate is above the
// cap, the designated officer's approval. Until the file exists the closing
// gate fails closed and no forbearance, extension or modification can be
// submitted.
//
// Validation is lib/disclosures/broker-of-record.ts (loanBrokerOfRecordSchema,
// which rejects Corin as the lender); evaluation is lib/compliance/gates.ts.
// The beneficiary and originator named on the loan documents are recorded as
// written, so a document naming Corin holds the deal for counsel instead of
// being silently rejected.

import { mldsRequirement } from "@/lib/compliance/gates";
import { lenderChargesSchema, type CollateralInput, type LenderCategory, type LenderChargesInput } from "@/lib/compliance/schemas";
import { brokerOfRecordRow, loanBrokerOfRecordSchema, namesCorin, type BrokerOfRecordInput } from "@/lib/disclosures/broker-of-record";
import { holdForCounsel } from "@/lib/disclosures/service";
import type { DisclosureStore } from "@/lib/disclosures/store";
import { currentDealMlds } from "./mlds";
import { reevaluateOpenModifications } from "./modifications";
import type { DealDeskStore } from "./store";
import type { Clock, Deal, LoanBrokerOfRecord } from "./types";

export class BrokerOfRecordError extends Error {
  constructor(
    readonly reason: "deal_not_found" | "deal_settled" | "no_loan_record" | "officer_license" | "rate_mismatch",
    message: string,
  ) {
    super(message);
    this.name = "BrokerOfRecordError";
  }
}

type Party = "borrower" | "lender" | "borrower_and_lender";

export type LoanFileInput = {
  lender: { name: string; category: LenderCategory; evidenceRef?: string };
  noteRatePct: number;
  fedDiscountRatePct: number;
  lenderCharges?: LenderChargesInput;
  collateral: CollateralInput;
  /** Date the loan was (or will be) made. */
  transactionDate: string;
  tableFunded?: boolean;
  trueFundingSource?: string;
  tableFundedInCorinName?: boolean;
  deedBeneficiaryName?: string;
  originatorName?: string;
  actsFor?: Party;
  engagementAgreementRef?: string;
  compensation?: { amountUsd: number; payer: Party; expected?: boolean; closingStatementLine?: string };
  businessPurposeCertified: boolean;
  /** The arranging licensee (from the staff session). Omitted: the one already on file is kept. */
  arrangingLicensee?: { name: string; dreLicense: string; activeAtTransaction: boolean };
  /** Appended to the negotiation log (term-sheet version, lender submission, counteroffer or communication). */
  negotiationEntry?: { at: string; kind: "term_sheet" | "communication" | "counteroffer" | "lender_submission"; ref: string; summary?: string; byLicensee?: string };
};

export type BrokerOfRecordDeps = { store: DealDeskStore; now: Clock; disclosures?: DisclosureStore | null };

const SETTLED: ReadonlySet<Deal["status"]> = new Set(["won", "lost", "withdrawn"]);

/** The persisted row (and its gate-H evaluation) for a loan file. */
function loanRow(deal: Deal, file: Omit<LoanBrokerOfRecord, "id" | "dealId" | "leadId">): Record<string, unknown> {
  const input: BrokerOfRecordInput = {
    recordKind: "loan",
    dealId: deal.id,
    ...(deal.leadId ? { leadId: deal.leadId } : {}),
    ...(deal.twentyOpportunityId ? { twentyOpportunityId: deal.twentyOpportunityId } : {}),
    lender: file.lender,
    collateral: file.collateral,
    noteRatePct: file.noteRatePct,
    fedDiscountRatePct: file.fedDiscountRatePct,
    ...(file.lenderCharges ? { lenderCharges: file.lenderCharges } : {}),
    elements: file.elements,
    transactionDate: file.transactionDate,
    tableFunded: file.tableFunded ?? false,
    ...(file.trueFundingSource ? { trueFundingSource: file.trueFundingSource } : {}),
    tableFundedInCorinName: file.tableFundedInCorinName,
    ...(file.deedBeneficiaryName ? { deedBeneficiaryName: file.deedBeneficiaryName } : {}),
    ...(file.originatorName ? { originatorName: file.originatorName } : {}),
  };
  return brokerOfRecordRow(input);
}

/** Facts whose change invalidates an earlier officer approval (the officer approved a different loan). */
function approvalBasis(f: Pick<LoanBrokerOfRecord, "lender" | "noteRatePct" | "fedDiscountRatePct" | "lenderCharges" | "collateral" | "tableFunded" | "tableFundedInCorinName" | "deedBeneficiaryName" | "originatorName" | "transactionDate">): string {
  const charges = f.lenderCharges ? lenderChargesSchema.parse(f.lenderCharges) : null;
  return JSON.stringify([
    [f.lender.name, f.lender.category, f.lender.evidenceRef ?? null],
    f.noteRatePct,
    f.fedDiscountRatePct,
    charges && [charges.lenderPointsPct, charges.exitFeePct, charges.minimumInterestMonths, charges.termMonths ?? null, charges.effectiveRatePct ?? null],
    [f.collateral.realPropertyLien, f.collateral.equityPledgeOrUccOnly ?? false, f.collateral.apn ?? null, f.collateral.lienPosition ?? null],
    Boolean(f.tableFunded),
    f.tableFundedInCorinName,
    f.deedBeneficiaryName ?? null,
    f.originatorName ?? null,
    f.transactionDate,
  ]);
}

/** The rate gate H must evaluate: the latest applied modification's, else the locked term-sheet rate. */
export async function governingNoteRate(store: DealDeskStore, deal: Deal): Promise<number | null> {
  const applied = (await store.listModifications(deal.id)).filter((m) => m.termsAppliedAt && m.status !== "withdrawn");
  if (applied.length) return null; // the modification's own child row carries the changed rate
  const locked = deal.lockedTerms?.noteRatePct;
  return typeof locked === "number" && Number.isFinite(locked) ? locked : null;
}

/**
 * When the loan documents name Corin as beneficiary or originator (or the
 * loan is table funded in Corin's name), gate A holds the deal for counsel:
 * an open MLDS is held too, so nothing goes to the borrower.
 */
async function holdOpenMlds(deps: BrokerOfRecordDeps, deal: Deal, file: LoanBrokerOfRecord, actor: string): Promise<boolean> {
  const requirement = mldsRequirement({
    corinRole: "broker",
    program: deal.program,
    collateral: file.collateral,
    tableFundedInCorinName: file.tableFundedInCorinName,
    ...namesCorin(file),
  });
  if (!requirement.heldForCounsel || !deps.disclosures) return requirement.heldForCounsel;
  const mlds = await currentDealMlds(deps.disclosures, deal);
  if (mlds && (mlds.status === "required" || mlds.status === "generated" || mlds.status === "sent")) {
    const reason = requirement.flags.filter((f) => f.code === "held_for_counsel").map((f) => f.reason).join(" ");
    await holdForCounsel({ store: deps.disclosures, now: deps.now }, mlds.id, reason, actor);
  }
  return true;
}

export type RecordLoanFileResult = { file: LoanBrokerOfRecord; created: boolean; officerApprovalCleared: boolean; heldForCounsel: boolean };

/** Records (or updates) the deal's loan-level broker-of-record file and re-runs gate H on it and on any open change. */
export async function recordLoanBrokerOfRecord(deps: BrokerOfRecordDeps, input: { dealId: string; file: LoanFileInput; actor: string }): Promise<RecordLoanFileResult> {
  const deal = await deps.store.getDeal(input.dealId);
  if (!deal) throw new BrokerOfRecordError("deal_not_found", `Deal ${input.dealId} not found`);
  if (SETTLED.has(deal.status)) throw new BrokerOfRecordError("deal_settled", `The deal is ${deal.status}; its broker-of-record file is the transaction record and cannot change.`);
  const existing = await deps.store.getLoanBrokerOfRecord(deal.id);

  const governing = await governingNoteRate(deps.store, deal);
  if (governing !== null && governing !== input.file.noteRatePct) {
    throw new BrokerOfRecordError("rate_mismatch", `The note rate must match the locked term-sheet rate (${governing}%); change locked terms only through a documented modification.`);
  }

  const f = input.file;
  const log = [...(existing?.elements.negotiationLog ?? []), ...(f.negotiationEntry ? [f.negotiationEntry] : [])];
  const arrangingLicensee = f.arrangingLicensee ?? existing?.elements.arrangingLicensee;
  const draft: Omit<LoanBrokerOfRecord, "id" | "dealId" | "leadId"> = {
    lender: { name: f.lender.name, category: f.lender.category, ...(f.lender.evidenceRef ? { evidenceRef: f.lender.evidenceRef } : {}) },
    noteRatePct: f.noteRatePct,
    fedDiscountRatePct: f.fedDiscountRatePct,
    ...(f.lenderCharges ? { lenderCharges: f.lenderCharges } : {}),
    collateral: { realPropertyLien: f.collateral.realPropertyLien, equityPledgeOrUccOnly: f.collateral.equityPledgeOrUccOnly ?? false, ...(f.collateral.apn ? { apn: f.collateral.apn } : {}), ...(f.collateral.lienPosition ? { lienPosition: f.collateral.lienPosition } : {}) },
    elements: {
      ...(arrangingLicensee ? { arrangingLicensee } : {}),
      ...(f.actsFor ? { actsFor: f.actsFor } : {}),
      ...(f.engagementAgreementRef ? { engagementAgreementRef: f.engagementAgreementRef } : {}),
      ...(f.compensation ? { compensation: { expected: true, ...f.compensation } } : {}),
      negotiationLog: log,
      businessPurposeCertified: f.businessPurposeCertified,
    },
    tableFunded: f.tableFunded ?? false,
    ...(f.trueFundingSource ? { trueFundingSource: f.trueFundingSource } : {}),
    tableFundedInCorinName: f.tableFundedInCorinName ?? false,
    ...(f.deedBeneficiaryName ? { deedBeneficiaryName: f.deedBeneficiaryName } : {}),
    ...(f.originatorName ? { originatorName: f.originatorName } : {}),
    transactionDate: f.transactionDate,
  };
  // An officer approval stands only for the loan the officer approved.
  const keepApproval = Boolean(existing?.elements.officerApproval) && approvalBasis(existing!) === approvalBasis(draft);
  if (keepApproval) draft.elements.officerApproval = existing!.elements.officerApproval;
  // Validate before writing (the row builder parses with loanBrokerOfRecordSchema).
  loanBrokerOfRecordSchema.parse({ recordKind: "loan", dealId: deal.id, ...draft, tableFunded: draft.tableFunded ?? false });
  const row = loanRow(deal, draft);

  if (existing) await deps.store.updateBrokerOfRecordRow(existing.id, row);
  else await deps.store.insertBrokerOfRecordRow(row);
  const file = (await deps.store.getLoanBrokerOfRecord(deal.id))!;

  await reevaluateOpenModifications({ store: deps.store, now: deps.now }, deal.id, input.actor);
  const heldForCounsel = await holdOpenMlds(deps, deal, file, input.actor);
  return { file, created: !existing, officerApprovalCleared: Boolean(existing?.elements.officerApproval) && !keepApproval, heldForCounsel };
}

/** Designated-officer approval of the loan file (the staff action is restricted to the officer by the caller). */
export async function approveLoanBrokerOfRecord(deps: BrokerOfRecordDeps, dealId: string, officer: { name: string; dreLicense: string }, actor: string): Promise<LoanBrokerOfRecord> {
  if (!/^\d{8}$/.test(officer.dreLicense)) throw new BrokerOfRecordError("officer_license", "The designated officer's 8-digit DRE license is required");
  const deal = await deps.store.getDeal(dealId);
  if (!deal) throw new BrokerOfRecordError("deal_not_found", `Deal ${dealId} not found`);
  if (SETTLED.has(deal.status)) throw new BrokerOfRecordError("deal_settled", `The deal is ${deal.status}; its broker-of-record file cannot change.`);
  const existing = await deps.store.getLoanBrokerOfRecord(deal.id);
  if (!existing) throw new BrokerOfRecordError("no_loan_record", "Record the loan's broker-of-record file before the officer approves it");
  const { id: _id, dealId: _deal, leadId: _lead, effectiveRatePct: _eff, updatedAt: _upd, ...rest } = existing;
  const approved = { ...rest, elements: { ...existing.elements, officerApproval: { name: officer.name, dreLicense: officer.dreLicense, approvedAt: deps.now().toISOString() } } };
  await deps.store.updateBrokerOfRecordRow(existing.id, loanRow(deal, approved));
  await reevaluateOpenModifications({ store: deps.store, now: deps.now }, deal.id, actor);
  return (await deps.store.getLoanBrokerOfRecord(deal.id))!;
}
