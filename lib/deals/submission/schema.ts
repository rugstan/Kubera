// Zod schemas for the deal submission profile (spec 3.3, 4.7): one schema per
// editor section, one per program section (program_details jsonb), the sponsor
// profile and the field sources. Every schema mirrors the check constraints of
// 20261105160000_int_deal_submission.sql (the twin tests in schema.test.ts and
// migration.test.ts prove it) and adds what the database cannot see: unknown
// keys in program sections are refused, and free text that looks like an SSN,
// an account or routing number, a card number or a date of birth is refused
// (it belongs in the vault, never in a field a lender may read).
//
// Form input is accepted as the browser sends it: a blank string means "no
// value" (null on a column, absent in a program section), numbers may arrive as
// numeric strings ("1,250,000") and booleans as "true" / "on" / "yes".
// Section schemas are partial: a key that is absent is left unchanged by the
// store, null clears it.

import { z } from "zod";
import { detectSensitiveValues } from "@/lib/privacy/classification";
import { RESTRICTED_TEXT_PATTERNS, findRestrictedText, normalizeForScan } from "./redaction";
import {
  asIsValueSources,
  consentStatuses,
  constructionContractTypes,
  creditEventKinds,
  emailFinancialsModes,
  entitlementStatuses,
  exitStrategies,
  hudSections,
  leaseStatuses,
  loanPurposes,
  marketRentSources,
  noiBases,
  permitStatuses,
  plansStages,
  programDetailKeys,
  rateTypes,
  recourseOptions,
  sizeUnits,
  sourceKinds,
  sourceRecordTables,
  sponsorCreditBands,
  stabilizedValueSources,
  SUBMISSION_ARRAY_LIMITS,
  SUBMISSION_TEXT_LIMITS,
  submissionAssetTypes,
  submissionLienPositions,
  submissionPlaybooks,
  tenancyKinds,
  trancheKinds,
  useKinds,
  type FieldSourceKey,
  type FieldSources,
  type ProfileFieldKey,
  type ProgramDetailKey,
  type ProgramDetails,
  type SponsorProfileFields,
  type SubmissionProfileFields,
  type SubmissionProfilePatch,
  type SponsorProfilePatch,
} from "./types";

// ---------------------------------------------------------------------------
// Restricted text
//
// Saved free text is normalized (redaction.ts normalizeForScan: NFKC, Unicode
// digits as ASCII, format characters removed) and refused on the same shapes
// the lender email is (redaction.ts RESTRICTED_TEXT_PATTERNS: SSN / ITIN in
// any grouping or wording, EIN, nine-digit runs, account groupings,
// date-of-birth and account wording), which the database checks too
// (public.submission_text_restricted), and on the restricted detectors of
// lib/privacy/classification.ts (card numbers).

/** Twin of deal_submission_profiles.postal_code. */
export const POSTAL_CODE_DB_RE = /^[0-9]{5}(-[0-9]{4})?$/;
/** Twin of deal_submission_profiles.asset_type (the enum is stricter). */
export const ASSET_TYPE_DB_RE = /^[A-Z0-9_]{2,40}$/;

export const RESTRICTED_TEXT_MESSAGE = "Remove the SSN, account or routing number, card number or date of birth: it belongs in the document vault, not in this field.";

/** What `text` holds that may not be saved (the kind of data, never the value), or null when it may be saved. */
export function restrictedTextReason(text: string): string | null {
  const finding = findRestrictedText(text)[0];
  if (finding) return finding.label;
  const hit = detectSensitiveValues(normalizeForScan(text)).find((f) => f.level === "restricted");
  return hit ? hit.detector.replace(/_/g, " ") : null;
}

export function isSafeText(text: string): boolean {
  return restrictedTextReason(text) === null;
}

// ---------------------------------------------------------------------------
// Form-input coercion

/** "" and whitespace are "no value". undefined stays undefined (absent = unchanged). */
const blank = (v: unknown): unknown => (typeof v === "string" && v.trim() === "" ? null : v);
const numeric = (v: unknown): unknown => {
  const b = blank(v);
  if (typeof b !== "string") return b;
  const s = b.replace(/[,\s$_]/g, "");
  const n = Number(s);
  return s !== "" && Number.isFinite(n) ? n : b;
};
const boolish = (v: unknown): unknown => {
  const b = blank(v);
  if (typeof b !== "string") return b;
  const s = b.trim().toLowerCase();
  if (["true", "on", "yes", "1"].includes(s)) return true;
  if (["false", "off", "no", "0"].includes(s)) return false;
  return b;
};

/** bigint columns: JavaScript numbers stay exact up to this. */
export const MAX_CENTS = Number.MAX_SAFE_INTEGER;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Free text: stored normalized (so the database checks read what the app checked), trimmed, and refused when it holds a restricted identifier. */
const text = (max: number) => z.preprocess((v) => (typeof v === "string" ? normalizeForScan(v) : v), z.string().trim().min(1, "Required").max(max).refine(isSafeText, RESTRICTED_TEXT_MESSAGE));
/** The APN is an identifier, not free text: letters, digits, dashes, dots and spaces, and never an SSN shape. */
const nApn = (max: number) =>
  z.preprocess(
    blank,
    z
      .string()
      .trim()
      .max(max)
      .regex(/^[0-9A-Za-z][0-9A-Za-z .-]*$/, "Enter the APN as printed (letters, digits, dashes and spaces)")
      .refine((v) => !RESTRICTED_TEXT_PATTERNS[0]!.re.test(v), RESTRICTED_TEXT_MESSAGE)
      .nullable(),
  );
const nText = (max: number) => z.preprocess(blank, text(max).nullable());
const intIn = (min: number, max: number) => z.number().int().min(min).max(max);
const nInt = (min: number, max: number) => z.preprocess(numeric, intIn(min, max).nullable());
/** numeric(p, 3) columns: stored to three decimals, so rounded here too. */
const decIn = (min: number, max: number) => z.number().finite().min(min).max(max).transform(round3);
const nDec = (min: number, max: number) => z.preprocess(numeric, decIn(min, max).nullable());
const cents = (min = 0) => intIn(min, MAX_CENTS);
const nCents = (min = 0) => z.preprocess(numeric, cents(min).nullable());
const nDate = z.preprocess(blank, z.iso.date().nullable());
const nBool = z.preprocess(boolish, z.boolean().nullable());
const nEnum = <const T extends readonly [string, ...string[]]>(values: T) => z.preprocess(blank, z.enum(values).nullable());

// Program-section leaves: absent = unanswered; a blank or null input is dropped.
const oText = (max: number) => text(max).optional();
const oInt = (min: number, max: number) => z.preprocess(numeric, intIn(min, max).optional());
const oDec = (min: number, max: number) => z.preprocess(numeric, decIn(min, max).optional());
const oCents = (min = 0) => z.preprocess(numeric, cents(min).optional());
const oDate = z.iso.date().optional();
const oBool = z.preprocess(boolish, z.boolean().optional());
const oEnum = <const T extends readonly [string, ...string[]]>(values: T) => z.enum(values).optional();

/** Drops blank and null keys, so "no answer" is stored as an absent key (types.ts convention). */
const dropBlank = (v: unknown): unknown => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== null && x !== undefined && !(typeof x === "string" && x.trim() === "")));
};
const section = <S extends z.ZodRawShape>(shape: S) => z.preprocess(dropBlank, z.strictObject(shape));

// ---------------------------------------------------------------------------
// Number limits mirrored from the column checks (schema.test.ts proves each against the SQL)

export type NumberLimit = { min: number; max: number; int: boolean };
const lim = (min: number, max: number, int = true): NumberLimit => ({ min, max, int });

export const PROFILE_NUMBER_LIMITS = {
  requestedTermMonths: lim(1, 480),
  requestedAmortMonths: lim(12, 480),
  requestedIoMonths: lim(0, 480),
  existingDebtCents: lim(0, MAX_CENTS),
  existingRatePct: lim(0, 40, false),
  cashOutCents: lim(0, MAX_CENTS),
  assumedRatePct: lim(0, 40, false),
  assumedAmortMonths: lim(12, 480),
  yearBuilt: lim(1700, 2100),
  yearRenovated: lim(1700, 2100),
  sizeCount: lim(0, 1_000_000),
  rentableSf: lim(0, 100_000_000),
  landAcres: lim(0, 1_000_000, false),
  ownerOccupiedPct: lim(0, 100, false),
  occupancyPct: lim(0, 100, false),
  purchasePriceCents: lim(0, MAX_CENTS),
  asIsValueCents: lim(0, MAX_CENTS),
  stabilizedValueCents: lim(0, MAX_CENTS),
  revenueCents: lim(0, MAX_CENTS),
  expensesCents: lim(0, MAX_CENTS),
  noiInPlaceCents: lim(-MAX_CENTS, MAX_CENTS),
  noiStabilizedCents: lim(-MAX_CENTS, MAX_CENTS),
  stabilizationMonths: lim(0, 120),
  exitMonths: lim(1, 480),
} as const satisfies Partial<Record<ProfileFieldKey, NumberLimit>>;

export const SPONSOR_NUMBER_LIMITS = {
  yearsExperience: lim(0, 80),
  similarProjectsCount: lim(0, 10_000),
  portfolioCount: lim(0, 100_000),
  statedNetWorthCents: lim(-100_000_000_000_000, 100_000_000_000_000),
  statedLiquidityCents: lim(0, 100_000_000_000_000),
} as const satisfies Partial<Record<keyof SponsorProfileFields, NumberLimit>>;

const fromLimit = (l: NumberLimit) => (l.int ? nInt(l.min, l.max) : nDec(l.min, l.max));
const P = PROFILE_NUMBER_LIMITS;
const T = SUBMISSION_TEXT_LIMITS;
const A = SUBMISSION_ARRAY_LIMITS;

/** Item lengths for the array columns (the database caps only the count). */
export const ITEM_TEXT_LIMITS = { highlight: 300, risk: 300, mitigant: 1000, capitalLineNote: 200 } as const;

// ---------------------------------------------------------------------------
// jsonb items on the profile

export const riskItemSchema = z.strictObject({ risk: text(ITEM_TEXT_LIMITS.risk), mitigant: text(ITEM_TEXT_LIMITS.mitigant) });

const capitalLine = <const K extends readonly [string, ...string[]]>(kinds: K) =>
  z
    .strictObject({
      kind: z.enum(kinds),
      /** Positive cents (types.ts CapitalLine). */
      amountCents: z.preprocess(numeric, cents(1)),
      note: z.preprocess(blank, text(ITEM_TEXT_LIMITS.capitalLineNote).nullable().optional()).transform((v) => v ?? undefined),
    })
    .refine((l) => l.kind !== "other" || Boolean(l.note), { message: "Name an \"other\" line in its note", path: ["note"] })
    .transform((l) => (l.note === undefined ? { kind: l.kind, amountCents: l.amountCents } : l));
export const sourceLineSchema = capitalLine(sourceKinds);
export const useLineSchema = capitalLine(useKinds);

// ---------------------------------------------------------------------------
// Profile columns, one schema per field

export const PROFILE_FIELD_SCHEMAS = {
  // Loan request
  purpose: nEnum(loanPurposes),
  requestedTermMonths: fromLimit(P.requestedTermMonths),
  requestedAmortMonths: fromLimit(P.requestedAmortMonths),
  requestedIoMonths: fromLimit(P.requestedIoMonths),
  rateType: nEnum(rateTypes),
  recourse: nEnum(recourseOptions),
  lienPosition: nEnum(submissionLienPositions),
  targetCloseDate: nDate,
  closeDriver: nText(T.closeDriver),
  prepayPreference: nText(T.prepayPreference),
  existingLender: nText(T.existingLender),
  existingDebtCents: nCents(),
  existingRatePct: fromLimit(P.existingRatePct),
  existingMaturityDate: nDate,
  cashOutCents: nCents(),
  cashOutUse: nText(T.cashOutUse),
  assumedRatePct: fromLimit(P.assumedRatePct),
  assumedAmortMonths: fromLimit(P.assumedAmortMonths),
  // Property
  assetType: nEnum(submissionAssetTypes),
  propertyName: nText(T.propertyName),
  city: nText(T.city),
  county: nText(T.county),
  postalCode: z.preprocess(blank, z.string().trim().regex(POSTAL_CODE_DB_RE, "Enter a 5-digit ZIP or ZIP+4").nullable()),
  apn: nApn(T.apn),
  yearBuilt: fromLimit(P.yearBuilt),
  yearRenovated: fromLimit(P.yearRenovated),
  sizeCount: fromLimit(P.sizeCount),
  sizeUnit: nEnum(sizeUnits),
  rentableSf: fromLimit(P.rentableSf),
  landAcres: fromLimit(P.landAcres),
  tenancy: nEnum(tenancyKinds),
  ownerOccupiedPct: fromLimit(P.ownerOccupiedPct),
  occupancyPct: fromLimit(P.occupancyPct),
  occupancyAsOf: nDate,
  zoning: nText(T.zoning),
  floodZone: nText(T.floodZone),
  rentControl: nBool,
  seismicZone: nBool,
  maskAddress: z.preprocess((v) => (blank(v) === null ? false : boolish(v)), z.boolean()),
  // Value
  purchasePriceCents: nCents(),
  purchaseCloseDate: nDate,
  asIsValueCents: nCents(),
  asIsValueSource: nEnum(asIsValueSources),
  asIsValueAsOf: nDate,
  stabilizedValueCents: nCents(),
  stabilizedValueSource: nEnum(stabilizedValueSources),
  // Operating financials
  revenueCents: nCents(),
  expensesCents: nCents(),
  noiInPlaceCents: nCents(-MAX_CENTS),
  noiPeriodEnd: nDate,
  noiBasis: nEnum(noiBases),
  noiStabilizedCents: nCents(-MAX_CENTS),
  stabilizationMonths: fromLimit(P.stabilizationMonths),
  // Business plan and exit
  businessPlan: nText(T.businessPlan),
  exitStrategy: nEnum(exitStrategies),
  exitMonths: fromLimit(P.exitMonths),
  exitDetail: nText(T.exitDetail),
  highlights: z.array(text(ITEM_TEXT_LIMITS.highlight)).max(A.highlights),
  risks: z.array(riskItemSchema).max(A.risks),
  // Sources and uses
  sources: z.array(sourceLineSchema).max(A.sources),
  uses: z.array(useLineSchema).max(A.uses),
} as const satisfies Record<ProfileFieldKey, z.ZodType>;

/** Every ProfileFieldKey (columns that may carry a field source), in column order. */
export const profileFieldKeys = Object.keys(PROFILE_FIELD_SCHEMAS) as ProfileFieldKey[];

// ---------------------------------------------------------------------------
// Program sections (program_details jsonb)

const constructionBudgetSchema = z.strictObject({
  landCents: z.preprocess(numeric, cents()),
  hardCents: z.preprocess(numeric, cents()),
  softCents: z.preprocess(numeric, cents()),
  contingencyCents: z.preprocess(numeric, cents()),
  developerFeeCents: z.preprocess(numeric, cents()),
  financingCents: z.preprocess(numeric, cents()),
  reservesCents: z.preprocess(numeric, cents()),
});

const constructionShape = {
  budget: constructionBudgetSchema.optional(),
  unitsToBuild: oInt(0, 1_000_000),
  grossSf: oInt(0, 100_000_000),
  constructionMonths: oInt(1, 120),
  leaseUpMonths: oInt(0, 120),
  contractType: oEnum(constructionContractTypes),
  entitlementStatus: oEnum(entitlementStatuses),
  permitStatus: oEnum(permitStatuses),
  plansStage: oEnum(plansStages),
  equityInToDateCents: oCents(),
  completionGuaranty: oBool,
  groundUpProjectsCompleted: oInt(0, 10_000),
};

const rehabShape = {
  budgetCents: oCents(),
  scopeSummary: oText(2000),
  months: oInt(1, 120),
  reservesRequested: section({ interestCents: oCents(), capexCents: oCents(), leasingCents: oCents() }).optional(),
};

const rentalShape = {
  monthlyRentCents: oCents(),
  marketRentCents: oCents(),
  marketRentSource: oEnum(marketRentSources),
  monthlyTaxesCents: oCents(),
  monthlyInsuranceCents: oCents(),
  monthlyHoaCents: oCents(),
  leaseStatus: oEnum(leaseStatuses),
  earliestLeaseEnd: oDate,
  reservesMonths: oDec(0, 120),
};

const sbaShape = {
  businessName: oText(200),
  naics: z.string().trim().regex(/^[0-9]{2,6}$/, "NAICS codes are 2 to 6 digits").optional(),
  yearsInBusiness: oDec(0, 200),
  employees: oInt(0, 1_000_000),
  businessRevenueCents: oCents(),
  businessEbitdaCents: oCents(-MAX_CENTS),
  existingBusinessDebtServiceCents: oCents(),
  equityInjectionCents: oCents(),
  equityInjectionSource: oText(300),
  franchise: oBool,
  changeOfOwnership: oBool,
  affiliates: oBool,
  cdcName: oText(200),
  jobsCreated: oInt(0, 1_000_000),
};

const pipSchema = section({
  required: z.preprocess(boolish, z.boolean()),
  budgetCents: oCents(),
  deadline: oDate,
  brandApproved: oBool,
});

const hotelShape = {
  brand: oText(120),
  franchiseExpiry: oDate,
  adrCents: oCents(),
  revparCents: oCents(),
  revparIndex: oDec(0, 1000),
  ffeReservePct: oDec(0, 100),
  pip: pipSchema.optional(),
};

const topTenantSchema = z.strictObject({ name: text(200), sharePct: z.preprocess(numeric, decIn(0, 100)), leaseEnd: z.iso.date() });
const tenancyShape = {
  topTenants: z.array(topTenantSchema).max(A.topTenants).optional(),
  rolloverPctWithinTerm: oDec(0, 100),
  walMonths: oDec(0, 600),
};

const unitMixLineSchema = z.strictObject({ type: text(80), count: z.preprocess(numeric, intIn(0, 100_000)), avgRentCents: z.preprocess(numeric, cents()) });
const agencyShape = {
  unitMix: z.array(unitMixLineSchema).max(50).optional(),
  economicOccupancyPct: oDec(0, 100),
  affordabilityNote: oText(1000),
  studentOrSeniorPct: oDec(0, 100),
};

const hudShape = {
  section: oEnum(hudSections),
  repairsCents: oCents(),
  existingFhaNumber: z.string().trim().regex(/^[0-9A-Za-z-]{3,20}$/, "Enter the FHA number as printed (letters, digits and dashes)").refine(isSafeText, RESTRICTED_TEXT_MESSAGE).optional(),
  priorHudParticipation: oBool,
  licensedBeds: oInt(0, 100_000),
  operatorName: oText(200),
  payorMixNote: oText(1000),
  surveyHistoryNote: oText(2000),
};

const capitalStackShape = {
  seniorLender: oText(200),
  seniorAmountCents: oCents(),
  seniorRatePct: oDec(0, 40),
  seniorMaturity: oDate,
  seniorAllowsSubordinate: oBool,
  intercreditorStatus: oEnum(consentStatuses),
  consentStatus: oEnum(consentStatuses),
  thisTrancheKind: oEnum(trancheKinds),
  eligibleImprovementsCents: oCents(),
  programJurisdiction: oText(200),
};

export const constructionDetailsSchema = section(constructionShape);
export const rehabDetailsSchema = section(rehabShape);
export const rentalDetailsSchema = section(rentalShape);
export const sbaDetailsSchema = section(sbaShape);
export const hotelDetailsSchema = section(hotelShape);
export const tenancyDetailsSchema = section(tenancyShape);
export const agencyDetailsSchema = section(agencyShape);
export const hudDetailsSchema = section(hudShape);
export const capitalStackDetailsSchema = section(capitalStackShape);

/** The schema for each program_details key. */
export const PROGRAM_DETAIL_SCHEMAS = {
  construction: constructionDetailsSchema,
  rehab: rehabDetailsSchema,
  rental: rentalDetailsSchema,
  sba: sbaDetailsSchema,
  hotel: hotelDetailsSchema,
  tenancy: tenancyDetailsSchema,
  agency: agencyDetailsSchema,
  hud: hudDetailsSchema,
  capitalStack: capitalStackDetailsSchema,
} as const satisfies Record<ProgramDetailKey, z.ZodType>;

/** The keys each program section may hold (anything else is refused). */
export const PROGRAM_DETAIL_FIELDS: { readonly [K in ProgramDetailKey]: readonly string[] } = {
  construction: Object.keys(constructionShape),
  rehab: Object.keys(rehabShape),
  rental: Object.keys(rentalShape),
  sba: Object.keys(sbaShape),
  hotel: Object.keys(hotelShape),
  tenancy: Object.keys(tenancyShape),
  agency: Object.keys(agencyShape),
  hud: Object.keys(hudShape),
  capitalStack: Object.keys(capitalStackShape),
};

/** program_details jsonb as a whole: known sections only, within the column's size check. */
export const programDetailsSchema = z
  .strictObject(Object.fromEntries(programDetailKeys.map((k) => [k, PROGRAM_DETAIL_SCHEMAS[k].optional()])) as { [K in ProgramDetailKey]: z.ZodOptional<(typeof PROGRAM_DETAIL_SCHEMAS)[K]> })
  .refine((v) => JSON.stringify(v).length <= 200_000, "Program sections are too long");

// ---------------------------------------------------------------------------
// Field sources (field_sources jsonb)

const isoTimestamp = z.iso.datetime({ offset: true });
const actor = z.string().trim().min(1).max(200);
const ref = z.string().trim().min(1).max(200);

export const fieldSourceSchema = z.discriminatedUnion("source", [
  z.strictObject({ source: z.literal("entered"), by: actor, at: isoTimestamp }),
  z.strictObject({ source: z.literal("borrower"), by: actor, at: isoTimestamp, ref: ref.optional() }),
  z.strictObject({ source: z.literal("document"), ref, asOf: z.iso.date().optional(), at: isoTimestamp, by: actor.optional() }),
  z.strictObject({ source: z.literal("spread"), ref, asOf: z.iso.date().optional(), at: isoTimestamp, by: actor.optional() }),
  z.strictObject({ source: z.literal("record"), record: z.enum(sourceRecordTables), ref, at: isoTimestamp, by: actor.optional() }),
  z.strictObject({ source: z.literal("public_record"), ref, at: isoTimestamp, by: actor.optional() }),
]);

const PROFILE_FIELD_KEY_SET: ReadonlySet<string> = new Set(profileFieldKeys);

/** A profile column or "programDetails.<section>.<key>" (types.ts FieldSourceKey). */
export function isFieldSourceKey(key: string): key is FieldSourceKey {
  if (PROFILE_FIELD_KEY_SET.has(key)) return true;
  const m = /^programDetails\.([A-Za-z]+)\.([A-Za-z]+)$/.exec(key);
  return Boolean(m && (programDetailKeys as readonly string[]).includes(m[1]!) && PROGRAM_DETAIL_FIELDS[m[1] as ProgramDetailKey].includes(m[2]!));
}

const fieldSourceKey = z.string().refine(isFieldSourceKey, "Not a submission field");

export const fieldSourcesSchema = z
  .record(fieldSourceKey, fieldSourceSchema)
  .refine((v) => JSON.stringify(v).length <= 100_000, "Too many field sources")
  .transform((v) => v as FieldSources);

/** What a patch may carry: a null removes that key (SubmissionProfilePatch). */
export const fieldSourcesPatchSchema = z.record(fieldSourceKey, fieldSourceSchema.nullable()).transform((v) => v as NonNullable<SubmissionProfilePatch["fieldSources"]>);

// ---------------------------------------------------------------------------
// Editor sections (spec 4.2). Sponsor has its own table; program sections are above.

/** The profile columns each core section edits. */
export const SECTION_FIELDS = {
  loan_request: [
    "purpose",
    "requestedTermMonths",
    "requestedAmortMonths",
    "requestedIoMonths",
    "rateType",
    "recourse",
    "lienPosition",
    "targetCloseDate",
    "closeDriver",
    "prepayPreference",
    "existingLender",
    "existingDebtCents",
    "existingRatePct",
    "existingMaturityDate",
    "cashOutCents",
    "cashOutUse",
    "assumedRatePct",
    "assumedAmortMonths",
  ],
  property: [
    "assetType",
    "propertyName",
    "city",
    "county",
    "postalCode",
    "apn",
    "yearBuilt",
    "yearRenovated",
    "sizeCount",
    "sizeUnit",
    "rentableSf",
    "landAcres",
    "tenancy",
    "ownerOccupiedPct",
    "occupancyPct",
    "occupancyAsOf",
    "zoning",
    "floodZone",
    "rentControl",
    "seismicZone",
    "maskAddress",
  ],
  value: ["purchasePriceCents", "purchaseCloseDate", "asIsValueCents", "asIsValueSource", "asIsValueAsOf", "stabilizedValueCents", "stabilizedValueSource"],
  financials: ["revenueCents", "expensesCents", "noiInPlaceCents", "noiPeriodEnd", "noiBasis", "noiStabilizedCents", "stabilizationMonths"],
  plan_exit: ["businessPlan", "exitStrategy", "exitMonths", "exitDetail", "highlights", "risks"],
  sources_uses: ["sources", "uses"],
} as const satisfies Record<string, readonly ProfileFieldKey[]>;
export type CoreSectionId = keyof typeof SECTION_FIELDS;

type FieldSchemas = typeof PROFILE_FIELD_SCHEMAS;
type SectionShape<S extends CoreSectionId> = { [K in (typeof SECTION_FIELDS)[S][number]]: z.ZodOptional<FieldSchemas[K]> };

function coreSection<S extends CoreSectionId>(id: S) {
  const shape = Object.fromEntries(SECTION_FIELDS[id].map((k) => [k, PROFILE_FIELD_SCHEMAS[k].optional()])) as SectionShape<S>;
  return z.strictObject(shape);
}

type IoTerm = { requestedIoMonths?: number | null; requestedTermMonths?: number | null };
/** deal_submission_profiles_io_within_term. */
function ioWithinTerm(v: IoTerm, ctx: z.RefinementCtx): void {
  if (v.requestedIoMonths != null && v.requestedTermMonths != null && v.requestedIoMonths > v.requestedTermMonths) {
    ctx.addIssue({ code: "custom", message: "The interest-only period cannot be longer than the term", path: ["requestedIoMonths"] });
  }
}

export const loanRequestSchema = coreSection("loan_request").superRefine(ioWithinTerm);
export const propertySchema = coreSection("property");
export const valueSchema = coreSection("value");
export const financialsSchema = coreSection("financials");
export const planExitSchema = coreSection("plan_exit");
export const sourcesUsesSchema = coreSection("sources_uses");

/** The schema for each core editor section (program sections: PROGRAM_DETAIL_SCHEMAS; sponsor: sponsorSchema). */
export const SECTION_SCHEMAS = {
  loan_request: loanRequestSchema,
  property: propertySchema,
  value: valueSchema,
  financials: financialsSchema,
  plan_exit: planExitSchema,
  sources_uses: sourcesUsesSchema,
} as const;

// ---------------------------------------------------------------------------
// Whole rows (stores, fixtures and the twin tests)

const profileShape = {
  playbook: z.enum(submissionPlaybooks),
  ...PROFILE_FIELD_SCHEMAS,
  programDetails: programDetailsSchema,
  fieldSources: fieldSourcesSchema,
};

/** Every column of a deal_submission_profiles row (SubmissionProfileFields), with the row-level checks. */
export const submissionProfileFieldsSchema = z.strictObject(profileShape).superRefine(ioWithinTerm);

type Optionalize<S extends Record<string, z.ZodType>> = { [K in keyof S]: z.ZodOptional<S[K]> };
const optionalShape = <S extends Record<string, z.ZodType>>(shape: S) => Object.fromEntries(Object.entries(shape).map(([k, s]) => [k, s.optional()])) as unknown as Optionalize<S>;

/** What upsertProfile may take (SubmissionProfilePatch): any subset of the columns, programDetails per section, fieldSources per key (null removes one). */
export const submissionProfilePatchSchema = z
  .strictObject({
    playbook: profileShape.playbook.optional(),
    ...optionalShape(PROFILE_FIELD_SCHEMAS),
    programDetails: programDetailsSchema.optional(),
    fieldSources: fieldSourcesPatchSchema.optional(),
  })
  .superRefine(ioWithinTerm);

// Sponsor profile ---------------------------------------------------------------

const S = SPONSOR_NUMBER_LIMITS;

export const creditEventAnswerSchema = z
  .strictObject({
    occurred: z.preprocess(boolish, z.boolean()),
    explanation: z.preprocess(blank, text(1000).nullable().optional()).transform((v) => v ?? undefined),
  })
  .refine((a) => !a.occurred || Boolean(a.explanation), { message: "Explain what happened", path: ["explanation"] })
  .transform((a) => (a.explanation === undefined ? { occurred: a.occurred } : a));

export const creditEventsSchema = section(Object.fromEntries(creditEventKinds.map((k) => [k, creditEventAnswerSchema.optional()])) as Record<(typeof creditEventKinds)[number], z.ZodOptional<typeof creditEventAnswerSchema>>).refine(
  (v) => JSON.stringify(v).length <= 8000,
  "Credit event explanations are too long",
);

export const SPONSOR_FIELD_SCHEMAS = {
  experienceSummary: nText(T.experienceSummary),
  yearsExperience: fromLimit(S.yearsExperience),
  similarProjectsCount: fromLimit(S.similarProjectsCount),
  portfolioCount: fromLimit(S.portfolioCount),
  portfolioSizeNote: nText(T.portfolioSizeNote),
  statedNetWorthCents: fromLimit(S.statedNetWorthCents),
  statedLiquidityCents: fromLimit(S.statedLiquidityCents),
  statedAsOf: nDate,
  creditBand: nEnum(sponsorCreditBands),
  creditEvents: creditEventsSchema,
  managementCompany: nText(T.managementCompany),
  notes: nText(T.notes),
  emailFinancialsMode: z.enum(emailFinancialsModes),
} as const satisfies Record<keyof SponsorProfileFields, z.ZodType>;

type StatedFigures = { statedNetWorthCents?: number | null; statedLiquidityCents?: number | null; statedAsOf?: string | null };
/** deal_sponsor_profiles_stated_dated: a stated figure needs its date. A patch that leaves statedAsOf out is checked on the merged row. */
function statedDated(v: StatedFigures, ctx: z.RefinementCtx): void {
  if ((v.statedNetWorthCents != null || v.statedLiquidityCents != null) && v.statedAsOf === null) {
    ctx.addIssue({ code: "custom", message: "Give the date the sponsor stated these figures", path: ["statedAsOf"] });
  }
}

/** The sponsor section (a patch: absent keys are unchanged). The stated-figures date is checked on the merged row too. */
export const sponsorSchema = z.strictObject(optionalShape(SPONSOR_FIELD_SCHEMAS)).superRefine(statedDated);

/** Every column of a deal_sponsor_profiles row, with the row-level checks. */
export const sponsorProfileFieldsSchema = z.strictObject(SPONSOR_FIELD_SCHEMAS).superRefine(statedDated);

// ---------------------------------------------------------------------------
// Type agreement with the frozen contract (compile-time only)

type Assert<T extends true> = T;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export type _ProfileFieldsAgree = Assert<Same<z.output<typeof submissionProfileFieldsSchema>, SubmissionProfileFields>>;
export type _SponsorFieldsAgree = Assert<Same<z.output<typeof sponsorProfileFieldsSchema>, SponsorProfileFields>>;
export type _ProgramDetailsAgree = Assert<Same<z.output<typeof programDetailsSchema>, ProgramDetails>>;
export type _ProfilePatchAgree = Assert<Same<z.output<typeof submissionProfilePatchSchema>, SubmissionProfilePatch>>;
export type _SponsorPatchAgree = Assert<Same<z.output<typeof sponsorSchema>, SponsorProfilePatch>>;
