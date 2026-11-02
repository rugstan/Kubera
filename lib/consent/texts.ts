// Versioned consent language. The ledger stores the version id plus a hash of
// the exact text the person agreed to, so a record can always be tied back to
// the words on screen.
//
// Rules: never edit the `text` of a published version. To change the wording,
// add a new version, point CURRENT_CONSENT at it, and render that text in the
// form. A unit test pins each version's hash so a silent edit fails CI.

export const CONSENT_CHANNELS = ["phone", "sms", "email", "autodialer"] as const;
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];

export const CONSENT_FORMS = ["qualifier", "partner", "newsletter"] as const;
export type ConsentForm = (typeof CONSENT_FORMS)[number];

export type ConsentText = {
  id: string;
  form: ConsentForm;
  /** ISO date the version went live. */
  effective: string;
  /** Channels this wording covers. The server records these, never client-supplied channels. */
  channels: readonly ConsentChannel[];
  text: string;
};

export const CONSENT_TEXTS = {
  "qualifier-contact-2026-10-31": {
    id: "qualifier-contact-2026-10-31",
    form: "qualifier",
    effective: "2026-10-31",
    channels: ["phone", "sms", "email", "autodialer"],
    text: "I agree that Corin Commercial may contact me about this financing request by phone, text, or email, including by automated means. Consent is not a condition of any service. Message and data rates may apply; reply STOP to opt out.",
  },
  "qualifier-contact-2026-11-01": {
    id: "qualifier-contact-2026-11-01",
    form: "qualifier",
    effective: "2026-11-01",
    channels: ["phone", "sms", "email", "autodialer"],
    text: "I agree that Corin Commercial may contact me about this financing request by phone, text, or email, including by automated means. Consent is not a condition of any service. Message and data rates may apply; reply STOP to opt out or HELP for help.",
  },
  "partner-contact-2026-10-31": {
    id: "partner-contact-2026-10-31",
    form: "partner",
    effective: "2026-10-31",
    channels: ["phone", "sms", "email"],
    text: "I agree that Corin Commercial may contact me about this registration by phone, text, or email.",
  },
  "partner-contact-2026-11-01": {
    id: "partner-contact-2026-11-01",
    form: "partner",
    effective: "2026-11-01",
    channels: ["phone", "sms", "email"],
    text: "I agree that Corin Commercial may contact me about this registration by phone, text, or email. Consent is not a condition of any service. Message and data rates may apply; reply STOP to opt out or HELP for help.",
  },
} as const satisfies Record<string, ConsentText>;

export type ConsentTextId = keyof typeof CONSENT_TEXTS;

/** The version each form must render today. */
export const CURRENT_CONSENT = {
  qualifier: "qualifier-contact-2026-11-01",
  partner: "partner-contact-2026-11-01",
} as const satisfies Partial<Record<ConsentForm, ConsentTextId>>;

export function consentText(id: string): ConsentText | undefined {
  return (CONSENT_TEXTS as Record<string, ConsentText>)[id];
}

/**
 * Resolves the version a submission agreed to. A client may name the version
 * it rendered (so an open tab on an older version is recorded accurately), but
 * only a known version for the same form is accepted; otherwise the current
 * version for the form is used.
 */
export function resolveConsentText(form: keyof typeof CURRENT_CONSENT, requested?: string | null): ConsentText {
  const candidate = requested ? consentText(requested) : undefined;
  if (candidate && candidate.form === form) return candidate;
  return CONSENT_TEXTS[CURRENT_CONSENT[form]];
}
