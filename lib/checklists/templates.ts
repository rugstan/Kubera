// Seeded document checklists per program (WS-U). These definitions are the
// source of truth: supabase/migrations/20261103000300_u_checklists_principals.sql
// seeds `checklist_templates` with exactly this content (rendered by
// lib/checklists/seed.ts, pinned by seed.test.ts).
//
// Scope is pre-closing only. Corin is the broker: the lender of record funds
// and services the loan, and Corin has no role in construction draws, so no
// item tracks advances, draw requests, lien releases or inspections during
// construction (Global rule 1; templates.test.ts scans for those words).
//
// Program sources are marked VERIFY until underwriting confirms them against
// the current handbook or the lender's own checklist.

import type { ChecklistItemDef, ChecklistProgram, ChecklistTemplate } from "./types";

export const TEMPLATE_VERSION = "2026.11.1";

type Def = ChecklistItemDef;
const def = (d: Def): Def => d;
/** Copy of a shared definition with some fields replaced (title, required …). */
const tweak = (d: Def, patch: Partial<Def>): Def => ({ ...d, ...patch });

// --- Borrowing entity --------------------------------------------------------------

const FORMATION = def({ key: "entity_formation", title: "Formation documents", description: "Articles or certificate of formation and the operating, partnership or shareholder agreement for the borrowing entity and each entity above it.", category: "entity", responsible: "borrower", stage: "application", required: true, upload: true });
const ORG_CHART = def({ key: "org_chart", title: "Ownership chart", description: "Chart of every owner down to the individuals, with ownership percentages and who has control (managing member, general partner, officers).", category: "entity", responsible: "borrower", stage: "application", required: true, upload: true });
const EIN = def({ key: "ein_letter", title: "IRS EIN letter", description: "IRS confirmation of the borrowing entity's employer identification number (CP 575 or 147C).", category: "entity", responsible: "borrower", stage: "application", required: true, upload: true });
const GOOD_STANDING = def({ key: "good_standing", title: "Certificate of good standing", description: "Good standing from the state of formation and, for an out-of-state entity, California foreign qualification.", category: "entity", responsible: "borrower", stage: "pre_closing", required: true, upload: true, recencyDays: 90, reference: "Lender closing requirement (VERIFY recency per lender)" });
const RESOLUTION = def({ key: "borrowing_resolution", title: "Borrowing resolution", description: "Signed resolution or consent authorizing the loan and naming who may sign. The lender's counsel usually supplies the form.", category: "entity", responsible: "borrower", stage: "pre_closing", required: true, upload: true });
const BUSINESS_TAX = def({ key: "business_tax_returns", title: "Business tax returns (3 years)", description: "Federal returns with all schedules for the operating business for the last three years.", category: "entity", responsible: "borrower", stage: "application", required: true, upload: true, docKind: "TAX_RETURN" });
const INTERIM_FINANCIALS = def({ key: "interim_financials", title: "Year-to-date financial statements", description: "Year-to-date profit and loss statement and balance sheet for the operating business.", category: "entity", responsible: "borrower", stage: "application", required: true, upload: true, recencyDays: 90, reference: "SBA SOP 50 10 (VERIFY: statements within 180 days of application)" });
const DEBT_SCHEDULE = def({ key: "business_debt_schedule", title: "Business debt schedule", description: "Every business loan and lease: lender, balance, payment, rate, maturity and collateral.", category: "entity", responsible: "borrower", stage: "application", required: true, upload: true });
const TAX_TRANSCRIPT_AUTH = def({ key: "tax_transcript_authorization", title: "IRS Form 4506-C", description: "Authorization for the lender to obtain IRS tax transcripts for the business.", category: "entity", responsible: "borrower", stage: "underwriting", required: true, upload: true, reference: "SBA SOP 50 10 (VERIFY)" });

// --- Principals (expanded per principal) --------------------------------------------

const PFS = def({ key: "pfs", title: "Personal financial statement", description: "Assets, liabilities, income and contingent liabilities, signed and dated. You can complete it in the portal.", category: "principal", responsible: "borrower", stage: "application", required: true, upload: true, perPrincipal: "pfs", docKind: "PFS", recencyDays: 90 });
const PFS_413 = tweak(PFS, { title: "Personal financial statement (SBA Form 413)", reference: "SBA Form 413 (VERIFY: dated within 90 days of submission)" });
const REO = def({ key: "reo_schedule", title: "Schedule of real estate owned", description: "Every property you own or control: value, debt, lender, payment, income and maturity. You can complete it in the portal.", category: "principal", responsible: "borrower", stage: "application", required: true, upload: true, perPrincipal: "reo_schedule" });
const CREDIT_AUTH = def({ key: "credit_authorization", title: "Credit and background authorization", description: "Your written authorization for credit, background and sanctions checks. Signed in the portal.", category: "principal", responsible: "borrower", stage: "application", required: true, upload: false, perPrincipal: "credit_authorization" });
const GOV_ID = def({ key: "government_id", title: "Government-issued photo ID", description: "Driver's license or passport for identity verification.", category: "principal", responsible: "borrower", stage: "underwriting", required: true, upload: true, perPrincipal: "government_id" });
const RESUME = def({ key: "sponsor_resume", title: "Sponsor résumé and track record", description: "Experience owning and operating comparable properties, with a list of current and past projects.", category: "principal", responsible: "borrower", stage: "application", required: true, upload: true, perPrincipal: "resume" });
const PERSONAL_TAX = def({ key: "personal_tax_returns", title: "Personal tax returns (3 years)", description: "Federal returns with all schedules for each guarantor.", category: "principal", responsible: "borrower", stage: "application", required: true, upload: true, perPrincipal: "guaranty", docKind: "TAX_RETURN" });
const GUARANTY = def({ key: "guaranty", title: "Guaranty", description: "The lender's guaranty, signed at closing by each guarantor. The lender of record prepares it.", category: "principal", responsible: "lender", stage: "pre_closing", required: true, upload: false, perPrincipal: "guaranty" });
const FORM_1919 = def({ key: "form_1919", title: "SBA Form 1919 (Borrower Information Form)", description: "Borrower information and eligibility questions for each owner of 20% or more and each officer, director, managing member and general partner. Corin pre-fills it from the portal.", category: "program", responsible: "borrower", stage: "application", required: true, upload: false, perPrincipal: "form_1919", reference: "SBA Form 1919; SOP 50 10 (VERIFY ownership threshold)" });
const HUD_2530 = def({ key: "hud_2530", title: "Previous participation certification (HUD-2530 / APPS)", description: "Your prior HUD and other government-assisted projects. Each principal certifies in HUD's APPS system; the portal collects the details first.", category: "program", responsible: "borrower", stage: "application", required: true, upload: false, perPrincipal: "hud_2530", reference: "HUD-2530 / APPS; Handbook 4232.1 and MAP Guide (VERIFY principal thresholds)" });

// --- Property financials ------------------------------------------------------------

const T12 = def({ key: "t12", title: "Trailing 12-month operating statement (T-12)", description: "Month-by-month income and expenses for the last 12 months.", category: "financial", responsible: "borrower", stage: "application", required: true, upload: true, docKind: "T12", recencyDays: 90 });
const T3 = def({ key: "t3", title: "Trailing 3-month operating statement (T-3)", description: "The most recent three months of income and expenses, for annualizing current collections.", category: "financial", responsible: "borrower", stage: "application", required: true, upload: true, docKind: "T12", recencyDays: 60 });
const HISTORY = def({ key: "operating_history", title: "Operating statements (3 years)", description: "Annual operating statements for the last three full years.", category: "financial", responsible: "borrower", stage: "application", required: true, upload: true, docKind: "T12" });
const RENT_ROLL_CERT = def({ key: "rent_roll_certified", title: "Certified rent roll", description: "Current rent roll by unit (unit type, tenant, lease dates, contract and market rent, concessions, delinquency), certified as true by the borrower.", category: "financial", responsible: "borrower", stage: "application", required: true, upload: true, docKind: "RENT_ROLL", recencyDays: 30, reference: "Lender requirement (VERIFY: updated within 30 days of closing)" });
const RENT_ROLL = tweak(RENT_ROLL_CERT, { key: "rent_roll", title: "Rent roll", description: "Current rent roll by unit or suite with lease dates and rents.", recencyDays: 60 });
const BUDGET = def({ key: "operating_budget", title: "Current-year operating budget", description: "This year's budget with the assumptions behind it.", category: "financial", responsible: "borrower", stage: "underwriting", required: false, upload: true });
const TAX_BILLS = def({ key: "property_tax_bills", title: "Property tax bills", description: "The most recent secured property tax bill for each parcel.", category: "financial", responsible: "borrower", stage: "underwriting", required: true, upload: true });
const LOSS_RUNS = def({ key: "insurance_loss_runs", title: "Insurance loss runs (5 years)", description: "Carrier loss runs for the property for the last five years.", category: "financial", responsible: "borrower", stage: "underwriting", required: true, upload: true });
const CENSUS = def({ key: "census_payor_mix", title: "Resident census and payor mix", description: "Monthly occupancy by unit type and level of care, with private-pay, Medicare and Medicaid mix, for the last 12 months.", category: "financial", responsible: "borrower", stage: "application", required: true, upload: true, docKind: "CENSUS", recencyDays: 60 });
const STR = def({ key: "str_report", title: "STR report", description: "STR trend and competitive-set report covering the last 12 months (occupancy, ADR, RevPAR, index).", category: "financial", responsible: "borrower", stage: "application", required: true, upload: true, docKind: "STR_REPORT", recencyDays: 60 });
const CAPEX = def({ key: "capex_history", title: "Capital expenditure history", description: "Capital work completed in the last three years and planned work.", category: "financial", responsible: "borrower", stage: "underwriting", required: false, upload: true });

// --- Property -----------------------------------------------------------------------

const PURCHASE_CONTRACT = def({ key: "purchase_contract", title: "Purchase contract", description: "Signed purchase agreement with all amendments (acquisitions only; marked not applicable on a refinance).", category: "property", responsible: "borrower", stage: "application", required: true, upload: true });
const EXISTING_DEBT = def({ key: "existing_debt_statement", title: "Existing loan statement", description: "Latest statement for each loan being paid off, for the lender's payoff (refinances only).", category: "property", responsible: "borrower", stage: "underwriting", required: true, upload: true });
const MGMT_AGREEMENT = def({ key: "management_agreement", title: "Property management agreement", description: "Current management agreement and the manager's résumé.", category: "property", responsible: "borrower", stage: "underwriting", required: true, upload: true });
const PHOTOS = def({ key: "property_photos", title: "Property photos", description: "Recent exterior and interior photos.", category: "property", responsible: "borrower", stage: "application", required: false, upload: true });

// --- Third-party reports (ordered by the lender of record or Corin on its behalf) -----

const APPRAISAL = def({ key: "appraisal", title: "Appraisal", description: "Appraisal ordered by the lender of record. Corin tracks its status.", category: "third_party", responsible: "lender", stage: "underwriting", required: true, upload: false, docKind: "APPRAISAL", recencyDays: 180 });
const APPRAISAL_AS_COMPLETE = tweak(APPRAISAL, { key: "appraisal_as_complete", title: "Appraisal (as-is, as-complete and as-stabilized)", description: "Appraisal with as-is land, as-complete and as-stabilized values, ordered by the lender of record." });
const PHASE_I = def({ key: "phase_i_esa", title: "Phase I environmental site assessment", description: "ASTM E1527-21 Phase I. A Phase II follows only if the Phase I finds a recognized environmental condition.", category: "third_party", responsible: "vendor", stage: "underwriting", required: true, upload: false, recencyDays: 180, reference: "ASTM E1527-21 (VERIFY: viability window per lender)" });
const PCA = def({ key: "property_condition", title: "Property condition assessment", description: "Physical condition report with immediate repairs and a reserve schedule.", category: "third_party", responsible: "vendor", stage: "underwriting", required: true, upload: false, recencyDays: 180 });
const CNA = tweak(PCA, { key: "capital_needs_assessment", title: "Capital needs assessment (HUD CNA e-Tool)", description: "HUD-format capital needs assessment with critical and non-critical repairs and the reserve for replacement schedule.", reference: "HUD MAP Guide / Handbook 4232.1 (VERIFY)" });
const SEISMIC = def({ key: "seismic_pml", title: "Seismic risk assessment (PML)", description: "Probable maximum loss study. Most lenders require it for California properties; Corin marks it not applicable outside seismic zones.", category: "third_party", responsible: "vendor", stage: "underwriting", required: true, upload: false, reference: "Lender seismic policy (VERIFY PML threshold, often 20%)" });
const ZONING = def({ key: "zoning_report", title: "Zoning report", description: "Zoning compliance report or letter confirming the use is legal and conforming.", category: "third_party", responsible: "vendor", stage: "underwriting", required: true, upload: false });
const SURVEY = def({ key: "alta_survey", title: "ALTA/NSPS survey", description: "Current ALTA/NSPS land title survey certified to the lender and title company.", category: "third_party", responsible: "vendor", stage: "pre_closing", required: true, upload: false });
const MARKET_STUDY = def({ key: "market_study", title: "Market study", description: "Third-party market study supporting demand, rents and absorption.", category: "third_party", responsible: "vendor", stage: "underwriting", required: true, upload: false });
const GEOTECH = def({ key: "geotech_report", title: "Geotechnical report", description: "Soils and geotechnical investigation for the building design.", category: "third_party", responsible: "borrower", stage: "underwriting", required: true, upload: true });

// --- Construction (pre-closing only) ----------------------------------------------------

const CONSTRUCTION_BUDGET = def({ key: "construction_budget", title: "Construction budget", description: "Line-item hard and soft cost budget with contingency, developer fee and the interest reserve the lender sizes.", category: "construction", responsible: "borrower", stage: "application", required: true, upload: true });
const GMP = def({ key: "gmp_contract", title: "Construction contract (GMP)", description: "Signed guaranteed maximum price contract with the general contractor, including the schedule of values.", category: "construction", responsible: "borrower", stage: "pre_closing", required: true, upload: true });
const PLANS = def({ key: "plans_specs", title: "Plans and specifications", description: "Permit-set architectural, structural and MEP plans and the project specifications.", category: "construction", responsible: "borrower", stage: "underwriting", required: true, upload: true });
const PERMITS = def({ key: "building_permits", title: "Building permits", description: "Issued building permits, or the jurisdiction's ready-to-issue letter and fee estimate.", category: "construction", responsible: "borrower", stage: "pre_closing", required: true, upload: true });
const GC_LICENSE = def({ key: "gc_license", title: "General contractor license (CSLB)", description: "The general contractor's California license number. Corin verifies status, classification, bond and workers' compensation on the CSLB public lookup.", category: "construction", responsible: "corin", stage: "underwriting", required: true, upload: false, lookup: "cslb_license", reference: "Cal. B&P §7000 et seq.; CSLB license lookup" });
const SCHEDULE = def({ key: "construction_schedule", title: "Construction schedule", description: "Critical-path schedule from start through certificate of occupancy.", category: "construction", responsible: "borrower", stage: "underwriting", required: true, upload: true });
const GC_PACKAGE = def({ key: "gc_qualifications", title: "General contractor qualifications", description: "Contractor résumé, comparable completed projects, financial statements and references.", category: "construction", responsible: "borrower", stage: "underwriting", required: true, upload: true });
const ARCHITECT = def({ key: "architect_agreement", title: "Architect agreement", description: "Signed architect agreement and the architect's certificate of insurance.", category: "construction", responsible: "borrower", stage: "underwriting", required: true, upload: true });
const PLAN_COST = def({ key: "plan_cost_review", title: "Plan and cost review", description: "Independent review of the plans, budget, contract and schedule, ordered by the lender of record before closing.", category: "construction", responsible: "lender", stage: "pre_closing", required: true, upload: false });

// --- Title and insurance --------------------------------------------------------------------

const TITLE = def({ key: "title_commitment", title: "Preliminary title report", description: "Title commitment or preliminary report with copies of the recorded exceptions.", category: "title_insurance", responsible: "title_escrow", stage: "underwriting", required: true, upload: false });
const ENDORSEMENTS = def({ key: "title_endorsements", title: "Title endorsements", description: "Pro forma lender's policy with the endorsements the lender requires (for example zoning, survey, access, contiguity, tax parcel).", category: "title_insurance", responsible: "title_escrow", stage: "pre_closing", required: true, upload: false });
const INSURANCE = def({ key: "insurance_evidence", title: "Property and liability insurance", description: "Evidence of property, general liability and, where required, flood and earthquake coverage naming the lender of record as mortgagee and additional insured.", category: "title_insurance", responsible: "borrower", stage: "pre_closing", required: true, upload: true });
const BUILDERS_RISK = def({ key: "builders_risk", title: "Builder's risk insurance", description: "Builder's risk policy for the full completed value naming the lender of record, with the contractor's liability and workers' compensation certificates.", category: "title_insurance", responsible: "borrower", stage: "pre_closing", required: true, upload: true });

// --- Program-specific ------------------------------------------------------------------------

const OPERATOR_LEASE = def({ key: "operator_agreement", title: "Operator lease or management agreement", description: "The lease or management agreement with the licensed operator, with the operator's résumé and financials.", category: "program", responsible: "borrower", stage: "application", required: true, upload: true, reference: "HUD Handbook 4232.1 (VERIFY)" });
const STATE_LICENSE = def({ key: "state_license", title: "State operating license", description: "Current facility license (for example an RCFE license from CDSS or an SNF license from CDPH) and the last three state survey results with plans of correction.", category: "program", responsible: "borrower", stage: "application", required: true, upload: true });
const AR_AGING = def({ key: "ar_aging", title: "Accounts receivable aging", description: "Current receivables aging by payor (skilled nursing and other Medicare or Medicaid providers).", category: "program", responsible: "borrower", stage: "underwriting", required: false, upload: true });
const HUD_EXHIBITS = def({ key: "hud_application_exhibits", title: "HUD application exhibits", description: "Application package the lender of record assembles and submits to HUD; Corin coordinates the borrower exhibits.", category: "program", responsible: "lender", stage: "underwriting", required: true, upload: false, reference: "HUD MAP Guide / Handbook 4232.1 (VERIFY)" });
const AFHMP = def({ key: "affirmative_marketing_plan", title: "Affirmative fair housing marketing plan", description: "HUD-935.2A affirmative fair housing marketing plan.", category: "program", responsible: "borrower", stage: "underwriting", required: true, upload: true, reference: "HUD-935.2A (VERIFY applicability)" });
const DAVIS_BACON = def({ key: "prevailing_wage_acknowledgment", title: "Prevailing wage acknowledgment", description: "Contractor acknowledgment of Davis-Bacon prevailing wage requirements for the project.", category: "program", responsible: "borrower", stage: "pre_closing", required: true, upload: true, reference: "Davis-Bacon Act; HUD 221(d)(4) (VERIFY)" });
const SBA_ELIGIBILITY = def({ key: "sba_eligibility", title: "SBA eligibility and use of proceeds", description: "Use-of-proceeds table, size standard and eligibility review. Corin prepares it with you for the lender.", category: "program", responsible: "corin", stage: "application", required: true, upload: false, reference: "SBA SOP 50 10 (VERIFY)" });
const BUSINESS_PLAN = def({ key: "business_plan", title: "Business plan and projections", description: "Two-year monthly projections with assumptions; required for start-ups, acquisitions and changes of ownership.", category: "program", responsible: "borrower", stage: "application", required: false, upload: true });
const FRANCHISE = def({ key: "franchise_agreement", title: "Franchise agreement", description: "Signed franchise or license agreement with all amendments and the franchise disclosure document if new.", category: "program", responsible: "borrower", stage: "application", required: true, upload: true, docKind: "FRANCHISE_AGREEMENT" });
const COMFORT_LETTER = def({ key: "franchise_comfort_letter", title: "Franchise comfort letter", description: "Brand comfort letter in favor of the lender of record, requested once the lender is selected.", category: "program", responsible: "lender", stage: "pre_closing", required: true, upload: false });
const HOTEL_MGMT = tweak(MGMT_AGREEMENT, { key: "hotel_management_agreement", title: "Hotel management agreement", description: "Management agreement with the hotel operator and the operator's portfolio summary." });
const PIP = def({ key: "pip_document", title: "Property improvement plan (PIP)", description: "The brand's PIP report and deadlines.", category: "program", responsible: "borrower", stage: "application", required: true, upload: true, docKind: "PIP_BUDGET" });
const PIP_BUDGET = def({ key: "pip_budget", title: "PIP budget and contractor bids", description: "Line-item PIP budget with contractor bids and contingency.", category: "program", responsible: "borrower", stage: "underwriting", required: true, upload: true, docKind: "PIP_BUDGET" });
const CDC_APPLICATION = def({ key: "cdc_application", title: "CDC application", description: "Certified Development Company application for the 504 debenture, prepared with the CDC.", category: "program", responsible: "corin", stage: "underwriting", required: true, upload: false, reference: "SBA 504 (VERIFY)" });
const OCCUPANCY = def({ key: "owner_occupancy", title: "Owner-occupancy certification", description: "Confirmation the operating business will occupy at least 51% of an existing building (60% for new construction).", category: "program", responsible: "borrower", stage: "underwriting", required: true, upload: true, reference: "SBA SOP 50 10 (VERIFY)" });
const JOBS = def({ key: "job_creation", title: "Job creation and retention estimate", description: "Jobs created or retained by the project, for the CDC's public policy test.", category: "program", responsible: "borrower", stage: "underwriting", required: true, upload: true, reference: "SBA 504 (VERIFY)" });
const VALUE_ADD_PLAN = def({ key: "business_plan_capex", title: "Business plan and capital budget", description: "Value-add plan, renovation budget and timeline, and the stabilized pro forma.", category: "property", responsible: "borrower", stage: "application", required: true, upload: true });
const EXIT_PLAN = def({ key: "exit_plan", title: "Exit plan", description: "How the loan will be repaid at maturity: sale, refinance (and to which program), with timing and support.", category: "property", responsible: "borrower", stage: "application", required: true, upload: true });

// --- Hard money --------------------------------------------------------------------------------

const SCOPE_OF_WORK = def({ key: "scope_of_work", title: "Scope of work and rehab budget", description: "Line-item scope of work with costs and timeline. You can enter it in the portal.", category: "property", responsible: "borrower", stage: "application", required: true, upload: true });
const ARV_SUPPORT = def({ key: "arv_support", title: "After-repair value support", description: "Comparable sales or a broker price opinion supporting the after-repair value; the lender of record orders its own valuation.", category: "property", responsible: "borrower", stage: "application", required: true, upload: true });
const TRACK_RECORD = def({ key: "track_record", title: "Project track record", description: "Completed projects in the last 36 months: address, purchase and sale dates and prices, rehab cost and your role.", category: "principal", responsible: "borrower", stage: "application", required: true, upload: true, perPrincipal: "resume" });
const CONTRACTOR_LICENSE_HM = tweak(GC_LICENSE, { required: false, description: "Required when a licensed contractor performs the rehab. Corin verifies the license on the CSLB public lookup." });
const VALUATION = tweak(APPRAISAL, { key: "valuation", title: "Valuation (appraisal or BPO)", description: "As-is and after-repair valuation ordered by the lender of record." });

// --- Composition -------------------------------------------------------------------------------

const ENTITY_CORE = [FORMATION, ORG_CHART, EIN, GOOD_STANDING, RESOLUTION];
const PRINCIPAL_CORE = [PFS, REO, CREDIT_AUTH, GOV_ID, RESUME];
const TITLE_INSURANCE = [TITLE, ENDORSEMENTS, INSURANCE];
const CONSTRUCTION_CORE = [CONSTRUCTION_BUDGET, GMP, PLANS, PERMITS, GC_LICENSE, SCHEDULE, GC_PACKAGE, ARCHITECT, PLAN_COST, GEOTECH, BUILDERS_RISK];
const MULTIFAMILY_CORE = [RENT_ROLL_CERT, T12, T3, HISTORY, SEISMIC, INSURANCE, TAX_BILLS, LOSS_RUNS, MGMT_AGREEMENT];
const HUD_CONSTRUCTION_CONTRACT = tweak(GMP, { title: "Construction contract (HUD form)", description: "Owner–contractor agreement on HUD's required form with the trade payment breakdown; HUD cost certification applies at completion.", reference: "HUD MAP Guide (VERIFY forms)" });

function build(program: ChecklistProgram, title: string, groups: readonly (readonly Def[])[]): ChecklistTemplate {
  const seen = new Map<string, Def>();
  for (const group of groups) for (const d of group) if (!seen.has(d.key)) seen.set(d.key, d);
  return { program, version: TEMPLATE_VERSION, title, items: [...seen.values()] };
}

export const CHECKLIST_TEMPLATES: Readonly<Record<ChecklistProgram, ChecklistTemplate>> = {
  HUD_232_223F: build("HUD_232_223F", "HUD 232/223(f) document checklist", [
    ENTITY_CORE,
    PRINCIPAL_CORE,
    [HUD_2530],
    [T12, HISTORY, CENSUS, BUDGET, TAX_BILLS, LOSS_RUNS, AR_AGING],
    [OPERATOR_LEASE, STATE_LICENSE, HUD_EXHIBITS],
    [PURCHASE_CONTRACT, EXISTING_DEBT, PHOTOS],
    [APPRAISAL, PHASE_I, CNA, SEISMIC, ZONING, SURVEY],
    TITLE_INSURANCE,
  ]),
  HUD_232_NEW_CONSTRUCTION: build("HUD_232_NEW_CONSTRUCTION", "HUD 232 new construction document checklist", [
    ENTITY_CORE,
    PRINCIPAL_CORE,
    [HUD_2530],
    [OPERATOR_LEASE, HUD_EXHIBITS, MARKET_STUDY],
    [CONSTRUCTION_BUDGET, HUD_CONSTRUCTION_CONTRACT],
    CONSTRUCTION_CORE,
    [APPRAISAL_AS_COMPLETE, PHASE_I, ZONING, SURVEY, DAVIS_BACON],
    TITLE_INSURANCE,
  ]),
  HUD_MULTIFAMILY_223F: build("HUD_MULTIFAMILY_223F", "HUD 223(f) multifamily document checklist", [
    ENTITY_CORE,
    PRINCIPAL_CORE,
    [HUD_2530],
    MULTIFAMILY_CORE,
    [HUD_EXHIBITS, AFHMP],
    [PURCHASE_CONTRACT, EXISTING_DEBT, PHOTOS, CAPEX],
    [APPRAISAL, PHASE_I, CNA, ZONING, SURVEY],
    TITLE_INSURANCE,
  ]),
  HUD_221D4: build("HUD_221D4", "HUD 221(d)(4) document checklist", [
    ENTITY_CORE,
    PRINCIPAL_CORE,
    [HUD_2530],
    [HUD_EXHIBITS, AFHMP, MARKET_STUDY],
    [CONSTRUCTION_BUDGET, HUD_CONSTRUCTION_CONTRACT],
    CONSTRUCTION_CORE,
    [APPRAISAL_AS_COMPLETE, PHASE_I, SEISMIC, ZONING, SURVEY, DAVIS_BACON],
    TITLE_INSURANCE,
  ]),
  SBA_7A: build("SBA_7A", "SBA 7(a) document checklist", [
    ENTITY_CORE,
    [BUSINESS_TAX, INTERIM_FINANCIALS, DEBT_SCHEDULE, TAX_TRANSCRIPT_AUTH],
    [PFS_413, REO, CREDIT_AUTH, GOV_ID, RESUME, PERSONAL_TAX, FORM_1919, GUARANTY],
    [SBA_ELIGIBILITY, BUSINESS_PLAN, FRANCHISE],
    [PURCHASE_CONTRACT, EXISTING_DEBT],
    [tweak(APPRAISAL, { required: false, description: "Appraisal when real estate secures the loan, ordered by the lender of record." }), tweak(PHASE_I, { required: false, description: "Environmental review when real estate secures the loan (SBA SOP environmental policy)." })],
    [tweak(TITLE, { required: false }), INSURANCE],
  ]),
  SBA_504: build("SBA_504", "SBA 504 document checklist", [
    ENTITY_CORE,
    [BUSINESS_TAX, INTERIM_FINANCIALS, DEBT_SCHEDULE, TAX_TRANSCRIPT_AUTH],
    [PFS_413, REO, CREDIT_AUTH, GOV_ID, RESUME, PERSONAL_TAX, FORM_1919, GUARANTY],
    [SBA_ELIGIBILITY, CDC_APPLICATION, OCCUPANCY, JOBS, BUSINESS_PLAN, FRANCHISE],
    [PURCHASE_CONTRACT, EXISTING_DEBT],
    [APPRAISAL, PHASE_I, SURVEY],
    TITLE_INSURANCE,
  ]),
  HOTEL_CMBS: build("HOTEL_CMBS", "Hotel CMBS document checklist", [
    ENTITY_CORE,
    PRINCIPAL_CORE,
    [GUARANTY],
    [T12, HISTORY, STR, BUDGET, TAX_BILLS, LOSS_RUNS, CAPEX],
    [FRANCHISE, COMFORT_LETTER, HOTEL_MGMT],
    [PURCHASE_CONTRACT, EXISTING_DEBT, PHOTOS],
    [APPRAISAL, PHASE_I, PCA, SEISMIC, ZONING, SURVEY],
    TITLE_INSURANCE,
  ]),
  PIP_BRIDGE: build("PIP_BRIDGE", "Hotel PIP bridge document checklist", [
    ENTITY_CORE,
    PRINCIPAL_CORE,
    [GUARANTY],
    [T12, STR, BUDGET, TAX_BILLS],
    [FRANCHISE, PIP, PIP_BUDGET, COMFORT_LETTER, HOTEL_MGMT],
    [tweak(GC_LICENSE, { description: "The renovation contractor's California license number. Corin verifies status, classification, bond and workers' compensation on the CSLB public lookup." }), SCHEDULE, EXIT_PLAN],
    [PURCHASE_CONTRACT, EXISTING_DEBT],
    [APPRAISAL, PHASE_I, PCA, SEISMIC],
    TITLE_INSURANCE,
  ]),
  AGENCY_MULTIFAMILY: build("AGENCY_MULTIFAMILY", "Fannie Mae / Freddie Mac multifamily document checklist", [
    ENTITY_CORE,
    PRINCIPAL_CORE,
    [GUARANTY],
    MULTIFAMILY_CORE,
    [PURCHASE_CONTRACT, EXISTING_DEBT, PHOTOS, CAPEX],
    [APPRAISAL, PHASE_I, PCA, ZONING, SURVEY],
    TITLE_INSURANCE,
  ]),
  BRIDGE: build("BRIDGE", "Bridge loan document checklist", [
    ENTITY_CORE,
    PRINCIPAL_CORE,
    [GUARANTY],
    [T12, RENT_ROLL, TAX_BILLS],
    [VALUE_ADD_PLAN, EXIT_PLAN],
    [PURCHASE_CONTRACT, EXISTING_DEBT, PHOTOS],
    [APPRAISAL, PHASE_I, PCA, SEISMIC],
    TITLE_INSURANCE,
  ]),
  HARD_MONEY: build("HARD_MONEY", "Hard money document checklist", [
    [FORMATION, ORG_CHART, EIN, RESOLUTION],
    [CREDIT_AUTH, GOV_ID, REO, TRACK_RECORD, GUARANTY],
    [SCOPE_OF_WORK, ARV_SUPPORT, EXIT_PLAN, CONTRACTOR_LICENSE_HM],
    [PURCHASE_CONTRACT, EXISTING_DEBT, PHOTOS],
    [VALUATION],
    TITLE_INSURANCE,
  ]),
  CONSTRUCTION: build("CONSTRUCTION", "Construction loan document checklist (pre-closing)", [
    ENTITY_CORE,
    PRINCIPAL_CORE,
    [GUARANTY],
    CONSTRUCTION_CORE,
    [APPRAISAL_AS_COMPLETE, PHASE_I, SEISMIC, ZONING, SURVEY, tweak(MARKET_STUDY, { required: false })],
    [PURCHASE_CONTRACT, EXIT_PLAN],
    TITLE_INSURANCE,
  ]),
};

export function templateFor(program: ChecklistProgram): ChecklistTemplate {
  return CHECKLIST_TEMPLATES[program];
}

/**
 * Checklist programs for a sizer/Jev program id (lib/sizing/types.ts ProgramId
 * plus the new-program boxes). A 7(a)+504 stack gets both SBA checklists.
 */
export function checklistProgramsForSizerProgram(programId: string): ChecklistProgram[] {
  switch (programId) {
    case "HUD_232_223F":
      return ["HUD_232_223F"];
    case "BRIDGE_TO_HUD_232":
      return ["BRIDGE"];
    case "HUD_232_NEW_CONST":
      return ["HUD_232_NEW_CONSTRUCTION"];
    case "SBA_504_STANDARD":
      return ["SBA_504"];
    case "SBA_504_PLUS_7A_10M_STACK":
      return ["SBA_504", "SBA_7A"];
    case "SBA_7A":
      return ["SBA_7A"];
    case "HOSPITALITY_CMBS_NON_RECOURSE":
      return ["HOTEL_CMBS"];
    case "HOSPITALITY_PIP_BRIDGE":
      return ["PIP_BRIDGE"];
    case "WHITE_LABEL_CRE_BRIDGE":
      return ["BRIDGE"];
    case "HUD_221D4_223F_MULTIFAMILY":
    case "HUD_223F_MULTIFAMILY":
      return ["HUD_MULTIFAMILY_223F"];
    case "HUD_221D4":
      return ["HUD_221D4"];
    case "AGENCY_FANNIE_FREDDIE":
      return ["AGENCY_MULTIFAMILY"];
    case "HARD_MONEY":
      return ["HARD_MONEY"];
    case "CONSTRUCTION":
      return ["CONSTRUCTION"];
    default:
      return [];
  }
}
