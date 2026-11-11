// Lender contact info (lender_panel columns), contact persons (lender_contacts)
// and the submission recipient derived from them. Pure (no server-only), so
// the stores, the service, the actions and the tests share one validation.
//
// Every regex below mirrors a CHECK in
// supabase/migrations/20261105120000_int_lender_contacts.sql, so anything zod
// accepts also passes the database (lib/deals/lender-contacts.test.ts proves
// it on fixed samples). Validation messages are fixed strings: they travel in
// redirect URLs and logs, so they never echo what was typed.
//
// Corin is a broker and never moves money (Global rule 1). Free-text fields
// refuse account numbers, card and routing numbers and anything that reads
// like a password; lender account numbers go to lender_accounts (sealed), and
// passwords stay in the password manager.

import { z } from "zod";
import { toE164 } from "@/lib/notify/phone";
import { detectSensitiveValues } from "@/lib/privacy/classification";
import {
  lenderContactChannels,
  lenderContactRoles,
  lenderContactSources,
  type LenderContact,
  type LenderContactInfo,
  type LenderContactRole,
  type LenderContactSource,
  type LenderDerivedContacts,
  type NewLenderContact,
} from "./types";

export class LenderDirectoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LenderDirectoryError";
  }
}

export const EMPTY_LENDER_CONTACT_INFO: LenderContactInfo = {
  mainPhone: null,
  mainPhoneExt: null,
  generalEmail: null,
  submissionEmail: null,
  websiteUrl: null,
  portalUrl: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  addressState: null,
  postalCode: null,
  country: "US",
  nmlsId: null,
  submissionInstructions: null,
  credentialsLocation: null,
  contactVerifiedAt: null,
  contactVerifiedBy: null,
};

export const LENDER_CONTACT_ROLE_LABELS: Record<LenderContactRole, string> = {
  account_executive: "Account executive",
  regional_manager: "Regional manager",
  scenario_desk: "Scenario desk",
  underwriter: "Underwriter",
  processor: "Processor",
  closer: "Closer",
  servicing: "Servicing / loan administration",
  compliance_legal: "Compliance / legal",
  lender_counsel: "Lender counsel",
  sba_bdo: "SBA business development officer",
  other: "Other",
};

export const LENDER_CONTACT_SOURCE_LABELS: Record<LenderContactSource, string> = {
  staff: "Staff entry",
  directory_import: "Directory import (unverified)",
  business_card: "Business card",
  email_signature: "Email signature",
  lender_website: "Lender website",
  referral: "Referral",
};

export const LENDER_CONTACT_CHANNEL_LABELS: Record<(typeof lenderContactChannels)[number], string> = {
  email: "Email",
  phone: "Direct phone",
  mobile: "Mobile",
};

// --- Regexes identical to the SQL checks -----------------------------------------------------------
// Postgres [:space:] and [:cntrl:] are written \s and \p{Cc}; the JS classes are at least as strict.

export const EMAIL_DB_RE = /^[^@\s\p{Cc}<>",;]{1,64}@[^@\s\p{Cc}<>",;]+\.[^@\s\p{Cc}<>",;]+$/u;
export const E164_RE = /^\+[1-9]\d{7,14}$/;
export const EXT_RE = /^\d{1,6}$/;
export const HTTPS_DB_RE = /^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?(\/[^\s\p{Cc}<>"]*)?$/u;
export const PORTAL_DB_RE = /^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?(\/[^\s\p{Cc}<>"?#]*)?$/u;
export const STATE_RE = /^[A-Z]{2}$/;
export const US_ZIP_RE = /^\d{5}(-\d{4})?$/;
export const POSTAL_RE = /^[A-Za-z0-9][A-Za-z0-9 -]{1,9}$/;
export const NMLS_RE = /^\d{1,10}$/;

// --- Cleaning --------------------------------------------------------------------------------------

const INVISIBLE = /[​-‏‪-‮⁦-⁩﻿]/g;
const CONTROL_LINE = /[\u0000-\u001F\u007F]/;
const CONTROL_TEXT = /[\u0000-\u0008\u000B-\u001F\u007F]/; // \t and \n allowed
export const CONTROL_MESSAGE = "Remove line breaks and control characters";

/** NFC, zero-width and bidi controls removed, line endings normalized (multiline), trimmed. */
export function cleanText(raw: string, opts: { multiline?: boolean } = {}): string {
  let s = raw.normalize("NFC").replace(INVISIBLE, "");
  if (opts.multiline) s = s.replace(/\r\n?/g, "\n");
  return s.trim();
}

/** Blank (after cleaning) and missing become null. */
const clean = (multiline: boolean) => (v: unknown) => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return v;
  const c = cleanText(v, { multiline });
  return c === "" ? null : c;
};
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v === null ? undefined : v);

const line = (max: number) => z.string().min(1, "Required").max(max).refine((s) => !CONTROL_LINE.test(s), CONTROL_MESSAGE);

/** Optional single-line text, 1..max characters after cleaning. */
export const optLine = (max: number) => z.preprocess(clean(false), line(max).nullable());
/** Required single-line text. */
export const reqLine = (max: number) => z.preprocess(clean(false), z.string({ error: "Required" }).min(1, "Required").max(max).refine((s) => !CONTROL_LINE.test(s), CONTROL_MESSAGE));
/** Optional multiline text (tabs and line breaks allowed). */
export const optText = (max: number) =>
  z.preprocess(
    clean(true),
    z
      .string()
      .min(1)
      .max(max)
      .refine((s) => !CONTROL_TEXT.test(s), "Remove control characters")
      .nullable(),
  );

const EMAIL_MESSAGE = "Enter one email address, like submissions@lender.com";
export const optEmail = z.preprocess(
  (v) => {
    const c = clean(false)(v);
    return typeof c === "string" ? c.toLowerCase() : c;
  },
  z
    .email(EMAIL_MESSAGE)
    .max(254, EMAIL_MESSAGE)
    .refine((s) => s.split("@")[0]!.length <= 64 && EMAIL_DB_RE.test(s), EMAIL_MESSAGE)
    .nullable(),
);

const PHONE_SHAPE = /^[+\d().\-\s]{7,32}$/;
export const PHONE_MESSAGE = "Enter a phone number like (310) 555-0100 or +44 20 7946 0000; put an extension in Ext.";
export const optPhone = z.preprocess(
  clean(false),
  z
    .string()
    .nullable()
    .transform((v, ctx) => {
      if (v === null) return null;
      const e164 = PHONE_SHAPE.test(v) ? toE164(v) : null;
      if (!e164 || !E164_RE.test(e164)) {
        ctx.addIssue({ code: "custom", message: PHONE_MESSAGE });
        return z.NEVER;
      }
      return e164;
    }),
);

export const optExt = z.preprocess(clean(false), z.string().regex(EXT_RE, "Extensions are 1 to 6 digits").nullable());

const URL_MESSAGE = "Enter a full https:// address with no username, password or port";
/** https only, no credentials or port; query and fragment are dropped (no tokenized links). */
export const optHttpsUrl = (opts: { portal?: boolean } = {}) =>
  z.preprocess(
    clean(false),
    z
      .string()
      .max(2048, "Addresses are at most 2048 characters")
      .nullable()
      .transform((v, ctx) => {
        if (v === null) return null;
        let u: URL;
        try {
          u = new URL(v);
        } catch {
          ctx.addIssue({ code: "custom", message: URL_MESSAGE });
          return z.NEVER;
        }
        if (u.protocol !== "https:" || u.username || u.password || u.port !== "" || !/^[a-z0-9.-]+$/.test(u.hostname) || !u.hostname.includes(".")) {
          ctx.addIssue({ code: "custom", message: URL_MESSAGE });
          return z.NEVER;
        }
        u.search = "";
        u.hash = "";
        const href = u.href;
        if (href.length > 2048 || !(opts.portal ? PORTAL_DB_RE : HTTPS_DB_RE).test(href)) {
          ctx.addIssue({ code: "custom", message: URL_MESSAGE });
          return z.NEVER;
        }
        return href;
      }),
  );

const upper = (v: unknown) => {
  const c = clean(false)(v);
  return typeof c === "string" ? c.toUpperCase() : c;
};
export const optState = z.preprocess(upper, z.string().regex(STATE_RE, "Use the two-letter state code").nullable());
export const optPostal = z.preprocess(upper, z.string().regex(POSTAL_RE, "Enter a postal code").nullable());
export const country = z.preprocess((v) => upper(v) ?? undefined, z.string().regex(STATE_RE, "Use the two-letter country code, like US").default("US"));
export const nmlsId = z.preprocess(clean(false), z.string().regex(NMLS_RE, "NMLS IDs are up to 10 digits").nullable());

// --- Restricted text ---------------------------------------------------------------------------------

// A secret word, then the secret: "password: x" or "pin=x" always; "password is x"
// and "password - x" unless the next word says where it is kept ("password is in
// 1Password", "password - see the vault"). A hyphenated word ("password-protected
// PDFs") and the 1Password name ("1Password > Lenders") are not secret labels.
const SECRET_WORD = String.raw`(?:pass(?:word|code|wd|phrase)?|pwd|pw|pin|otp|mfa code|2fa code|one[- ]time code)`;
const KEPT_WORD = String.raw`(?:in|is|kept|stored|saved|held|located|at|on|under|with|the|a|an|our|managed|shared|see|ask|via|from|reset|resets|expires|expired|required|needed|sent|changes?|changed|rotat[a-z]*|manager|vault|policy|protected)\b`;
const SECRET_LABEL = new RegExp(String.raw`\b${SECRET_WORD}\b(?:\s*[:=]|\s+(?:-+|–|—|is)\s+(?!${KEPT_WORD})\S)`, "i");
// "Use pwd Summer2026", "PIN 4821", "pass Summer2026!": a secret word, a space, then a
// password-like token (four or more characters with a digit in it; for the looser "pass",
// six or more with a letter and a digit) that is not a word saying where it is kept.
const SECRET_SPACED = new RegExp(
  String.raw`\b(?:password|passcode|passwd|passphrase|pwd|pw|pin|otp)\s+(?!${KEPT_WORD})(?=\S*\d)\S{4,}|\bpass\s+(?=\S*[A-Za-z])(?=\S*\d)\S{6,}`,
  "i",
);
// "Login: corin / Summer2026!": a username and a password-like second token (a digit or a symbol).
// Neither token holds a slash, so a URL after "Sign in:" is not a login.
const LOGIN_PAIR = /\b(?:log[- ]?in|sign[- ]?in|credentials?|creds|user(?:name)?)\b\s*[:=-]?\s*[^\s/]+\s*\/\s*[^\s/]*[^A-Za-z\s/][^\s/]*/i;
// "Routing number is 021000021", "Account number - 000123456789", "IBAN GB82…": a bank or
// account word, then six or more digits. The shared detectors need the digits right after the label.
const BANK_NUMBER = /\b(?:routing|aba|rtn|account|acct|a\/c)\b(?:\s*(?:#|no\.?|num(?:ber)?))?\s*(?:[:=#-]|\bis\b)?\s*\d[\d -]{4,20}\d|\biban\b\s*(?:[:#-]|\bis\b)?\s*[a-z]{2}\d{2}/i;

/** True when text holds an SSN, card, routing or account number, a date of birth, or a password or login. */
export function hasRestrictedText(text: string | null | undefined): boolean {
  if (!text) return false;
  return SECRET_LABEL.test(text) || SECRET_SPACED.test(text) || LOGIN_PAIR.test(text) || BANK_NUMBER.test(text) || detectSensitiveValues(text).some((f) => f.level === "restricted");
}

export const restrictedTextMessage = (fieldLabel: string) =>
  `${fieldLabel}: remove account numbers, passwords and bank details. Put lender account numbers under Account numbers; keep passwords in the password manager.`;

/** Throws LenderDirectoryError (fixed message, never the text) when `text` holds restricted values. */
export function assertNoRestrictedText(fieldLabel: string, text: string | null | undefined): void {
  if (hasRestrictedText(text)) throw new LenderDirectoryError(restrictedTextMessage(fieldLabel));
}

// --- Schemas ----------------------------------------------------------------------------------------------

export const lenderContactInfoSchema = z
  .object({
    mainPhone: optPhone,
    mainPhoneExt: optExt,
    submissionEmail: optEmail,
    generalEmail: optEmail,
    websiteUrl: optHttpsUrl(),
    portalUrl: optHttpsUrl({ portal: true }),
    addressLine1: optLine(200),
    addressLine2: optLine(200),
    city: optLine(100),
    addressState: optState,
    postalCode: optPostal,
    country,
    nmlsId,
    submissionInstructions: optText(4000),
    credentialsLocation: optLine(200),
  })
  .superRefine((v, ctx) => {
    if (v.mainPhoneExt && !v.mainPhone) ctx.addIssue({ code: "custom", path: ["mainPhoneExt"], message: "An extension needs a main phone number" });
    if (v.postalCode && v.country === "US" && !US_ZIP_RE.test(v.postalCode)) ctx.addIssue({ code: "custom", path: ["postalCode"], message: "Use a 5-digit ZIP code (or ZIP+4)" });
    assertNoRestrictedText("Submission instructions", v.submissionInstructions);
    assertNoRestrictedText("Where the portal password is kept", v.credentialsLocation);
  });

export type LenderContactInfoInput = Omit<LenderContactInfo, "contactVerifiedAt" | "contactVerifiedBy">;

export function parseLenderContactInfo(input: unknown): LenderContactInfoInput {
  return lenderContactInfoSchema.parse(input) as LenderContactInfoInput;
}

export const lenderContactInputSchema = z
  .object({
    fullName: reqLine(120),
    title: optLine(120),
    role: z.preprocess(blankToUndefined, z.enum(lenderContactRoles).default("other")),
    email: optEmail,
    phoneDirect: optPhone,
    phoneExt: optExt,
    phoneMobile: optPhone,
    preferredChannel: z.preprocess((v) => blankToUndefined(v) ?? null, z.enum(lenderContactChannels).nullable()),
    territory: optLine(200),
    notes: optText(2000),
    source: z.preprocess(blankToUndefined, z.enum(lenderContactSources).default("staff")).refine((s) => s !== "directory_import", "Directory imports come only from the directory seed"),
  })
  .superRefine((v, ctx) => {
    const has = { email: v.email, phone: v.phoneDirect, mobile: v.phoneMobile } as const;
    if (v.preferredChannel && !has[v.preferredChannel]) ctx.addIssue({ code: "custom", path: ["preferredChannel"], message: "Add the email or number for the preferred channel" });
    if (v.phoneExt && !v.phoneDirect) ctx.addIssue({ code: "custom", path: ["phoneExt"], message: "An extension needs a direct phone number" });
    assertNoRestrictedText("Notes", v.notes);
    assertNoRestrictedText("Territory", v.territory);
  });

export type LenderContactInput = Omit<NewLenderContact, "lenderId">;

export function parseLenderContact(input: unknown): LenderContactInput {
  return lenderContactInputSchema.parse(input) as LenderContactInput;
}

// --- Derived recipient -------------------------------------------------------------------------------

const domainOf = (email: string | null | undefined) => {
  const at = email ? email.lastIndexOf("@") : -1;
  return at > 0 ? email!.slice(at + 1).toLowerCase() : null;
};

/**
 * The submission recipient and matching domains. The primary contact's email
 * wins (greeted by name); without one the submission inbox gets the package
 * ("Hello,"). A contact who left never counts.
 */
export function deriveLenderContacts(
  lender: Pick<LenderContactInfo, "submissionEmail" | "generalEmail">,
  contacts: readonly Pick<LenderContact, "id" | "fullName" | "email" | "isPrimary" | "status">[],
): LenderDerivedContacts {
  const active = contacts.filter((c) => c.status === "active");
  const primary = active.find((c) => c.isPrimary);
  const domains = new Set<string>();
  for (const e of [...active.map((c) => c.email), lender.submissionEmail, lender.generalEmail]) {
    const d = domainOf(e);
    if (d) domains.add(d);
  }
  return {
    primaryContactId: primary?.id ?? null,
    primaryContactName: primary?.fullName ?? null,
    contactName: primary?.email ? primary.fullName : null,
    contactEmail: primary?.email ?? lender.submissionEmail ?? null,
    contactDomains: [...domains].sort(),
  };
}

// --- Display -----------------------------------------------------------------------------------------

/** "+13105550100" -> "(310) 555-0100"; anything else stays E.164. */
export function formatPhone(e164: string): string {
  const m = /^\+1([2-9]\d{2})([2-9]\d{2})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

/** tel: link with an RFC 3966 extension. */
export function telHref(e164: string, ext?: string | null): string {
  return `tel:${e164}${ext ? `;ext=${ext}` : ""}`;
}
