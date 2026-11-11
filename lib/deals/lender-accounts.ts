// Account numbers a lender assigned to Corin (a broker ID, Corin's account
// number at the lender, a portal username). Restricted data (Global rule 8):
// sealed with AES-256-GCM (lib/privacy/crypto.ts) bound to
// "lender_accounts:<id>.number" before any write, shown masked, and opened
// only by the audited reveal (lib/deals/lender-directory.ts). No blind index:
// nobody looks a lender up by account number.
//
// Corin is a broker and never holds or moves money (Global rule 1): passwords,
// PINs, wire instructions and bank account or routing numbers are refused.

import { z } from "zod";
import { detectSensitiveValues } from "@/lib/privacy/classification";
import { decryptField, encryptField, isEncrypted, type PiiKeyring } from "@/lib/privacy/crypto";
import { assertNoRestrictedText, hasRestrictedText, optLine, optText } from "./lender-contacts";
import { GuardError } from "./store";
import { lenderAccountKinds, type LenderAccountKind } from "./types";

export const LENDER_ACCOUNT_KIND_LABELS: Record<LenderAccountKind, string> = {
  broker_id: "Broker ID (assigned by lender)",
  client_account: "Account number at lender",
  portal_username: "Portal username",
  other: "Other",
};

/** The label a standard kind gets when staff leave it blank. */
export const LENDER_ACCOUNT_DEFAULT_LABELS: Record<Exclude<LenderAccountKind, "other">, string> = {
  broker_id: "Broker ID",
  client_account: "Account number",
  portal_username: "Portal username",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

/** AAD context for a lender account number; binds the envelope to its row. */
export function lenderAccountContext(id: string): string {
  if (!isUuid(id)) throw new GuardError("Lender account ids are UUIDs");
  return `lender_accounts:${id}.number`;
}

const BANNED_LABEL = /pass(word|code|phrase)?|\bpwd?\b|\bpin\b|\botp\b|\b[m2]fa\b|secret|routing|\baba\b|swift|iban|wire|bank account|\bssn\b|social security|credit card|debit card|card number|\bcvv\b|\bcvc\b/i;
export const BANNED_LABEL_MESSAGE = "Corin does not store passwords, PINs, card or Social Security numbers, or bank and wire details.";
// The label is stored in clear, copied into audit_log and shown to every staff
// role, so it must never hold the number itself: no restricted value (an
// account, card, routing or Social Security number, a password) and no six
// digits in a row, even split by single spaces, dots, hyphens, slashes or
// underscores ("0001 2345 6789", "021-000-021"). lender_accounts.label has the same CHECK.
export const LABEL_DIGITS_RE = /[0-9](?:[\s._/-]?[0-9]){5}/;
export const LABEL_NUMBER_MESSAGE = "Put the number itself in Account number: a label cannot hold an account, card or Social Security number or a password.";
const NUMBER_SHAPE = /^[A-Za-z0-9][A-Za-z0-9 ._@+\-/#]*$/;
export const NUMBER_SHAPE_MESSAGE = "Use 1 to 64 letters, digits, spaces and . _ @ + - / #";
export const CARD_OR_SSN_MESSAGE = "This looks like a card number or SSN; Corin does not store those";

/** Trimmed, whitespace runs collapsed to one space. */
export function normalizeAccountNumber(raw: string): string {
  return raw.normalize("NFC").trim().replace(/\s+/g, " ");
}

/** Validation message for an account number of `kind`, or null when it can be stored. Never includes the value. */
export function accountNumberProblem(kind: LenderAccountKind, number: string): string | null {
  if (number.length < 1 || number.length > 64 || !NUMBER_SHAPE.test(number)) return NUMBER_SHAPE_MESSAGE;
  const found = detectSensitiveValues(number);
  if (found.some((f) => f.detector === "ssn")) return CARD_OR_SSN_MESSAGE;
  // Long account numbers at a lender can pass Luhn by chance, so only client_account skips the card check.
  if (kind !== "client_account" && found.some((f) => f.detector === "card_number")) return CARD_OR_SSN_MESSAGE;
  return null;
}

const accountNumber = z.preprocess(
  (v) => (typeof v === "string" ? (normalizeAccountNumber(v) === "" ? null : normalizeAccountNumber(v)) : (v ?? null)),
  z.string().nullable(),
);

/**
 * kind, label, number, notes. `requireNumber: false` (an edit) lets a blank
 * number through as null: keep the stored one.
 */
export function lenderAccountInputSchema(opts: { requireNumber?: boolean } = {}) {
  const requireNumber = opts.requireNumber ?? true;
  return z
    .object({
      kind: z.enum(lenderAccountKinds),
      label: optLine(80),
      number: accountNumber,
      notes: optText(500),
    })
    .superRefine((v, ctx) => {
      if (!v.label && v.kind === "other") ctx.addIssue({ code: "custom", path: ["label"], message: "Give an Other account number a label" });
      if (v.label && (LABEL_DIGITS_RE.test(v.label) || hasRestrictedText(v.label))) ctx.addIssue({ code: "custom", path: ["label"], message: LABEL_NUMBER_MESSAGE });
      else if (v.label && BANNED_LABEL.test(v.label)) ctx.addIssue({ code: "custom", path: ["label"], message: BANNED_LABEL_MESSAGE });
      if (v.number === null) {
        if (requireNumber) ctx.addIssue({ code: "custom", path: ["number"], message: "Enter the account number" });
      } else {
        const problem = accountNumberProblem(v.kind, v.number);
        if (problem) ctx.addIssue({ code: "custom", path: ["number"], message: problem });
      }
      assertNoRestrictedText("Notes", v.notes);
    })
    .transform((v) => ({ ...v, label: v.label ?? (v.kind === "other" ? "" : LENDER_ACCOUNT_DEFAULT_LABELS[v.kind]) }));
}

export type LenderAccountInput = { kind: LenderAccountKind; label: string; number: string | null; notes: string | null };

export function parseLenderAccount(input: unknown, opts: { requireNumber?: boolean } = {}): LenderAccountInput {
  return lenderAccountInputSchema(opts).parse(input) as LenderAccountInput;
}

// --- Masking --------------------------------------------------------------------------------------

/** Last 4 letters or digits of a long value, last 2 of a 6-9 character one, nothing for shorter ones. */
export function maskHint(value: string): string | null {
  const alnum = value.replace(/[^A-Za-z0-9]/g, "");
  if (alnum.length >= 10) return alnum.slice(-4);
  if (alnum.length >= 6) return alnum.slice(-2);
  return null;
}

export function maskedNumber(hint: string | null): string {
  return hint ? `•••• ${hint}` : "••••";
}

// --- Sealing ----------------------------------------------------------------------------------------

/** Seals a validated number under its row id. Throws PiiKeyError without a key (nothing is stored). */
export function sealLenderAccountNumber(id: string, number: string, keyring: PiiKeyring | null | undefined): { numberEnc: string; numberLast4: string | null } {
  const numberEnc = encryptField(number, { context: lenderAccountContext(id), keyring });
  if (!isEncrypted(numberEnc)) throw new Error("Refusing to store a lender account number that is not encrypted");
  return { numberEnc, numberLast4: maskHint(number) };
}

/** Opens a sealed number (reveal path only). Throws PiiDecryptError / PiiKeyError. */
export function openLenderAccountNumber(row: { id: string; numberEnc: string }, keyring: PiiKeyring | null | undefined): string {
  return decryptField(row.numberEnc, { context: lenderAccountContext(row.id), keyring });
}

/** Both stores call this before any write that carries numberEnc. */
export function assertSealedAccount(row: { numberEnc?: unknown }): void {
  if (!isEncrypted(row.numberEnc)) throw new GuardError("Refusing to store a lender account number that is not encrypted");
}
