// Cookieless, PII-free product analytics: the typed event catalog and the
// sanitizer every event passes through. Properties are coarse categorical
// values (a step number, an asset class, an HTTP status); names, emails,
// phone numbers, dollar amounts and free text never go in.

export type AnalyticsValue = string | number | boolean | null;
export type AnalyticsProps = Record<string, AnalyticsValue>;

/** Every event the site may send, with the properties each one carries. */
export type AnalyticsEvents = {
  qualifier_step_viewed: { step: number; asset?: string };
  qualifier_submitted: { asset: string; transaction: string; qualified: boolean; consent: boolean };
  qualifier_failed: { reason: string; status?: number };
  qualifier_validation_blocked: { step: number; fields: number };
  partner_tab_selected: { type: string };
  partner_submitted: { type: string; consent: boolean };
  partner_failed: { type: string; reason: string; status?: number };
  partner_validation_blocked: { type: string; fields: number };
  sizer_see_all_clicked: { tab?: string };
  sizer_quote_swiped: { index: number; count: number };
  /** A homepage call to action: which one, and the section it sits in. */
  home_cta_clicked: {
    cta: "get_options" | "size_loan" | "book_call" | "email_advisor" | "family_hub" | "family_options";
    section: "hero" | "programs" | "process" | "sizer" | "why" | "faq" | "final";
  };
};

export type AnalyticsEventName = keyof AnalyticsEvents;

export const EVENT_NAMES = [
  "qualifier_step_viewed",
  "qualifier_submitted",
  "qualifier_failed",
  "qualifier_validation_blocked",
  "partner_tab_selected",
  "partner_submitted",
  "partner_failed",
  "partner_validation_blocked",
  "sizer_see_all_clicked",
  "sizer_quote_swiped",
  "home_cta_clicked",
] as const satisfies readonly AnalyticsEventName[];

const MAX_STRING = 60;

// Property names that suggest personal or deal-identifying data. A property
// with one of these names is stripped before an event leaves the browser.
const FORBIDDEN_KEY = /(e-?mail|phone|name|address|ssn|dob|birth|account|token|note|message|amount|loan|noi|value|price)/i;

/**
 * Keeps primitive values only, truncates strings, and removes any key that
 * looks like personal or deal data. Returns a fresh object.
 */
export function sanitizeProps(props: Record<string, unknown> | undefined): AnalyticsProps {
  const out: AnalyticsProps = {};
  if (!props) return out;
  for (const [key, value] of Object.entries(props)) {
    if (FORBIDDEN_KEY.test(key)) continue;
    if (value === undefined) continue;
    if (typeof value === "string") out[key] = value.slice(0, MAX_STRING);
    else if (typeof value === "number") {
      if (Number.isFinite(value)) out[key] = value;
    } else if (typeof value === "boolean" || value === null) out[key] = value;
  }
  return out;
}

/**
 * Page URLs can carry deal data (the sizer links to /express?loan=...&noi=...),
 * so analytics only ever sees the origin and path.
 */
export function scrubUrl(url: string): string {
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(url);
  try {
    const u = new URL(url, "https://placeholder.invalid");
    return absolute ? `${u.origin}${u.pathname}` : u.pathname;
  } catch {
    return url.split(/[?#]/)[0] ?? url;
  }
}
