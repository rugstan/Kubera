// Row mapping between deal-desk records (camelCase) and their snake_case
// columns. Only top-level keys convert; jsonb values pass through untouched.

import type { BrokerOfRecordElements, LenderCategory } from "@/lib/compliance/schemas";
import type { LoanBrokerOfRecord } from "./types";

export type Row = Record<string, unknown>;

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const camel = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

export function toRow(obj: object): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[snake(k)] = v;
  return out;
}

export function fromRow<T>(row: Row, numeric: string[] = []): T {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[camel(k)] = v;
  for (const k of numeric) if (out[k] !== null && out[k] !== undefined) out[k] = Number(out[k]);
  return out as T;
}

/** Maps a WS-W `broker_of_record` loan row back to the gate-H facts. */
export function loanBrokerOfRecordFromRow(r: Row): LoanBrokerOfRecord {
  const str = (k: string) => (r[k] === null || r[k] === undefined ? undefined : String(r[k]));
  const elements: BrokerOfRecordElements = {
    ...(r.arranging_licensee_name && r.arranging_licensee_dre
      ? { arrangingLicensee: { name: String(r.arranging_licensee_name), dreLicense: String(r.arranging_licensee_dre), activeAtTransaction: Boolean(r.licensee_active_at_transaction) } }
      : {}),
    ...(r.acts_for ? { actsFor: r.acts_for as "borrower" | "lender" | "borrower_and_lender" } : {}),
    ...(r.engagement_agreement_ref ? { engagementAgreementRef: String(r.engagement_agreement_ref) } : {}),
    ...(r.compensation_amount_usd !== null && r.compensation_amount_usd !== undefined && r.compensation_payer
      ? { compensation: { amountUsd: Number(r.compensation_amount_usd), payer: r.compensation_payer as "borrower" | "lender" | "borrower_and_lender", expected: r.compensation_expected !== false } }
      : {}),
    negotiationLog: (r.negotiation_log as BrokerOfRecordElements["negotiationLog"]) ?? [],
    businessPurposeCertified: Boolean(r.business_purpose_certified),
    ...(r.officer_approved_by && r.officer_approved_dre && r.officer_approved_at
      ? { officerApproval: { name: String(r.officer_approved_by), dreLicense: String(r.officer_approved_dre), approvedAt: new Date(String(r.officer_approved_at)).toISOString() } }
      : {}),
  };
  return {
    id: String(r.id),
    dealId: str("deal_id") ?? null,
    leadId: str("lead_id") ?? null,
    lender: { name: String(r.lender_name), category: r.lender_category as LenderCategory, ...(r.lender_evidence_ref ? { evidenceRef: String(r.lender_evidence_ref) } : {}) },
    noteRatePct: Number(r.note_rate_pct),
    fedDiscountRatePct: Number(r.fed_discount_rate_pct),
    collateral: {
      realPropertyLien: Boolean(r.collateral_real_property_lien),
      equityPledgeOrUccOnly: Boolean(r.collateral_equity_pledge_or_ucc_only),
      ...(r.collateral_apn ? { apn: String(r.collateral_apn) } : {}),
      ...(r.collateral_lien_position ? { lienPosition: Number(r.collateral_lien_position) } : {}),
    },
    elements,
    tableFundedInKuberaName: Boolean(r.table_funded_in_kubera_name),
    transactionDate: String(r.transaction_date),
  };
}
