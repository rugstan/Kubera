// The editor's fields, one list per section, and the form parsing that turns a
// section's posted fields into a store patch (pure, so it is unit tested and
// shared by the server components that render the forms and the server action
// that saves them).
//
// Names: a profile column is its camelCase key ("asIsValueCents"); a program
// section value is "programDetails.<section>.<key>" (a nested object adds one
// more segment); a sponsor value is "sponsor.<key>". Inputs render
// id="field-<name>", which is where readiness fix links point.
//
// No ratio is a field here: LTV, LTC, DSCR, debt yield and every other metric
// are computed (lib/deals/submission/metrics.ts) and shown read-only.
// Labels never say "approved" (checkSummaryCopy refuses it).
//
// The store validates every merged row with lib/deals/submission/schema.ts;
// the checks here name the offending field first, so a refused save keeps
// what was typed and says which field to fix. Free text is checked with the
// store's own restricted-text rule (restrictedTextReason).

import {
  CONSENT_STATUS_LABELS,
  CONSTRUCTION_CONTRACT_LABELS,
  CREDIT_BAND_LABELS,
  CREDIT_EVENT_LABELS,
  EMAIL_FINANCIALS_MODE_LABELS,
  ENTITLEMENT_STATUS_LABELS,
  EXIT_STRATEGY_LABELS,
  HUD_SECTION_LABELS,
  LEASE_STATUS_LABELS,
  LIEN_POSITION_LABELS,
  LOAN_PURPOSE_LABELS,
  MARKET_RENT_SOURCE_LABELS,
  NOI_BASIS_LABELS,
  PERMIT_STATUS_LABELS,
  PLANS_STAGE_LABELS,
  RATE_TYPE_LABELS,
  RECOURSE_LABELS,
  SIZE_UNIT_LABELS,
  SOURCE_KIND_LABELS,
  SUBMISSION_ASSET_TYPE_LABELS,
  TENANCY_LABELS,
  TRANCHE_KIND_LABELS,
  USE_KIND_LABELS,
  VALUE_SOURCE_LABELS,
  SUBMISSION_ARRAY_LIMITS,
  SUBMISSION_TEXT_LIMITS,
  asIsValueSources,
  creditEventKinds,
  sourceKinds,
  stabilizedValueSources,
  submissionAssetTypes,
  useKinds,
  type CreditEvents,
  type FieldSource,
  type FieldSourceKey,
  type ProgramDetailKey,
  type ProgramDetails,
  type RiskItem,
  type SectionId,
  type SourceLine,
  type SponsorProfile,
  type SponsorProfilePatch,
  type SubmissionPlaybook,
  type SubmissionProfile,
  type SubmissionProfilePatch,
  type TopTenant,
  type UnitMixLine,
  type UseLine,
} from "@/lib/deals/submission/types";
import { PLAYBOOK_LABELS } from "@/lib/deals/submission/playbooks";
import { restrictedTextReason } from "@/lib/deals/submission/schema";

// ---------------------------------------------------------------------------
// Definitions

export type FieldKind =
  /** Dollars typed, cents stored, never negative. */
  | "money"
  /** Dollars typed, cents stored; may be negative (NOI, net worth). */
  | "signed_money"
  | "int"
  | "decimal"
  /** 0–100. */
  | "pct"
  | "date"
  | "text"
  | "textarea"
  | "enum"
  /** Not answered / Yes / No (a stored false is an answer). */
  | "bool"
  /** A checkbox for a column that is never null. */
  | "check";

export type Option = { value: string; label: string };

export type FieldDef = {
  kind: FieldKind;
  name: string;
  label: string;
  options?: readonly Option[];
  /** enum: the select has no "Not answered" choice (the column is never null). */
  noBlank?: boolean;
  min?: number;
  max?: number;
  maxLength?: number;
  /** A regular expression the trimmed text must match, and what to say when it does not. */
  pattern?: { re: RegExp; message: string };
  hint?: string;
  /** Spans the whole form row. */
  wide?: boolean;
  /** Shown only for these playbooks; values stay stored when hidden. */
  playbooks?: readonly SubmissionPlaybook[];
};

/**
 * A nested object stored under one key (budget, PIP, reserves requested).
 * zero_fill: any line set makes the whole object, blank lines are 0.
 * partial: the object holds the lines that are set.
 * keyed: the object exists only when `key` is answered.
 */
export type GroupDef = { kind: "group"; name: string; legend: string; hint?: string; mode: "zero_fill" | "partial" | "keyed"; key?: string; fields: FieldDef[]; playbooks?: readonly SubmissionPlaybook[] };

export type Entry = FieldDef | GroupDef;

const opts = <T extends string>(labels: Readonly<Record<T, string>>, order?: readonly T[]): Option[] => (order ?? (Object.keys(labels) as T[])).map((v) => ({ value: v, label: labels[v] }));

const money = (name: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ kind: "money", name, label, ...extra });
const signedMoney = (name: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ kind: "signed_money", name, label, ...extra });
const int = (name: string, label: string, min: number, max: number, extra: Partial<FieldDef> = {}): FieldDef => ({ kind: "int", name, label, min, max, ...extra });
const decimal = (name: string, label: string, min: number, max: number, extra: Partial<FieldDef> = {}): FieldDef => ({ kind: "decimal", name, label, min, max, ...extra });
const percent = (name: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ kind: "pct", name, label, min: 0, max: 100, ...extra });
const day = (name: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ kind: "date", name, label, ...extra });
const text = (name: string, label: string, maxLength: number, extra: Partial<FieldDef> = {}): FieldDef => ({ kind: "text", name, label, maxLength, ...extra });
const area = (name: string, label: string, maxLength: number, extra: Partial<FieldDef> = {}): FieldDef => ({ kind: "textarea", name, label, maxLength, wide: true, ...extra });
const choice = (name: string, label: string, options: readonly Option[], extra: Partial<FieldDef> = {}): FieldDef => ({ kind: "enum", name, label, options, ...extra });
const yesNo = (name: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ kind: "bool", name, label, ...extra });

const L = SUBMISSION_TEXT_LIMITS;
const pd = (section: ProgramDetailKey, key: string) => `programDetails.${section}.${key}`;
const sp = (key: string) => `sponsor.${key}`;

export const SECTION_FIELDS: Readonly<Partial<Record<SectionId, readonly Entry[]>>> = {
  loan_request: [
    choice("purpose", "Loan purpose", opts(LOAN_PURPOSE_LABELS)),
    int("requestedTermMonths", "Requested term (months)", 1, 480),
    int("requestedAmortMonths", "Amortization (months)", 12, 480, { hint: "Leave blank for interest-only for the whole term." }),
    int("requestedIoMonths", "Interest-only period (months)", 0, 480),
    choice("rateType", "Rate type", opts(RATE_TYPE_LABELS)),
    choice("recourse", "Recourse sought", opts(RECOURSE_LABELS)),
    choice("lienPosition", "Lien position", opts(LIEN_POSITION_LABELS)),
    day("targetCloseDate", "Target closing date"),
    text("closeDriver", "What drives the closing date", L.closeDriver, { hint: "A contract deadline, a maturity, a permit window." }),
    text("prepayPreference", "Prepayment preference", L.prepayPreference),
    text("existingLender", "Existing lender", L.existingLender, { hint: "Refinance only." }),
    money("existingDebtCents", "Existing debt balance (USD)"),
    decimal("existingRatePct", "Existing rate (%)", 0, 40),
    day("existingMaturityDate", "Existing debt matures"),
    money("cashOutCents", "Cash out to the borrower (USD)"),
    area("cashOutUse", "Use of the cash out", L.cashOutUse),
    decimal("assumedRatePct", "Assumed rate for DSCR sizing (%)", 0, 40, { hint: "A sizing assumption, shown to lenders as assumed, not a quote." }),
    int("assumedAmortMonths", "Assumed amortization for DSCR sizing (months)", 12, 480),
  ],
  property: [
    choice("assetType", "Property type", opts(SUBMISSION_ASSET_TYPE_LABELS, submissionAssetTypes)),
    text("propertyName", "Property name", L.propertyName),
    text("city", "City", L.city),
    text("county", "County", L.county),
    text("postalCode", "ZIP code", 10, { pattern: { re: /^\d{5}(-\d{4})?$/, message: "use five digits, or ZIP+4 (94611-1234)" } }),
    text("apn", "APN", L.apn),
    int("yearBuilt", "Year built", 1700, 2100),
    int("yearRenovated", "Year renovated", 1700, 2100),
    int("sizeCount", "Size", 0, 1_000_000),
    choice("sizeUnit", "Size measured in", opts(SIZE_UNIT_LABELS)),
    int("rentableSf", "Rentable square feet", 0, 100_000_000),
    decimal("landAcres", "Land (acres)", 0, 1_000_000),
    choice("tenancy", "Tenancy", opts(TENANCY_LABELS)),
    percent("ownerOccupiedPct", "Owner-occupied share (%)", { hint: "SBA loans: the operating business's share of the building." }),
    percent("occupancyPct", "Physical occupancy (%)"),
    day("occupancyAsOf", "Occupancy as of"),
    text("zoning", "Zoning", L.zoning),
    text("floodZone", "Flood zone", L.floodZone),
    yesNo("rentControl", "Rent control applies"),
    yesNo("seismicZone", "In a seismic zone"),
    { kind: "check", name: "maskAddress", label: "Show only the city and submarket in the email (confidential acquisition)", wide: true },
  ],
  value: [
    money("purchasePriceCents", "Purchase price (USD)"),
    day("purchaseCloseDate", "Purchase closing date"),
    money("asIsValueCents", "As-is value (USD)"),
    choice("asIsValueSource", "As-is value source", opts(VALUE_SOURCE_LABELS, asIsValueSources)),
    day("asIsValueAsOf", "As-is value date"),
    money("stabilizedValueCents", "After-repair, as-complete or as-stabilized value (USD)"),
    choice("stabilizedValueSource", "Stabilized value source", opts(VALUE_SOURCE_LABELS, stabilizedValueSources)),
  ],
  financials: [
    money("revenueCents", "Revenue, annual (USD)"),
    money("expensesCents", "Operating expenses, annual (USD)"),
    signedMoney("noiInPlaceCents", "NOI in place, annual (USD)"),
    day("noiPeriodEnd", "NOI period end"),
    choice("noiBasis", "NOI basis", opts(NOI_BASIS_LABELS)),
    signedMoney("noiStabilizedCents", "Stabilized NOI, annual (USD)", { hint: "Corin pro forma from the sponsor's plan; never shown on the same line as in-place NOI." }),
    int("stabilizationMonths", "Months to stabilize", 0, 120),
  ],
  sponsor: [
    area(sp("experienceSummary"), "Experience summary", L.experienceSummary, { hint: "80 characters or more. Never name a guarantor or give personal details; the email says \"the guarantors\"." }),
    int(sp("yearsExperience"), "Years of experience", 0, 80),
    int(sp("similarProjectsCount"), "Similar projects completed", 0, 10_000),
    int(sp("portfolioCount"), "Properties owned", 0, 100_000),
    text(sp("portfolioSizeNote"), "Portfolio note", L.portfolioSizeNote),
    signedMoney(sp("statedNetWorthCents"), "Stated combined net worth (USD)", { hint: "As stated by the sponsor before a personal financial statement is on file." }),
    money(sp("statedLiquidityCents"), "Stated combined liquidity (USD)"),
    day(sp("statedAsOf"), "Stated as of"),
    choice(sp("creditBand"), "Credit band (self-reported)", opts(CREDIT_BAND_LABELS)),
    text(sp("managementCompany"), "Property or hotel management company", L.managementCompany),
    choice(sp("emailFinancialsMode"), "Sponsor strength in the email", opts(EMAIL_FINANCIALS_MODE_LABELS), { noBlank: true }),
    area(sp("notes"), "Staff notes (never shown to a lender)", L.notes),
  ],
  plan_exit: [
    area("businessPlan", "Business plan", L.businessPlan, { hint: "200 characters or more for a short-term loan." }),
    choice("exitStrategy", "Exit strategy", opts(EXIT_STRATEGY_LABELS)),
    int("exitMonths", "Exit in (months)", 1, 480),
    area("exitDetail", "Exit detail", L.exitDetail, { hint: "Take-out lender type, the loan it supports, and a higher-rate check." }),
  ],
  construction: [
    {
      kind: "group",
      name: pd("construction", "budget"),
      legend: "Budget by category (USD)",
      hint: "Leave a line blank for zero. Used when no budget spread is saved.",
      mode: "zero_fill",
      fields: [
        money(pd("construction", "budget.landCents"), "Land"),
        money(pd("construction", "budget.hardCents"), "Hard costs"),
        money(pd("construction", "budget.softCents"), "Soft costs"),
        money(pd("construction", "budget.contingencyCents"), "Contingency"),
        money(pd("construction", "budget.developerFeeCents"), "Developer fee"),
        money(pd("construction", "budget.financingCents"), "Financing costs"),
        money(pd("construction", "budget.reservesCents"), "Reserves requested from the lender"),
      ],
    },
    int(pd("construction", "unitsToBuild"), "Units to build", 0, 100_000),
    int(pd("construction", "grossSf"), "Gross square feet", 0, 100_000_000),
    int(pd("construction", "constructionMonths"), "Construction (months)", 1, 120),
    int(pd("construction", "leaseUpMonths"), "Lease-up or sell-out (months)", 0, 120),
    choice(pd("construction", "contractType"), "Construction contract", opts(CONSTRUCTION_CONTRACT_LABELS)),
    choice(pd("construction", "entitlementStatus"), "Entitlements", opts(ENTITLEMENT_STATUS_LABELS)),
    choice(pd("construction", "permitStatus"), "Building permits", opts(PERMIT_STATUS_LABELS)),
    choice(pd("construction", "plansStage"), "Plans", opts(PLANS_STAGE_LABELS)),
    money(pd("construction", "equityInToDateCents"), "Sponsor equity in to date, land included (USD)"),
    yesNo(pd("construction", "completionGuaranty"), "Completion guaranty offered"),
    int(pd("construction", "groundUpProjectsCompleted"), "Ground-up projects the sponsor completed", 0, 10_000),
  ],
  rehab: [
    money(pd("rehab", "budgetCents"), "Rehab or capex budget (USD)"),
    int(pd("rehab", "months"), "Renovation (months)", 0, 120),
    area(pd("rehab", "scopeSummary"), "Scope of work", 1_000),
    {
      kind: "group",
      name: pd("rehab", "reservesRequested"),
      legend: "Reserves requested from the lender (USD)",
      hint: "The lender holds and administers these; Corin never does.",
      mode: "partial",
      fields: [money(pd("rehab", "reservesRequested.interestCents"), "Interest reserve"), money(pd("rehab", "reservesRequested.capexCents"), "Capex reserve"), money(pd("rehab", "reservesRequested.leasingCents"), "Leasing reserve")],
    },
  ],
  rental: [
    money(pd("rental", "monthlyRentCents"), "Monthly rent in place, whole property (USD)"),
    money(pd("rental", "marketRentCents"), "Monthly market rent (USD)"),
    choice(pd("rental", "marketRentSource"), "Market rent source", opts(MARKET_RENT_SOURCE_LABELS)),
    money(pd("rental", "monthlyTaxesCents"), "Monthly property taxes (USD)"),
    money(pd("rental", "monthlyInsuranceCents"), "Monthly insurance (USD)"),
    money(pd("rental", "monthlyHoaCents"), "Monthly HOA dues (USD)"),
    choice(pd("rental", "leaseStatus"), "Lease status", opts(LEASE_STATUS_LABELS)),
    day(pd("rental", "earliestLeaseEnd"), "Earliest lease end"),
    decimal(pd("rental", "reservesMonths"), "Reserves (months of payments)", 0, 120),
  ],
  sba: [
    text(pd("sba", "businessName"), "Operating business", 200),
    text(pd("sba", "naics"), "NAICS code", 6, { pattern: { re: /^\d{2,6}$/, message: "use the 2- to 6-digit NAICS code" } }),
    int(pd("sba", "yearsInBusiness"), "Years in business", 0, 200),
    int(pd("sba", "employees"), "Employees", 0, 100_000),
    money(pd("sba", "businessRevenueCents"), "Business revenue, annual (USD)"),
    signedMoney(pd("sba", "businessEbitdaCents"), "Business EBITDA, annual (USD)"),
    money(pd("sba", "existingBusinessDebtServiceCents"), "Existing business debt service, annual (USD)"),
    money(pd("sba", "equityInjectionCents"), "Equity injection (USD)"),
    text(pd("sba", "equityInjectionSource"), "Equity injection source", 300),
    yesNo(pd("sba", "franchise"), "Franchise"),
    yesNo(pd("sba", "changeOfOwnership"), "Change of ownership"),
    yesNo(pd("sba", "affiliates"), "Affiliated businesses"),
    text(pd("sba", "cdcName"), "Certified development company", 200, { playbooks: ["sba_504"] }),
    int(pd("sba", "jobsCreated"), "Jobs created or retained", 0, 100_000, { playbooks: ["sba_504"] }),
  ],
  hotel: [
    text(pd("hotel", "brand"), "Brand (or Independent)", 200),
    day(pd("hotel", "franchiseExpiry"), "Franchise agreement expires"),
    money(pd("hotel", "adrCents"), "ADR (USD)"),
    money(pd("hotel", "revparCents"), "RevPAR (USD)"),
    decimal(pd("hotel", "revparIndex"), "RevPAR index vs comp set", 0, 400, { hint: "100 = fair share (from the STR report)." }),
    percent(pd("hotel", "ffeReservePct"), "FF&E reserve (% of revenue)"),
    {
      kind: "group",
      name: pd("hotel", "pip"),
      legend: "Property improvement plan",
      mode: "keyed",
      key: pd("hotel", "pip.required"),
      fields: [
        yesNo(pd("hotel", "pip.required"), "The brand requires a PIP"),
        money(pd("hotel", "pip.budgetCents"), "PIP budget (USD)"),
        day(pd("hotel", "pip.deadline"), "PIP deadline"),
        yesNo(pd("hotel", "pip.brandApproved"), "Brand has signed off on the PIP scope"),
      ],
    },
  ],
  tenancy: [percent(pd("tenancy", "rolloverPctWithinTerm"), "Rent rolling over inside the term (%)"), int(pd("tenancy", "walMonths"), "Weighted average lease term left (months)", 0, 600)],
  agency: [
    percent(pd("agency", "economicOccupancyPct"), "Economic occupancy (%)"),
    percent(pd("agency", "studentOrSeniorPct"), "Student or senior concentration (%)"),
    area(pd("agency", "affordabilityNote"), "Affordability or rent restrictions", 1_000),
  ],
  hud: [
    choice(pd("hud", "section"), "HUD program", opts(HUD_SECTION_LABELS)),
    money(pd("hud", "repairsCents"), "Repairs the CNA calls for (USD)", { hint: "Enter 0 when none." }),
    text(pd("hud", "existingFhaNumber"), "Existing FHA number", 40),
    yesNo(pd("hud", "priorHudParticipation"), "Principals have prior HUD participation"),
    int(pd("hud", "licensedBeds"), "Licensed beds", 0, 10_000, { playbooks: ["hud_232"] }),
    text(pd("hud", "operatorName"), "Operator", 200, { playbooks: ["hud_232"] }),
    area(pd("hud", "payorMixNote"), "Payor mix", 1_000, { playbooks: ["hud_232"] }),
    area(pd("hud", "surveyHistoryNote"), "State survey history", 1_000, { playbooks: ["hud_232"] }),
  ],
  capital_stack: [
    text(pd("capitalStack", "seniorLender"), "Senior lender", 200),
    money(pd("capitalStack", "seniorAmountCents"), "Senior loan amount (USD)"),
    decimal(pd("capitalStack", "seniorRatePct"), "Senior rate (%)", 0, 40),
    day(pd("capitalStack", "seniorMaturity"), "Senior loan matures"),
    yesNo(pd("capitalStack", "seniorAllowsSubordinate"), "Senior loan allows subordinate financing"),
    choice(pd("capitalStack", "intercreditorStatus"), "Intercreditor agreement", opts(CONSENT_STATUS_LABELS), { playbooks: ["mezz_pref"] }),
    choice(pd("capitalStack", "consentStatus"), "Mortgage holder's consent", opts(CONSENT_STATUS_LABELS), { playbooks: ["c_pace"] }),
    choice(pd("capitalStack", "thisTrancheKind"), "This tranche", opts(TRANCHE_KIND_LABELS)),
    money(pd("capitalStack", "eligibleImprovementsCents"), "Eligible improvements cost (USD)", { playbooks: ["c_pace"] }),
    text(pd("capitalStack", "programJurisdiction"), "C-PACE program jurisdiction", 200, { playbooks: ["c_pace"] }),
  ],
};

/** Sections whose extra lists (sources and uses, risks, tenants, unit mix, credit events) are parsed below. */
export const LIST_LIMITS = { blankRows: 3, sources: SUBMISSION_ARRAY_LIMITS.sources, uses: SUBMISSION_ARRAY_LIMITS.uses, risks: SUBMISSION_ARRAY_LIMITS.risks, highlights: SUBMISSION_ARRAY_LIMITS.highlights, topTenants: SUBMISSION_ARRAY_LIMITS.topTenants, unitMix: 20 } as const;

export const SOURCE_KIND_OPTIONS = opts(SOURCE_KIND_LABELS, sourceKinds);
export const USE_KIND_OPTIONS = opts(USE_KIND_LABELS, useKinds);
export const CREDIT_EVENT_OPTIONS = creditEventKinds.map((k) => ({ value: k, label: CREDIT_EVENT_LABELS[k] }));

export function playbookOptions(allowed: readonly SubmissionPlaybook[]): Option[] {
  return allowed.map((p) => ({ value: p, label: PLAYBOOK_LABELS[p] }));
}

const shown = (e: { playbooks?: readonly SubmissionPlaybook[] }, playbook: SubmissionPlaybook) => !e.playbooks || e.playbooks.includes(playbook);

/** A section's entries for the playbook (hidden ones are left out but keep their stored values). */
export function visibleEntries(section: SectionId, playbook: SubmissionPlaybook): Entry[] {
  return (SECTION_FIELDS[section] ?? []).filter((e) => shown(e, playbook));
}

/** Every field (group members included) of a section, by name. */
export function fieldsOf(entries: readonly Entry[]): FieldDef[] {
  return entries.flatMap((e) => (e.kind === "group" ? e.fields : [e]));
}

// ---------------------------------------------------------------------------
// Reading stored values

/** The stored value behind a field name (undefined = unanswered). */
export function readValue(name: string, profile: SubmissionProfile | null, sponsor: SponsorProfile | null): unknown {
  const parts = name.split(".");
  let cur: unknown = parts[0] === "sponsor" ? sponsor : profile;
  for (const p of parts[0] === "sponsor" ? parts.slice(1) : parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** The field_sources key a field name belongs to (a nested object has one source); null for sponsor values. */
export function sourceKeyFor(name: string): FieldSourceKey | null {
  if (name.startsWith("sponsor.")) return null;
  const parts = name.split(".");
  return (parts[0] === "programDetails" ? parts.slice(0, 3).join(".") : parts[0]) as FieldSourceKey;
}

/** The text an input starts with for a stored value. */
export function inputDefault(def: FieldDef, value: unknown): string {
  if (value === null || value === undefined) return "";
  switch (def.kind) {
    case "money":
    case "signed_money": {
      const c = Number(value);
      if (!Number.isFinite(c)) return "";
      const abs = Math.abs(c);
      const s = abs % 100 === 0 ? String(abs / 100) : (abs / 100).toFixed(2);
      return c < 0 ? `-${s}` : s;
    }
    case "bool":
      return value === true ? "yes" : value === false ? "no" : "";
    case "check":
      return value === true ? "on" : "";
    default:
      return String(value);
  }
}

// ---------------------------------------------------------------------------
// Parsing

export type FormLike = { get(name: string): FormDataEntryValue | null };
export type FieldError = { name: string; label: string; message: string };
export type SectionValues = { target: "profile"; patch: SubmissionProfilePatch } | { target: "sponsor"; patch: SponsorProfilePatch };
export type ParseContext = {
  playbook: SubmissionPlaybook;
  allowedPlaybooks: readonly SubmissionPlaybook[];
  profile: SubmissionProfile | null;
  sponsor: SponsorProfile | null;
  actor: string;
  /** ISO timestamp the entered sources carry. */
  at: string;
};

/**
 * Identifiers never belong in free text (spec 5.4): the same check the store
 * applies (schema.ts restrictedTextReason, on redaction.ts's patterns), so a
 * refusal names the field here instead of failing the whole save.
 */
export function restrictedTextProblem(s: string): string | null {
  const what = restrictedTextReason(s);
  return what ? `remove ${what}; personal identifiers stay in the vault and reach a lender only as documents behind the share link` : null;
}

const raw = (f: FormLike, name: string): string => {
  const v = f.get(name);
  return typeof v === "string" ? v.trim() : "";
};

class Collector {
  readonly errors: FieldError[] = [];
  add(name: string, label: string, message: string) {
    this.errors.push({ name, label, message });
  }
}

function parseDollars(s: string, signed: boolean): number | null | "bad" {
  let t = s.replace(/[$,\s]/g, "");
  let neg = false;
  if (/^\(.*\)$/.test(t)) {
    neg = true;
    t = t.slice(1, -1);
  } else if (t.startsWith("-")) {
    neg = true;
    t = t.slice(1);
  }
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return "bad";
  if (neg && !signed) return "bad";
  const [whole, frac = ""] = t.split(".") as [string, string?];
  const cents = Number(whole) * 100 + Number((frac ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > 100_000_000_000_000) return "bad";
  return neg ? -cents : cents;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
function validDay(s: string): boolean {
  if (!ISO_DAY.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** One field's posted value: undefined = left blank, or the typed value. Problems go to the collector with the field's label. */
export function parseField(def: FieldDef, f: FormLike, c: Collector): unknown {
  const s = raw(f, def.name);
  const bad = (message: string) => {
    c.add(def.name, def.label, message);
    return undefined;
  };
  if (def.kind === "check") return s === "on";
  if (!s) return undefined;
  switch (def.kind) {
    case "money":
    case "signed_money": {
      const v = parseDollars(s, def.kind === "signed_money");
      return v === "bad" ? bad(def.kind === "money" ? "enter a dollar amount like 1,250,000" : "enter a dollar amount like 1,250,000 or -45,000") : v;
    }
    case "int":
    case "decimal":
    case "pct": {
      const n = Number(s.replace(/[,%x\s]/gi, ""));
      if (!Number.isFinite(n)) return bad("enter a number");
      if (def.kind === "int" && !Number.isInteger(n)) return bad("enter a whole number");
      if ((def.min !== undefined && n < def.min) || (def.max !== undefined && n > def.max)) return bad(`enter a number from ${def.min ?? 0} to ${def.max ?? "any"}`);
      return n;
    }
    case "date":
      return validDay(s) ? s : bad("enter a date as YYYY-MM-DD");
    case "text":
    case "textarea": {
      if (def.maxLength && s.length > def.maxLength) return bad(`keep it to ${def.maxLength} characters`);
      if (def.pattern && !def.pattern.re.test(s)) return bad(def.pattern.message);
      const problem = restrictedTextProblem(s);
      return problem ? bad(problem) : s;
    }
    case "enum":
      return def.options?.some((o) => o.value === s) ? s : bad("pick one of the listed choices");
    case "bool":
      return s === "yes" ? true : s === "no" ? false : bad("answer yes or no");
  }
}

function setPath(target: Record<string, unknown>, path: string[], value: unknown) {
  let cur = target;
  for (const p of path.slice(0, -1)) {
    if (typeof cur[p] !== "object" || cur[p] === null) cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  const last = path.at(-1)!;
  if (value === undefined) delete cur[last];
  else cur[last] = value;
}

const programKeyOf = (name: string) => name.split(".")[1] as ProgramDetailKey;
/** Path of a program-section field inside its section object: "programDetails.hotel.pip.budgetCents" → ["pip", "budgetCents"]. */
const innerPath = (name: string) => name.split(".").slice(2);

/** Applies the posted entries of one section onto copies of the stored values. */
function applyEntries(entries: readonly Entry[], f: FormLike, c: Collector, profile: Record<string, unknown>, program: Partial<Record<ProgramDetailKey, Record<string, unknown>>>, sponsor: Record<string, unknown>) {
  const put = (name: string, value: unknown) => {
    if (name.startsWith("sponsor.")) sponsor[name.slice(8)] = value === undefined ? null : value;
    else if (name.startsWith("programDetails.")) {
      const key = programKeyOf(name);
      program[key] ??= {};
      setPath(program[key]!, innerPath(name), value);
    } else profile[name] = value === undefined ? null : value;
  };
  for (const e of entries) {
    if (e.kind !== "group") {
      const v = parseField(e, f, c);
      // A never-null select (emailFinancialsMode) keeps its stored value when nothing valid was posted.
      if (e.noBlank && v === undefined) continue;
      put(e.name, v);
      continue;
    }
    const values = e.fields.map((d) => [d, parseField(d, f, c)] as const);
    const anySet = values.some(([, v]) => v !== undefined);
    if (e.mode === "zero_fill") {
      put(e.name, anySet ? Object.fromEntries(values.map(([d, v]) => [d.name.split(".").at(-1)!, v ?? 0])) : undefined);
    } else if (e.mode === "partial") {
      put(e.name, anySet ? Object.fromEntries(values.filter(([, v]) => v !== undefined).map(([d, v]) => [d.name.split(".").at(-1)!, v])) : undefined);
    } else {
      const keyValue = values.find(([d]) => d.name === e.key)?.[1];
      if (keyValue === undefined) {
        if (anySet) {
          const keyDef = e.fields.find((d) => d.name === e.key)!;
          c.add(keyDef.name, keyDef.label, "answer yes or no before adding the other details");
        }
        put(e.name, undefined);
      } else put(e.name, Object.fromEntries(values.filter(([, v]) => v !== undefined).map(([d, v]) => [d.name.split(".").at(-1)!, v])));
    }
  }
}

// Lists ----------------------------------------------------------------------------

function capitalLines<K extends string>(f: FormLike, c: Collector, list: "sources" | "uses", kinds: readonly K[], labels: Readonly<Record<K, string>>, limit: number): { kind: K; amountCents: number; note?: string }[] {
  const title = list === "sources" ? "Sources" : "Uses";
  const out: { kind: K; amountCents: number; note?: string }[] = [];
  for (let i = 0; i < limit; i++) {
    const kind = raw(f, `${list}.${i}.kind`);
    const amount = raw(f, `${list}.${i}.amount`);
    const note = raw(f, `${list}.${i}.note`);
    if (!amount && !note) continue;
    const name = `${list}.${i}.amount`;
    const label = `${title} line ${i + 1}`;
    if (!(kinds as readonly string[]).includes(kind)) {
      c.add(`${list}.${i}.kind`, label, "pick what the line is");
      continue;
    }
    const cents = parseDollars(amount, false);
    if (cents === "bad" || cents === null || cents <= 0) {
      c.add(name, `${label} (${labels[kind as K]})`, "enter an amount above zero");
      continue;
    }
    const problem = note ? restrictedTextProblem(note) : null;
    if (problem) c.add(`${list}.${i}.note`, `${label} note`, problem);
    if (note.length > 200) c.add(`${list}.${i}.note`, `${label} note`, "keep it to 200 characters");
    if (kind === "other" && !note) c.add(`${list}.${i}.note`, `${label} note`, "name an \"Other\" line");
    out.push({ kind: kind as K, amountCents: cents, ...(note ? { note } : {}) });
  }
  return out;
}

function riskLines(f: FormLike, c: Collector): RiskItem[] {
  const out: RiskItem[] = [];
  for (let i = 0; i < LIST_LIMITS.risks; i++) {
    const risk = raw(f, `risks.${i}.risk`);
    const mitigant = raw(f, `risks.${i}.mitigant`);
    if (!risk && !mitigant) continue;
    if (!risk || !mitigant) {
      c.add(`risks.${i}.${risk ? "mitigant" : "risk"}`, `Known issue ${i + 1}`, "give both the issue and its mitigant");
      continue;
    }
    for (const [k, v] of [["risk", risk], ["mitigant", mitigant]] as const) {
      const problem = restrictedTextProblem(v);
      if (problem) c.add(`risks.${i}.${k}`, `Known issue ${i + 1}`, problem);
      if (v.length > 600) c.add(`risks.${i}.${k}`, `Known issue ${i + 1}`, "keep each part to 600 characters");
    }
    out.push({ risk, mitigant });
  }
  return out;
}

function highlightLines(f: FormLike, c: Collector): string[] {
  const lines = raw(f, "highlights")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (lines.length > LIST_LIMITS.highlights) c.add("highlights", "Highlights", `keep it to ${LIST_LIMITS.highlights} lines`);
  for (const l of lines) {
    const problem = restrictedTextProblem(l);
    if (problem) {
      c.add("highlights", "Highlights", problem);
      break;
    }
    if (l.length > 300) {
      c.add("highlights", "Highlights", "keep each line to 300 characters");
      break;
    }
  }
  return lines.slice(0, LIST_LIMITS.highlights);
}

function tenantLines(f: FormLike, c: Collector): TopTenant[] {
  const out: TopTenant[] = [];
  for (let i = 0; i < LIST_LIMITS.topTenants; i++) {
    const name = raw(f, `tenants.${i}.name`);
    const share = raw(f, `tenants.${i}.sharePct`);
    const end = raw(f, `tenants.${i}.leaseEnd`);
    if (!name && !share && !end) continue;
    const label = `Tenant ${i + 1}`;
    const n = Number(share.replace(/[%\s]/g, ""));
    if (!name) c.add(`tenants.${i}.name`, label, "name the tenant");
    else if (restrictedTextProblem(name)) c.add(`tenants.${i}.name`, label, restrictedTextProblem(name)!);
    if (!share || !Number.isFinite(n) || n < 0 || n > 100) c.add(`tenants.${i}.sharePct`, `${label} share of rent`, "enter a percent from 0 to 100");
    if (!validDay(end)) c.add(`tenants.${i}.leaseEnd`, `${label} lease end`, "enter a date as YYYY-MM-DD");
    if (name && Number.isFinite(n) && validDay(end)) out.push({ name: name.slice(0, 200), sharePct: n, leaseEnd: end });
  }
  return out;
}

function unitMixLines(f: FormLike, c: Collector): UnitMixLine[] {
  const out: UnitMixLine[] = [];
  for (let i = 0; i < LIST_LIMITS.unitMix; i++) {
    const type = raw(f, `unitMix.${i}.type`);
    const n = raw(f, `unitMix.${i}.count`);
    const rent = raw(f, `unitMix.${i}.avgRent`);
    if (!type && !n && !rent) continue;
    const label = `Unit type ${i + 1}`;
    const countN = Number(n.replace(/,/g, ""));
    const cents = parseDollars(rent, false);
    if (!type) c.add(`unitMix.${i}.type`, label, "name the unit type (for example 2 bed / 1 bath)");
    if (!Number.isInteger(countN) || countN <= 0) c.add(`unitMix.${i}.count`, `${label} units`, "enter a whole number above zero");
    if (cents === "bad" || cents === null) c.add(`unitMix.${i}.avgRent`, `${label} average rent`, "enter a monthly rent in dollars");
    if (type && Number.isInteger(countN) && countN > 0 && typeof cents === "number") out.push({ type: type.slice(0, 80), count: countN, avgRentCents: cents });
  }
  return out;
}

function creditEventAnswers(f: FormLike, c: Collector): CreditEvents {
  const out: CreditEvents = {};
  for (const k of creditEventKinds) {
    const a = raw(f, `sponsor.creditEvents.${k}`);
    const why = raw(f, `sponsor.creditEvents.${k}.explanation`);
    if (!a) continue;
    if (a !== "yes" && a !== "no") continue;
    if (a === "yes" && !why) c.add(`sponsor.creditEvents.${k}.explanation`, CREDIT_EVENT_LABELS[k], "explain what happened and when");
    const problem = why ? restrictedTextProblem(why) : null;
    if (problem) c.add(`sponsor.creditEvents.${k}.explanation`, CREDIT_EVENT_LABELS[k], problem);
    out[k] = a === "yes" ? { occurred: true, ...(why ? { explanation: why.slice(0, 1000) } : {}) } : { occurred: false };
  }
  return out;
}

// Sources ----------------------------------------------------------------------------

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const blank = (v: unknown) => v === null || v === undefined || (Array.isArray(v) && v.length === 0);

/**
 * field_sources changes for the keys a save touched: a changed value becomes
 * "entered" by the actor; a cleared value loses its source; an unchanged value
 * keeps the source it had (a value staff confirmed without editing stays
 * "per borrower" or "from document").
 */
export function sourceChanges(touched: Iterable<[FieldSourceKey, unknown]>, profile: SubmissionProfile | null, actor: string, at: string): Partial<Record<FieldSourceKey, FieldSource | null>> {
  const out: Partial<Record<FieldSourceKey, FieldSource | null>> = {};
  for (const [key, next] of touched) {
    const before = readValue(key, profile, null);
    if (same(before, next)) continue;
    if (blank(next)) {
      if (profile?.fieldSources[key]) out[key] = null;
    } else out[key] = { source: "entered", by: actor, at };
  }
  return out;
}

// ---------------------------------------------------------------------------
// The section form

const SPONSOR_SECTION: SectionId = "sponsor";

/**
 * Parses one section's form into the patch the store takes. Returns every
 * problem, each named by the field's visible label, and no patch when there is
 * any problem (nothing is saved).
 */
export function parseSectionForm(section: SectionId, f: FormLike, ctx: ParseContext): { values: SectionValues | null; errors: FieldError[] } {
  const c = new Collector();
  const entries = visibleEntries(section, ctx.playbook);
  const profile: Record<string, unknown> = {};
  const sponsor: Record<string, unknown> = {};
  // Program sections start from what is stored, so fields hidden for this playbook keep their values.
  const program: Partial<Record<ProgramDetailKey, Record<string, unknown>>> = {};
  for (const e of entries) {
    if (!e.name.startsWith("programDetails.")) continue;
    const key = programKeyOf(e.name);
    program[key] ??= structuredClone((ctx.profile?.programDetails[key] as Record<string, unknown> | undefined) ?? {});
  }
  applyEntries(entries, f, c, profile, program, sponsor);

  if (section === "loan_request") {
    const pb = raw(f, "playbook");
    if (pb) {
      if ((ctx.allowedPlaybooks as readonly string[]).includes(pb)) profile.playbook = pb;
      else c.add("playbook", "Playbook", "pick one of the playbooks this program allows");
    }
    const term = profile.requestedTermMonths as number | null;
    const io = profile.requestedIoMonths as number | null;
    if (typeof term === "number" && typeof io === "number" && io > term) c.add("requestedIoMonths", "Interest-only period (months)", "cannot be longer than the requested term");
  }
  if (section === "sources_uses") {
    profile.sources = capitalLines(f, c, "sources", sourceKinds, SOURCE_KIND_LABELS, LIST_LIMITS.sources) satisfies SourceLine[];
    profile.uses = capitalLines(f, c, "uses", useKinds, USE_KIND_LABELS, LIST_LIMITS.uses) satisfies UseLine[];
  }
  if (section === "plan_exit") {
    profile.highlights = highlightLines(f, c);
    profile.risks = riskLines(f, c);
  }
  if (section === "tenancy") {
    program.tenancy ??= structuredClone((ctx.profile?.programDetails.tenancy as Record<string, unknown> | undefined) ?? {});
    const tenants = tenantLines(f, c);
    if (tenants.length) program.tenancy.topTenants = tenants;
    else delete program.tenancy.topTenants;
  }
  if (section === "agency") {
    program.agency ??= structuredClone((ctx.profile?.programDetails.agency as Record<string, unknown> | undefined) ?? {});
    const mix = unitMixLines(f, c);
    if (mix.length) program.agency.unitMix = mix;
    else delete program.agency.unitMix;
  }
  if (section === SPONSOR_SECTION) {
    sponsor.creditEvents = creditEventAnswers(f, c);
    const stated = sponsor.statedNetWorthCents !== null || sponsor.statedLiquidityCents !== null;
    if (stated && !sponsor.statedAsOf) c.add("sponsor.statedAsOf", "Stated as of", "give the date the sponsor stated the figures");
  }
  if (c.errors.length) return { values: null, errors: c.errors };

  if (section === SPONSOR_SECTION) return { values: { target: "sponsor", patch: sponsor as SponsorProfilePatch }, errors: [] };

  const patch: SubmissionProfilePatch = { ...(profile as SubmissionProfilePatch) };
  const programDetails = Object.fromEntries(Object.entries(program)) as ProgramDetails;
  if (Object.keys(programDetails).length) patch.programDetails = programDetails;
  if (!ctx.profile && !patch.playbook) patch.playbook = ctx.playbook;

  // Sources for every key this form owns, compared against what is stored.
  const touched: [FieldSourceKey, unknown][] = [];
  for (const [k, v] of Object.entries(profile)) if (k !== "playbook") touched.push([k as FieldSourceKey, v]);
  for (const [section, obj] of Object.entries(program) as [ProgramDetailKey, Record<string, unknown>][]) {
    const owned = new Set(fieldsOf(entries).filter((d) => d.name.startsWith(`programDetails.${section}.`)).map((d) => d.name.split(".")[2]!));
    if (section === "tenancy") owned.add("topTenants");
    if (section === "agency") owned.add("unitMix");
    for (const k of owned) touched.push([`programDetails.${section}.${k}` as FieldSourceKey, obj[k]]);
  }
  const fieldSources = sourceChanges(touched, ctx.profile, ctx.actor, ctx.at);
  if (Object.keys(fieldSources).length) patch.fieldSources = fieldSources;
  return { values: { target: "profile", patch }, errors: [] };
}
