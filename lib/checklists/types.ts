// Deal checklist vocabulary (WS-U). Kubera brokers the loan, so every item is
// something the borrower, a vendor, title/escrow or the lender of record
// provides before closing. Nothing here tracks money movement or construction
// draws (Global rule 1): the checklists stop at closing.

export const CHECKLIST_PROGRAMS = [
  "HUD_232_223F",
  "HUD_232_NEW_CONSTRUCTION",
  "HUD_MULTIFAMILY_223F",
  "HUD_221D4",
  "SBA_7A",
  "SBA_504",
  "HOTEL_CMBS",
  "PIP_BRIDGE",
  "AGENCY_MULTIFAMILY",
  "BRIDGE",
  "HARD_MONEY",
  "CONSTRUCTION",
] as const;
export type ChecklistProgram = (typeof CHECKLIST_PROGRAMS)[number];

export const PROGRAM_LABEL: Record<ChecklistProgram, string> = {
  HUD_232_223F: "HUD Section 232/223(f) (senior housing and healthcare)",
  HUD_232_NEW_CONSTRUCTION: "HUD Section 232 new construction",
  HUD_MULTIFAMILY_223F: "HUD 223(f) multifamily",
  HUD_221D4: "HUD 221(d)(4) multifamily construction",
  SBA_7A: "SBA 7(a)",
  SBA_504: "SBA 504",
  HOTEL_CMBS: "Hotel CMBS",
  PIP_BRIDGE: "Hotel PIP bridge",
  AGENCY_MULTIFAMILY: "Fannie Mae / Freddie Mac multifamily",
  BRIDGE: "Bridge",
  HARD_MONEY: "Hard money",
  CONSTRUCTION: "Construction",
};

export const CHECKLIST_CATEGORIES = ["entity", "principal", "financial", "property", "third_party", "construction", "title_insurance", "program"] as const;
export type ChecklistCategory = (typeof CHECKLIST_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<ChecklistCategory, string> = {
  entity: "Borrowing entity",
  principal: "Principals and guarantors",
  financial: "Property financials",
  property: "Property",
  third_party: "Third-party reports",
  construction: "Construction (pre-closing)",
  title_insurance: "Title and insurance",
  program: "Program forms",
};

/** Who supplies the item. "lender" means the lender of record (Kubera is never the lender). */
export const RESPONSIBLE_PARTIES = ["borrower", "kubera", "lender", "vendor", "title_escrow"] as const;
export type ResponsibleParty = (typeof RESPONSIBLE_PARTIES)[number];

export const CHECKLIST_STAGES = ["application", "underwriting", "pre_closing"] as const;
export type ChecklistStage = (typeof CHECKLIST_STAGES)[number];

/**
 * Principal-level requirements. An item with `perPrincipal` expands into one
 * instance per principal that owes it under lib/principals/requirements.ts.
 */
export const PRINCIPAL_REQUIREMENTS = ["pfs", "reo_schedule", "credit_authorization", "government_id", "form_1919", "hud_2530", "guaranty", "resume"] as const;
export type PrincipalRequirement = (typeof PRINCIPAL_REQUIREMENTS)[number];

/** documents.kind values an item maps to (init migration check constraint). */
export const DOCUMENT_KINDS = ["T12", "RENT_ROLL", "CENSUS", "STR_REPORT", "FRANCHISE_AGREEMENT", "PIP_BUDGET", "PFS", "TAX_RETURN", "APPRAISAL", "OTHER"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export type ChecklistItemDef = {
  /** Stable snake_case key, unique within a template. */
  key: string;
  title: string;
  /** Plain-language description shown to the borrower. */
  description: string;
  category: ChecklistCategory;
  responsible: ResponsibleParty;
  stage: ChecklistStage;
  /** Required before closing. Optional items never block. */
  required: boolean;
  /** The borrower can upload this item in the portal. */
  upload: boolean;
  /** Expands into one instance per principal that owes this requirement. */
  perPrincipal?: PrincipalRequirement;
  docKind?: DocumentKind;
  /** The item must be dated within this many days of closing (e.g. a T-12 or credit report). */
  recencyDays?: number;
  /** A staff-side public-record verification attached to this item. */
  lookup?: "cslb_license";
  /** Program source; every source carries VERIFY until counsel/underwriting confirms it. */
  reference?: string;
};

export type ChecklistTemplate = {
  program: ChecklistProgram;
  /** Bumped whenever items change; deal checklists keep the version they were created from. */
  version: string;
  title: string;
  items: readonly ChecklistItemDef[];
};

export const ITEM_STATUSES = ["requested", "submitted", "under_review", "accepted", "rejected", "waived", "not_applicable"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  requested: "Requested",
  submitted: "Received",
  under_review: "In review",
  accepted: "Accepted",
  rejected: "Needs attention",
  waived: "Waived",
  not_applicable: "Not applicable",
};

/** Statuses that satisfy an item for closing. */
export const SATISFIED_STATUSES: readonly ItemStatus[] = ["accepted", "waived", "not_applicable"];

export type DealChecklist = {
  id: string;
  dealId: string;
  leadId: string | null;
  program: ChecklistProgram;
  templateVersion: string;
  title: string;
  createdAt: string;
  createdBy: string;
  closedAt: string | null;
};

export type DealChecklistItem = {
  id: string;
  checklistId: string;
  dealId: string;
  /** Template key, plus `:<principalId>` for per-principal instances. */
  itemKey: string;
  templateKey: string;
  principalId: string | null;
  title: string;
  description: string;
  category: ChecklistCategory;
  responsible: ResponsibleParty;
  stage: ChecklistStage;
  required: boolean;
  upload: boolean;
  docKind: DocumentKind | null;
  recencyDays: number | null;
  lookup: "cslb_license" | null;
  status: ItemStatus;
  /** Date printed on the document (statement date, report date) for recency checks. */
  documentDate: string | null;
  dueDate: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  waivedReason: string | null;
  /** Result of a public-record lookup (e.g. CSLB license status). */
  verification: Record<string, unknown> | null;
  sortOrder: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export const FILE_STATUSES = ["pending_upload", "uploaded", "rejected"] as const;
export type FileStatus = (typeof FILE_STATUSES)[number];

export type ChecklistItemFile = {
  id: string;
  itemId: string;
  dealId: string;
  storagePath: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  status: FileStatus;
  uploadedBy: string;
  rejectReason: string | null;
  createdAt: string;
  uploadedAt: string | null;
};
