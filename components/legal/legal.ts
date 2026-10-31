// Shared facts for the legal pages and the notice at collection. Kept as data
// so the privacy policy, the short form notices, and the tests all read one
// source. Draft text: every page shows a counsel-review banner until
// NEXT_PUBLIC_LEGAL_APPROVED is "true".

type Env = Record<string, string | undefined>;

export function legalApproved(env: Env = process.env): boolean {
  return env.NEXT_PUBLIC_LEGAL_APPROVED === "true";
}

/** Bumped whenever the privacy policy or the notice at collection changes. */
export const PRIVACY_POLICY_VERSION = "2026-11-01";
export const LEGAL_EFFECTIVE_DATE = "November 1, 2026";

export const LEGAL_PAGES = [
  { href: "/privacy", label: "Privacy policy" },
  { href: "/privacy#notice-at-collection", label: "Notice at collection" },
  { href: "/privacy/ai", label: "AI use and your choices" },
  { href: "/terms", label: "Terms of use" },
  { href: "/licensing", label: "Licensing and disclosures" },
  { href: "/accessibility", label: "Accessibility" },
] as const;

export type CategoryId =
  | "identifiers"
  | "contact"
  | "professional"
  | "loan_request"
  | "financial_documents"
  | "communications"
  | "consent_records"
  | "device_usage"
  | "inferences";

export type PiCategory = {
  id: CategoryId;
  /** CCPA category name (Civ. Code §1798.140(v)). */
  ccpa: string;
  label: string;
  examples: string;
  sensitive: boolean;
  retention: string;
};

// Retention periods are drafts for counsel. Loan file periods follow the DRE's
// three-year record rule (Bus. & Prof. Code §10148); anything under a legal hold
// is kept until the hold is released.
export const PI_CATEGORIES: readonly PiCategory[] = [
  {
    id: "identifiers",
    ccpa: "Identifiers",
    label: "Identifiers",
    examples: "Name, email address, phone number, IP address, and the reference ID we assign to your request.",
    sensitive: false,
    retention: "For the life of the relationship, then three years after our last contact with you.",
  },
  {
    id: "contact",
    ccpa: "Personal information described in Civ. Code §1798.80(e)",
    label: "Contact and customer records",
    examples: "Mailing address, company name, and the contact details you give us for co-borrowers or principals.",
    sensitive: false,
    retention: "Three years after our last contact with you, or three years after the related loan closes, whichever is later.",
  },
  {
    id: "professional",
    ccpa: "Professional or employment-related information",
    label: "Professional information",
    examples: "Job title, organization, license type and number, markets served, services offered, and lending criteria.",
    sensitive: false,
    retention: "While the partner relationship is active, then three years.",
  },
  {
    id: "loan_request",
    ccpa: "Commercial information",
    label: "Loan request and property details",
    examples: "Property type, location, loan amount, income and occupancy figures, timing, and the notes you write.",
    sensitive: false,
    retention: "Three years after our last contact with you; for loans we arrange, three years after the loan closes or the file is withdrawn.",
  },
  {
    id: "financial_documents",
    ccpa: "Financial information and sensitive personal information",
    label: "Financial documents",
    examples:
      "Operating statements, rent rolls, census and STR reports, personal financial statements, and anything those files contain, such as account numbers or government ID numbers.",
    sensitive: true,
    retention: "Three years after the related loan closes or the request is withdrawn, unless a lender or regulator requires longer.",
  },
  {
    id: "communications",
    ccpa: "Audio, electronic, or similar information",
    label: "Communications",
    examples: "Emails, text messages, call notes, and questions you send to Kubera AI.",
    sensitive: false,
    retention: "Three years after our last contact with you. Kubera AI conversations are kept for up to one year unless they become part of a loan file.",
  },
  {
    id: "consent_records",
    ccpa: "Commercial information",
    label: "Consent records",
    examples: "The consent text you agreed to, when you agreed, the page, IP address, and browser, and any opt-out.",
    sensitive: false,
    retention: "Five years after consent is withdrawn or the relationship ends, so we can prove consent and honor opt-outs.",
  },
  {
    id: "device_usage",
    ccpa: "Internet or other electronic network activity",
    label: "Device and usage data",
    examples: "Browser type, device type, pages viewed, referring page, and security logs. We do not use advertising cookies.",
    sensitive: false,
    retention: "Up to 90 days for security and error logs; aggregated statistics without identifiers may be kept longer.",
  },
  {
    id: "inferences",
    ccpa: "Inferences",
    label: "Program-fit assessments",
    examples: "Our internal view of which loan programs may fit your request and how quickly an advisor should follow up.",
    sensitive: false,
    retention: "Kept with the loan request it describes.",
  },
] as const;

export const PURPOSES = [
  "Respond to your request and have a licensed advisor review it.",
  "Arrange financing as a real estate broker, including sharing your loan package with lenders and third-party report providers you ask us to work with.",
  "Prepare required disclosures, such as the Mortgage Loan Disclosure Statement, and keep records the California Department of Real Estate requires.",
  "Contact you by email, phone, or text when you have agreed to it.",
  "Send the newsletter you subscribe to, and keep a record of your consent and any unsubscribe.",
  "Review partner registrations and manage partner relationships.",
  "Run AI-assisted sizing and analysis that an advisor reviews.",
  "Protect our sites and users, prevent fraud, and fix errors.",
  "Comply with law, respond to lawful requests, and enforce our terms.",
] as const;

export type CollectionPoint = "qualifier" | "partner" | "upload" | "privacy_request" | "newsletter";

export const COLLECTION_POINTS: Record<CollectionPoint, { categories: readonly CategoryId[]; purpose: string; retention?: string }> = {
  qualifier: {
    categories: ["identifiers", "contact", "loan_request", "consent_records", "device_usage", "inferences"],
    purpose: "to review your financing request, have an advisor contact you, and arrange financing if you go ahead",
  },
  partner: {
    categories: ["identifiers", "contact", "professional", "consent_records", "device_usage"],
    purpose: "to review your registration, contact you, and send you deals or requests that match what you do",
  },
  upload: {
    categories: ["financial_documents", "loan_request", "device_usage"],
    purpose: "to analyze your request and, with your direction, share your loan package with prospective lenders",
  },
  privacy_request: {
    categories: ["identifiers", "contact"],
    purpose: "to verify your identity and respond to your privacy request; we use it only for that purpose",
    // 11 CCR §7101: request records are kept 24 months (see lib/privacy/retention.ts).
    retention: "which for privacy requests is 24 months after we close the request, as California privacy regulations require",
  },
  newsletter: {
    categories: ["identifiers", "consent_records", "device_usage"],
    purpose: "to send you the newsletter you asked for and keep a record of your consent",
    // Matches the consent_records retention: the opt-out is kept so it can be honored.
    retention: "which for the newsletter is until you unsubscribe, and for the record of your consent and unsubscribe five years after that",
  },
};

export function categoryById(id: CategoryId): PiCategory {
  const found = PI_CATEGORIES.find((c) => c.id === id);
  if (!found) throw new Error(`Unknown personal information category: ${id}`);
  return found;
}

/** Plain-language list of the categories collected at one point, e.g. "identifiers, contact details and …". */
export function categoriesSentence(point: CollectionPoint): string {
  const labels = COLLECTION_POINTS[point].categories.map((id) => categoryById(id).label.toLowerCase());
  if (labels.length <= 1) return labels.join("");
  if (labels.length === 2) return labels.join(" and ");
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}

/** Service providers that process personal information for us. */
export const SERVICE_PROVIDERS = [
  { name: "Vercel", role: "Website hosting" },
  { name: "Supabase", role: "Database and encrypted document storage" },
  { name: "Twenty", role: "Customer relationship management" },
  { name: "Anthropic", role: "AI processing for Kubera AI and sizing narratives" },
  { name: "Zoho", role: "Business email and electronic signatures" },
  { name: "Resend", role: "Transactional email and the newsletter" },
  { name: "Telnyx", role: "Text messages and calls" },
  { name: "Cloudflare", role: "Bot protection" },
  { name: "Sentry", role: "Error monitoring, with personal details removed" },
] as const;
