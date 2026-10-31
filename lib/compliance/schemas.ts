// Typed facts the compliance gates evaluate. Zod schemas double as the
// validation layer for staff input and the persisted `broker_of_record` shape.
//
// Kubera is a broker only (Global rule 1): there is deliberately no "lender",
// "originator of record" or "beneficiary" value for Kubera's role. Facts that a
// deal document names Kubera that way are captured as booleans so the gates can
// hold the deal for counsel.

import { z } from "zod";

const isoDate = z.iso.date();
const isoDateTime = z.iso.datetime({ offset: true });

/** Kubera's role on a loan. Kubera is never the lender. */
export const kuberaRoles = ["broker", "paid_referral", "unpaid_referral"] as const;
export type KuberaRole = (typeof kuberaRoles)[number];

export const collateralSchema = z
  .object({
    /** Any lien on real property securing the loan, directly or collaterally, wholly or partly. */
    realPropertyLien: z.boolean(),
    /** Only an equity pledge, UCC filing or other non-real-property collateral backs the loan. */
    equityPledgeOrUccOnly: z.boolean().default(false),
    apn: z.string().trim().max(60).optional(),
    lienPosition: z.number().int().min(1).max(5).optional(),
    propertyState: z.string().trim().length(2).toUpperCase().optional(),
  })
  .refine((c) => !(c.realPropertyLien && c.equityPledgeOrUccOnly), {
    message: "Collateral cannot be both a real-property lien and equity-pledge/UCC-only",
    path: ["equityPledgeOrUccOnly"],
  });
export type Collateral = z.infer<typeof collateralSchema>;
export type CollateralInput = z.input<typeof collateralSchema>;

export const mldsFactsSchema = z.object({
  kuberaRole: z.enum(kuberaRoles),
  collateral: collateralSchema,
  /** Program id from the sizer / Jev (e.g. "SBA_7A", "HUD_232"). */
  program: z.string().trim().max(60).optional(),
  /** A deal document names Kubera as trust-deed beneficiary. */
  namesKuberaAsBeneficiary: z.boolean().default(false),
  /** A deal document names Kubera as originator / lender of record. */
  namesKuberaAsOriginator: z.boolean().default(false),
  /** Table-funded with Kubera named on the note or deed (B&P §10234). */
  tableFundedInKuberaName: z.boolean().default(false),
  /** Non-traditional loan on 1–4 residential units (RE 885, not built). */
  nonTraditionalResidential1to4: z.boolean().default(false),
});
export type MldsFacts = z.input<typeof mldsFactsSchema>;

/**
 * Lender categories for the Cal. Const. art. XV analysis.
 * VERIFY (counsel gate H): which categories are exempt for Kubera's lender
 * panel, and the evidence each needs (charter, license number).
 */
export const lenderCategories = [
  "NATIONAL_BANK",
  "STATE_BANK",
  "SAVINGS_ASSOCIATION",
  "CREDIT_UNION",
  "INSURANCE_COMPANY",
  "CFL_LICENSEE",
  "INDUSTRIAL_LOAN_COMPANY",
  "PRIVATE_NON_EXEMPT",
  "UNKNOWN",
] as const;
export type LenderCategory = (typeof lenderCategories)[number];

/** Constitutionally or statutorily exempt lender categories (VERIFY). */
export const EXEMPT_LENDER_CATEGORIES: ReadonlySet<LenderCategory> = new Set<LenderCategory>([
  "NATIONAL_BANK",
  "STATE_BANK",
  "SAVINGS_ASSOCIATION",
  "CREDIT_UNION",
  "INSURANCE_COMPANY",
  "CFL_LICENSEE",
  "INDUSTRIAL_LOAN_COMPANY",
]);

export const parties = ["borrower", "lender", "borrower_and_lender"] as const;

export const licenseeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  dreLicense: z.string().trim().regex(/^\d{8}$/, "DRE license numbers are 8 digits"),
  /** License was active on the transaction date. */
  activeAtTransaction: z.boolean(),
});

export const negotiationEntrySchema = z.object({
  at: isoDateTime,
  kind: z.enum(["term_sheet", "communication", "counteroffer", "lender_submission"]),
  /** Vault path, mail message id or term-sheet version label. */
  ref: z.string().trim().min(1).max(300),
  summary: z.string().trim().max(1_000).default(""),
  byLicensee: z.string().trim().max(120).optional(),
});

export const compensationSchema = z.object({
  amountUsd: z.number().finite().min(0),
  payer: z.enum(parties),
  /** Compensation is expected (contracted) even if not yet paid. */
  expected: z.boolean().default(true),
  closingStatementLine: z.string().trim().max(200).optional(),
});

export const officerApprovalSchema = z.object({
  name: z.string().trim().min(1).max(120),
  dreLicense: z.string().trim().regex(/^\d{8}$/),
  approvedAt: isoDateTime,
});

/** Civ. Code §1916.1 "arranged by a licensed broker" elements (gate H). */
export const brokerOfRecordElementsSchema = z.object({
  arrangingLicensee: licenseeSchema.optional(),
  /** The party Kubera acts for. Acting only for itself never qualifies. */
  actsFor: z.enum(parties).optional(),
  engagementAgreementRef: z.string().trim().max(300).optional(),
  compensation: compensationSchema.optional(),
  negotiationLog: z.array(negotiationEntrySchema).default([]),
  businessPurposeCertified: z.boolean().default(false),
  officerApproval: officerApprovalSchema.optional(),
});
export type BrokerOfRecordElements = z.input<typeof brokerOfRecordElementsSchema>;

export const lenderSchema = z.object({
  name: z.string().trim().min(1).max(160),
  category: z.enum(lenderCategories),
  /** Charter / license number evidencing the category. */
  evidenceRef: z.string().trim().max(200).optional(),
});

export const usuryFactsSchema = z.object({
  lender: lenderSchema,
  /** Highest contract (note) rate, % per year, including default-free step-ups. */
  noteRatePct: z.number().finite().min(0).max(100),
  /**
   * FRBSF discount rate (%) on the 25th day of the month before the earlier of
   * contract or loan execution (Cal. Const. art. XV §1(2)).
   */
  fedDiscountRatePct: z.number().finite().min(0).max(25),
  collateral: collateralSchema,
  elements: brokerOfRecordElementsSchema,
  tableFundedInKuberaName: z.boolean().default(false),
  /** Date the loan was (or will be) made. */
  transactionDate: isoDate,
});
export type UsuryFacts = z.input<typeof usuryFactsSchema>;

export const modificationKinds = ["forbearance", "extension", "modification"] as const;
export const arrangers = ["kubera", "other_licensed_broker", "lender_or_servicer_only"] as const;

export const modificationFactsSchema = z.object({
  kind: z.enum(modificationKinds),
  effectiveDate: isoDate,
  arrangedBy: z.enum(arrangers),
  otherBroker: z.object({ name: z.string().trim().min(1).max(160), dreLicense: z.string().trim().regex(/^\d{8}$/) }).optional(),
  /** The modification agreement recites that a licensed broker arranged it. */
  agreementRecitesBrokerArrangement: z.boolean().default(false),
  /** Rate after the modification (% per year). */
  noteRatePct: z.number().finite().min(0).max(100),
  elements: brokerOfRecordElementsSchema.default({ negotiationLog: [], businessPurposeCertified: false }),
  /** Written notice to the lender that no exemption representation is made has been sent. */
  lenderNoticeSentAt: isoDateTime.optional(),
});
export type ModificationFacts = z.input<typeof modificationFactsSchema>;
