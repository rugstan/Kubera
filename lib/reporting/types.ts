// Business reporting over the deal desk: pipeline by stage, time in stage, fee
// forecast from the ledger, lender hit rate and lead-source ROI.
//
// Broker only (Global rule 1): every amount is Kubera's own compensation as
// recorded in fee_ledger (integer cents) or Kubera's own marketing spend.
// Loan amounts are the requested loan size, shown for pipeline volume; Kubera
// never holds, moves or disburses any of it. Reports are read-only.

import type { FeeEntryKind, FeePayee, FeePayer, FeeStatus, OutreachStatus } from "@/lib/deals/types";

export type ReportDeal = {
  id: string;
  title: string;
  /** DealProgram key, or null for legacy rows without one. */
  program: string | null;
  stage: string;
  /** Pipeline status: active, on_hold, held_for_counsel, won, lost, withdrawn. */
  status: string;
  loanAmountCents: number | null;
  leadId: string | null;
  createdAt: string;
  stageEnteredAt: string | null;
  /** YYYY-MM-DD. */
  closedOn: string | null;
};

/** The deal entered `stage` at `at` (from the audit trail: the INSERT and every stage change). */
export type StageEntry = { dealId: string; stage: string; at: string };

export type ReportFee = {
  id: string;
  dealId: string;
  entryKind: FeeEntryKind;
  payer: FeePayer;
  payee: FeePayee;
  status: FeeStatus;
  amountCents: number;
  /** YYYY-MM-DD the compensation was earned (null until then). */
  earnedOn: string | null;
  createdAt: string;
  invoiceId: string | null;
};

export type ReportInvoice = {
  id: string;
  dealId: string;
  number: string;
  status: "draft" | "pending_approval" | "issued" | "settled" | "void";
  totalCents: number;
  lines: { feeEntryId: string; amountCents: number }[];
};

export type ReportOutreach = {
  id: string;
  dealId: string;
  lenderId: string;
  status: OutreachStatus;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
};

export type ReportLender = { id: string; name: string; category: string; brokerFriendly: boolean };

export type ReportLead = { id: string; source: string; createdAt: string };

/** Kubera's marketing spend on one lead source for a period (lead_source_costs). */
export type SourceCost = { source: string; periodStart: string; periodEnd: string; spendCents: number };

export type ReportingData = {
  deals: ReportDeal[];
  stageEntries: StageEntry[];
  fees: ReportFee[];
  invoices: ReportInvoice[];
  outreach: ReportOutreach[];
  lenders: ReportLender[];
  leads: ReportLead[];
  costs: SourceCost[];
};

export interface ReportingSource {
  load(): Promise<ReportingData>;
}

export function emptyData(): ReportingData {
  return { deals: [], stageEntries: [], fees: [], invoices: [], outreach: [], lenders: [], leads: [], costs: [] };
}

/** Reporting window as California calendar dates, inclusive. */
export type ReportWindow = { key: RangeKey; label: string; from: string; to: string };

export const RANGE_KEYS = ["30d", "90d", "365d", "ytd"] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];
