// Broker-of-record file (counsel gate H): the facts Kubera records on every
// loan and on every forbearance, extension or modification to show that a
// licensed broker arranged it for another, for compensation, on a
// real-property-secured loan (Civ. Code §1916.1, as amended by SB 1146).
// Evaluation is delegated to the pure gates in lib/compliance/gates.ts.

import { z } from "zod";
import { evaluateModification, evaluateUsury, type ModificationEvaluation, type UsuryEvaluation } from "@/lib/compliance/gates";
import {
  arrangers,
  brokerOfRecordElementsSchema,
  collateralSchema,
  lenderSchema,
  modificationKinds,
  type ModificationFacts,
  type UsuryFacts,
} from "@/lib/compliance/schemas";

export const BROKER_OF_RECORD_RETENTION_YEARS = 3;

const base = {
  leadId: z.uuid().optional(),
  dealId: z.uuid().optional(),
  twentyOpportunityId: z.uuid().optional(),
  lender: lenderSchema,
  collateral: collateralSchema,
  noteRatePct: z.number().finite().min(0).max(100),
  fedDiscountRatePct: z.number().finite().min(0).max(25),
  elements: brokerOfRecordElementsSchema,
  /** §10240 statement (MLDS) date for the loan, when one was given. */
  mldsSignedOn: z.iso.date().optional(),
};

export const loanBrokerOfRecordSchema = z.object({
  recordKind: z.literal("loan"),
  ...base,
  transactionDate: z.iso.date(),
  tableFunded: z.boolean().default(false),
  /** True funding source when table funded. */
  trueFundingSource: z.string().trim().max(160).optional(),
  tableFundedInKuberaName: z.boolean().default(false),
});

export const modificationBrokerOfRecordSchema = z.object({
  recordKind: z.enum(modificationKinds),
  ...base,
  /** The loan-level broker_of_record row this change belongs to. */
  parentId: z.uuid(),
  effectiveDate: z.iso.date(),
  arrangedBy: z.enum(arrangers),
  otherBroker: z.object({ name: z.string().trim().min(1).max(160), dreLicense: z.string().trim().regex(/^\d{8}$/) }).optional(),
  agreementRecitesBrokerArrangement: z.boolean().default(false),
  lenderNoticeSentAt: z.iso.datetime({ offset: true }).optional(),
});

export const brokerOfRecordSchema = z.discriminatedUnion("recordKind", [loanBrokerOfRecordSchema, modificationBrokerOfRecordSchema]);
export type BrokerOfRecordInput = z.input<typeof brokerOfRecordSchema>;
export type BrokerOfRecord = z.output<typeof brokerOfRecordSchema>;

export function toUsuryFacts(r: z.output<typeof loanBrokerOfRecordSchema>): UsuryFacts {
  return {
    lender: r.lender,
    noteRatePct: r.noteRatePct,
    fedDiscountRatePct: r.fedDiscountRatePct,
    collateral: r.collateral,
    elements: r.elements,
    tableFundedInKuberaName: r.tableFundedInKuberaName,
    transactionDate: r.transactionDate,
  };
}

export function toModificationFacts(r: z.output<typeof modificationBrokerOfRecordSchema>): ModificationFacts {
  return {
    kind: r.recordKind,
    effectiveDate: r.effectiveDate,
    arrangedBy: r.arrangedBy,
    otherBroker: r.otherBroker,
    agreementRecitesBrokerArrangement: r.agreementRecitesBrokerArrangement,
    noteRatePct: r.noteRatePct,
    elements: r.elements,
    lenderNoticeSentAt: r.lenderNoticeSentAt,
  };
}

export type BrokerOfRecordEvaluation = { kind: "loan"; result: UsuryEvaluation } | { kind: "modification"; result: ModificationEvaluation };

export function evaluateBrokerOfRecord(input: BrokerOfRecordInput): BrokerOfRecordEvaluation {
  const r = brokerOfRecordSchema.parse(input);
  if (r.recordKind === "loan") return { kind: "loan", result: evaluateUsury(toUsuryFacts(r)) };
  return {
    kind: "modification",
    result: evaluateModification(toModificationFacts(r), { lender: r.lender, fedDiscountRatePct: r.fedDiscountRatePct, collateral: r.collateral }),
  };
}

/** Row for `public.broker_of_record` (snake_case columns from the WS-W migration). */
export function brokerOfRecordRow(input: BrokerOfRecordInput): Record<string, unknown> {
  const r = brokerOfRecordSchema.parse(input);
  const evaluation = evaluateBrokerOfRecord(r);
  const e = r.elements;
  const flags = [...new Set(evaluation.result.flags.map((f) => f.code))];
  return {
    record_kind: r.recordKind,
    lead_id: r.leadId ?? null,
    deal_id: r.dealId ?? null,
    twenty_opportunity_id: r.twentyOpportunityId ?? null,
    parent_id: r.recordKind === "loan" ? null : r.parentId,
    transaction_date: r.recordKind === "loan" ? r.transactionDate : null,
    effective_date: r.recordKind === "loan" ? null : r.effectiveDate,
    arranged_by: r.recordKind === "loan" ? "kubera" : r.arrangedBy,
    arranging_licensee_name: e.arrangingLicensee?.name ?? null,
    arranging_licensee_dre: e.arrangingLicensee?.dreLicense ?? null,
    licensee_active_at_transaction: e.arrangingLicensee?.activeAtTransaction ?? null,
    other_broker_name: r.recordKind === "loan" ? null : (r.otherBroker?.name ?? null),
    other_broker_dre: r.recordKind === "loan" ? null : (r.otherBroker?.dreLicense ?? null),
    acts_for: e.actsFor ?? null,
    engagement_agreement_ref: e.engagementAgreementRef ?? null,
    compensation_amount_usd: e.compensation?.amountUsd ?? null,
    compensation_payer: e.compensation?.payer ?? null,
    compensation_expected: e.compensation?.expected ?? null,
    closing_statement_line: e.compensation?.closingStatementLine ?? null,
    negotiation_log: e.negotiationLog,
    lender_name: r.lender.name,
    lender_category: r.lender.category,
    lender_evidence_ref: r.lender.evidenceRef ?? null,
    collateral_real_property_lien: r.collateral.realPropertyLien,
    collateral_equity_pledge_or_ucc_only: r.collateral.equityPledgeOrUccOnly,
    collateral_apn: r.collateral.apn ?? null,
    collateral_lien_position: r.collateral.lienPosition ?? null,
    business_purpose_certified: e.businessPurposeCertified,
    note_rate_pct: r.noteRatePct,
    fed_discount_rate_pct: r.fedDiscountRatePct,
    table_funded: r.recordKind === "loan" ? r.tableFunded : false,
    true_funding_source: r.recordKind === "loan" ? (r.trueFundingSource ?? null) : null,
    table_funded_in_kubera_name: r.recordKind === "loan" ? r.tableFundedInKuberaName : false,
    agreement_recites_broker_arrangement: r.recordKind === "loan" ? null : r.agreementRecitesBrokerArrangement,
    lender_notice_sent_at: r.recordKind === "loan" ? null : (r.lenderNoticeSentAt ?? null),
    officer_approved_by: e.officerApproval?.name ?? null,
    officer_approved_dre: e.officerApproval?.dreLicense ?? null,
    officer_approved_at: e.officerApproval?.approvedAt ?? null,
    mlds_signed_on: r.mldsSignedOn ?? null,
    gate_status: evaluation.result.status,
    gate_blocking: evaluation.result.blocking,
    gate_result: evaluation.result,
    flags,
  };
}
