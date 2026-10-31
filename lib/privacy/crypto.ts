// Application-layer field encryption for restricted personal information
// (SSN/ITIN, date of birth, account numbers, personal financial statements).
//
// AES-256-GCM with a fresh 96-bit IV per value and a 128-bit tag. The master
// key comes from PII_ENCRYPTION_KEY (32 bytes, base64 or hex); the AES key and
// the blind-index key are derived from it with HKDF-SHA256 so the two uses
// never share key material.
//
// Key versioning: every ciphertext names the key version that sealed it.
//   PII_ENCRYPTION_KEY           current master key
//   PII_ENCRYPTION_KEY_VERSION   its version number (positive integer, default 1)
//   PII_ENCRYPTION_PREVIOUS_KEYS older keys still needed to decrypt, "1:<key>,2:<key>"
// Rotation: add the old key to PREVIOUS_KEYS, set the new key and bump the
// version, then re-seal rows with `rotateField` (needsRotation tells you which).
//
// Envelope:  pii1.<keyVersion>.<iv>.<ciphertext>.<tag>   (base64url parts)
// The additional authenticated data binds each ciphertext to a context string
// such as "principals.ssn:<row id>", so a ciphertext copied into another
// column or row fails to decrypt instead of silently moving data.
//
// There is no plaintext fallback: without a key, encrypting throws, and the
// caller must refuse to store the field.

import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

const FORMAT = "pii1";
const INDEX_FORMAT = "bi1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const HKDF_SALT = Buffer.from("kubera-commercial/pii", "utf8");

export class PiiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PiiKeyError";
  }
}

export class PiiDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PiiDecryptError";
  }
}

type KeyMaterial = { version: number; encKey: Buffer; indexKey: Buffer };

export type PiiKeyring = {
  current: KeyMaterial;
  byVersion: ReadonlyMap<number, KeyMaterial>;
};

/** Parses a 32-byte key given as base64, base64url or 64 hex characters. */
export function parseKey(raw: string): Buffer {
  const value = raw.trim();
  let key: Buffer | undefined;
  if (/^[0-9a-f]{64}$/i.test(value)) key = Buffer.from(value, "hex");
  else if (/^[A-Za-z0-9+/_-]{43}=?$/.test(value)) key = Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (!key || key.length !== KEY_BYTES) throw new PiiKeyError("PII encryption keys must be 32 bytes (base64 or 64 hex characters). Generate one with: openssl rand -base64 32");
  return key;
}

function derive(master: Buffer, version: number): KeyMaterial {
  const encKey = Buffer.from(hkdfSync("sha256", master, HKDF_SALT, Buffer.from(`aes-256-gcm/v${version}`), KEY_BYTES));
  const indexKey = Buffer.from(hkdfSync("sha256", master, HKDF_SALT, Buffer.from(`blind-index/v${version}`), KEY_BYTES));
  return { version, encKey, indexKey };
}

function parseVersion(raw: string | undefined, label: string): number {
  const v = Number(raw);
  if (!Number.isInteger(v) || v < 1 || v > 65_535) throw new PiiKeyError(`${label} must be a positive integer`);
  return v;
}

/** Builds a keyring from explicit keys (tests, scripts). */
export function createKeyring(current: { version: number; key: string | Buffer }, previous: { version: number; key: string | Buffer }[] = []): PiiKeyring {
  const toBuf = (k: string | Buffer) => (typeof k === "string" ? parseKey(k) : k);
  const currentKey = toBuf(current.key);
  if (currentKey.length !== KEY_BYTES) throw new PiiKeyError("PII encryption keys must be 32 bytes");
  const byVersion = new Map<number, KeyMaterial>();
  for (const p of previous) {
    const buf = toBuf(p.key);
    if (buf.length !== KEY_BYTES) throw new PiiKeyError("PII encryption keys must be 32 bytes");
    byVersion.set(parseVersion(String(p.version), "Previous key version"), derive(buf, p.version));
  }
  const cur = derive(currentKey, parseVersion(String(current.version), "PII_ENCRYPTION_KEY_VERSION"));
  if (byVersion.has(cur.version)) throw new PiiKeyError(`Key version ${cur.version} is listed as both current and previous`);
  byVersion.set(cur.version, cur);
  return { current: cur, byVersion };
}

/** Reads the keyring from the environment. Returns null when no key is configured. */
export function keyringFromEnv(env: Record<string, string | undefined> = process.env): PiiKeyring | null {
  const key = env.PII_ENCRYPTION_KEY?.trim();
  if (!key) return null;
  const version = env.PII_ENCRYPTION_KEY_VERSION?.trim() ? parseVersion(env.PII_ENCRYPTION_KEY_VERSION, "PII_ENCRYPTION_KEY_VERSION") : 1;
  const previous = (env.PII_ENCRYPTION_PREVIOUS_KEYS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const sep = entry.indexOf(":");
      if (sep <= 0) throw new PiiKeyError('PII_ENCRYPTION_PREVIOUS_KEYS entries must look like "<version>:<key>"');
      return { version: parseVersion(entry.slice(0, sep), "Previous key version"), key: entry.slice(sep + 1) };
    });
  return createKeyring({ version, key }, previous);
}

let cached: PiiKeyring | null | undefined;
let warned = false;

/** Lazily loaded keyring (null when PII_ENCRYPTION_KEY is unset). */
export function piiKeyring(): PiiKeyring | null {
  if (cached === undefined) {
    cached = keyringFromEnv();
    if (!cached && !warned) {
      warned = true;
      console.warn("[privacy] PII_ENCRYPTION_KEY is not set; restricted fields cannot be stored.");
    }
  }
  return cached;
}

/** Test hook: inject a keyring (undefined re-reads the environment). */
export function setPiiKeyring(keyring: PiiKeyring | null | undefined): void {
  cached = keyring;
}

export function piiEncryptionConfigured(): boolean {
  return piiKeyring() !== null;
}

function requireKeyring(keyring: PiiKeyring | null | undefined): PiiKeyring {
  const k = keyring ?? piiKeyring();
  if (!k) throw new PiiKeyError("PII_ENCRYPTION_KEY is not configured; refusing to store restricted data unencrypted");
  return k;
}

function checkContext(context: string): string {
  if (typeof context !== "string" || !context.trim() || context.length > 256) throw new PiiKeyError("Encryption context must be a non-empty string (e.g. 'principals.ssn:<id>')");
  return context;
}

function aad(version: number, context: string): Buffer {
  return Buffer.from(`${FORMAT}|k${version}|${context}`, "utf8");
}

export type CryptoOptions = { context: string; keyring?: PiiKeyring | null };

/** Encrypts one string value. */
export function encryptField(plaintext: string, opts: CryptoOptions): string {
  if (typeof plaintext !== "string") throw new TypeError("encryptField expects a string");
  const keyring = requireKeyring(opts.keyring);
  const context = checkContext(opts.context);
  const { version, encKey } = keyring.current;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encKey, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(version, context));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [FORMAT, String(version), iv.toString("base64url"), ct.toString("base64url"), tag.toString("base64url")].join(".");
}

type ParsedEnvelope = { version: number; iv: Buffer; ct: Buffer; tag: Buffer };

const ENVELOPE = /^pii1\.(\d{1,5})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]*)\.([A-Za-z0-9_-]{22})$/;

/** True when the value looks like a field this module sealed. */
export function isEncrypted(value: unknown): value is string {
  return typeof value === "string" && ENVELOPE.test(value);
}

function parseEnvelope(envelope: string): ParsedEnvelope {
  const m = ENVELOPE.exec(envelope);
  if (!m) throw new PiiDecryptError("Not an encrypted PII value");
  return { version: Number(m[1]), iv: Buffer.from(m[2]!, "base64url"), ct: Buffer.from(m[3]!, "base64url"), tag: Buffer.from(m[4]!, "base64url") };
}

/** Key version an envelope was sealed with. */
export function envelopeKeyVersion(envelope: string): number {
  return parseEnvelope(envelope).version;
}

/** Decrypts a value from `encryptField`. Throws PiiDecryptError on tampering, wrong context or unknown key. */
export function decryptField(envelope: string, opts: CryptoOptions): string {
  const keyring = requireKeyring(opts.keyring);
  const context = checkContext(opts.context);
  const { version, iv, ct, tag } = parseEnvelope(envelope);
  const key = keyring.byVersion.get(version);
  if (!key) throw new PiiDecryptError(`No PII key for version ${version}; add it to PII_ENCRYPTION_PREVIOUS_KEYS`);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key.encKey, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad(version, context));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    throw new PiiDecryptError("PII value failed authentication (tampered, wrong context, or wrong key)");
  }
}

/** True when the envelope was sealed with an older key and should be re-encrypted. */
export function needsRotation(envelope: string, keyring?: PiiKeyring | null): boolean {
  return envelopeKeyVersion(envelope) !== requireKeyring(keyring).current.version;
}

/** Re-seals a value under the current key (no-op when it already uses it). */
export function rotateField(envelope: string, opts: CryptoOptions): string {
  if (!needsRotation(envelope, opts.keyring)) return envelope;
  return encryptField(decryptField(envelope, opts), opts);
}

/** JSON helpers for structured restricted values (e.g. a PFS). */
export function encryptJson(value: unknown, opts: CryptoOptions): string {
  return encryptField(JSON.stringify(value), opts);
}

export function decryptJson<T = unknown>(envelope: string, opts: CryptoOptions): T {
  return JSON.parse(decryptField(envelope, opts)) as T;
}

/**
 * Deterministic keyed hash for equality lookups on encrypted fields (find a
 * principal by SSN without decrypting every row). The value is normalized
 * (trimmed, lower-cased, separators removed when `digitsOnly`) and bound to the
 * context, so the same SSN indexes differently in two columns. Indexes are
 * tied to the key version: after a rotation, rebuild them.
 */
export function blindIndex(value: string, opts: CryptoOptions & { digitsOnly?: boolean }): string {
  const keyring = requireKeyring(opts.keyring);
  const context = checkContext(opts.context);
  const normalized = opts.digitsOnly ? value.replace(/\D/g, "") : value.trim().toLowerCase();
  const mac = createHmac("sha256", keyring.current.indexKey).update(`${context}\u0000${normalized}`).digest("hex");
  return `${INDEX_FORMAT}.${keyring.current.version}.${mac}`;
}

/**
 * Encrypts the named fields of a record (any JSON value, stored JSON-encoded).
 * Context per field is `${contextPrefix}.${field}` (e.g. "principals:<id>.ssn").
 * Null/undefined fields are left alone; already-encrypted values are kept.
 * Pair with `openFields`, which JSON-decodes.
 */
export function sealFields<T extends Record<string, unknown>>(record: T, fields: readonly (keyof T & string)[], opts: { contextPrefix: string; keyring?: PiiKeyring | null }): T {
  const out: Record<string, unknown> = { ...record };
  for (const f of fields) {
    const v = record[f];
    if (v === null || v === undefined || isEncrypted(v)) continue;
    out[f] = encryptJson(v, { context: `${opts.contextPrefix}.${f}`, keyring: opts.keyring });
  }
  return out as T;
}

/** Inverse of sealFields. */
export function openFields<T extends Record<string, unknown>>(record: T, fields: readonly (keyof T & string)[], opts: { contextPrefix: string; keyring?: PiiKeyring | null }): T {
  const out: Record<string, unknown> = { ...record };
  for (const f of fields) {
    const v = record[f];
    if (isEncrypted(v)) out[f] = decryptJson(v, { context: `${opts.contextPrefix}.${f}`, keyring: opts.keyring });
  }
  return out as T;
}
