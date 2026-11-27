// Lender-ready deal submission: the frozen contract (spec section 3.7).
//
// One structured profile per deal (deal_submission_profiles), a sponsor
// summary (deal_sponsor_profiles, personal), the immutable one-page summaries
// a lender was shown (deal_summaries), and the readiness / email record on
// each lender_outreach row. Migration: 20261105160000_int_deal_submission.sql.
//
// Units, everywhere in this module:
//   *Cents      integer cents (bigint columns), never dollars.
//   *Pct        percent 0–100 (68.5 = 68.5%), never a fraction.
//   ratio "x"   plain number (1.25 = 1.25x).
//   dates       IsoDate "YYYY-MM-DD"; timestamps IsoTimestamp (ISO 8601).
// Records reused as-is from other modules keep their own units and say so:
// `hardMoney` (HmUnderwriting) and `reoSummary` (ReoSummary) are in dollars.
//
// Broker only (Global rule 1): reserve and budget fields record what the
// borrower asks the lender for. Nothing here holds, schedules or releases
// money. Ratios are computed (lib/deals/submission/metrics.ts), never typed.
// No field exists for age, sex, marital status, race, religion, national
// origin, public assistance or citizenship (fair lending, spec 6.5).

import type { ChecklistStage, DealChecklistItem, ItemStatus, PrincipalRequirement } from "@/lib/checklists/types";
import type { HmUnderwriting } from "@/lib/checklists/hm-underwriting";
import type { ConstructionProject, ConstructionReport, ContractorLicenseCheck, LicenseCheckStatus } from "@/lib/construction/types";
import type { ReoSummary } from "@/lib/principals/financials";
import type { Principal } from "@/lib/principals/types";
import { PROPERTY_TYPES } from "@/lib/property-types";
import type { SpreadKind } from "@/lib/spreads/store";
import type { SavedPackageSpreads } from "@/lib/spreads/workflow";
import { creditBands, type Intake } from "@/lib/validation";
import type { Staleness } from "../lenders";
import type { LenderLoanType } from "../loan-types";
import type { Deal, DealProgram, LenderPanelEntry } from "../types";

/** "YYYY-MM-DD". */
export type IsoDate = string;
/** ISO 8601 timestamp. */
export type IsoTimestamp = string;

// ---------------------------------------------------------------------------
// Playbooks and stages

/** Mirrors the deal_submission_profiles.playbook check list (playbooks.test.ts proves it). */
export const submissionPlaybooks = [
  "construction",
  "bridge",
  "hard_money",
  "fix_flip",
  "dscr_rental",
  "sba_7a",
  "sba_504",
  "hud_multifamily",
  "hud_232",
  "agency",
  "cmbs",
  "hotel_cmbs",
  "hotel_pip_bridge",
  "bank",
  "life_company",
  "mezz_pref",
  "c_pace",
] as const;
export type SubmissionPlaybook = (typeof submissionPlaybooks)[number];

export function isSubmissionPlaybook(v: unknown): v is SubmissionPlaybook {
  return typeof v === "string" && (submissionPlaybooks as readonly string[]).includes(v);
}

/** What the lender is asked for: a soft quote / LOI, a term sheet, or full underwriting. */
export const targetStages = ["screen", "term_sheet", "underwrite"] as const;
export type TargetStage = (typeof targetStages)[number];

export const TARGET_STAGE_LABELS: Record<TargetStage, string> = {
  screen: "Screen (soft quote)",
  term_sheet: "Term sheet",
  underwrite: "Underwrite",
};

export function isTargetStage(v: unknown): v is TargetStage {
  return typeof v === "string" && (targetStages as readonly string[]).includes(v);
}

/** Editor sections, in display order (spec 4.2). Visibility per playbook: playbooks.ts. */
export const submissionSections = [
  "loan_request",
  "property",
  "value",
  "financials",
  "sponsor",
  "plan_exit",
  "sources_uses",
  "construction",
  "rehab",
  "rental",
  "sba",
  "hotel",
  "tenancy",
  "agency",
  "hud",
  "capital_stack",
  "documents",
] as const;
export type SectionId = (typeof submissionSections)[number];

// ---------------------------------------------------------------------------
// Column enums (each list mirrors a check constraint in the migration; playbooks.test.ts proves it)

export const loanPurposes = ["acquisition", "refinance", "cash_out_refinance", "construction", "renovation", "recapitalization"] as const;
export type LoanPurpose = (typeof loanPurposes)[number];
export const LOAN_PURPOSE_LABELS: Record<LoanPurpose, string> = {
  acquisition: "Acquisition",
  refinance: "Refinance",
  cash_out_refinance: "Cash-out refinance",
  construction: "Construction",
  renovation: "Renovation",
  recapitalization: "Recapitalization",
};
/** Purposes that pay off existing debt (request.existing_debt applies). */
export const REFINANCE_PURPOSES: readonly LoanPurpose[] = ["refinance", "cash_out_refinance", "recapitalization"];

export const rateTypes = ["fixed", "floating", "either"] as const;
export type RateType = (typeof rateTypes)[number];
export const RATE_TYPE_LABELS: Record<RateType, string> = { fixed: "Fixed", floating: "Floating", either: "Fixed or floating" };

/** Recourse the borrower is asking for (same vocabulary as credit boxes, lib/agents/lenders/types.ts). */
export const recourseOptions = ["full", "partial", "non_recourse", "negotiable"] as const;
export type RecourseRequest = (typeof recourseOptions)[number];
export const RECOURSE_LABELS: Record<RecourseRequest, string> = {
  full: "Full recourse",
  partial: "Partial recourse",
  non_recourse: "Non-recourse (standard carve-outs)",
  negotiable: "Recourse negotiable",
};

/** "assessment" = C-PACE, collected with property taxes. */
export const submissionLienPositions = ["first", "second", "mezzanine", "assessment"] as const;
export type SubmissionLienPosition = (typeof submissionLienPositions)[number];
export const LIEN_POSITION_LABELS: Record<SubmissionLienPosition, string> = {
  first: "First lien",
  second: "Second lien",
  mezzanine: "Mezzanine (equity pledge)",
  assessment: "Property-tax assessment (C-PACE)",
};

/** Property types a lead can name (lib/property-types.ts) plus land and 1–4 unit houses. The column checks only the shape. */
export const submissionAssetTypes = [...PROPERTY_TYPES, "LAND", "SFR_1_4"] as const;
export type SubmissionAssetType = (typeof submissionAssetTypes)[number];
export const SUBMISSION_ASSET_TYPE_LABELS: Record<SubmissionAssetType, string> = {
  ASSISTED_LIVING: "Assisted living",
  MEMORY_CARE: "Memory care",
  RCFE: "Residential care facility for the elderly",
  SNF: "Skilled nursing facility",
  HOTEL_FLAGGED: "Hotel (flagged)",
  HOTEL_BOUTIQUE: "Hotel (boutique / independent)",
  HOTEL_TO_SENIOR_CONVERSION: "Hotel-to-senior-housing conversion",
  MULTIFAMILY: "Multifamily",
  MIXED_USE: "Mixed use",
  COMMERCIAL: "Commercial",
  RESIDENTIAL_2_4: "2–4 unit residential",
  OFFICE: "Office",
  INDUSTRIAL: "Industrial",
  RETAIL: "Retail",
  SELF_STORAGE: "Self storage",
  MEDICAL_OFFICE: "Medical office",
  MANUFACTURED_HOUSING: "Manufactured housing community",
  LAND: "Land",
  SFR_1_4: "1–4 unit house",
};

export function isSubmissionAssetType(v: unknown): v is SubmissionAssetType {
  return typeof v === "string" && (submissionAssetTypes as readonly string[]).includes(v);
}

export const sizeUnits = ["units", "beds", "keys", "sf", "pads", "lots", "acres"] as const;
export type SizeUnit = (typeof sizeUnits)[number];
export const SIZE_UNIT_LABELS: Record<SizeUnit, string> = { units: "units", beds: "beds", keys: "keys", sf: "SF", pads: "pads", lots: "lots", acres: "acres" };

export const tenancyKinds = ["single_tenant", "multi_tenant", "owner_user", "not_applicable"] as const;
export type Tenancy = (typeof tenancyKinds)[number];
export const TENANCY_LABELS: Record<Tenancy, string> = {
  single_tenant: "Single tenant",
  multi_tenant: "Multi-tenant",
  owner_user: "Owner-user",
  not_applicable: "Not applicable",
};

export const asIsValueSources = ["appraisal", "bpo", "broker_opinion", "purchase_price", "comparable_sales", "sponsor_estimate"] as const;
export type AsIsValueSource = (typeof asIsValueSources)[number];
export const stabilizedValueSources = ["appraisal", "bpo", "broker_opinion", "comparable_sales", "sponsor_estimate"] as const;
export type StabilizedValueSource = (typeof stabilizedValueSources)[number];
export const VALUE_SOURCE_LABELS: Record<AsIsValueSource, string> = {
  appraisal: "Appraisal",
  bpo: "Broker price opinion",
  broker_opinion: "Corin broker opinion of value",
  purchase_price: "Purchase price",
  comparable_sales: "Comparable sales",
  sponsor_estimate: "Sponsor estimate",
};

export const noiBases = ["t12", "t3_annualized", "fiscal_year", "borrower_stated"] as const;
export type NoiBasis = (typeof noiBases)[number];
export const NOI_BASIS_LABELS: Record<NoiBasis, string> = {
  t12: "Trailing 12 months",
  t3_annualized: "Trailing 3 months, annualized",
  fiscal_year: "Fiscal year",
  borrower_stated: "Stated by the borrower",
};

export const exitStrategies = ["sale", "refinance", "construction_to_permanent", "hold_to_maturity", "not_applicable"] as const;
export type ExitStrategy = (typeof exitStrategies)[number];
export const EXIT_STRATEGY_LABELS: Record<ExitStrategy, string> = {
  sale: "Sale",
  refinance: "Refinance",
  construction_to_permanent: "Construction-to-permanent conversion",
  hold_to_maturity: "Hold to maturity",
  not_applicable: "Not applicable",
};

// ---------------------------------------------------------------------------
// jsonb shapes on deal_submission_profiles (validated by schema.ts with zod)

/** One staff-stated weakness and how it is mitigated (risks jsonb; at most 12). */
export type RiskItem = { risk: string; mitigant: string };

export const sourceKinds = ["senior_loan", "subordinate_debt", "c_pace", "sponsor_equity", "investor_equity", "seller_credit", "land_equity", "other"] as const;
export type SourceKind = (typeof sourceKinds)[number];
export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  senior_loan: "Senior loan",
  subordinate_debt: "Subordinate debt",
  c_pace: "C-PACE",
  sponsor_equity: "Sponsor equity",
  investor_equity: "Investor equity",
  seller_credit: "Seller credit",
  land_equity: "Land equity",
  other: "Other",
};

export const useKinds = [
  "purchase_price",
  "payoff",
  "land",
  "hard_costs",
  "soft_costs",
  "contingency",
  "developer_fee",
  "renovation",
  "ffe",
  "closing_costs",
  "financing_costs",
  "interest_reserve",
  "operating_reserve",
  "cash_out",
  "other",
] as const;
export type UseKind = (typeof useKinds)[number];
export const USE_KIND_LABELS: Record<UseKind, string> = {
  purchase_price: "Purchase price",
  payoff: "Payoff of existing debt",
  land: "Land",
  hard_costs: "Hard costs",
  soft_costs: "Soft costs",
  contingency: "Contingency",
  developer_fee: "Developer fee",
  renovation: "Renovation / capital work",
  ffe: "FF&E",
  closing_costs: "Closing costs",
  financing_costs: "Financing costs",
  interest_reserve: "Interest reserve (lender-held, requested)",
  operating_reserve: "Operating reserve (lender-held, requested)",
  cash_out: "Cash out to borrower",
  other: "Other",
};

/** A sources or uses line. `note` names an "other" line and may qualify any line. Amounts are positive cents. */
export type CapitalLine<K extends string> = { kind: K; amountCents: number; note?: string };
export type SourceLine = CapitalLine<SourceKind>;
export type UseLine = CapitalLine<UseKind>;

// Program sections (program_details jsonb). Convention for every section: a key
// that is absent is unanswered; null is never stored. Booleans are answers
// (false = "no"), not defaults.

export const constructionContractTypes = ["gmp", "cost_plus", "stipulated", "not_selected"] as const;
export type ConstructionContractType = (typeof constructionContractTypes)[number];
export const CONSTRUCTION_CONTRACT_LABELS: Record<ConstructionContractType, string> = {
  gmp: "GMP (maximum price) contract",
  cost_plus: "Cost plus",
  stipulated: "Stipulated sum",
  not_selected: "Contractor not yet selected",
};
export const entitlementStatuses = ["entitled", "in_process", "not_started"] as const;
export type EntitlementStatus = (typeof entitlementStatuses)[number];
export const ENTITLEMENT_STATUS_LABELS: Record<EntitlementStatus, string> = { entitled: "Entitled", in_process: "Entitlements in process", not_started: "Entitlements not started" };
export const permitStatuses = ["issued", "ready_to_issue", "in_plan_check", "not_submitted"] as const;
export type PermitStatus = (typeof permitStatuses)[number];
export const PERMIT_STATUS_LABELS: Record<PermitStatus, string> = { issued: "Permits issued", ready_to_issue: "Ready to issue", in_plan_check: "In plan check", not_submitted: "Not submitted" };
export const plansStages = ["concept", "schematic_design", "design_development", "construction_documents", "permit_set"] as const;
export type PlansStage = (typeof plansStages)[number];
export const PLANS_STAGE_LABELS: Record<PlansStage, string> = {
  concept: "Concept",
  schematic_design: "Schematic design",
  design_development: "Design development",
  construction_documents: "Construction documents",
  permit_set: "Permit set",
};

/** Budget by category, cents. Used when no construction_budget spread is saved. */
export type ConstructionBudget = {
  landCents: number;
  hardCents: number;
  softCents: number;
  contingencyCents: number;
  developerFeeCents: number;
  financingCents: number;
  /** Interest and other reserves the borrower asks the lender to size and hold. */
  reservesCents: number;
};

/** construction, c_pace. GC name and license come from construction_projects, not from here. */
export type ConstructionDetails = {
  budget?: ConstructionBudget;
  unitsToBuild?: number;
  grossSf?: number;
  constructionMonths?: number;
  leaseUpMonths?: number;
  contractType?: ConstructionContractType;
  entitlementStatus?: EntitlementStatus;
  permitStatus?: PermitStatus;
  plansStage?: PlansStage;
  /** Sponsor cash and land basis already in the project. */
  equityInToDateCents?: number;
  completionGuaranty?: boolean;
  groundUpProjectsCompleted?: number;
};

/** Reserves the borrower is asking the lender for (the lender holds and administers them). */
export type ReservesRequested = { interestCents?: number; capexCents?: number; leasingCents?: number };

/** bridge, hotel_pip_bridge (hard_money and fix_flip use the hm_underwriting file instead). */
export type RehabDetails = {
  budgetCents?: number;
  scopeSummary?: string;
  months?: number;
  reservesRequested?: ReservesRequested;
};

export const leaseStatuses = ["leased", "vacant", "short_term", "mixed"] as const;
export type LeaseStatus = (typeof leaseStatuses)[number];
export const LEASE_STATUS_LABELS: Record<LeaseStatus, string> = { leased: "Leased", vacant: "Vacant", short_term: "Short-term rental", mixed: "Mixed" };
export const marketRentSources = ["appraisal", "rent_comps", "property_manager", "sponsor_estimate"] as const;
export type MarketRentSource = (typeof marketRentSources)[number];
export const MARKET_RENT_SOURCE_LABELS: Record<MarketRentSource, string> = {
  appraisal: "Appraisal rent schedule (Form 1007 / 1025)",
  rent_comps: "Rent comparables",
  property_manager: "Property manager opinion",
  sponsor_estimate: "Sponsor estimate",
};

/** dscr_rental. Monthly amounts, whole property. */
export type RentalDetails = {
  monthlyRentCents?: number;
  marketRentCents?: number;
  marketRentSource?: MarketRentSource;
  monthlyTaxesCents?: number;
  monthlyInsuranceCents?: number;
  monthlyHoaCents?: number;
  leaseStatus?: LeaseStatus;
  earliestLeaseEnd?: IsoDate;
  reservesMonths?: number;
};

/**
 * sba_7a, sba_504. Owner occupancy is the profile column `ownerOccupiedPct`
 * (one home per fact; the spec's duplicate `sba.ownerOccupiedPct` was dropped).
 */
export type SbaDetails = {
  businessName?: string;
  /** 2 to 6 digits. */
  naics?: string;
  yearsInBusiness?: number;
  employees?: number;
  /** Annual, the operating business. */
  businessRevenueCents?: number;
  businessEbitdaCents?: number;
  existingBusinessDebtServiceCents?: number;
  equityInjectionCents?: number;
  equityInjectionSource?: string;
  franchise?: boolean;
  changeOfOwnership?: boolean;
  affiliates?: boolean;
  /** 504 only. */
  cdcName?: string;
  /** 504 only: jobs created or retained. */
  jobsCreated?: number;
};

/** Property improvement plan the brand requires. */
export type PipFacts = { required: boolean; budgetCents?: number; deadline?: IsoDate; brandApproved?: boolean };

/**
 * hotel_cmbs, hotel_pip_bridge. Keys are the profile's sizeCount with sizeUnit
 * "keys"; the hotel's management company is the sponsor profile's
 * `managementCompany` (the spec's duplicate `hotel.managementCompany` was dropped).
 */
export type HotelDetails = {
  /** Brand name, or "Independent". */
  brand?: string;
  franchiseExpiry?: IsoDate;
  adrCents?: number;
  revparCents?: number;
  /** RevPAR index (RGI) against the comp set; 100 = fair share. */
  revparIndex?: number;
  ffeReservePct?: number;
  pip?: PipFacts;
};

/** Commercial tenants only (residential tenant names never go here). Names may appear in the email. */
export type TopTenant = { name: string; sharePct: number; leaseEnd: IsoDate };

/** cmbs, life_company, bank. */
export type TenancyDetails = {
  /** At most 10, largest first. */
  topTenants?: TopTenant[];
  /** Share of rent whose lease ends inside the requested term. */
  rolloverPctWithinTerm?: number;
  /** Weighted average lease term remaining. */
  walMonths?: number;
};

export type UnitMixLine = { type: string; count: number; avgRentCents: number };

/** agency. Physical occupancy is the profile's occupancyPct. */
export type AgencyDetails = {
  /** When no rent-roll spread is saved. */
  unitMix?: UnitMixLine[];
  economicOccupancyPct?: number;
  affordabilityNote?: string;
  studentOrSeniorPct?: number;
};

export const hudSections = ["223f", "221d4", "223a7", "232_223f", "232_new"] as const;
export type HudSection = (typeof hudSections)[number];
export const HUD_SECTION_LABELS: Record<HudSection, string> = {
  "223f": "223(f) refinance or acquisition",
  "221d4": "221(d)(4) new construction / substantial rehab",
  "223a7": "223(a)(7) streamlined refinance",
  "232_223f": "232/223(f) healthcare refinance or acquisition",
  "232_new": "232 new construction",
};

/** hud_multifamily, hud_232. The 232 fields apply to hud_232 only. */
export type HudDetails = {
  section?: HudSection;
  /** Repairs the CNA / PCNA calls for (0 when none). */
  repairsCents?: number;
  existingFhaNumber?: string;
  priorHudParticipation?: boolean;
  licensedBeds?: number;
  operatorName?: string;
  payorMixNote?: string;
  surveyHistoryNote?: string;
};

export const consentStatuses = ["not_requested", "requested", "granted", "refused"] as const;
export type ConsentStatus = (typeof consentStatuses)[number];
export const CONSENT_STATUS_LABELS: Record<ConsentStatus, string> = { not_requested: "Not requested", requested: "Requested", granted: "Granted", refused: "Refused" };
export const trancheKinds = ["mezzanine", "preferred_equity", "second_lien", "c_pace"] as const;
export type TrancheKind = (typeof trancheKinds)[number];
export const TRANCHE_KIND_LABELS: Record<TrancheKind, string> = { mezzanine: "Mezzanine loan", preferred_equity: "Preferred equity", second_lien: "Second lien", c_pace: "C-PACE assessment" };

/**
 * mezz_pref, c_pace. "This tranche" is the deal's loanAmountCents. Mezz /
 * pref use `intercreditorStatus`; C-PACE uses `consentStatus` (the mortgage
 * holder's consent) and the two C-PACE fields.
 */
export type CapitalStackDetails = {
  seniorLender?: string;
  seniorAmountCents?: number;
  seniorRatePct?: number;
  seniorMaturity?: IsoDate;
  seniorAllowsSubordinate?: boolean;
  intercreditorStatus?: ConsentStatus;
  consentStatus?: ConsentStatus;
  thisTrancheKind?: TrancheKind;
  eligibleImprovementsCents?: number;
  programJurisdiction?: string;
};

export type ProgramDetails = {
  construction?: ConstructionDetails;
  rehab?: RehabDetails;
  rental?: RentalDetails;
  sba?: SbaDetails;
  hotel?: HotelDetails;
  tenancy?: TenancyDetails;
  agency?: AgencyDetails;
  hud?: HudDetails;
  capitalStack?: CapitalStackDetails;
};
export const programDetailKeys = ["construction", "rehab", "rental", "sba", "hotel", "tenancy", "agency", "hud", "capitalStack"] as const satisfies readonly (keyof ProgramDetails)[];
export type ProgramDetailKey = (typeof programDetailKeys)[number];

// ---------------------------------------------------------------------------
// Provenance (spec 3.4)

/** The record a `record` source points at. */
export const sourceRecordTables = ["principals", "hm_underwriting", "construction_projects"] as const;
export type SourceRecordTable = (typeof sourceRecordTables)[number];

/**
 * Where a stored value came from. `at` is when the value was stored; `by` the
 * staff actor who stored or confirmed it. A value with no entry counts as
 * `entered` by the row's updatedBy. Computed metrics never have an entry.
 */
export type FieldSource =
  /** Staff typed it. */
  | { source: "entered"; by: string; at: IsoTimestamp }
  /** Per the borrower (intake, call, email). `ref`: the lead id or a note. */
  | { source: "borrower"; by: string; at: IsoTimestamp; ref?: string }
  /** A vault document (public.documents id), with the date the document speaks to. */
  | { source: "document"; ref: string; asOf?: IsoDate; at: IsoTimestamp; by?: string }
  /** A saved spread (public.spreads id). */
  | { source: "spread"; ref: string; asOf?: IsoDate; at: IsoTimestamp; by?: string }
  /** Another Corin record. */
  | { source: "record"; record: SourceRecordTable; ref: string; at: IsoTimestamp; by?: string }
  /** public.property_facts id. */
  | { source: "public_record"; ref: string; at: IsoTimestamp; by?: string };
export type FieldSourceKind = FieldSource["source"];

export const FIELD_SOURCE_LABELS: Record<FieldSourceKind, string> = {
  entered: "Entered",
  borrower: "Per borrower",
  document: "From document",
  spread: "From spread",
  record: "From Corin record",
  public_record: "Public record",
};

// ---------------------------------------------------------------------------
// deal_submission_profiles

type RowMeta = {
  id: string;
  dealId: string;
  createdAt: IsoTimestamp;
  createdBy: string;
  updatedAt: IsoTimestamp;
  updatedBy: string | null;
  /** Optimistic-concurrency token; bumped by the store on every update. */
  recordVersion: number;
};

/** Every editable column of deal_submission_profiles, camelCase. Loan amount, address, state and borrower name stay on `deals`. */
export type SubmissionProfileFields = {
  playbook: SubmissionPlaybook;

  // Loan request
  purpose: LoanPurpose | null;
  requestedTermMonths: number | null;
  /** null = interest-only for the whole term. */
  requestedAmortMonths: number | null;
  requestedIoMonths: number | null;
  rateType: RateType | null;
  recourse: RecourseRequest | null;
  lienPosition: SubmissionLienPosition | null;
  targetCloseDate: IsoDate | null;
  closeDriver: string | null;
  prepayPreference: string | null;
  existingLender: string | null;
  existingDebtCents: number | null;
  existingRatePct: number | null;
  existingMaturityDate: IsoDate | null;
  cashOutCents: number | null;
  cashOutUse: string | null;
  /** DSCR sizing assumption only, shown as "assumed, not a quote". Not a term (the deal's term lock is unaffected). */
  assumedRatePct: number | null;
  assumedAmortMonths: number | null;

  // Property
  assetType: SubmissionAssetType | null;
  propertyName: string | null;
  city: string | null;
  county: string | null;
  /** 5-digit ZIP or ZIP+4. */
  postalCode: string | null;
  apn: string | null;
  yearBuilt: number | null;
  yearRenovated: number | null;
  sizeCount: number | null;
  sizeUnit: SizeUnit | null;
  rentableSf: number | null;
  landAcres: number | null;
  tenancy: Tenancy | null;
  ownerOccupiedPct: number | null;
  /** Physical occupancy. */
  occupancyPct: number | null;
  occupancyAsOf: IsoDate | null;
  zoning: string | null;
  floodZone: string | null;
  rentControl: boolean | null;
  seismicZone: boolean | null;
  /** The email shows only city and submarket (off-market acquisitions under confidentiality). */
  maskAddress: boolean;

  // Value
  purchasePriceCents: number | null;
  purchaseCloseDate: IsoDate | null;
  asIsValueCents: number | null;
  asIsValueSource: AsIsValueSource | null;
  asIsValueAsOf: IsoDate | null;
  /** After-repair, as-complete or as-stabilized value. */
  stabilizedValueCents: number | null;
  stabilizedValueSource: StabilizedValueSource | null;

  // Operating financials (annual)
  revenueCents: number | null;
  expensesCents: number | null;
  /** May be negative. */
  noiInPlaceCents: number | null;
  noiPeriodEnd: IsoDate | null;
  noiBasis: NoiBasis | null;
  noiStabilizedCents: number | null;
  stabilizationMonths: number | null;

  // Business plan and exit
  businessPlan: string | null;
  exitStrategy: ExitStrategy | null;
  exitMonths: number | null;
  exitDetail: string | null;
  highlights: string[];
  risks: RiskItem[];

  // Sources and uses
  sources: SourceLine[];
  uses: UseLine[];

  // Program sections and provenance
  programDetails: ProgramDetails;
  fieldSources: FieldSources;
};

export type SubmissionProfile = RowMeta & SubmissionProfileFields;

/** Profile fields that can carry a FieldSource (sources apply to values, not to the playbook or the maps themselves). */
export type ProfileFieldKey = Exclude<keyof SubmissionProfileFields, "playbook" | "programDetails" | "fieldSources">;
/** A program-section value, e.g. "programDetails.hotel.adrCents". A nested object (budget, pip) has one source for the whole object. */
export type ProgramDetailFieldKey = {
  [S in ProgramDetailKey]: `programDetails.${S}.${Extract<keyof NonNullable<ProgramDetails[S]>, string>}`;
}[ProgramDetailKey];
export type FieldSourceKey = ProfileFieldKey | ProgramDetailFieldKey;
/** field_sources jsonb. Sponsor-profile values have no entries: they are always shown as per borrower (stated by the sponsor). */
export type FieldSources = Partial<Record<FieldSourceKey, FieldSource>>;

/**
 * What upsertProfile accepts. `programDetails` merges one section key at a
 * time (a present section replaces that section; absent sections are kept).
 * `fieldSources` merges key by key; a null value removes that key.
 */
export type SubmissionProfilePatch = Partial<Omit<SubmissionProfileFields, "programDetails" | "fieldSources">> & {
  programDetails?: ProgramDetails;
  fieldSources?: Partial<Record<FieldSourceKey, FieldSource | null>>;
};

/** Column defaults of a new profile row (migration defaults), for stores, forms and fixtures. */
export function blankSubmissionProfileFields(playbook: SubmissionPlaybook): SubmissionProfileFields {
  return {
    playbook,
    purpose: null,
    requestedTermMonths: null,
    requestedAmortMonths: null,
    requestedIoMonths: null,
    rateType: null,
    recourse: null,
    lienPosition: null,
    targetCloseDate: null,
    closeDriver: null,
    prepayPreference: null,
    existingLender: null,
    existingDebtCents: null,
    existingRatePct: null,
    existingMaturityDate: null,
    cashOutCents: null,
    cashOutUse: null,
    assumedRatePct: null,
    assumedAmortMonths: null,
    assetType: null,
    propertyName: null,
    city: null,
    county: null,
    postalCode: null,
    apn: null,
    yearBuilt: null,
    yearRenovated: null,
    sizeCount: null,
    sizeUnit: null,
    rentableSf: null,
    landAcres: null,
    tenancy: null,
    ownerOccupiedPct: null,
    occupancyPct: null,
    occupancyAsOf: null,
    zoning: null,
    floodZone: null,
    rentControl: null,
    seismicZone: null,
    maskAddress: false,
    purchasePriceCents: null,
    purchaseCloseDate: null,
    asIsValueCents: null,
    asIsValueSource: null,
    asIsValueAsOf: null,
    stabilizedValueCents: null,
    stabilizedValueSource: null,
    revenueCents: null,
    expensesCents: null,
    noiInPlaceCents: null,
    noiPeriodEnd: null,
    noiBasis: null,
    noiStabilizedCents: null,
    stabilizationMonths: null,
    businessPlan: null,
    exitStrategy: null,
    exitMonths: null,
    exitDetail: null,
    highlights: [],
    risks: [],
    sources: [],
    uses: [],
    programDetails: {},
    fieldSources: {},
  };
}

// ---------------------------------------------------------------------------
// deal_sponsor_profiles (personal: audit rows are redacted)

/** Self-reported band (lib/validation.ts creditBands) plus "not provided". Never a score. */
export const sponsorCreditBands = [...creditBands, "NOT_PROVIDED"] as const;
export type SponsorCreditBand = (typeof sponsorCreditBands)[number];
export const CREDIT_BAND_LABELS: Record<SponsorCreditBand, string> = {
  "740_PLUS": "740 or higher",
  "700_739": "700–739",
  "660_699": "660–699",
  BELOW_660: "Below 660",
  NOT_PROVIDED: "Not provided",
};

export const creditEventKinds = ["bankruptcy", "foreclosure", "judgment", "litigation"] as const;
export type CreditEventKind = (typeof creditEventKinds)[number];
export const CREDIT_EVENT_LABELS: Record<CreditEventKind, string> = {
  bankruptcy: "Bankruptcy",
  foreclosure: "Foreclosure, deed in lieu or short sale",
  judgment: "Judgment or tax lien",
  litigation: "Pending litigation",
};
/** One answer. `explanation` is required by schema.ts when `occurred` is true. */
export type CreditEventAnswer = { occurred: boolean; explanation?: string };
/** credit_events jsonb. A missing key is unanswered. */
export type CreditEvents = Partial<Record<CreditEventKind, CreditEventAnswer>>;

/**
 * What the lender email may say about sponsor financial strength:
 *   covenant_only  "net worth at or above the loan amount: yes" (no dollar figures; the default)
 *   rounded        combined figures rounded down to ROUNDED_FINANCIALS_STEP_CENTS
 *   none           nothing; the summary behind the share link carries it
 */
export const emailFinancialsModes = ["covenant_only", "rounded", "none"] as const;
export type EmailFinancialsMode = (typeof emailFinancialsModes)[number];
export const EMAIL_FINANCIALS_MODE_LABELS: Record<EmailFinancialsMode, string> = {
  covenant_only: "Covenant checks only (no dollar figures)",
  rounded: "Rounded combined figures",
  none: "Nothing in the email",
};

export type SponsorProfileFields = {
  experienceSummary: string | null;
  yearsExperience: number | null;
  similarProjectsCount: number | null;
  portfolioCount: number | null;
  portfolioSizeNote: string | null;
  /** As stated by the sponsor before a PFS is on file. May be negative. */
  statedNetWorthCents: number | null;
  statedLiquidityCents: number | null;
  /** Required whenever either stated figure is set. */
  statedAsOf: IsoDate | null;
  creditBand: SponsorCreditBand | null;
  creditEvents: CreditEvents;
  /** Property (or hotel) management company. */
  managementCompany: string | null;
  /** Staff notes; never shown to a lender. */
  notes: string | null;
  emailFinancialsMode: EmailFinancialsMode;
};

export type SponsorProfile = RowMeta & SponsorProfileFields;
export type SponsorProfilePatch = Partial<SponsorProfileFields>;

export function blankSponsorProfileFields(): SponsorProfileFields {
  return {
    experienceSummary: null,
    yearsExperience: null,
    similarProjectsCount: null,
    portfolioCount: null,
    portfolioSizeNote: null,
    statedNetWorthCents: null,
    statedLiquidityCents: null,
    statedAsOf: null,
    creditBand: null,
    creditEvents: {},
    managementCompany: null,
    notes: null,
    emailFinancialsMode: "covenant_only",
  };
}

// ---------------------------------------------------------------------------
// Limits mirrored from the migration's check constraints (playbooks.test.ts proves them)

export const SUBMISSION_TEXT_LIMITS = {
  closeDriver: 300,
  prepayPreference: 300,
  existingLender: 200,
  cashOutUse: 500,
  propertyName: 200,
  city: 120,
  county: 80,
  apn: 60,
  zoning: 120,
  floodZone: 20,
  businessPlan: 4000,
  exitDetail: 2000,
  experienceSummary: 4000,
  portfolioSizeNote: 300,
  managementCompany: 200,
  notes: 2000,
  emailSubject: 200,
  emailText: 20000,
} as const;

export const SUBMISSION_ARRAY_LIMITS = { highlights: 12, risks: 12, sources: 40, uses: 60, topTenants: 10 } as const;

/** lender_outreach.readiness_override_reason, after trimming. */
export const OVERRIDE_REASON_LENGTH = { min: 20, max: 1000 } as const;

// ---------------------------------------------------------------------------
// Thresholds (VERIFY: market norms, not lender rules; spec open question 6)

/** PFS freshness window for the term-sheet sponsor.strength check (matches summarizePfs). */
export const PFS_MAX_AGE_DAYS = 90;
/** Default guarantor covenants: net worth at or above 1x the loan, liquidity at or above 10% (lib/principals/financials.ts guarantorCovenants). */
export const GUARANTOR_COVENANT_DEFAULTS = { netWorthMultiple: 1, liquidityPct: 0.1 } as const;
/** A typed NOI and a spread NOI that differ by more than this percent raise a warning. */
export const NOI_MISMATCH_WARN_PCT = 2;
/** `rounded` mode rounds combined sponsor figures down to this step ($500,000). */
export const ROUNDED_FINANCIALS_STEP_CENTS = 50_000_000;

// ---------------------------------------------------------------------------
// deal_summaries

/** The one-page summary (spec 5.5). Every value is already formatted text. */
export type DealSummaryRow = { label: string; value: string; source?: string };
export type DealSummarySection = {
  title: string;
  rows?: DealSummaryRow[];
  paragraphs?: string[];
  table?: { head: string[]; rows: string[][] };
};
export type DealSummarySpec = {
  templateVersion: string;
  /** "<deal title> — loan request summary" */
  title: string;
  /** "Prepared <asOf> by Corin Commercial, Inc. for lender review" */
  subtitle: string;
  /** Latest updated_at among the profile, sponsor, spreads and principals; never "today". */
  asOf: IsoDate;
  /** 4–6 tiles: loan, LTV, DSCR, debt yield, ... */
  headline: { label: string; value: string }[];
  sections: DealSummarySection[];
  /** "How these figures were calculated". */
  metricNotes: { key: string; formula: string; inputs: string[] }[];
  /** Unmet required items, by label. */
  openItems: string[];
  /** licenseLine(). */
  footer: string;
};

/** A deal_summaries row. Immutable once inserted. */
export type DealSummaryRecord = {
  id: string;
  dealId: string;
  asOf: IsoDate;
  playbook: SubmissionPlaybook;
  targetStage: TargetStage;
  templateVersion: string;
  /** Holds the sponsor's combined net worth and liquidity (the audit trigger redacts it). */
  spec: DealSummarySpec;
  specSha256: string;
  pdfSha256: string;
  pdfStoragePath: string;
  /** recordVersion of the profile and sponsor rows the summary was built from. */
  profileVersion: number;
  sponsorVersion: number | null;
  createdBy: string;
  createdAt: IsoTimestamp;
};

// ---------------------------------------------------------------------------
// Store (store.ts: MemorySubmissionStore; store-supabase.ts)

export interface SubmissionStore {
  getProfile(dealId: string): Promise<SubmissionProfile | null>;
  /**
   * expectedVersion null inserts (the patch must carry `playbook`; a row that
   * already exists throws ConcurrentUpdateError from lib/deals/store.ts).
   * A number updates only when record_version still equals it, bumps it, and
   * otherwise throws ConcurrentUpdateError. Merge rules: SubmissionProfilePatch.
   */
  upsertProfile(dealId: string, expectedVersion: number | null, patch: SubmissionProfilePatch, actor: string, now: Date): Promise<SubmissionProfile>;
  getSponsor(dealId: string): Promise<SponsorProfile | null>;
  /** Same version rules as upsertProfile. */
  upsertSponsor(dealId: string, expectedVersion: number | null, patch: SponsorProfilePatch, actor: string, now: Date): Promise<SponsorProfile>;
  /** Returns the existing row on (dealId, pdfSha256) instead of inserting a duplicate. */
  insertSummary(s: Omit<DealSummaryRecord, "id" | "createdAt">, now: Date): Promise<DealSummaryRecord>;
  getSummary(id: string): Promise<DealSummaryRecord | null>;
  getSummaryByPdfSha(dealId: string, pdfSha256: string): Promise<DealSummaryRecord | null>;
}

// ---------------------------------------------------------------------------
// Submission context (context.ts loadSubmissionContext builds it once per request)

/**
 * A principal as the submission builders see it: the org chart, roles and
 * which exhibits are on file. Contact details, home address, citizenship, tax
 * id and exhibit contents are left out on purpose (spec 5.4 and 6.5): no
 * builder may read them. `legalName` is here only for the summary behind the
 * link and for assertEmailSafe's name check; the email never prints it.
 */
export type SubmissionPrincipal = Pick<Principal, "id" | "parentId" | "kind" | "legalName" | "roles" | "title" | "ownershipPct" | "isGuarantor" | "formationState" | "hasPfs" | "pfsAsOf" | "hasForm1919"> & {
  /** Effective share of the borrower (lib/principals/org-chart.ts). */
  effectivePct: number;
  hasReoSchedule: boolean;
  hasHud2530: boolean;
  hasCreditAuthorization: boolean;
  /** What this principal owes for the deal's checklist program(s) (lib/principals/requirements.ts principalObligations). */
  owes: PrincipalRequirement[];
};

/**
 * Sums over the principals who back the loan: the guarantors, or, on a
 * program with no guaranty (HUD), the key principals. Only principals with a
 * PFS on file contribute figures. Null when none of them has a PFS (the
 * summary then falls back to the sponsor profile's stated figures).
 */
export type GuarantorTotals = {
  netWorthCents: number;
  liquidityCents: number;
  pfsCount: number;
  guarantorCount: number;
  oldestPfsAsOf: IsoDate | null;
};

/** Checklist items as readiness reads them (Underwrite level and document checks). */
export type SubmissionChecklistItem = Pick<DealChecklistItem, "id" | "itemKey" | "templateKey" | "principalId" | "title" | "category" | "stage" | "required" | "status" | "docKind" | "documentDate">;

/** Clean vault documents on the deal's lead, TERM_SHEET excluded (lib/deals/runtime.ts vaultDocuments). */
export type VaultDocumentRef = { id: string; kind: string; fileName: string; createdAt: IsoTimestamp };

/** The public-record facts prefill may suggest (property_facts row). */
export type PropertyFactsRef = { id: string; apn: string | null; county: string | null; floodZone: string | null; yearBuilt: number | null; fetchedAt: IsoTimestamp };

/** Spread figures SavedPackageSpreads does not carry, from the latest saved row of each kind (cents, ratios as plain numbers). */
export type SubmissionSpreadFigures = {
  globalCashFlow: { spreadId: string; asOf: IsoDate; globalDscr: number; businessDscr: number } | null;
  constructionBudget: { spreadId: string; asOf: IsoDate; budget: ConstructionBudget; totalCents: number } | null;
  hotelStr: { spreadId: string; asOf: IsoDate; occupancyPct: number; adrCents: number; revparCents: number; revparIndex: number | null; lastMonth: string } | null;
  /** Reviewed quotes, tested at the quote's own terms (lib/spreads/quotes.ts analyzeQuote). */
  quotes: { spreadId: string; asOf: IsoDate; rows: { lender: string; loanAmountCents: number; ratePct: number; amortYears: number; dscr: number; debtYieldPct: number; ltvPct: number | null }[] } | null;
};

/** Everything the metrics, readiness, summary and email builders read. Loaded once per request; builders never fetch. */
export type SubmissionContext = {
  deal: Deal;
  profile: SubmissionProfile | null;
  sponsor: SponsorProfile | null;
  /** leads.intake via deal.leadId. */
  intake: Intake | null;
  /** leads.created_at (prefill: target close = lead date + timelineDays). */
  intakeReceivedAt: IsoTimestamp | null;
  /** lib/spreads/workflow.ts packageSpreadsFromSaved. */
  spreads: SavedPackageSpreads | null;
  spreadFigures: SubmissionSpreadFigures;
  /** Which spread kinds are saved for the deal. */
  spreadBundleKinds: SpreadKind[];
  principals: SubmissionPrincipal[];
  guarantorTotals: GuarantorTotals | null;
  /** summarizeReo over the key principals' schedules. DOLLARS, as lib/principals/financials.ts returns. */
  reoSummary: ReoSummary | null;
  /** The hm_underwriting file. DOLLARS (purchasePrice, arv, ...), as lib/checklists/hm-underwriting.ts stores them. */
  hardMoney: HmUnderwriting | null;
  construction: { project: ConstructionProject; licenseCheck: ContractorLicenseCheck | null; reports: ConstructionReport[] } | null;
  propertyFacts: PropertyFactsRef | null;
  checklistItems: SubmissionChecklistItem[];
  vaultDocuments: VaultDocumentRef[];
  /** Details of open sanctions holds (DealHold.detail). Any entry is a hard stop. */
  openHolds: string[];
  now: Date;
};

// ---------------------------------------------------------------------------
// Metrics (metrics.ts computeSubmissionMetrics)

export const metricKeys = [
  "ltv_as_is",
  "ltv_stabilized",
  "ltarv",
  "ltc",
  "combined_ltv",
  "combined_ltc",
  "debt_yield_in_place",
  "debt_yield_stabilized",
  "dscr_in_place",
  "dscr_stabilized",
  "dscr_quoted",
  "dscr_rental",
  "pitia_monthly",
  "global_dscr",
  "cap_rate",
  "yield_on_cost",
  "noi_underwritten",
  "loan_per_unit",
  "loan_per_sf",
  "price_per_unit",
  "equity",
  "equity_share",
  "sources_minus_uses",
  "hotel_occupancy",
  "hotel_adr",
  "hotel_revpar",
  "revpar_index",
  "pip_per_key",
  "flip_margin",
  "rehab_weeks",
  "verified_projects_36m",
] as const;
export type MetricKey = (typeof metricKeys)[number];

export const metricUnits = ["pct", "x", "cents", "count", "months", "weeks"] as const;
/** pct: 0–100; x: ratio (1.25); cents: integer cents; count, months, weeks: plain numbers. */
export type MetricUnit = (typeof metricUnits)[number];

/** Fixed unit per key, so the UI, summary and email format the same number the same way. */
export const METRIC_UNITS: Record<MetricKey, MetricUnit> = {
  ltv_as_is: "pct",
  ltv_stabilized: "pct",
  ltarv: "pct",
  ltc: "pct",
  combined_ltv: "pct",
  combined_ltc: "pct",
  debt_yield_in_place: "pct",
  debt_yield_stabilized: "pct",
  dscr_in_place: "x",
  dscr_stabilized: "x",
  dscr_quoted: "x",
  dscr_rental: "x",
  pitia_monthly: "cents",
  global_dscr: "x",
  cap_rate: "pct",
  yield_on_cost: "pct",
  noi_underwritten: "cents",
  loan_per_unit: "cents",
  loan_per_sf: "cents",
  price_per_unit: "cents",
  equity: "cents",
  equity_share: "pct",
  sources_minus_uses: "cents",
  hotel_occupancy: "pct",
  hotel_adr: "cents",
  hotel_revpar: "cents",
  revpar_index: "count",
  pip_per_key: "cents",
  flip_margin: "pct",
  rehab_weeks: "weeks",
  verified_projects_36m: "count",
};

export type MetricBasis = "in_place" | "stabilized" | "cost" | "na";

/**
 * One input of a metric. `field` names where it came from: a profile key
 * ("asIsValueCents"), "deal.<key>", "programDetails.<section>.<key>",
 * "spread.<kind>", "hardMoney.<key>" or "principals.pfs".
 */
export type MetricInput = { field: string; label: string; value: number | null; source: FieldSource | null };

export type Metric = {
  key: MetricKey;
  label: string;
  /** null when an input is missing; never guessed, never 0 for "unknown". */
  value: number | null;
  unit: MetricUnit;
  basis: MetricBasis;
  /** e.g. "loan ÷ as-is value". */
  formula: string;
  inputs: MetricInput[];
  /** Labels of the missing inputs ("as-is value"). */
  missing: string[];
  /** e.g. "at an assumed 7.25% / 30-year amortization; not a quote". */
  note?: string;
};

/**
 * Guarantor strength for the summary behind the link (spec 3.5 "Guarantor
 * covenants"). Kept out of Metric[] so the email builder never receives a
 * sponsor dollar figure; the email gets GuarantorCovenantLine instead.
 */
export type SponsorStrength = {
  /** pfs: summed PFS totals (GuarantorTotals); stated: the sponsor profile's stated figures. */
  basis: "pfs" | "stated";
  /** Oldest PFS date, or statedAsOf. */
  asOf: IsoDate | null;
  netWorthCents: number | null;
  liquidityCents: number | null;
  guarantorCount: number;
  pfsCount: number;
  covenants: {
    netWorthMultiple: number;
    liquidityPct: number;
    requiredNetWorthCents: number | null;
    requiredLiquidityCents: number | null;
    /** null when a figure or the loan amount is missing. */
    netWorthOk: boolean | null;
    liquidityOk: boolean | null;
  };
};

/** What computeSubmissionMetrics returns and every consumer takes. */
export type SubmissionMetrics = {
  /** Display order. A key appears at most once. */
  metrics: Metric[];
  sponsorStrength: SponsorStrength | null;
  /** e.g. the typed NOI differs from the spread NOI by more than NOI_MISMATCH_WARN_PCT. */
  warnings: string[];
};

// ---------------------------------------------------------------------------
// Requirements and readiness (requirements.ts, readiness.ts)

export type RequirementLevel = "required" | "recommended";
export type StageLevels = { screen?: RequirementLevel; term_sheet?: RequirementLevel };
/** `all` applies to every playbook; a playbook entry overrides it. A playbook with neither does not have the item. */
export type RequirementLevels = { all?: StageLevels } & { [P in SubmissionPlaybook]?: StageLevels };

/** Where a fix link goes. playbooks.ts submissionFixHref turns it into a URL. */
export type FixTarget =
  | { kind: "editor"; section: SectionId; field?: FieldSourceKey }
  /** The deal's Details form on /deals/[id] (loan amount, address, state, borrower name). */
  | { kind: "deal_details" }
  /** The deal checklist, optionally one item (DealChecklistItem.id; the page anchors items as "item-<id>"). */
  | { kind: "checklist"; itemId?: string }
  /** The hard money file (HardMoneySection on the checklist page). */
  | { kind: "hard_money_file" }
  | { kind: "principals" }
  | { kind: "construction_project"; projectId: string | null };

export type Requirement = {
  /** Stable, e.g. "value.basis"; stored in lender_outreach.readiness_missing. */
  id: string;
  section: SectionId;
  /** What staff read: "As-is value with its source". */
  label: string;
  levels: RequirementLevels;
  /** Applies only when true (e.g. only on a refinance). */
  when?: (ctx: SubmissionContext) => boolean;
  met: (ctx: SubmissionContext, metrics: SubmissionMetrics) => boolean;
  /** Stored fields the check reads; when every one that is set is sourced "borrower", the item shows as per borrower. */
  fields?: readonly FieldSourceKey[];
  fix: { target: FixTarget; hint: string };
};

export type ReadinessItem = {
  id: string;
  section: SectionId;
  label: string;
  met: boolean;
  /** Met only through values sourced "borrower": "per borrower, not yet verified by a document". */
  perBorrower: boolean;
  fix: { href: string; hint: string };
};

/** Screen and Term sheet come from requirements.ts; Underwrite from the checklist's required application and underwriting items. */
export type Readiness = {
  playbook: SubmissionPlaybook;
  stage: TargetStage;
  required: ReadinessItem[];
  recommended: ReadinessItem[];
  /** Met required ÷ required, 0–100, whole number (100 when nothing is required). */
  score: number;
  /** Every required item met. Hard stops do not change `ready`; they block the send on their own. */
  ready: boolean;
  /** Required ids not met. */
  missing: string[];
  /** Open holds and deal status; never overridable. */
  hardStops: string[];
};

// ---------------------------------------------------------------------------
// Per-lender tailoring (tailor.ts lenderFit)

export type LenderFit = {
  lenderId: string;
  /** Facts that fit: "Bridge", "$2M–$25M covers $8.4M", "Lends in CA". */
  matches: string[];
  /** Facts outside the recorded box: "LTV 78% vs 75% maximum". */
  exceptions: string[];
  /** Dimensions the lender has not recorded. */
  unknown: string[];
  staleness: Staleness;
  /** From matchLenders when an approved credit box exists. */
  score: number | null;
};

// ---------------------------------------------------------------------------
// The lender email (email.ts). EmailFacts has no field for any restricted value (spec 5.4 layer 1).

/** Placeholders in the approved email text; filled only after approval, when the link exists. */
export const EMAIL_PLACEHOLDERS = { shareLink: "{{SHARE_LINK}}", linkExpires: "{{LINK_EXPIRES}}" } as const;

/** What the email may say about guarantor strength (redaction.ts guarantorCovenantLine). */
export type GuarantorCovenantLine = {
  basis: "pfs" | "stated";
  asOf: IsoDate | null;
  netWorthAtLeastLoan: boolean | null;
  liquidityAtLeastPct: boolean | null;
  thresholds: { netWorthMultiple: number; liquidityPct: number };
  /** Only in `rounded` mode: combined figures rounded down to ROUNDED_FINANCIALS_STEP_CENTS. */
  rounded: { netWorthCents: number; liquidityCents: number } | null;
};

export type EmailSponsorFacts = Pick<SponsorProfileFields, "experienceSummary" | "yearsExperience" | "similarProjectsCount" | "portfolioCount" | "portfolioSizeNote" | "managementCompany" | "creditBand" | "emailFinancialsMode"> & {
  /** The borrowing entity (deals.borrowerName and its formation state); never an individual. */
  borrowerEntity: { name: string | null; formationState: string | null } | null;
  /** true when any credit event was answered yes (details stay behind the link); null when unanswered. */
  creditEventsReported: boolean | null;
  /** null in `none` mode or when no figures exist. */
  covenants: GuarantorCovenantLine | null;
};

/** Hard money / fix & flip figures for the email, converted to cents. */
export type EmailHardMoneyFacts = {
  strategy: HmUnderwriting["strategy"];
  purchasePriceCents: number;
  asIsValueCents: number;
  arvCents: number;
  arvSource: HmUnderwriting["arvSource"];
  rehabBudgetCents: number;
  rehabWeeks: number;
  verifiedProjects36m: number;
  exit: { type: "sale" | "refinance"; targetMonths: number; refinanceProgram: string | null };
};

export type EmailLender = Pick<LenderPanelEntry, "id" | "name" | "loanTypes" | "minLoanCents" | "maxLoanCents" | "states" | "assetTypes"> & {
  /** The primary contact's first name; the greeting falls back to "Hello". */
  contactFirstName: string | null;
};

/** The signing advisor (staff profile). */
export type EmailAdvisor = { name: string; title: string | null; dreLicense: string | null; email: string; phone: string | null };

export type EmailFacts = {
  templateVersion: string;
  stage: TargetStage;
  playbook: SubmissionPlaybook;
  /** propertyAddress is null when profile.maskAddress is set (city and state still show). */
  deal: Pick<Deal, "id" | "title" | "program" | "loanAmountCents" | "propertyState"> & { propertyAddress: string | null };
  profile: SubmissionProfile;
  sponsor: EmailSponsorFacts | null;
  /** The same metrics as the summary (no sponsor figures by construction). */
  metrics: Metric[];
  hardMoney: EmailHardMoneyFacts | null;
  construction: { generalContractorName: string | null; licenseStatus: LicenseCheckStatus | null } | null;
  lender: EmailLender;
  fit: LenderFit;
  /** The locked package manifest, the deal summary first. `date`: statement or report date when known. */
  documents: { label: string; kind: string; date: IsoDate | null }[];
  reportsOnHand: { label: string; date: IsoDate | null }[];
  /** Labels of unmet required items at the target stage. */
  notYetInHand: string[];
  advisor: EmailAdvisor;
};

// ---------------------------------------------------------------------------
// The send (packages.ts SendPackageInput.submission, spec 5.2)

export type SubmissionSendInput = {
  targetStage: TargetStage;
  summaryId: string;
  readiness: Pick<Readiness, "missing" | "hardStops" | "score">;
  /** Required when readiness.missing is not empty; OVERRIDE_REASON_LENGTH after trimming. */
  overrideReason?: string;
  fit: LenderFit;
  /** The approved text with EMAIL_PLACEHOLDERS; sha256 is hex of the UTF-8 bytes of `text`. */
  email: { subject: string; text: string; sha256: string };
};

/** Shape of playbooks.ts playbookLoanTypes. */
export type PlaybookLoanTypes = Readonly<Record<SubmissionPlaybook, readonly LenderLoanType[]>>;
/** Shape of playbooks.ts PROGRAM_PLAYBOOKS. */
export type ProgramPlaybooks = Readonly<Record<DealProgram, { default: SubmissionPlaybook; also: readonly SubmissionPlaybook[] }>>;

// Re-exported so builders import the checklist vocabulary they compare against from one place.
export type { ChecklistStage, ItemStatus, PrincipalRequirement };
