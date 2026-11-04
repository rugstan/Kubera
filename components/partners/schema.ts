import { z } from "zod";

// The partner portal's form model: the four partner types, their option lists,
// one Zod schema per type (the form keeps one set of values across tabs and
// validates only the active type), and the builders that turn values into the
// /api/partners payload.

export type PartnerType = "LENDER" | "REFERRAL" | "OPERATOR" | "VENDOR";

export const TYPES: { id: PartnerType; hash: string; title: string; blurb: string }[] = [
  { id: "LENDER", hash: "lender", title: "Wholesale lenders", blurb: "Banks, debt funds, CMBS desks, SBA CDCs and 7(a) lenders, HUD MAP/LEAN lenders. Register your current credit box and broker compensation terms." },
  { id: "REFERRAL", hash: "referral", title: "Referral brokers", blurb: "Real estate brokers, hotel brokers, and affiliates. Co-broker or refer deals under a signed non-circumvention and fee-split agreement." },
  { id: "OPERATOR", hash: "operator", title: "Operators", blurb: "RCFE, assisted living, memory care, SNF, and hotel management operators — introduced to owners who need HUD-compliant or franchise-accepted management." },
  { id: "VENDOR", hash: "vendor", title: "Third-party vendors", blurb: "MAI healthcare and hospitality appraisers, HVS/STR analysts, Phase I ESA, PCNA engineers, CPAs. Receive RFPs when a deal needs your reports." },
];

export const VERTICALS = [
  { value: "SENIOR_LIVING", label: "Senior living & care" },
  { value: "HOSPITALITY", label: "Hospitality" },
  { value: "MULTIFAMILY", label: "Multifamily" },
  { value: "COMMERCIAL", label: "Commercial" },
  { value: "CONSTRUCTION", label: "Construction" },
] as const;

export const SERVICES = [
  { value: "MAI_APPRAISAL_HEALTHCARE", label: "MAI appraisal — healthcare" },
  { value: "MAI_APPRAISAL_HOSPITALITY", label: "MAI appraisal — hospitality" },
  { value: "HVS_STR_FEASIBILITY", label: "HVS / STR feasibility" },
  { value: "PHASE_I_ESA", label: "Phase I ESA" },
  { value: "PCNA", label: "PCNA / property condition" },
  { value: "CPA_AUDIT", label: "CPA / HUD audit" },
  { value: "LEGAL", label: "Legal" },
  { value: "TITLE_ESCROW", label: "Title & escrow" },
] as const;

export const LENDER_KINDS = [
  { value: "BANK", label: "Bank / credit union" },
  { value: "DEBT_FUND", label: "Debt fund" },
  { value: "CMBS_DESK", label: "CMBS conduit desk" },
  { value: "SBA_CDC", label: "SBA 504 CDC" },
  { value: "SBA_7A_LENDER", label: "SBA 7(a) lender" },
  { value: "HUD_LENDER", label: "HUD MAP / LEAN lender" },
  { value: "LIFE_CO", label: "Life company" },
  { value: "PRIVATE", label: "Private lender" },
] as const;

export const LICENSE_TYPES = [
  { value: "CA_DRE_BROKER", label: "California DRE broker" },
  { value: "CA_DRE_SALESPERSON", label: "California DRE salesperson" },
  { value: "OTHER_STATE_LICENSE", label: "Other state license" },
  { value: "HOTEL_BROKER", label: "Hotel / business broker" },
  { value: "UNLICENSED_REFERRAL", label: "Not licensed (finder)" },
] as const;

export const OPERATOR_KINDS = [
  { value: "RCFE_ASSISTED_LIVING", label: "RCFE / assisted living" },
  { value: "MEMORY_CARE", label: "Memory care" },
  { value: "SNF", label: "Skilled nursing" },
  { value: "HOTEL_MANAGEMENT", label: "Hotel management" },
] as const;

export type PartnerFormValues = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  consent: boolean;
  organization: string;
  // lender
  lenderKind: string;
  minLoan: number | null;
  maxLoan: number | null;
  verticals: string[];
  maxLtv: number | null;
  maxLtc: number | null;
  minDscr: number | null;
  minDebtYield: number | null;
  brokerFeeProtectionPct: number | null;
  flagRequirements: string;
  states: string;
  website: string;
  // referral
  licenseType: string;
  licenseNumber: string;
  acceptsAgreement: boolean;
  // shared by referral (markets served), operator and vendor
  markets: string;
  // operator
  operatorKind: string;
  unitsUnderManagement: number | null;
  licenseNumbers: string;
  flagsApproved: string;
  // vendor
  services: string[];
  typicalTurnaroundDays: number | null;
};

/** No realistic values are pre-filled; the inputs show example placeholders instead. */
export const EMPTY_PARTNER_VALUES: PartnerFormValues = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  consent: false,
  organization: "",
  lenderKind: "",
  minLoan: null,
  maxLoan: null,
  verticals: [],
  maxLtv: null,
  maxLtc: null,
  minDscr: null,
  minDebtYield: null,
  brokerFeeProtectionPct: null,
  flagRequirements: "",
  states: "",
  website: "",
  licenseType: "",
  licenseNumber: "",
  acceptsAgreement: false,
  markets: "",
  operatorKind: "",
  unitsUnderManagement: null,
  licenseNumbers: "",
  flagsApproved: "",
  services: [],
  typicalTurnaroundDays: null,
};

/** Human labels by field, for the error summary. */
export const FIELD_LABELS: Record<string, string> = {
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  phone: "Phone",
  organization: "Organization",
  lenderKind: "Lender type",
  minLoan: "Min loan",
  maxLoan: "Max loan",
  verticals: "Appetite",
  maxLtv: "Max LTV / LTC",
  maxLtc: "Max LTC (construction)",
  minDscr: "Min DSCR",
  minDebtYield: "Min debt yield",
  brokerFeeProtectionPct: "Broker compensation you pay",
  website: "Website",
  licenseType: "License",
  licenseNumber: "License #",
  acceptsAgreement: "Agreement",
  markets: "Markets",
  operatorKind: "Operator type",
  unitsUnderManagement: "Beds / keys under management",
  services: "Services",
  typicalTurnaroundDays: "Typical turnaround",
};

const MAX_MONEY = 1_000_000_000;

const text = (max: number) => z.string().trim().max(max, `Use ${max} characters or fewer.`);
const required = (message: string, max = 160) => z.string().trim().min(1, message).max(max, `Use ${max} characters or fewer.`);
const pct = (message: string, max: number) => z.number({ error: message }).min(0, `Enter a number from 0 to ${max}.`).max(max, `Enter a number from 0 to ${max}.`);
const phoneDigits = (s: string) => s.replace(/\D/g, "");

/** "example.com" becomes "https://example.com"; blank stays blank. */
export function normalizeWebsite(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`;
}

function websiteOk(raw: string): boolean {
  const v = normalizeWebsite(raw);
  if (!v) return true;
  try {
    const u = new URL(v);
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".");
  } catch {
    return false;
  }
}

function contactShape(consent: boolean) {
  return {
    firstName: required("Enter your first name.", 80),
    lastName: required("Enter your last name.", 80),
    email: z.string().trim().min(1, "Enter your email address.").max(200, "Use 200 characters or fewer.").pipe(z.email("Enter a valid email address, like name@company.com.")),
    phone: z
      .string()
      .trim()
      .max(40, "Use 40 characters or fewer.")
      .refine((v) => v === "" || (phoneDigits(v).length >= 10 && phoneDigits(v).length <= 15), "Enter a phone number with area code, for example 415-555-0100.")
      .refine((v) => !consent || v !== "", "Add a phone number so we can use the contact permission you ticked, or untick the box."),
    consent: z.boolean(),
  };
}

export function partnerFormSchema(type: PartnerType, values: Pick<PartnerFormValues, "consent" | "licenseType" | "minLoan">) {
  const contact = contactShape(values.consent);
  switch (type) {
    case "LENDER":
      return z
        .object({
          ...contact,
          organization: required("Enter your organization's name."),
          lenderKind: z.enum(LENDER_KINDS.map((k) => k.value) as [string, ...string[]], { error: "Choose your lender type." }),
          minLoan: z.number({ error: "Enter your minimum loan size." }).min(0, "Enter zero or more.").max(MAX_MONEY, "Enter an amount under $1 billion."),
          maxLoan: z
            .number({ error: "Enter your maximum loan size." })
            .min(values.minLoan ?? 0, "Max loan must be at least the minimum loan.")
            .max(MAX_MONEY, "Enter an amount under $1 billion."),
          verticals: z.array(z.string()),
          maxLtv: pct("Enter your maximum LTV or LTC as a percentage.", 100),
          maxLtc: pct("Enter a number", 100).nullable(),
          minDscr: pct("Enter a number", 5).nullable(),
          minDebtYield: pct("Enter a number", 50).nullable(),
          brokerFeeProtectionPct: pct("Enter the broker compensation you pay, as a percentage (0 if none).", 10),
          flagRequirements: text(400),
          states: text(400),
          website: text(300).refine(websiteOk, "Enter a full web address, like https://example.com."),
        });
    case "REFERRAL":
      return z.object({
        ...contact,
        organization: text(160),
        licenseType: z.enum(LICENSE_TYPES.map((k) => k.value) as [string, ...string[]], { error: "Choose your license type." }),
        licenseNumber:
          values.licenseType && values.licenseType !== "UNLICENSED_REFERRAL"
            ? required("Enter your license number.", 40)
            : text(40),
        markets: text(400),
        acceptsAgreement: z.literal(true, { error: "Confirm that you agree to review the agreement to register." }),
      });
    case "OPERATOR":
      return z.object({
        ...contact,
        organization: required("Enter your organization's name."),
        operatorKind: z.enum(OPERATOR_KINDS.map((k) => k.value) as [string, ...string[]], { error: "Choose your operator type." }),
        unitsUnderManagement: z.number({ error: "Enter the number of beds or keys you manage." }).int("Enter a whole number.").min(0, "Enter zero or more.").max(1_000_000, "Enter 1,000,000 or fewer."),
        licenseNumbers: text(400),
        flagsApproved: text(400),
        markets: text(400),
      });
    case "VENDOR":
      return z.object({
        ...contact,
        organization: required("Enter your company's name."),
        services: z.array(z.string()).min(1, "Select at least one service you provide."),
        markets: text(400),
        typicalTurnaroundDays: z.number().int("Enter a whole number of days.").min(0, "Enter zero or more.").max(365, "Enter 365 or fewer.").nullable(),
      });
  }
}

/** Fields that exist for each type (used to jump to the right place on a server rejection). */
export const TYPE_FIELDS: Record<PartnerType, readonly (keyof PartnerFormValues)[]> = {
  LENDER: ["organization", "lenderKind", "minLoan", "maxLoan", "verticals", "maxLtv", "maxLtc", "minDscr", "minDebtYield", "brokerFeeProtectionPct", "flagRequirements", "states", "website"],
  REFERRAL: ["organization", "licenseType", "licenseNumber", "markets", "acceptsAgreement"],
  OPERATOR: ["organization", "operatorKind", "unitsUnderManagement", "licenseNumbers", "flagsApproved", "markets"],
  VENDOR: ["organization", "services", "markets", "typicalTurnaroundDays"],
};

const optionalNumber = (n: number | null) => (n === null ? undefined : n);

export type PartnerPayload = Record<string, unknown> & { partnerType: PartnerType; consentMeta: { textVersion: string; page: string } };

/** Converts validated values to the /api/partners body. */
export function buildPartnerPayload(type: PartnerType, v: PartnerFormValues, consentMeta: PartnerPayload["consentMeta"]): PartnerPayload {
  const contact = { firstName: v.firstName.trim(), lastName: v.lastName.trim(), email: v.email.trim(), phone: v.phone.trim(), company: "", consent: v.consent };
  const base = { partnerType: type, contact, organization: v.organization.trim(), consentMeta };
  switch (type) {
    case "LENDER":
      return {
        ...base,
        website: normalizeWebsite(v.website),
        lenderKind: v.lenderKind,
        minLoan: v.minLoan ?? 0,
        maxLoan: v.maxLoan ?? 0,
        verticals: v.verticals,
        states: v.states.trim(),
        maxLtv: v.maxLtv ?? 0,
        maxLtc: optionalNumber(v.maxLtc),
        minDscr: optionalNumber(v.minDscr),
        minDebtYield: optionalNumber(v.minDebtYield),
        flagRequirements: v.flagRequirements.trim(),
        brokerFeeProtectionPct: v.brokerFeeProtectionPct ?? 0,
      };
    case "REFERRAL":
      return { ...base, licenseType: v.licenseType, licenseNumber: v.licenseNumber.trim(), marketsServed: v.markets.trim(), acceptsAgreement: v.acceptsAgreement };
    case "OPERATOR":
      return { ...base, operatorKind: v.operatorKind, licenseNumbers: v.licenseNumbers.trim(), unitsUnderManagement: v.unitsUnderManagement ?? 0, flagsApproved: v.flagsApproved.trim(), markets: v.markets.trim() };
    case "VENDOR":
      return { ...base, services: v.services, markets: v.markets.trim(), typicalTurnaroundDays: optionalNumber(v.typicalTurnaroundDays) };
  }
}
