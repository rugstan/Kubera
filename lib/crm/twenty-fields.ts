// Structured Twenty fields for the public forms.
//
// Every lead (the 60-second qualifier at /express, the short form on each
// /financing page, the sizer) fills custom fields on its Twenty opportunity,
// and every partner registration (/partners) fills custom fields on its
// company. Brokers can then filter, group and sort on what the visitor entered
// instead of reading the JSON note, which stays as the full record.
//
// TWENTY_FIELDS is the single source of truth:
//   - ops/twenty/fields.json is generated from it (`npm run twenty:fields`),
//     and twenty-fields.test.ts fails when the two drift apart. It is the
//     field list the CRM's own schema script (corin-schema.py, run by whoever
//     administers crm.corincommercial.com: dry run first, additive only)
//     creates in the workspace, and it must be applied before a release that
//     writes a new field;
//   - lib/crm/twenty.ts writes these values in a separate step after the
//     record exists, so a field the workspace lacks never stops a lead from
//     reaching the CRM (see `patchFields` there).
//
// Select values are GraphQL enum names in Twenty, so they start with a letter
// (the credit bands, "740_PLUS" and so on, are prefixed with CREDIT_).
// The privacy request form is not synced: those requests stay in the
// compliance queue on the site and never enter the CRM.

import { ASSETS, FRANCHISE_TIERS, HARD_MONEY_STRATEGIES } from "@/components/express/schema";
import { LENDER_KINDS, LICENSE_TYPES, OPERATOR_KINDS, SERVICES, VERTICALS } from "@/components/partners/schema";
import { ASSET_VERTICALS, OPTIMIZATION_FLAGS, PROGRAM_FITS, URGENCY_TIERS, type JevResult } from "@/lib/ai/jev";
import { creditBands, type Intake, type PartnerRegistration } from "@/lib/validation";

export type TwentyObjectName = "opportunity" | "company";
export type TwentyFieldType = "TEXT" | "NUMBER" | "BOOLEAN" | "CURRENCY" | "SELECT" | "MULTI_SELECT";
export type TwentyOption = { value: string; label: string };
export type TwentyFieldSpec = {
  object: TwentyObjectName;
  name: string;
  label: string;
  type: TwentyFieldType;
  description: string;
  options?: TwentyOption[];
};

/** A value ready for Twenty's REST API: CURRENCY is `{ amountMicros, currencyCode }`, MULTI_SELECT an array. */
export type TwentyValue = string | number | boolean | string[] | { amountMicros: number; currencyCode: "USD" };
export type TwentyFieldValues = Record<string, TwentyValue>;

const humanize = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const fixAcronyms = (s: string) =>
  s
    .replace(/\bhud\b/gi, "HUD")
    .replace(/\bsba\b/gi, "SBA")
    .replace(/\bcmbs\b/gi, "CMBS")
    .replace(/\bpip\b/gi, "PIP")
    .replace(/\bcre\b/gi, "CRE")
    .replace(/\bdscr\b/gi, "DSCR")
    .replace(/\bltarv\b/gi, "LTARV")
    .replace(/\bltv\b/gi, "LTV")
    .replace(/\b(\d+)a7\b/gi, "$1(a)(7)")
    .replace(/\b221d4\b/gi, "221(d)(4)")
    .replace(/\b223f\b/gi, "223(f)")
    .replace(/\b7a\b/gi, "7(a)")
    .replace(/\b(\d) (\d)\b/g, "$1–$2");
const label = (value: string) => fixAcronyms(humanize(value));
/**
 * Twenty 2.40 refuses a comma in any field or option label ("Label must not
 * contain a comma"), so ", " becomes " / " (the CRM's schema script applies the
 * same swap). The forms keep their own wording.
 */
export const crmLabel = (text: string) => text.replace(/,\s*/g, " / ");
const options = (values: readonly string[], labels: Record<string, string> = {}): TwentyOption[] => values.map((value) => ({ value, label: crmLabel(labels[value] ?? label(value)) }));
const fromList = (list: readonly { value: string; label: string }[]): TwentyOption[] => list.map(({ value, label }) => ({ value, label: crmLabel(label) }));

/** intake.source → the Lead source select. */
export const LEAD_SOURCES: TwentyOption[] = [
  { value: "EXPRESS", label: "60-second qualifier" },
  { value: "FINANCING_PAGE", label: "Financing page form" },
  { value: "SIZER", label: "Loan sizer" },
  { value: "ASK", label: "Ask an advisor" },
  { value: "WEBSITE", label: "Website" },
];

/** The qualifier's transactions plus the short form's "Other", kept on the lead's origin. */
export const TRANSACTIONS: TwentyOption[] = [
  { value: "PURCHASE", label: "Purchase" },
  { value: "REFINANCE", label: "Refinance" },
  { value: "CONSTRUCTION", label: "Construction" },
  { value: "CONVERSION", label: "Conversion" },
  { value: "HARD_MONEY", label: "Hard money / bridge" },
  { value: "OTHER", label: "Other" },
];

export const CREDIT_BAND_OPTIONS: TwentyOption[] = [
  { value: "CREDIT_740_PLUS", label: "740+" },
  { value: "CREDIT_700_739", label: "700–739" },
  { value: "CREDIT_660_699", label: "660–699" },
  { value: "CREDIT_BELOW_660", label: "Below 660" },
];
const creditBandValue = (band: (typeof creditBands)[number]) => `CREDIT_${band}`;

const TIER_LABELS: Record<string, string> = {
  TIER_1_INSTITUTIONAL_HOT: "Tier 1 · hot",
  TIER_2_QUALIFIED_MIDMARKET: "Tier 2 · qualified",
  TIER_3_NURTURE: "Tier 3 · nurture",
  UNQUALIFIED: "Unqualified",
};

// Typed as complete records, so a new program, vertical or flag cannot ship without a label.
const PROGRAM_LABELS: Record<(typeof PROGRAM_FITS)[number], string> = {
  HUD_232_223F: "HUD 232/223(f)",
  HUD_232_NEW_CONST: "HUD 232 new construction",
  SBA_504_STANDARD: "SBA 504",
  SBA_504_PLUS_7A_10M_STACK: "SBA 504 + 7(a) $10M stack",
  HOSPITALITY_CMBS_NON_RECOURSE: "Hotel CMBS (non-recourse)",
  HOSPITALITY_PIP_BRIDGE: "Hotel PIP bridge",
  BRIDGE_TO_HUD_232: "Bridge to HUD 232",
  WHITE_LABEL_CRE_BRIDGE: "CRE bridge",
  HUD_221D4_223F_MULTIFAMILY: "HUD 221(d)(4) / 223(f) multifamily",
  AGENCY_FANNIE_FREDDIE: "Agency (Fannie Mae / Freddie Mac)",
  HARD_MONEY: "Hard money",
  CONSTRUCTION_BANK: "Construction (bank)",
  CONSTRUCTION_DEBT_FUND: "Construction (debt fund)",
  CONSTRUCTION_PRIVATE: "Construction (private)",
  AGENCY_FANNIE_MAE: "Fannie Mae",
  AGENCY_FREDDIE_MAC: "Freddie Mac",
  DSCR_INVESTOR_2_4: "DSCR investor (2–4 units)",
  DSCR_INVESTOR_5_PLUS: "DSCR investor (5+ units)",
  HUD_223A7: "HUD 223(a)(7)",
};
const VERTICAL_LABELS: Record<(typeof ASSET_VERTICALS)[number], string> = {
  SENIOR_LIVING_CARE: "Senior living and care",
  HOSPITALITY_HOTEL: "Hotels",
  HOTEL_TO_CARE_CONVERSION: "Hotel to care conversion",
  MULTIFAMILY: "Multifamily",
  GENERAL_CRE_OR_CONSTRUCTION: "Commercial or construction",
  HARD_MONEY_PRIVATE: "Hard money / private",
  RESIDENTIAL_INVESTOR: "Residential investor",
};
const FLAG_LABELS: Record<(typeof OPTIMIZATION_FLAGS)[number], string> = {
  OPTIMAL_FOR_HUD_232: "Fits HUD 232",
  LOAN_UNDER_3_5M_USE_SBA_504_TO_AVOID_HUD_COSTS: "Under $3.5M: SBA 504 before HUD",
  USE_2026_SBA_10M_STACK_FOR_LARGE_HOTEL_OR_CARE_FACILITY: "SBA $10M stack for a large hotel or care facility",
  NEEDS_STABILIZATION_OR_PIP_BRIDGE_FIRST: "Needs stabilization or a PIP bridge first",
  OPTIMAL_AS_STRUCTURED: "Fits as structured",
  EXIT_SHORTFALL_NEEDS_RESTRUCTURE: "Exit shortfall: needs restructuring",
  NEEDS_BROKER_REVIEW: "Needs broker review",
};
const PROGRAM_OPTIONS = options(PROGRAM_FITS, PROGRAM_LABELS);

const opp = (name: string, labelText: string, type: TwentyFieldType, description: string, opts?: TwentyOption[]): TwentyFieldSpec => ({ object: "opportunity", name, label: crmLabel(labelText), type, description, ...(opts ? { options: opts } : {}) });
const co = (name: string, labelText: string, type: TwentyFieldType, description: string, opts?: TwentyOption[]): TwentyFieldSpec => ({ object: "company", name, label: crmLabel(labelText), type, description, ...(opts ? { options: opts } : {}) });

export const TWENTY_FIELDS: readonly TwentyFieldSpec[] = [
  // --- Leads: where they came from -----------------------------------------
  opp("siteLeadId", "Site lead ID", "TEXT", "The lead's id on corincommercial.com (staff lead record)."),
  opp("leadSource", "Lead source", "SELECT", "Which form the lead used.", LEAD_SOURCES),
  opp("sourcePage", "Source page", "TEXT", "The page the form was on, e.g. /financing/office-loans or /express."),
  opp("advisorOnly", "Advisor-only handling", "BOOLEAN", "The person asked for human review only: no automated scoring or AI tools."),
  // --- Leads: what the visitor entered (both forms) --------------------------
  opp("propertyType", "Property type", "SELECT", "Property type the visitor chose.", fromList(ASSETS)),
  opp("transactionType", "Transaction", "SELECT", "Purchase, refinance, construction and so on.", TRANSACTIONS),
  opp("closeTimelineDays", "Close needed in (days)", "NUMBER", "How soon the visitor needs to close."),
  opp("borrowerNotes", "Borrower notes", "TEXT", "The visitor's own notes from the form."),
  // --- Leads: the 60-second qualifier's numbers ------------------------------
  opp("noi", "NOI (trailing 12 months)", "CURRENCY", "Trailing 12-month net operating income."),
  opp("propertyValue", "Property value", "CURRENCY", "Estimated value or purchase price."),
  opp("unitCount", "Beds / keys / units", "NUMBER", "Licensed beds, hotel keys or residential units."),
  opp("occupancyPct", "Occupancy %", "NUMBER", "Current occupancy, 0 to 100."),
  opp("adr", "ADR", "CURRENCY", "Hotel average daily rate."),
  opp("pipBudget", "PIP budget", "CURRENCY", "Hotel property improvement plan budget."),
  opp("franchiseTier", "Hotel flag", "SELECT", "Hotel brand tier.", fromList(FRANCHISE_TIERS)),
  opp("nonRecourseOnly", "Non-recourse only", "BOOLEAN", "The borrower wants non-recourse debt only."),
  opp("greenBuilding", "Green / energy upgrade", "BOOLEAN", "Energy or green improvements (Green MIP or Green 504 candidate)."),
  opp("ownerOperator", "Owner-operator", "BOOLEAN", "The borrower operates the property."),
  opp("creditBand", "Guarantor credit band", "SELECT", "Self-reported guarantor credit band (a band, not a score).", CREDIT_BAND_OPTIONS),
  // Hard money, construction and 1–4 unit rental details.
  opp("hardMoneyStrategy", "Hard money strategy", "SELECT", "Fix and flip, bridge or rental.", fromList(HARD_MONEY_STRATEGIES)),
  opp("rehabBudget", "Rehab budget", "CURRENCY", "Hard money rehab budget."),
  opp("afterRepairValue", "After-repair value", "CURRENCY", "After-repair or as-stabilized value."),
  opp("loanTermMonths", "Loan term (months)", "NUMBER", "Requested hard money term."),
  opp("existingPayoff", "Existing payoff", "CURRENCY", "Existing loan payoff on a refinance."),
  opp("completedProjects", "Completed projects (36 months)", "NUMBER", "Comparable projects completed in the last 36 months."),
  opp("landCost", "Land cost", "CURRENCY", "Construction: land cost."),
  opp("hardCosts", "Hard costs", "CURRENCY", "Construction: hard costs."),
  opp("softCosts", "Soft costs", "CURRENCY", "Construction: soft costs."),
  opp("constructionMonths", "Construction months", "NUMBER", "Construction period."),
  opp("asCompletedValue", "As-completed value", "CURRENCY", "Construction: value once complete."),
  opp("gmpContract", "GMP contract", "BOOLEAN", "Guaranteed maximum price construction contract."),
  opp("monthlyRent", "Monthly rent", "CURRENCY", "1–4 unit rental: monthly rent."),
  opp("monthlyTaxesInsuranceHoa", "Monthly taxes, insurance, HOA", "CURRENCY", "1–4 unit rental: monthly taxes, insurance and HOA."),
  // --- Leads: the qualifier's indicative match --------------------------------
  opp("primaryProgram", "Primary program fit", "SELECT", "The program the rules engine matched first.", PROGRAM_OPTIONS),
  opp("secondaryProgram", "Secondary program fit", "SELECT", "The runner-up program, if any.", [...PROGRAM_OPTIONS, { value: "NONE", label: "None" }]),
  opp("leadTier", "Lead tier", "SELECT", "Urgency tier from the qualifier.", options(URGENCY_TIERS, TIER_LABELS)),
  opp("assetVertical", "Asset vertical", "SELECT", "The engine's asset grouping.", options(ASSET_VERTICALS, VERTICAL_LABELS)),
  opp("sizingFlag", "Sizing flag", "SELECT", "The engine's structuring note, e.g. needs broker review.", options(OPTIMIZATION_FLAGS, FLAG_LABELS)),
  opp("callRightAway", "Call right away", "BOOLEAN", "The engine flagged the lead for an immediate broker call."),
  opp("recommendedLenders", "Recommended lenders", "TEXT", "Wholesale lenders the engine suggested, in order."),
  // --- Partners (/partners) ----------------------------------------------
  co("sitePartnerId", "Site partner ID", "TEXT", "The registration's id on corincommercial.com."),
  co("partnerType", "Partner type", "SELECT", "Which partner form they used.", [
    { value: "LENDER", label: "Lender" },
    { value: "REFERRAL", label: "Referral partner" },
    { value: "OPERATOR", label: "Operator" },
    { value: "VENDOR", label: "Vendor" },
  ]),
  co("lenderType", "Lender type", "SELECT", "Lenders: what kind of lender.", fromList(LENDER_KINDS)),
  co("minLoan", "Min loan", "CURRENCY", "Lenders: smallest loan."),
  co("maxLoan", "Max loan", "CURRENCY", "Lenders: largest loan."),
  co("lendingVerticals", "Appetite", "MULTI_SELECT", "Lenders: asset classes they lend on.", fromList(VERTICALS)),
  co("maxLtvPct", "Max LTV / LTC %", "NUMBER", "Lenders: maximum loan-to-value or loan-to-cost."),
  co("maxLtcPct", "Max LTC, construction %", "NUMBER", "Lenders: maximum loan-to-cost on construction."),
  co("minDscr", "Min DSCR", "NUMBER", "Lenders: minimum debt service coverage."),
  co("minDebtYieldPct", "Min debt yield %", "NUMBER", "Lenders: minimum debt yield."),
  co("flagRequirements", "Flag requirements", "TEXT", "Lenders: hotel flag requirements."),
  co("brokerFeeProtectionPct", "Broker fee protection %", "NUMBER", "Lenders: broker fee they protect."),
  co("marketsServed", "Markets served", "TEXT", "States or markets they cover."),
  co("licenseType", "License type", "SELECT", "Referral partners: their license.", fromList(LICENSE_TYPES)),
  co("licenseNumbers", "License numbers", "TEXT", "Referral or operator license numbers."),
  co("operatorType", "Operator type", "SELECT", "Operators: what they operate.", fromList(OPERATOR_KINDS)),
  co("unitsUnderManagement", "Beds / keys under management", "NUMBER", "Operators: beds or keys under management."),
  co("flagsApproved", "Flags approved", "TEXT", "Operators: hotel brands they are approved to manage."),
  co("vendorServices", "Services", "MULTI_SELECT", "Vendors: services offered.", fromList(SERVICES)),
  co("typicalTurnaroundDays", "Typical turnaround (days)", "NUMBER", "Vendors: typical turnaround."),
];

const SPEC_BY_KEY = new Map(TWENTY_FIELDS.map((f) => [`${f.object}.${f.name}`, f]));
export function fieldSpec(object: TwentyObjectName, name: string): TwentyFieldSpec | undefined {
  return SPEC_BY_KEY.get(`${object}.${name}`);
}

// --- Values -----------------------------------------------------------------

const usd = (n: number | undefined | null) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? { amountMicros: Math.round(n * 1_000_000), currencyCode: "USD" as const } : undefined);
const count = (n: number | undefined | null) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined);
const text = (s: string | undefined | null) => (s && s.trim() ? s.trim().slice(0, 2_000) : undefined);

/** Drops undefined values and any value a select or multi-select does not offer, so a push never sends what the workspace would refuse. */
function clean(object: TwentyObjectName, values: Record<string, TwentyValue | undefined>): TwentyFieldValues {
  const out: TwentyFieldValues = {};
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) continue;
    const spec = fieldSpec(object, name);
    if (!spec) throw new Error(`twenty-fields: ${object}.${name} is not in TWENTY_FIELDS`);
    if (spec.type === "SELECT" && !spec.options!.some((o) => o.value === value)) continue;
    if (spec.type === "MULTI_SELECT") {
      const allowed = (value as string[]).filter((v) => spec.options!.some((o) => o.value === v));
      if (allowed.length) out[name] = allowed;
      continue;
    }
    out[name] = value;
  }
  return out;
}

export type LeadFieldContext = {
  /** The lead's id in the site database, when it was saved. */
  leadId?: string | null;
  /** True for an advisor-only lead (no automated scoring). */
  advisorOnly?: boolean;
};

/**
 * The opportunity fields for a lead. The short financing-page form collects
 * only property type, amount, transaction, timing and notes; the qualifier's
 * numbers are written only for leads that collected them, so a placeholder
 * (the short form's NOI of 0 or default occupancy) never reads as an answer.
 */
export function opportunityFields(intake: Intake, jev: JevResult | null, ctx: LeadFieldContext = {}): TwentyFieldValues {
  const quick = intake.source === "financing_page";
  const d = jev?.decision;
  const hm = intake.hardMoney;
  const cons = intake.construction;
  return clean("opportunity", {
    siteLeadId: text(ctx.leadId),
    leadSource: intake.source.toUpperCase(),
    sourcePage: intake.origin?.path ?? (intake.source === "express" ? "/express" : undefined),
    advisorOnly: ctx.advisorOnly ? true : undefined,
    propertyType: intake.assetType,
    transactionType: intake.origin?.transaction === "OTHER" ? "OTHER" : intake.transaction,
    closeTimelineDays: intake.timelineDays,
    borrowerNotes: text(intake.notes),
    ...(quick
      ? {}
      : {
          noi: usd(intake.noi),
          propertyValue: usd(intake.value),
          unitCount: count(intake.unitCount),
          occupancyPct: intake.occupancyPct,
          adr: usd(intake.adr),
          pipBudget: usd(intake.pipBudget),
          franchiseTier: intake.franchiseTier,
          nonRecourseOnly: intake.nonRecourseOnly,
          greenBuilding: intake.green,
          ownerOperator: intake.ownerOperator,
          creditBand: intake.creditBand ? creditBandValue(intake.creditBand) : undefined,
          hardMoneyStrategy: hm?.strategy,
          rehabBudget: usd(hm?.rehabBudget),
          afterRepairValue: usd(hm?.arv),
          loanTermMonths: count(hm?.termMonths),
          existingPayoff: usd(hm?.existingPayoff),
          completedProjects: hm?.completedProjects ?? cons?.completedProjects,
          landCost: usd(cons?.landCost),
          hardCosts: usd(cons?.hardCosts),
          softCosts: usd(cons?.softCosts),
          constructionMonths: count(cons?.constructionMonths),
          asCompletedValue: usd(cons?.asCompletedValue),
          gmpContract: cons ? cons.gmpContract : undefined,
          monthlyRent: usd(intake.rental?.monthlyRent),
          monthlyTaxesInsuranceHoa: usd(intake.rental?.monthlyTaxesInsuranceHoa),
        }),
    ...(d
      ? {
          primaryProgram: d.primaryProgramFit,
          secondaryProgram: d.secondaryProgramFit,
          leadTier: d.leadUrgencyTier,
          assetVertical: d.assetVertical,
          sizingFlag: d.sizingOptimizationFlag,
          callRightAway: d.requiresImmediateBrokerCall,
          recommendedLenders: text(d.recommendedWholesaleLenders.map(label).join(", ")),
        }
      : {}),
  });
}

/** The company fields for a partner registration. */
export function companyFields(reg: PartnerRegistration, partnerId?: string | null): TwentyFieldValues {
  const base = { sitePartnerId: text(partnerId), partnerType: reg.partnerType };
  switch (reg.partnerType) {
    case "LENDER":
      return clean("company", {
        ...base,
        lenderType: reg.lenderKind,
        minLoan: usd(reg.minLoan),
        maxLoan: usd(reg.maxLoan),
        lendingVerticals: reg.verticals.length ? [...reg.verticals] : undefined,
        maxLtvPct: reg.maxLtv,
        maxLtcPct: reg.maxLtc,
        minDscr: reg.minDscr,
        minDebtYieldPct: reg.minDebtYield,
        flagRequirements: text(reg.flagRequirements),
        brokerFeeProtectionPct: reg.brokerFeeProtectionPct,
        marketsServed: text(reg.states),
      });
    case "REFERRAL":
      return clean("company", { ...base, licenseType: reg.licenseType, licenseNumbers: text(reg.licenseNumber), marketsServed: text(reg.marketsServed) });
    case "OPERATOR":
      return clean("company", {
        ...base,
        operatorType: reg.operatorKind,
        licenseNumbers: text(reg.licenseNumbers),
        unitsUnderManagement: reg.unitsUnderManagement,
        flagsApproved: text(reg.flagsApproved),
        marketsServed: text(reg.markets),
      });
    case "VENDOR":
      return clean("company", { ...base, vendorServices: [...reg.services], marketsServed: text(reg.markets), typicalTurnaroundDays: reg.typicalTurnaroundDays });
  }
}

/** ops/twenty/fields.json, the field list the CRM's schema script applies (generated by `npm run twenty:fields`). */
export function fieldsManifest() {
  return { $comment: "Generated from lib/crm/twenty-fields.ts by `npm run twenty:fields`. Do not edit by hand.", fields: TWENTY_FIELDS };
}
