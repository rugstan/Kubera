// Field encryption for principals (Global rule 8). Restricted values are
// sealed with AES-256-GCM (lib/privacy/crypto.ts) bound to
// "principals:<id>.<column>", so a ciphertext copied to another row or column
// fails to open. The tax id also gets a keyed blind index so staff can spot
// the same person on two deals without decrypting anything.
//
// Without PII_ENCRYPTION_KEY, sealing throws: restricted data is refused, never
// stored in plaintext.

import { blindIndex, decryptField, decryptJson, encryptField, encryptJson, isEncrypted, type PiiKeyring } from "@/lib/privacy/crypto";
import { form1919Schema, pfsSchema, taxIdKind, type Form1919Answers, type Pfs, type PrincipalRow, type PrincipalSecrets } from "./types";

export const RESTRICTED_PRINCIPAL_COLUMNS = ["ssn", "dob", "pfs", "form_1919"] as const;
export type RestrictedPrincipalColumn = (typeof RESTRICTED_PRINCIPAL_COLUMNS)[number];

export const principalContext = (principalId: string, column: RestrictedPrincipalColumn) => `principals:${principalId}.${column}`;

export type SealedPrincipalFields = Partial<Pick<PrincipalRow, "ssnEnc" | "dobEnc" | "pfsEnc" | "form1919Enc" | "taxIdIndex" | "pfsAsOf" | "hasSsn" | "hasDob" | "hasPfs" | "hasForm1919">>;

export class InvalidSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSecretError";
  }
}

function validDob(dob: string, now: Date): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return false;
  const t = Date.parse(`${dob}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== dob) return false;
  const age = (now.getTime() - t) / (365.25 * 86_400_000);
  return age >= 18 && age <= 120;
}

/**
 * Seals the provided secrets. `undefined` leaves a field unchanged; `null`
 * clears it. Values are validated first so garbage is never encrypted.
 */
export function sealPrincipalSecrets(principalId: string, secrets: PrincipalSecrets, opts: { keyring?: PiiKeyring | null; now?: Date } = {}): SealedPrincipalFields {
  const out: SealedPrincipalFields = {};
  const k = { keyring: opts.keyring };
  if (secrets.ssn !== undefined) {
    if (secrets.ssn === null) Object.assign(out, { ssnEnc: null, taxIdIndex: null, hasSsn: false });
    else {
      const digits = secrets.ssn.replace(/[\s-]/g, "");
      if (!taxIdKind(digits)) throw new InvalidSecretError("Enter a valid 9-digit SSN or ITIN.");
      out.ssnEnc = encryptField(digits, { context: principalContext(principalId, "ssn"), ...k });
      // Index context is per column, not per row, so equal tax ids match across principals.
      out.taxIdIndex = blindIndex(digits, { context: "principals.ssn", digitsOnly: true, ...k });
      out.hasSsn = true;
    }
  }
  if (secrets.dob !== undefined) {
    if (secrets.dob === null) Object.assign(out, { dobEnc: null, hasDob: false });
    else {
      if (!validDob(secrets.dob, opts.now ?? new Date())) throw new InvalidSecretError("Enter a valid date of birth (age 18 or older).");
      out.dobEnc = encryptField(secrets.dob, { context: principalContext(principalId, "dob"), ...k });
      out.hasDob = true;
    }
  }
  if (secrets.pfs !== undefined) {
    if (secrets.pfs === null) Object.assign(out, { pfsEnc: null, pfsAsOf: null, hasPfs: false });
    else {
      const pfs = pfsSchema.parse(secrets.pfs);
      out.pfsEnc = encryptJson(pfs, { context: principalContext(principalId, "pfs"), ...k });
      out.pfsAsOf = pfs.asOf;
      out.hasPfs = true;
    }
  }
  if (secrets.form1919 !== undefined) {
    if (secrets.form1919 === null) Object.assign(out, { form1919Enc: null, hasForm1919: false });
    else {
      const f = form1919Schema.parse(secrets.form1919);
      out.form1919Enc = encryptJson(f, { context: principalContext(principalId, "form_1919"), ...k });
      out.hasForm1919 = true;
    }
  }
  for (const v of [out.ssnEnc, out.dobEnc, out.pfsEnc, out.form1919Enc]) {
    if (v !== undefined && v !== null && !isEncrypted(v)) throw new Error("Refusing to store a restricted principal field that is not encrypted");
  }
  return out;
}

export type OpenedSecrets = { ssn: string | null; dob: string | null; pfs: Pfs | null; form1919: Form1919Answers | null };

/** Decrypts the requested restricted fields of a row (all by default). */
export function openPrincipalSecrets(row: Pick<PrincipalRow, "id" | "ssnEnc" | "dobEnc" | "pfsEnc" | "form1919Enc">, opts: { keyring?: PiiKeyring | null; fields?: readonly RestrictedPrincipalColumn[] } = {}): OpenedSecrets {
  const want = new Set(opts.fields ?? RESTRICTED_PRINCIPAL_COLUMNS);
  const k = { keyring: opts.keyring };
  return {
    ssn: want.has("ssn") && row.ssnEnc ? decryptField(row.ssnEnc, { context: principalContext(row.id, "ssn"), ...k }) : null,
    dob: want.has("dob") && row.dobEnc ? decryptField(row.dobEnc, { context: principalContext(row.id, "dob"), ...k }) : null,
    pfs: want.has("pfs") && row.pfsEnc ? decryptJson<Pfs>(row.pfsEnc, { context: principalContext(row.id, "pfs"), ...k }) : null,
    form1919: want.has("form_1919") && row.form1919Enc ? decryptJson<Form1919Answers>(row.form1919Enc, { context: principalContext(row.id, "form_1919"), ...k }) : null,
  };
}

/** Blind index for looking up a tax id typed by staff. */
export function taxIdLookupIndex(taxId: string, keyring?: PiiKeyring | null): string {
  return blindIndex(taxId.replace(/[\s-]/g, ""), { context: "principals.ssn", digitsOnly: true, keyring });
}

/** Last four digits for display ("•••-••-1234"), derived on demand and never stored. */
export function maskTaxId(ssn: string): string {
  return `•••-••-${ssn.slice(-4)}`;
}
