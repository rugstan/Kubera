import { z } from "zod";
import { PROPERTY_TYPES } from "./property-types";

const money = z.coerce.number().finite().min(0).max(1_000_000_000);
const optionalMoney = money.optional().transform((v) => (v ? v : undefined));

export const contactSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.email().trim().max(200),
  phone: z.string().trim().max(40).optional().default(""),
  company: z.string().trim().max(160).optional().default(""),
  /**
   * Optional express consent to phone, text and automated contact (TCPA). The
   * consent wording says it is not a condition of any service, so a submission
   * without it is accepted; the routes write a consent_events row only when it
   * is true, and without one we reply by email about the request only.
   */
  consent: z.boolean().default(false),
});

/** Self-reported guarantor credit band; a band, not a score, keeps the intake out of credit-report territory. */
export const creditBands = ["740_PLUS", "700_739", "660_699", "BELOW_660"] as const;

const percent = (max: number) => z.coerce.number().finite().min(0).max(max);

/** Hard money details (transaction "HARD_MONEY"); every field has a sizing default. */
export const hardMoneyIntakeSchema = z.object({
  /** RENTAL is a bridge held for a long-term rental (DSCR) take-out; it is sized as a bridge. */
  strategy: z.enum(["FIX_AND_FLIP", "BRIDGE", "RENTAL"]).default("FIX_AND_FLIP"),
  purpose: z.enum(["PURCHASE", "REFINANCE"]).default("PURCHASE"),
  rehabBudget: money.default(0),
  /** After-repair (or as-stabilized) value. */
  arv: optionalMoney,
  termMonths: z.coerce.number().int().min(6).max(36).default(12),
  holdMonths: z.coerce.number().int().min(1).max(60).optional(),
  /** Comparable projects completed in the last 36 months. */
  completedProjects: z.coerce.number().int().min(0).max(1_000).default(0),
  existingPayoff: optionalMoney,
});

/** Ground-up construction budget (transaction "CONSTRUCTION"). Percentages are 0–100. */
export const constructionIntakeSchema = z.object({
  landCost: money,
  hardCosts: money,
  softCosts: money.default(0),
  contingencyPct: percent(50).default(5),
  developerFeePct: percent(10).default(3),
  gmpContract: z.boolean().default(false),
  constructionMonths: z.coerce.number().int().min(3).max(60).default(18),
  leaseUpMonths: z.coerce.number().int().min(0).max(36).default(6),
  asCompletedValue: optionalMoney,
  completedProjects: z.coerce.number().int().min(0).max(1_000).default(0),
});

/** Rent detail for 1–4 unit rentals (DSCR = rent / PITIA). */
export const rentalIntakeSchema = z.object({
  monthlyRent: money,
  monthlyTaxesInsuranceHoa: money.default(0),
});

// The short lead form on every /financing page posts to /api/qualify with
// `kind: "quick"` and goes through the same guard, lead row, consent record and
// CRM push as the qualifier. It asks for far less (no NOI, value, unit count or
// occupancy), so its intake carries an `origin` and an advisor reviews it.

/** Transactions the short form offers. "OTHER" is kept on the origin; the intake sizes it as a refinance. */
export const QUICK_TRANSACTIONS = ["PURCHASE", "REFINANCE", "CONSTRUCTION", "OTHER"] as const;
export type QuickTransaction = (typeof QUICK_TRANSACTIONS)[number];

/** A /financing URL segment, e.g. "office-loans". */
const financingSlug = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Invalid page");

/** Where a financing-page lead came from, as the server resolved it, and what the visitor chose. */
export const leadOriginSchema = z.object({
  form: z.literal("financing_page"),
  slug: financingSlug,
  path: z
    .string()
    .trim()
    .max(120)
    .regex(/^\/financing\/[a-z0-9]+(?:-[a-z0-9]+)*$/),
  /** The page's display name, e.g. "Office building loans". */
  page: z.string().trim().min(1).max(120),
  transaction: z.enum(QUICK_TRANSACTIONS),
});

export type LeadOrigin = z.infer<typeof leadOriginSchema>;

export const intakeSchema = z.object({
  /** Senior, hotel, residential and commercial property types; see lib/property-types.ts. */
  assetType: z.enum(PROPERTY_TYPES),
  /** HARD_MONEY: short-term private loan (fix-and-flip or bridge), details in `hardMoney`. */
  transaction: z.enum(["PURCHASE", "REFINANCE", "CONSTRUCTION", "CONVERSION", "HARD_MONEY"]),
  loanAmount: money.refine((v) => v >= 250_000, "Minimum $250,000"),
  noi: money,
  value: optionalMoney,
  /** Beds, keys, or units depending on asset type. */
  unitCount: z.coerce.number().int().min(0).max(10_000).default(0),
  occupancyPct: z.coerce.number().min(0).max(100).default(85),
  adr: optionalMoney,
  pipBudget: optionalMoney,
  franchiseTier: z.enum(["PREMIUM_FLAG", "ECONOMY_FLAG", "BOUTIQUE_INDEPENDENT"]).optional(),
  timelineDays: z.coerce.number().int().min(0).max(730).default(90),
  nonRecourseOnly: z.boolean().default(false),
  green: z.boolean().default(false),
  ownerOperator: z.boolean().default(true),
  creditBand: z.enum(creditBands).optional(),
  hardMoney: hardMoneyIntakeSchema.optional(),
  construction: constructionIntakeSchema.optional(),
  rental: rentalIntakeSchema.optional(),
  notes: z.string().trim().max(2_000).optional().default(""),
  /** "financing_page": the short form on a /financing page (see `origin`). */
  source: z.enum(["express", "sizer", "ask", "website", "financing_page"]).default("website"),
  /** Set only on leads from the short financing-page form. */
  origin: leadOriginSchema.optional(),
});

export const leadSchema = z.object({ intake: intakeSchema, contact: contactSchema });

export type Intake = z.infer<typeof intakeSchema>;
export type Contact = z.infer<typeof contactSchema>;

export const quickIntakeSchema = z.object({
  assetType: z.enum(PROPERTY_TYPES),
  transaction: z.enum(QUICK_TRANSACTIONS),
  loanAmount: money.refine((v) => v >= 250_000, "Minimum $250,000"),
  timelineDays: z.coerce.number().int().min(0).max(730),
  notes: z.string().trim().max(2_000).optional().default(""),
  /** The financing page the form sat on. The route checks it against the published pages. */
  slug: financingSlug,
});

export type QuickIntake = z.infer<typeof quickIntakeSchema>;

export const quickLeadSchema = z.object({ kind: z.literal("quick"), quick: quickIntakeSchema, contact: contactSchema });

/**
 * POST /api/qualify body: the qualifier's full intake (`kind: "full"`, the
 * default when the body names none) or the financing-page form (`kind: "quick"`).
 */
export const qualifySubmissionSchema = z.discriminatedUnion("kind", [leadSchema.extend({ kind: z.literal("full") }), quickLeadSchema]);

export type QualifySubmission = z.infer<typeof qualifySubmissionSchema>;

/** Parses a /api/qualify body; a body without `kind` is the qualifier's full intake. */
export function parseQualifySubmission(body: unknown) {
  const withKind = body && typeof body === "object" && !Array.isArray(body) && !("kind" in body) ? { ...body, kind: "full" } : body;
  return qualifySubmissionSchema.safeParse(withKind);
}

/**
 * The intake a financing-page lead is stored, scored and pushed to the CRM as.
 * Fields the form does not ask for keep the intake's "not given" defaults (an
 * NOI of 0), and `origin` records the page and marks the lead for broker
 * review. "Other" is sized as a refinance; the visitor's own answer stays on
 * the origin.
 */
export function intakeFromQuick(quick: QuickIntake, page: { slug: string; path: string; name: string }): Intake {
  const transaction =
    quick.transaction === "OTHER"
      ? "REFINANCE"
      : quick.transaction === "CONSTRUCTION" && quick.assetType === "HOTEL_TO_SENIOR_CONVERSION"
        ? "CONVERSION"
        : quick.transaction;
  return intakeSchema.parse({
    assetType: quick.assetType,
    transaction,
    loanAmount: quick.loanAmount,
    noi: 0,
    timelineDays: quick.timelineDays,
    notes: quick.notes,
    source: "financing_page",
    origin: { form: "financing_page", slug: page.slug, path: page.path, page: page.name, transaction: quick.transaction },
  });
}

export const partnerTypes = ["LENDER", "REFERRAL", "OPERATOR", "VENDOR"] as const;

const verticals = z.array(z.enum(["SENIOR_LIVING", "HOSPITALITY", "MULTIFAMILY", "COMMERCIAL", "CONSTRUCTION"])).default([]);

export const partnerSchema = z.discriminatedUnion("partnerType", [
  z.object({
    partnerType: z.literal("LENDER"),
    contact: contactSchema,
    organization: z.string().trim().min(1).max(160),
    website: z.url().max(300).optional().or(z.literal("")),
    lenderKind: z.enum(["BANK", "DEBT_FUND", "CMBS_DESK", "SBA_CDC", "SBA_7A_LENDER", "HUD_LENDER", "LIFE_CO", "PRIVATE"]),
    minLoan: money,
    maxLoan: money,
    verticals,
    states: z.string().trim().max(400).optional().default(""),
    maxLtv: z.coerce.number().min(0).max(100),
    maxLtc: z.coerce.number().min(0).max(100).optional(),
    minDscr: z.coerce.number().min(0).max(5).optional(),
    minDebtYield: z.coerce.number().min(0).max(50).optional(),
    flagRequirements: z.string().trim().max(400).optional().default(""),
    brokerFeeProtectionPct: z.coerce.number().min(0).max(10),
  }),
  z.object({
    partnerType: z.literal("REFERRAL"),
    contact: contactSchema,
    organization: z.string().trim().max(160).optional().default(""),
    licenseType: z.enum(["CA_DRE_BROKER", "CA_DRE_SALESPERSON", "OTHER_STATE_LICENSE", "HOTEL_BROKER", "UNLICENSED_REFERRAL"]),
    licenseNumber: z.string().trim().max(40).optional().default(""),
    marketsServed: z.string().trim().max(400).optional().default(""),
    acceptsAgreement: z.literal(true),
  }),
  z.object({
    partnerType: z.literal("OPERATOR"),
    contact: contactSchema,
    organization: z.string().trim().min(1).max(160),
    operatorKind: z.enum(["RCFE_ASSISTED_LIVING", "MEMORY_CARE", "SNF", "HOTEL_MANAGEMENT"]),
    licenseNumbers: z.string().trim().max(400).optional().default(""),
    unitsUnderManagement: z.coerce.number().int().min(0).max(1_000_000),
    flagsApproved: z.string().trim().max(400).optional().default(""),
    markets: z.string().trim().max(400).optional().default(""),
  }),
  z.object({
    partnerType: z.literal("VENDOR"),
    contact: contactSchema,
    organization: z.string().trim().min(1).max(160),
    services: z.array(z.enum(["MAI_APPRAISAL_HEALTHCARE", "MAI_APPRAISAL_HOSPITALITY", "HVS_STR_FEASIBILITY", "PHASE_I_ESA", "PCNA", "CPA_AUDIT", "LEGAL", "TITLE_ESCROW"])).min(1),
    markets: z.string().trim().max(400).optional().default(""),
    typicalTurnaroundDays: z.coerce.number().int().min(0).max(365).optional(),
  }),
]);

export type PartnerRegistration = z.infer<typeof partnerSchema>;
