// Consent wording for the newsletter signup. Versioned like the other forms
// (lib/consent/texts.ts): never edit the `text` of a published version, add a
// new one and point CURRENT_NEWSLETTER_CONSENT at it. The ledger stores the id
// and a hash of this exact text; a unit test pins the hash.

import type { ConsentText } from "@/lib/consent/texts";

export const NEWSLETTER_CONSENT_TEXTS = {
  "newsletter-signup-2026-11-05": {
    id: "newsletter-signup-2026-11-05",
    form: "newsletter",
    effective: "2026-11-05",
    channels: ["email"],
    text: "Send me the Kubera Commercial newsletter by email: market notes, program updates and new tools, about once a month. I will confirm my address by clicking a link in a confirmation email before anything is sent, and I can unsubscribe at any time. Subscribing is not a condition of any service.",
  },
} as const satisfies Record<string, ConsentText>;

export type NewsletterConsentId = keyof typeof NEWSLETTER_CONSENT_TEXTS;

export const CURRENT_NEWSLETTER_CONSENT: NewsletterConsentId = "newsletter-signup-2026-11-05";

export function newsletterConsentText(id: string | null | undefined): ConsentText | undefined {
  return id ? (NEWSLETTER_CONSENT_TEXTS as Record<string, ConsentText>)[id] : undefined;
}

/**
 * The version a signup agreed to. A client may name the version it rendered (an
 * open tab on an older version is recorded accurately), but only a known
 * version is accepted; anything else is recorded as the current one.
 */
export function resolveNewsletterConsent(requested?: string | null): ConsentText {
  return newsletterConsentText(requested) ?? NEWSLETTER_CONSENT_TEXTS[CURRENT_NEWSLETTER_CONSENT];
}
