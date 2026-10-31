import { z } from "zod";

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
  strategy: z.enum(["FIX_AND_FLIP", "BRIDGE"]).default("FIX_AND_FLIP"),
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

export const intakeSchema = z.object({
  assetType: z.enum([
    "ASSISTED_LIVING",
    "MEMORY_CARE",
    "RCFE",
    "SNF",
    "HOTEL_FLAGGED",
    "HOTEL_BOUTIQUE",
    "HOTEL_TO_SENIOR_CONVERSION",
    "MULTIFAMILY",
    "MIXED_USE",
    "COMMERCIAL",
    /** 2–4 unit residential investor property (DSCR rental or hard money). */
    "RESIDENTIAL_2_4",
  ]),
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
  source: z.enum(["express", "sizer", "ask", "website"]).default("website"),
});

export const leadSchema = z.object({ intake: intakeSchema, contact: contactSchema });

export type Intake = z.infer<typeof intakeSchema>;
export type Contact = z.infer<typeof contactSchema>;

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
