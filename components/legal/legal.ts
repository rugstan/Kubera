// Shared facts for the legal pages and the notice at collection. Kept as data
// so the privacy policy, the short form notices, and the tests all read one
// source. Draft text: every page shows a counsel-review banner until
// NEXT_PUBLIC_LEGAL_APPROVED is "true".

type Env = Record<string, string | undefined>;

export function legalApproved(env: Env = process.env): boolean {
  return env.NEXT_PUBLIC_LEGAL_APPROVED === "true";
}

/**
 * Bumped whenever the privacy policy or the notice at collection changes. The
 * November 2 revision folds the separate assistant page into the policy and
 * describes the automated tools neutrally. Add a ".2" suffix for a second
 * revision on the same day. "2026-11-02.2" scopes the automated-sending
 * statement to what the code does (pre-approved templates send automatically;
 * drafts and lender packages wait for an advisor) and adds call summaries and
 * consent-only artificial-voice calls. Counsel to confirm. "2026-11-02.3" lists
 * NVIDIA and Voyage as service providers on deployments that switch those
 * integrations on (see serviceProviders below). Counsel to confirm the
 * no-training statement for each of them.
 */
export const PRIVACY_POLICY_VERSION = "2026-11-02.3";
export const LEGAL_EFFECTIVE_DATE = "November 2, 2026";

export const LEGAL_PAGES = [
  { href: "/privacy", label: "Privacy policy" },
  { href: "/privacy#notice-at-collection", label: "Notice at collection" },
  { href: "/privacy#request", label: "Privacy requests" },
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
    examples: "Emails, text messages, call notes, recordings and transcripts of calls we tell you are recorded, and questions you sent through our website's former Ask feature.",
    sensitive: false,
    retention: "Three years after our last contact with you. Questions sent through our website's former Ask feature are kept for up to one year unless they became part of a loan file.",
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

/**
 * Specific records and how long each is kept, shown under the category table
 * on the privacy page. Each row names the retention policies in
 * lib/privacy/retention.ts that enforce it (asserted in tests), so the
 * published schedule and the deletion engine cannot drift apart.
 */
export const RECORD_RETENTION: readonly { record: string; retention: string; policies: readonly string[] }[] = [
  {
    record: "Emails you send to our deals, documents, lender, vendor, and closing mailboxes, with their attachments",
    retention:
      "Kept with your loan request and deleted with it. Email not tied to a request: three years after we receive it. Auto-replies, marketing, and spam: 90 days.",
    policies: ["leads", "mail_messages", "mail_messages_ignored"],
  },
  {
    record: "Text messages to and from us, including STOP, HELP, and START replies",
    retention: "Kept with your loan request and deleted with it; otherwise three years after the message. The record of an opt-out stays in your consent records.",
    policies: ["leads", "sms_messages"],
  },
  {
    record: "Our log of the emails and texts we send you (address or number, message type, delivery status)",
    retention: "Kept with your loan request and deleted with it; otherwise three years after we send it.",
    policies: ["leads", "notifications"],
  },
  {
    record: "Newsletter subscription",
    retention: "Until you unsubscribe, then 30 days. A signup you never confirm is deleted after 30 days. The record of your consent and unsubscribe is kept five years.",
    policies: ["newsletter_pending", "newsletter_unsubscribed", "consent_events"],
  },
  // Remove this record after 2027-11-30, once the 12-month lookback for the
  // retired feature and the 365-day purge of its stored conversations have both passed.
  {
    record: "Questions sent through our website's former Ask feature (retired November 2026)",
    retention: "Up to one year after the question, unless it became part of a loan file.",
    policies: ["ai_conversations", "leads"],
  },
];

export const PURPOSES = [
  "Respond to your request and have a licensed advisor review it.",
  "Arrange financing as a real estate broker, including sharing your loan package with lenders and third-party report providers you ask us to work with.",
  "Prepare required disclosures, such as the Mortgage Loan Disclosure Statement, and keep records the California Department of Real Estate requires.",
  "Contact you by email, phone, or text when you have agreed to it.",
  "Send the newsletter you subscribe to, and keep a record of your consent and any unsubscribe.",
  "Review partner registrations and manage partner relationships.",
  "Use automated tools for sizing estimates, program fit, follow-up priority, document reading, email sorting, and summaries of calls and call notes, with an advisor reviewing the results.",
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

const isSet = (v: string | undefined) => Boolean(v?.trim());

/** Service providers that receive personal information on every deployment. */
const CORE_SERVICE_PROVIDERS = [
  { name: "Contabo", role: "Server hosting for the website, the database, and document storage" },
  { name: "Twenty", role: "Customer relationship management" },
  { name: "Anthropic", role: "Automated document reading, call summaries, email sorting, and drafting tools used by our advisors" },
  { name: "Zoho", role: "Electronic signatures" },
  { name: "Telnyx", role: "Text messages and calls" },
  { name: "Cloudflare", role: "Bot protection, business email hosting, and transactional email delivery" },
  { name: "Sentry", role: "Error monitoring, with personal details removed" },
] as const;

export type ServiceProvider = { name: string; role: string };

/** True when SUPABASE_URL points at Supabase's hosted platform rather than our own server. */
function hostedSupabase(url: string | undefined): boolean {
  try {
    const host = new URL(url?.trim() ?? "").hostname.toLowerCase();
    return host.endsWith(".supabase.co") || host.endsWith(".supabase.com");
  } catch {
    return false;
  }
}

/**
 * Service providers that process personal information for us on this
 * deployment: the core list, plus the providers whose integration an
 * environment variable switches on, so the privacy policy and the access
 * request export name exactly who receives data here.
 * - Contabo hosts the production server, which runs the site and a
 *   self-hosted Supabase (open-source software, so Supabase the company
 *   receives nothing). Business email runs on Mailflare on Cloudflare, and
 *   transactional email goes out through Cloudflare Email Service.
 * - Vercel: only on a deployment Vercel hosts (VERCEL is set there).
 * - Supabase: only when SUPABASE_URL is on Supabase's hosted platform.
 * - Resend: only with RESEND_API_KEY (the newsletter, prospect outreach, and
 *   transactional email when Cloudflare is not configured).
 * - NVIDIA: document text and table extraction (NVIDIA_NEMO_RETRIEVER_URL,
 *   lib/agents/documents/nemo.ts) and NVIDIA-hosted models and embeddings
 *   (NVIDIA_API_KEY, lib/ai/gateway.ts and lib/ai/embeddings.ts).
 * - Voyage: search embeddings for the advisors' reference library
 *   (VOYAGE_API_KEY, lib/ai/embeddings.ts).
 * xAI is not listed: lib/ai/routing.ts lets it see public market data only.
 * The remote scoring endpoint (JEV_API_URL) is not listed either; if it is
 * hosted by a third party, add that provider here. Counsel to confirm.
 */
export function serviceProviders(env: Env = process.env): ServiceProvider[] {
  const embeddingsOff = ["off", "none"].includes(env.EMBEDDINGS_PROVIDER?.trim().toLowerCase() ?? "");
  const nvidia = isSet(env.NVIDIA_NEMO_RETRIEVER_URL) || isSet(env.NVIDIA_API_KEY);
  const voyage = isSet(env.VOYAGE_API_KEY) && !embeddingsOff;
  return [
    ...CORE_SERVICE_PROVIDERS,
    ...(isSet(env.VERCEL) ? [{ name: "Vercel", role: "Website hosting" }] : []),
    ...(hostedSupabase(env.SUPABASE_URL) ? [{ name: "Supabase", role: "Database and encrypted document storage" }] : []),
    ...(isSet(env.RESEND_API_KEY) ? [{ name: "Resend", role: "Email delivery, including the newsletter" }] : []),
    ...(nvidia ? [{ name: "NVIDIA", role: "Reading text and tables from some uploaded documents, and automated tools used by our advisors" }] : []),
    ...(voyage ? [{ name: "Voyage (MongoDB)", role: "Search indexing for the reference library our advisors use" }] : []),
  ];
}

/** Service providers for this deployment's environment. */
export const SERVICE_PROVIDERS: readonly ServiceProvider[] = serviceProviders();
