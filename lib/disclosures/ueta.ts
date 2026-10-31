// Consent to sign electronically (Cal. Civ. Code §1633.5, UETA; 15 U.S.C. §7001
// for any consumer record). Shown to each borrower before the MLDS is sent;
// the version id is stored with the consent so the exact text is provable.
// DRAFT — pending counsel review.

export const UETA_CONSENT_VERSION = "ueta-2026-11-01-draft";

export const UETA_CONSENT_TEXT = [
  "You agree to receive and sign the Mortgage Loan Disclosure Statement and related loan disclosures electronically.",
  "You can ask for a paper copy at no charge, and you can withdraw this consent at any time before signing, by emailing compliance@kuberacommercial.com.",
  "To view and keep these documents you need a device with a current web browser, a PDF viewer and an email account. You will receive an exact copy of each signed document by email and can download it again from your portal.",
  "Your electronic signature has the same legal effect as a handwritten signature.",
].join(" ");

export const UETA_CONSENT_TEXTS: Readonly<Record<string, string>> = { [UETA_CONSENT_VERSION]: UETA_CONSENT_TEXT };
