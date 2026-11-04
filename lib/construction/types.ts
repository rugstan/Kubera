// Construction desk domain types (WS-AA). Pre-closing and post-construction
// only: Corin brokers the loan and has no role in construction draws, so
// nothing here models money movement, draw reviews, lien waivers or servicing.
// Report orders carry no fees; vendors bill the borrower directly.

import type { ProgramId } from "@/lib/sizing/types";

// Programs ------------------------------------------------------------------

export const CONSTRUCTION_PROGRAMS = [
  "HUD_221D4",
  "HUD_232_NEW_CONSTRUCTION",
  "HUD_223F",
  "HUD_232_223F",
  "AGENCY_MULTIFAMILY",
  "BANK_CONSTRUCTION",
  "DEBT_FUND_CONSTRUCTION",
  "PRIVATE_CONSTRUCTION",
  "BRIDGE",
  "HOTEL_PIP_BRIDGE",
] as const;
export type ConstructionProgram = (typeof CONSTRUCTION_PROGRAMS)[number];

export const PROGRAM_LABELS: Record<ConstructionProgram, string> = {
  HUD_221D4: "HUD 221(d)(4) new construction / substantial rehab",
  HUD_232_NEW_CONSTRUCTION: "HUD 232 new construction",
  HUD_223F: "HUD 223(f) refinance",
  HUD_232_223F: "HUD 232/223(f) refinance",
  AGENCY_MULTIFAMILY: "Fannie / Freddie multifamily",
  BANK_CONSTRUCTION: "Bank construction",
  DEBT_FUND_CONSTRUCTION: "Debt fund construction",
  PRIVATE_CONSTRUCTION: "Private construction",
  BRIDGE: "Bridge",
  HOTEL_PIP_BRIDGE: "Hotel PIP bridge",
};

export const ASSET_TYPES = ["MULTIFAMILY", "SENIOR_HOUSING", "HOTEL", "MIXED_USE", "COMMERCIAL"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const ASSET_LABELS: Record<AssetType, string> = {
  MULTIFAMILY: "Multifamily",
  SENIOR_HOUSING: "Senior housing",
  HOTEL: "Hotel",
  MIXED_USE: "Mixed use",
  COMMERCIAL: "Commercial",
};

export const PROJECT_PHASES = ["pre_closing", "under_construction", "conversion", "taken_out", "closed_out"] as const;
export type ProjectPhase = (typeof PROJECT_PHASES)[number];

export const PHASE_LABELS: Record<ProjectPhase, string> = {
  pre_closing: "Pre-closing",
  under_construction: "Under construction (lender administers)",
  conversion: "Conversion and lease-up",
  taken_out: "Take-out in progress",
  closed_out: "Closed out",
};

export type ConstructionProject = {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** Deal this project belongs to (foreign key arrives with the deals table). */
  dealId: string | null;
  leadId: string | null;
  name: string;
  program: ConstructionProgram;
  assetType: AssetType;
  phase: ProjectPhase;
  propertyAddress: string | null;
  city: string | null;
  /** Two-letter state code. */
  state: string | null;
  zip: string | null;
  units: number | null;
  /** True when the site is in a seismic hazard area, so a PML is requested. */
  seismicZone: boolean;
  /** Ground-up or substantial rehab (drives plan-and-cost review and builder's risk). */
  newConstruction: boolean;
  generalContractorName: string | null;
  generalContractorLicense: string | null;
  notes: string | null;
};

export type NewConstructionProject = Omit<ConstructionProject, "id" | "createdAt" | "updatedAt" | "phase"> & { phase?: ProjectPhase };

// Third-party reports ----------------------------------------------------------

export const REPORT_TYPES = ["seismic_pml", "plan_and_cost_review", "bpo", "builders_risk", "pcna", "phase_i"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_LABELS: Record<ReportType, string> = {
  seismic_pml: "Seismic PML",
  plan_and_cost_review: "Plan-and-cost review",
  bpo: "Broker price opinion",
  builders_risk: "Builder's risk insurance",
  pcna: "Property condition assessment (PCNA)",
  phase_i: "Phase I environmental",
};

export const REPORT_STATUSES = [
  "not_ordered",
  "order_pending_approval",
  "order_blocked",
  "ordered",
  "in_progress",
  "delivered",
  "revision_requested",
  "accepted",
  "cancelled",
] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  not_ordered: "Not ordered",
  order_pending_approval: "Waiting for broker approval",
  order_blocked: "Order not approved",
  ordered: "Ordered",
  in_progress: "In progress",
  delivered: "Delivered",
  revision_requested: "Revision requested",
  accepted: "Accepted",
  cancelled: "Cancelled",
};

export type ConstructionReport = {
  id: string;
  createdAt: string;
  updatedAt: string;
  projectId: string;
  reportType: ReportType;
  status: ReportStatus;
  vendorName: string | null;
  vendorEmail: string | null;
  /** The vendor's own order or file number. */
  vendorReference: string | null;
  orderedAt: string | null;
  dueAt: string | null;
  deliveredAt: string | null;
  acceptedAt: string | null;
  /** Document vault row holding the delivered report, once uploaded. */
  documentId: string | null;
  /** Approval queue id for the outbound order. */
  approvalId: string | null;
  /** Bumped each time a blocked order is re-requested so it gets a fresh idempotency key. */
  orderAttempt: number;
  notes: string | null;
};

// Contractor license (CSLB) ----------------------------------------------------

export const LICENSE_CHECK_STATUSES = ["clear", "issues", "not_found", "lookup_unavailable"] as const;
export type LicenseCheckStatus = (typeof LICENSE_CHECK_STATUSES)[number];

export type ContractorLicense = {
  licenseNumber: string;
  businessName: string | null;
  /** Normalized license status text from CSLB, e.g. "CLEAR", "EXPIRED", "SUSPENDED". */
  status: string;
  issueDate: string | null;
  expirationDate: string | null;
  /** Classification codes, e.g. "B", "A", "C10". */
  classifications: string[];
  bondOnFile: boolean;
  bondExpiresOn: string | null;
  workersCompStatus: "active" | "exempt" | "none" | "unknown";
  /** Public disciplinary or complaint notice present on the record. */
  disciplinaryAction: boolean;
};

export type LicenseIssue =
  | "license_not_active"
  | "license_expired"
  | "expires_within_90_days"
  | "classification_mismatch"
  | "no_bond_on_file"
  | "bond_expired"
  | "no_workers_comp"
  | "disciplinary_action";

export type ContractorLicenseCheck = {
  id: string;
  createdAt: string;
  projectId: string;
  licenseNumber: string;
  contractorName: string | null;
  status: LicenseCheckStatus;
  issues: LicenseIssue[];
  /** CSLB record at check time (null when not found or lookup unavailable). */
  snapshot: ContractorLicense | null;
  checkedAt: string;
  checkedBy: string;
};

// Conversion and payoff tracker -----------------------------------------------

export const HUD_COST_CERT_STATUSES = ["not_applicable", "not_started", "in_preparation", "submitted", "under_review", "approved"] as const;
export type HudCostCertStatus = (typeof HUD_COST_CERT_STATUSES)[number];

export const HUD_COST_CERT_LABELS: Record<HudCostCertStatus, string> = {
  not_applicable: "Not applicable",
  not_started: "Not started",
  in_preparation: "In preparation",
  submitted: "Submitted to HUD",
  under_review: "Under HUD review",
  approved: "Approved",
};

/** Where the construction loan ends up: a refinance take-out, or HUD converting in place. */
export const TAKEOUT_PATHS = ["refinance", "hud_conversion"] as const;
export type TakeoutPath = (typeof TAKEOUT_PATHS)[number];

export const PAYOFF_STATUSES = ["not_scheduled", "takeout_selected", "payoff_requested", "payoff_confirmed"] as const;
export type PayoffStatus = (typeof PAYOFF_STATUSES)[number];

export const PAYOFF_LABELS: Record<PayoffStatus, string> = {
  not_scheduled: "Not scheduled",
  takeout_selected: "Take-out lender selected",
  payoff_requested: "Payoff statement requested from lender",
  payoff_confirmed: "Payoff confirmed by lender of record",
};

export type ConstructionConversion = {
  id: string;
  createdAt: string;
  updatedAt: string;
  projectId: string;
  /** Certificate of occupancy (or temporary CO) date. */
  coDate: string | null;
  /** Unit count the occupancy metrics are measured against. */
  unitsTotal: number | null;
  /** Construction loan maturity per the lender's loan documents. */
  loanMaturityDate: string | null;
  /** Last day to exercise the lender's extension option, when there is one. */
  extensionDeadline: string | null;
  takeoutPath: TakeoutPath;
  hudCostCertStatus: HudCostCertStatus;
  hudCostCertSubmittedAt: string | null;
  hudCostCertApprovedAt: string | null;
  payoffStatus: PayoffStatus;
  payoffTargetDate: string | null;
  payoffConfirmedAt: string | null;
  notes: string | null;
};

export type LeaseUpSnapshot = {
  id: string;
  createdAt: string;
  conversionId: string;
  asOf: string;
  unitsLeased: number;
  unitsOccupied: number;
  /** Average in-place monthly rent per occupied unit. */
  avgMonthlyRent: number | null;
  /** Trailing three-month NOI, annualized. */
  noiT3Annualized: number | null;
};

export const TAKEOUT_STATUSES = ["triggered", "deal_created", "dismissed"] as const;
export type TakeoutStatus = (typeof TAKEOUT_STATUSES)[number];

export type TakeoutProgramRef = Extract<ProgramId, "HUD_232_223F" | "HUD_221D4_223F_MULTIFAMILY" | "AGENCY_FANNIE_FREDDIE" | "HOSPITALITY_CMBS_NON_RECOURSE"> | "BANK_LIFE_CO";

export type TakeoutReason = "stabilized_occupancy" | "maturity_runway" | "extension_deadline" | "manual";

export type ConstructionTakeout = {
  id: string;
  createdAt: string;
  updatedAt: string;
  conversionId: string;
  status: TakeoutStatus;
  reasons: TakeoutReason[];
  suggestedPrograms: TakeoutProgramRef[];
  /** The new deal opened for refinance outreach. */
  newDealId: string | null;
  triggeredAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
};

// Audit trail -------------------------------------------------------------------

export type ConstructionEvent = {
  projectId: string;
  occurredAt: string;
  eventType: string;
  actor: string;
  detail: Record<string, unknown>;
};

// Staff -------------------------------------------------------------------------

export type StaffRole = "admin" | "broker" | "analyst";
export type StaffIdentity = { id: string; email: string; role: StaffRole };
