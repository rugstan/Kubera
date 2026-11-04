import { z } from "zod";
import { TIMELINES, assetGroupsFor, assetsFor } from "@/components/express/schema";
import type { Option } from "@/components/forms";
import type { ProgramFamily } from "@/content/programs/types";
import { PROPERTY_TYPES, type PropertyType } from "@/lib/property-types";
import type { QuickTransaction } from "@/lib/validation";

// The short request form on every /financing page: option lists, the Zod
// schema, page presets and the builder for the /api/qualify body
// (`kind: "quick"`). Pure, so it is unit-tested without a browser.

/** Id of the request form's section, the target of the "send a short request" link at the top of each page. */
export const LEAD_FORM_ANCHOR = "request";

export type LeadFormValues = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company: string;
  assetType: PropertyType | "";
  transaction: QuickTransaction | "";
  loanAmount: number | null;
  timelineDays: string;
  notes: string;
  consent: boolean;
};

export const EMPTY_LEAD: LeadFormValues = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  company: "",
  assetType: "",
  transaction: "",
  loanAmount: null,
  timelineDays: "",
  notes: "",
  consent: false,
};

export const LEAD_FIELDS = Object.keys(EMPTY_LEAD);

export const LEAD_TRANSACTIONS: Option<QuickTransaction>[] = [
  { value: "PURCHASE", label: "Purchase" },
  { value: "REFINANCE", label: "Refinance" },
  { value: "CONSTRUCTION", label: "Construction" },
  { value: "OTHER", label: "Other" },
];

export { TIMELINES as LEAD_TIMELINES };

/** "Commercial / bridge" reads oddly outside the qualifier's tiles; here it is the catch-all. */
const LABEL_OVERRIDES: Partial<Record<PropertyType, string>> = { COMMERCIAL: "Other commercial property" };

/** Every property type, grouped, with the page's own group first. */
export function propertyTypeOptions(family?: ProgramFamily): Option<PropertyType>[] {
  return assetGroupsFor(family).flatMap((group) => assetsFor(group).map((a) => ({ value: a.value, label: LABEL_OVERRIDES[a.value] ?? a.label, group })));
}

/** Pages about one property type preset it; the visitor can change it. */
const ASSET_BY_SLUG: Record<string, PropertyType> = {
  "office-loans": "OFFICE",
  "industrial-loans": "INDUSTRIAL",
  "retail-loans": "RETAIL",
  "self-storage-loans": "SELF_STORAGE",
  "medical-office-loans": "MEDICAL_OFFICE",
  "mixed-use-loans": "MIXED_USE",
  "mobile-home-park-loans": "MANUFACTURED_HOUSING",
  "assisted-living": "ASSISTED_LIVING",
  rcfe: "RCFE",
  "memory-care": "MEMORY_CARE",
  "skilled-nursing": "SNF",
  "hotel-to-senior-living-conversion": "HOTEL_TO_SENIOR_CONVERSION",
};

/** Otherwise the family's usual property, where it has one. Capital-type, construction and hard money pages leave it to the visitor. */
const ASSET_BY_FAMILY: Partial<Record<ProgramFamily, PropertyType>> = {
  "senior-living": "ASSISTED_LIVING",
  hotels: "HOTEL_FLAGGED",
  multifamily: "MULTIFAMILY",
};

/** Transactions a page is plainly about. */
const TRANSACTION_BY_SLUG: Record<string, QuickTransaction> = {
  "acquisition-loans": "PURCHASE",
  "hud-221d4": "CONSTRUCTION",
  "hotel-to-senior-living-conversion": "CONSTRUCTION",
};

export function leadPreset(slug: string, family: ProgramFamily): Pick<LeadFormValues, "assetType" | "transaction"> {
  const asset = ASSET_BY_SLUG[slug] ?? ASSET_BY_FAMILY[family] ?? "";
  const transaction = TRANSACTION_BY_SLUG[slug] ?? (family === "construction" ? "CONSTRUCTION" : "");
  return { assetType: asset, transaction };
}

const MAX_MONEY = 1_000_000_000;
const phoneDigits = (s: string) => s.replace(/\D/g, "");

export function leadFormSchema(values: Pick<LeadFormValues, "consent">) {
  const phone = z
    .string()
    .trim()
    .max(40, "Use 40 characters or fewer.")
    .refine((v) => v === "" || (phoneDigits(v).length >= 10 && phoneDigits(v).length <= 15), "Enter a phone number with area code, for example 415-555-0100.")
    .refine((v) => !values.consent || v !== "", "Add a mobile number so we can use the contact permission you ticked, or untick the box.");
  return z.object({
    firstName: z.string().trim().min(1, "Enter your first name.").max(80, "Use 80 characters or fewer."),
    lastName: z.string().trim().min(1, "Enter your last name.").max(80, "Use 80 characters or fewer."),
    email: z.string().trim().min(1, "Enter your email address.").max(200, "Use 200 characters or fewer.").pipe(z.email("Enter a valid email address, like name@company.com.")),
    phone,
    company: z.string().trim().max(160, "Use 160 characters or fewer."),
    assetType: z.enum(PROPERTY_TYPES, { error: "Choose the property type." }),
    transaction: z.enum(["PURCHASE", "REFINANCE", "CONSTRUCTION", "OTHER"], { error: "Choose the type of transaction." }),
    loanAmount: z.number({ error: "Enter the approximate loan amount." }).min(250_000, "Minimum $250,000.").max(MAX_MONEY, "Enter an amount under $1 billion."),
    timelineDays: z.enum(TIMELINES.map((t) => t.value) as [string, ...string[]], { error: "Choose when you need to close." }),
    notes: z.string().trim().max(2_000, "Use 2,000 characters or fewer."),
    consent: z.boolean(),
  });
}

export type LeadPayload = {
  kind: "quick";
  quick: { assetType: PropertyType; transaction: QuickTransaction; loanAmount: number; timelineDays: number; notes: string; slug: string };
  contact: { firstName: string; lastName: string; email: string; phone: string; company: string; consent: boolean };
  consentMeta: { textVersion: string; page: string };
};

/** Converts validated form values to the /api/qualify body. Throws if called with unvalidated values. */
export function buildLeadPayload(v: LeadFormValues, slug: string, consentMeta: LeadPayload["consentMeta"]): LeadPayload {
  if (!v.assetType || !v.transaction || v.loanAmount === null || !v.timelineDays) throw new Error("buildLeadPayload needs validated values");
  return {
    kind: "quick",
    quick: { assetType: v.assetType, transaction: v.transaction, loanAmount: v.loanAmount, timelineDays: Number(v.timelineDays), notes: v.notes.trim(), slug },
    contact: { firstName: v.firstName.trim(), lastName: v.lastName.trim(), email: v.email.trim(), phone: v.phone.trim(), company: v.company.trim(), consent: v.consent },
    consentMeta,
  };
}
