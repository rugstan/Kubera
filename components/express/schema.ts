import { z } from "zod";
import { PROGRAM_FAMILIES, type ProgramFamily } from "@/content/programs/types";
import type { Intake } from "@/lib/validation";

// The express qualifier's form model: option lists, per-step field groups, the
// Zod schema (a function of the answers, so hotel-only fields are validated
// only for hotels) and the builder that turns form values into the
// /api/qualify payload. Pure, so it is unit-tested without a browser.

export type Asset = Intake["assetType"];
export type Transaction = Intake["transaction"];
export type FranchiseTier = NonNullable<Intake["franchiseTier"]>;
export type HardMoneyStrategy = NonNullable<Intake["hardMoney"]>["strategy"];
export type HardMoneyPurpose = NonNullable<Intake["hardMoney"]>["purpose"];

export const ASSETS: { value: Asset; label: string; group: string }[] = [
  { value: "ASSISTED_LIVING", label: "Assisted living", group: "Senior living and care" },
  { value: "MEMORY_CARE", label: "Memory care", group: "Senior living and care" },
  { value: "RCFE", label: "RCFE / board and care", group: "Senior living and care" },
  { value: "SNF", label: "Skilled nursing", group: "Senior living and care" },
  { value: "HOTEL_FLAGGED", label: "Flagged hotel", group: "Hospitality" },
  { value: "HOTEL_BOUTIQUE", label: "Boutique hotel / motel", group: "Hospitality" },
  { value: "HOTEL_TO_SENIOR_CONVERSION", label: "Hotel to senior living", group: "Hospitality" },
  { value: "MULTIFAMILY", label: "Multifamily", group: "Multifamily and CRE" },
  { value: "MIXED_USE", label: "Mixed-use", group: "Multifamily and CRE" },
  { value: "COMMERCIAL", label: "Commercial / bridge", group: "Multifamily and CRE" },
  { value: "RESIDENTIAL_2_4", label: "2 to 4 unit rental", group: "Multifamily and CRE" },
];

export const ASSET_GROUPS = ["Senior living and care", "Hospitality", "Multifamily and CRE"] as const;
export type AssetGroup = (typeof ASSET_GROUPS)[number];

export const TIMELINES = [
  { value: "21", label: "Within 3 weeks" },
  { value: "45", label: "30 to 60 days" },
  { value: "90", label: "60 to 90 days" },
  { value: "150", label: "3 to 6 months" },
  { value: "270", label: "6+ months, or exploring" },
] as const;

export const FRANCHISE_TIERS: { value: FranchiseTier; label: string }[] = [
  { value: "PREMIUM_FLAG", label: "Marriott, Hilton, IHG or Hyatt" },
  { value: "ECONOMY_FLAG", label: "Economy or midscale flag" },
  { value: "BOUTIQUE_INDEPENDENT", label: "Independent" },
];

export const HARD_MONEY_STRATEGIES: { value: HardMoneyStrategy; label: string }[] = [
  { value: "FIX_AND_FLIP", label: "Fix and flip" },
  { value: "BRIDGE", label: "Bridge" },
  { value: "RENTAL", label: "Rental" },
];

export const HARD_MONEY_PURPOSES: { value: HardMoneyPurpose; label: string }[] = [
  { value: "PURCHASE", label: "Purchase" },
  { value: "REFINANCE", label: "Refinance" },
];

export const STEPS = ["Asset", "Deal", "Terms", "Contact"] as const;

/** Fields validated when a step's Continue button is pressed. */
export const STEP_FIELDS: readonly (readonly string[])[] = [
  ["assetType"],
  ["transaction", "loanAmount", "noi", "value", "unitCount", "occupancyPct", "adr", "pipBudget", "franchiseTier", "hmStrategy", "hmPurpose", "rehabBudget", "arv"],
  ["timelineDays", "ownerOperator", "nonRecourseOnly", "green", "notes"],
  ["firstName", "lastName", "email", "phone", "company", "consent"],
];

export const isSenior = (a: Asset | "") => a === "ASSISTED_LIVING" || a === "MEMORY_CARE" || a === "RCFE" || a === "SNF";
export const isHotel = (a: Asset | "") => a === "HOTEL_FLAGGED" || a === "HOTEL_BOUTIQUE";
export const isConversion = (a: Asset | "") => a === "HOTEL_TO_SENIOR_CONVERSION";

/** Label for the optional value field, which means something different per transaction. */
export function valueLabel(t: Transaction | ""): string {
  if (t === "PURCHASE") return "Purchase price";
  if (t === "REFINANCE") return "Estimated value";
  if (t === "HARD_MONEY") return "Purchase price or as-is value";
  return "Acquisition or land cost";
}

export function unitLabel(a: Asset | ""): string {
  if (isSenior(a)) return "Licensed beds";
  if (isHotel(a) || isConversion(a)) return "Rooms / keys";
  if (a === "COMMERCIAL") return "Tenants";
  return "Units";
}

/** Short-term private loans are offered for investor property, not licensed care facilities or conversions. */
export const offersHardMoney = (a: Asset | "") => a !== "" && !isSenior(a) && !isConversion(a);

export function transactionOptions(a: Asset | ""): { value: Transaction; label: string }[] {
  return [
    { value: "PURCHASE", label: "Purchase" },
    { value: "REFINANCE", label: "Refinance" },
    isConversion(a) ? { value: "CONVERSION", label: "Conversion" } : { value: "CONSTRUCTION", label: "Construction" },
    ...(offersHardMoney(a) ? [{ value: "HARD_MONEY" as const, label: "Hard money or fix-and-flip" }] : []),
  ];
}

export type QualifierValues = {
  assetType: Asset | "";
  transaction: Transaction | "";
  loanAmount: number | null;
  noi: number | null;
  value: number | null;
  unitCount: number | null;
  occupancyPct: number | null;
  adr: number | null;
  pipBudget: number | null;
  franchiseTier: FranchiseTier | "";
  /** Hard money only (transaction "HARD_MONEY"); all optional. */
  hmStrategy: HardMoneyStrategy | "";
  hmPurpose: HardMoneyPurpose | "";
  rehabBudget: number | null;
  /** After-repair value. */
  arv: number | null;
  timelineDays: string;
  ownerOperator: "yes" | "no" | "";
  nonRecourseOnly: boolean;
  green: boolean;
  notes: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company: string;
  consent: boolean;
};

/** Nothing realistic is pre-filled: numbers are empty (inputs show placeholders) and choices are unselected. */
export const EMPTY_VALUES: QualifierValues = {
  assetType: "",
  transaction: "",
  loanAmount: null,
  noi: null,
  value: null,
  unitCount: null,
  occupancyPct: null,
  adr: null,
  pipBudget: null,
  franchiseTier: "",
  hmStrategy: "",
  hmPurpose: "",
  rehabBudget: null,
  arv: null,
  timelineDays: "",
  ownerOperator: "",
  nonRecourseOnly: false,
  green: false,
  notes: "",
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  company: "",
  consent: false,
};

const MAX_MONEY = 1_000_000_000;
const money = (required: string, tooBig = "Enter an amount under $1 billion.") =>
  z.number({ error: required }).min(0, "Enter zero or a positive amount.").max(MAX_MONEY, tooBig);
const optionalMoney = z.number().min(0, "Enter zero or a positive amount.").max(MAX_MONEY, "Enter an amount under $1 billion.").nullable();

const phoneDigits = (s: string) => s.replace(/\D/g, "");

export function qualifierSchema(values: Pick<QualifierValues, "assetType" | "consent">) {
  const asset = values.assetType;
  const hotel = isHotel(asset);
  const commercial = asset === "COMMERCIAL";
  const phone = z
    .string()
    .trim()
    .max(40, "Use 40 characters or fewer.")
    .refine((v) => v === "" || (phoneDigits(v).length >= 10 && phoneDigits(v).length <= 15), "Enter a phone number with area code, for example 415-555-0100.")
    .refine((v) => !values.consent || v !== "", "Add a mobile number so we can use the contact permission you ticked, or untick the box.");

  return z.object({
    assetType: z.enum(ASSETS.map((a) => a.value) as [Asset, ...Asset[]], { error: "Choose what you're financing." }),
    transaction: z.enum(["PURCHASE", "REFINANCE", "CONSTRUCTION", "CONVERSION", "HARD_MONEY"], { error: "Choose the type of transaction." }),
    loanAmount: z
      .number({ error: "Enter the loan amount you're requesting." })
      .min(250_000, "Minimum $250,000.")
      .max(MAX_MONEY, "Enter an amount under $1 billion."),
    noi: money("Enter your net operating income, or 0 if the property has no income yet."),
    value: optionalMoney,
    unitCount: commercial
      ? z.number().int("Enter a whole number.").min(0, "Enter zero or more.").max(10_000, "Enter 10,000 or fewer.").nullable()
      : z.number({ error: `Enter the number of ${unitLabel(asset).toLowerCase()}.` }).int("Enter a whole number.").min(1, "Enter at least 1.").max(10_000, "Enter 10,000 or fewer."),
    occupancyPct: z.number({ error: "Enter current occupancy as a percentage." }).min(0, "Enter a percentage from 0 to 100.").max(100, "Enter a percentage from 0 to 100."),
    adr: hotel ? z.number({ error: "Enter the average daily rate." }).min(1, "Enter a rate above $0.").max(100_000, "Enter a realistic daily rate.") : z.number().nullable(),
    pipBudget: optionalMoney,
    franchiseTier: hotel ? z.enum(["PREMIUM_FLAG", "ECONOMY_FLAG", "BOUTIQUE_INDEPENDENT"], { error: "Choose the franchise tier." }) : z.string(),
    hmStrategy: z.enum(["", ...HARD_MONEY_STRATEGIES.map((o) => o.value)] as ["", ...HardMoneyStrategy[]]),
    hmPurpose: z.enum(["", ...HARD_MONEY_PURPOSES.map((o) => o.value)] as ["", ...HardMoneyPurpose[]]),
    rehabBudget: optionalMoney,
    arv: optionalMoney,
    timelineDays: z.enum(TIMELINES.map((t) => t.value) as [string, ...string[]], { error: "Choose when you need to close." }),
    ownerOperator: z.enum(["yes", "no"], { error: "Tell us whether an owner-operator runs the property." }),
    nonRecourseOnly: z.boolean(),
    green: z.boolean(),
    notes: z.string().trim().max(2_000, "Use 2,000 characters or fewer."),
    firstName: z.string().trim().min(1, "Enter your first name.").max(80, "Use 80 characters or fewer."),
    lastName: z.string().trim().min(1, "Enter your last name.").max(80, "Use 80 characters or fewer."),
    email: z.string().trim().min(1, "Enter your email address.").max(200, "Use 200 characters or fewer.").pipe(z.email("Enter a valid email address, like name@company.com.")),
    phone,
    company: z.string().trim().max(160, "Use 160 characters or fewer."),
    consent: z.boolean(),
  });
}

export type QualifierPayload = {
  intake: Intake;
  contact: { firstName: string; lastName: string; email: string; phone: string; company: string; consent: boolean };
  consentMeta: { textVersion: string; page: string };
};

/** Converts validated form values to the /api/qualify body. Throws if called with unvalidated values. */
export function buildQualifyPayload(v: QualifierValues, consentMeta: QualifierPayload["consentMeta"]): QualifierPayload {
  if (!v.assetType || !v.transaction || v.loanAmount === null || v.noi === null) throw new Error("buildQualifyPayload needs validated values");
  const hotel = isHotel(v.assetType);
  // The transaction option's value follows the asset ("Construction" vs "Conversion"); reconcile if the asset changed after it was picked.
  let transaction: Transaction = v.transaction;
  if (isConversion(v.assetType) && transaction === "CONSTRUCTION") transaction = "CONVERSION";
  if (!isConversion(v.assetType) && transaction === "CONVERSION") transaction = "CONSTRUCTION";
  const hotelLike = hotel || isConversion(v.assetType);
  // Hard money detail is sent only when the visitor gave some; the server sizes defaults otherwise.
  const hardMoney =
    transaction === "HARD_MONEY" && (v.hmStrategy || v.hmPurpose || v.rehabBudget || v.arv)
      ? {
          strategy: v.hmStrategy || "FIX_AND_FLIP",
          purpose: v.hmPurpose || "PURCHASE",
          rehabBudget: v.rehabBudget ?? 0,
          arv: v.arv || undefined,
          termMonths: 12,
          completedProjects: 0,
          existingPayoff: undefined,
        }
      : undefined;
  return {
    intake: {
      assetType: v.assetType,
      transaction,
      loanAmount: v.loanAmount,
      noi: v.noi,
      value: v.value || undefined,
      unitCount: v.unitCount ?? 0,
      occupancyPct: v.occupancyPct ?? 0,
      adr: hotel ? (v.adr ?? undefined) : undefined,
      pipBudget: hotelLike ? v.pipBudget || undefined : undefined,
      franchiseTier: hotel && v.franchiseTier ? v.franchiseTier : undefined,
      ...(hardMoney ? { hardMoney } : {}),
      timelineDays: Number(v.timelineDays),
      nonRecourseOnly: v.nonRecourseOnly,
      green: v.green,
      ownerOperator: v.ownerOperator === "yes",
      notes: v.notes.trim(),
      source: "express",
    },
    contact: {
      firstName: v.firstName.trim(),
      lastName: v.lastName.trim(),
      email: v.email.trim(),
      phone: v.phone.trim(),
      company: v.company.trim(),
      consent: v.consent,
    },
    consentMeta,
  };
}

/** Query-string prefill from the sizer's link to the qualifier. Only values the visitor entered are carried over. */
export function prefillFromParams(get: (key: string) => string | null): Partial<QualifierValues> {
  const asset = ASSETS.find((a) => a.value === get("asset"))?.value;
  const positive = (key: string) => {
    const n = Number(get(key));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  // The sizer's hard money and construction tabs also send the transaction; keep it only when the asset offers it.
  const transaction = asset ? transactionOptions(asset).find((o) => o.value === get("transaction"))?.value : undefined;
  return { ...(asset ? { assetType: asset } : {}), ...(transaction ? { transaction } : {}), loanAmount: positive("loan"), noi: positive("noi") };
}

// ---------------------------------------------------------------------------
// Family links: /express?family=<family> from the homepage cards and program
// pages. The family only shapes the first step (which assets show, and in what
// order) and preselects a transaction. Explicit `asset` and `transaction`
// parameters, as the sizer sends them, always win.

/** The program family named by `?family=`, or undefined when it is missing or unknown. */
export function familyFromParams(get: (key: string) => string | null): ProgramFamily | undefined {
  const raw = get("family")?.trim();
  return PROGRAM_FAMILIES.find((f) => f === raw);
}

/** Asset group a family link shows first. Construction and hard money keep the default order. */
const FAMILY_GROUP: Partial<Record<ProgramFamily, AssetGroup>> = {
  "senior-living": "Senior living and care",
  hotels: "Hospitality",
  multifamily: "Multifamily and CRE",
};

/** Transaction a family link preselects once the visitor picks an asset that offers it. */
const FAMILY_TRANSACTION: Partial<Record<ProgramFamily, Transaction>> = {
  construction: "CONSTRUCTION",
  "hard-money": "HARD_MONEY",
};

/** Asset groups in display order, with the family's own group first. */
export function assetGroupsFor(family?: ProgramFamily): readonly AssetGroup[] {
  const first = family ? FAMILY_GROUP[family] : undefined;
  return first ? [first, ...ASSET_GROUPS.filter((g) => g !== first)] : ASSET_GROUPS;
}

/** Assets in one group. A hard money link lists only assets a private lender finances. */
export function assetsFor(group: AssetGroup, family?: ProgramFamily): typeof ASSETS {
  return ASSETS.filter((a) => a.group === group && (family !== "hard-money" || offersHardMoney(a.value)));
}

/**
 * Shown above the asset groups on a plain /express visit (no family link), so a
 * construction or hard money borrower sees their project on step 1. A pick
 * works like the family link: it reshapes the asset list and preselects the
 * transaction once an asset is chosen. Pressing it again clears it.
 */
export const PROJECT_PICKS_LABEL = "Building or need fast private money?";
export const PROJECT_PICKS: readonly { family: ProgramFamily; label: string }[] = [
  { family: "construction", label: "Ground-up construction or heavy rehab" },
  { family: "hard-money", label: "Hard money, fix-and-flip or private bridge" },
];

export function assetStepHeading(family?: ProgramFamily): string {
  if (family === "construction") return "What are you building or renovating?";
  if (family === "hard-money") return "What property is the loan for?";
  return "What are you financing?";
}

/** The family's transaction for this asset, only when the asset offers it. */
export function familyTransaction(asset: Asset | "", family?: ProgramFamily): Transaction | undefined {
  const pending = family ? FAMILY_TRANSACTION[family] : undefined;
  return pending && transactionOptions(asset).some((o) => o.value === pending) ? pending : undefined;
}

/**
 * The transaction to keep once the visitor picks an asset: their current pick
 * while the asset still offers it, else the family's transaction when the asset
 * offers that, else none.
 */
export function transactionAfterAssetChoice(asset: Asset, current: Transaction | "", family?: ProgramFamily): Transaction | "" {
  if (current && transactionOptions(asset).some((o) => o.value === current)) return current;
  return familyTransaction(asset, family) ?? "";
}
