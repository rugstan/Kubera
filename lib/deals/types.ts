// Deal desk record types shared by the stage engine, ledger, packages,
// outreach, modifications, Form 159 and DRE reporting. Money is integer cents
// everywhere (no floating-point sums on compensation).
//
// Broker only (Global rule 1): every amount here is Kubera's own compensation
// (or a co-broker / referral partner's share of it) as recorded on the lender's
// closing statement. Nothing models holding, moving or paying out loan funds.

import type { ModificationEvaluation } from "@/lib/compliance/gates";
import type { BrokerOfRecordElements, LenderCategory, ModificationFacts } from "@/lib/compliance/schemas";
import type { EsignProviderName } from "@/lib/esign/types";
import type { Form159Data } from "./form159";

/** Deal-desk programs. Each has a stage template (lib/deals/stages.ts). */
export const dealPrograms = [
  "HUD_232",
  "HUD_MULTIFAMILY",
  "SBA_7A",
  "SBA_504",
  "HOTEL_CMBS",
  "PIP_BRIDGE",
  "AGENCY",
  "BANK_LIFE_CO",
  "PRIVATE_BRIDGE",
  "HARD_MONEY",
  "CONSTRUCTION",
] as const;
export type DealProgram = (typeof dealPrograms)[number];

export const DEAL_PROGRAM_LABELS: Record<DealProgram, string> = {
  HUD_232: "HUD 232 / 223(f) senior housing",
  HUD_MULTIFAMILY: "HUD multifamily 223(f) / 221(d)(4) / 223(a)(7)",
  SBA_7A: "SBA 7(a)",
  SBA_504: "SBA 504",
  HOTEL_CMBS: "Hotel CMBS",
  PIP_BRIDGE: "PIP bridge",
  AGENCY: "Fannie Mae / Freddie Mac agency",
  BANK_LIFE_CO: "Bank / life company",
  PRIVATE_BRIDGE: "Private bridge",
  HARD_MONEY: "Hard money",
  CONSTRUCTION: "Construction",
};

export function isSbaProgram(p: DealProgram): p is "SBA_7A" | "SBA_504" {
  return p === "SBA_7A" || p === "SBA_504";
}

/** Pipeline status (deals.status). Terminal stages settle it; sanctions holds pause it. */
export const dealStatuses = ["active", "on_hold", "held_for_counsel", "won", "lost", "withdrawn"] as const;
export type DealStatus = (typeof dealStatuses)[number];
/** Statuses of a deal that is still being worked (counted in the pipeline's open deals). */
export const OPEN_DEAL_STATUSES: readonly DealStatus[] = ["active", "on_hold", "held_for_counsel"];

export type Deal = {
  id: string;
  title: string;
  program: DealProgram;
  stage: string;
  /** Pipeline status: active, paused by a hold, or settled by a terminal stage. */
  status: DealStatus;
  stageTemplateVersion: number;
  stageEnteredAt: string;
  leadId: string | null;
  twentyOpportunityId: string | null;
  ownerId: string | null;
  borrowerName: string | null;
  propertyAddress: string | null;
  propertyState: string | null;
  loanAmountCents: number | null;
  /** Any lien on real property secures the loan (drives MLDS and the DRE threshold counter). */
  collateralRealProperty: boolean | null;
  /** Vault reference of the signed engagement / fee agreement. */
  engagementAgreementRef: string | null;
  termSheetAcceptedAt: string | null;
  /** Field names frozen at term-sheet acceptance. */
  lockedFields: string[];
  /** Snapshot of the accepted economic terms (rate, term, amortization, fees). */
  lockedTerms: Record<string, unknown> | null;
  /** Modification id that authorized the latest change to locked terms. */
  lockOverrideRef: string | null;
  closedOn: string | null;
  /** Idempotency key of the process that opened the deal (e.g. a construction take-out); unique. */
  originKey: string | null;
  recordVersion: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
};

export type NewDeal = Pick<Deal, "title" | "program"> &
  Partial<Pick<Deal, "leadId" | "twentyOpportunityId" | "ownerId" | "borrowerName" | "propertyAddress" | "propertyState" | "loanAmountCents" | "collateralRealProperty" | "engagementAgreementRef" | "originKey">>;

// ---------------------------------------------------------------------------
// Lender panel

export const feeSplitKinds = ["none", "percent_of_loan", "percent_of_lender_fee", "flat"] as const;
export type FeeSplitKind = (typeof feeSplitKinds)[number];

export type LenderPanelEntry = {
  id: string;
  partnerId: string | null;
  name: string;
  category: LenderCategory;
  categoryEvidenceRef: string | null;
  programs: DealProgram[];
  minLoanCents: number | null;
  maxLoanCents: number | null;
  /** Two-letter states the lender lends in; empty = nationwide. */
  states: string[];
  assetTypes: string[];
  appetiteNotes: string | null;
  brokerFriendly: boolean;
  feeSplitKind: FeeSplitKind;
  /** Percent (e.g. 0.5 = 0.5%) for percent kinds, cents for "flat". */
  feeSplitValue: number;
  feeAgreementRef: string | null;
  contactName: string | null;
  contactEmail: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
};

export type NewLender = Omit<LenderPanelEntry, "id" | "createdAt" | "updatedAt" | "updatedBy">;

// ---------------------------------------------------------------------------
// Packages, share links, outreach

export type PackageItem = {
  /** Vault document id (public.documents) or another stable id. */
  documentId: string;
  label: string;
  kind: string;
  storagePath: string;
  sha256: string;
};

export type DealPackage = {
  id: string;
  dealId: string;
  version: number;
  status: "draft" | "locked";
  manifest: PackageItem[];
  manifestSha256: string;
  lockedAt: string | null;
  lockedBy: string | null;
  createdAt: string;
};

export type ShareLink = {
  id: string;
  dealId: string;
  lenderId: string;
  packageId: string;
  packageVersion: number;
  tokenHash: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  revokeReason: string | null;
  accessCount: number;
  lastAccessedAt: string | null;
};

export const outreachStatuses = ["pending_approval", "approved", "sent", "rejected", "expired", "declined", "term_sheet", "withdrawn"] as const;
export type OutreachStatus = (typeof outreachStatuses)[number];

export type LenderOutreach = {
  id: string;
  dealId: string;
  lenderId: string;
  packageId: string;
  packageVersion: number;
  shareLinkId: string | null;
  status: OutreachStatus;
  approvalKey: string;
  approvalId: string | null;
  approvedBy: string | null;
  requestedBy: string;
  sentAt: string | null;
  externalMessageId: string | null;
  responseNote: string | null;
  termSheetRef: string | null;
  staleLenderOverride: boolean;
  createdAt: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Fee ledger and invoices

export const feeEntryKinds = [
  "broker_fee",
  "lender_paid_compensation",
  "agency_split",
  "hard_money_points",
  "extension_fee",
  "modification_fee",
  "sba_packaging_fee",
  "referral_fee",
  "co_broker_split",
] as const;
export type FeeEntryKind = (typeof feeEntryKinds)[number];

export const FEE_ENTRY_LABELS: Record<FeeEntryKind, string> = {
  broker_fee: "Broker fee",
  lender_paid_compensation: "Lender-paid compensation",
  agency_split: "Agency origination split",
  hard_money_points: "Hard money broker points",
  extension_fee: "Extension fee (broker-arranged)",
  modification_fee: "Modification fee (broker-arranged)",
  sba_packaging_fee: "SBA application packaging fee",
  referral_fee: "Referral fee",
  co_broker_split: "Co-broker split",
};

export type FeePayer = "borrower" | "lender" | "kubera";
export type FeePayee = "kubera" | "co_broker" | "referral_partner";
export type FeeBasis = "flat" | "percent_of_loan" | "points" | "percent_of_lender_fee";
export const feeStatuses = ["projected", "earned", "invoiced", "settled", "void"] as const;
export type FeeStatus = (typeof feeStatuses)[number];
export type Sba159Category = "packaging" | "other_services" | "referral";

export type FeeEntry = {
  id: string;
  dealId: string;
  entryKind: FeeEntryKind;
  payer: FeePayer;
  payee: FeePayee;
  basis: FeeBasis;
  ratePct: number | null;
  baseCents: number | null;
  amountCents: number;
  status: FeeStatus;
  sba159Category: Sba159Category | null;
  description: string;
  counterparty: string | null;
  earnedOn: string | null;
  invoiceId: string | null;
  modificationId: string | null;
  idempotencyKey: string;
  voidReason: string | null;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
};

export type NewFeeEntry = Omit<FeeEntry, "id" | "status" | "invoiceId" | "voidReason" | "createdAt" | "updatedAt" | "updatedBy" | "earnedOn" | "counterparty" | "modificationId" | "sba159Category"> &
  Partial<Pick<FeeEntry, "status" | "earnedOn" | "counterparty" | "modificationId" | "sba159Category">>;

export type InvoiceLine = { feeEntryId: string; description: string; amountCents: number };

export const invoiceStatuses = ["draft", "pending_approval", "issued", "settled", "void"] as const;
export type InvoiceStatus = (typeof invoiceStatuses)[number];

export type Invoice = {
  id: string;
  dealId: string;
  number: string;
  billToKind: "borrower" | "lender";
  billToName: string;
  billToEmail: string | null;
  status: InvoiceStatus;
  lines: InvoiceLine[];
  totalCents: number;
  issuedAt: string | null;
  dueOn: string | null;
  settledOn: string | null;
  closingStatementRef: string | null;
  approvalKey: string | null;
  approvalId: string | null;
  documentSha256: string | null;
  voidReason: string | null;
  createdAt: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Audit

export type AuditEntry = {
  id: number;
  occurredAt: string;
  tableName: string;
  rowId: string;
  dealId: string | null;
  action: "INSERT" | "UPDATE" | "DELETE";
  actor: string;
  changed: string[];
};

export type Clock = () => Date;

// ---------------------------------------------------------------------------
// Modifications (gate H), Form 159, DRE reporting

export type ModificationKind = "forbearance" | "extension" | "modification";

export const modificationStatuses = ["held_for_counsel", "blocked", "incomplete", "pending_lender_notice", "no_exemption_representation", "documented", "withdrawn"] as const;
export type ModificationStatus = (typeof modificationStatuses)[number];

export type ModificationRecord = {
  id: string;
  dealId: string;
  kind: ModificationKind;
  status: ModificationStatus;
  parentBrokerOfRecordId: string;
  brokerOfRecordId: string | null;
  facts: ModificationFacts;
  evaluation: ModificationEvaluation;
  flags: string[];
  lenderNoticeApprovalKey: string | null;
  lenderNoticeSentAt: string | null;
  officerApprovedBy: string | null;
  officerApprovedAt: string | null;
  feeEntryId: string | null;
  termsAppliedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** The loan-level broker-of-record file (WS-W `broker_of_record`, record_kind = 'loan'). */
export type LoanBrokerOfRecord = {
  id: string;
  dealId: string | null;
  leadId: string | null;
  lender: { name: string; category: LenderCategory; evidenceRef?: string };
  noteRatePct: number;
  fedDiscountRatePct: number;
  collateral: { realPropertyLien: boolean; equityPledgeOrUccOnly: boolean; apn?: string; lienPosition?: number };
  elements: BrokerOfRecordElements;
  tableFundedInKuberaName: boolean;
  transactionDate: string;
};

export type Form159Status = "generated" | "pending_approval" | "sent" | "signed" | "superseded";

export type Form159Record = {
  id: string;
  dealId: string;
  version: number;
  sbaProgram: "7A" | "504";
  status: Form159Status;
  data: Form159Data;
  ledgerEntryIds: string[];
  flags: string[];
  templateVersion: string;
  draft: boolean;
  documentSha256: string;
  documentPath: string | null;
  approvalKey: string | null;
  approvalId: string | null;
  provider: EsignProviderName | null;
  providerRequestId: string | null;
  sentAt: string | null;
  signedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DreReportKind = "threshold_monitor" | "RE853" | "RE860" | "RE881";

export type DreReport = {
  id: string;
  reportKind: DreReportKind;
  asOf: string;
  periodStart: string;
  periodEnd: string;
  counters: Record<string, unknown>;
  thresholdMet: boolean;
  firstMetOn: string | null;
  notifyBy: string | null;
  notifiedOn: string | null;
  export: Record<string, unknown> | null;
  createdAt: string;
  createdBy: string;
};
