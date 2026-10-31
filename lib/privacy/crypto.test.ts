import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  blindIndex,
  createKeyring,
  decryptField,
  decryptJson,
  encryptField,
  encryptJson,
  envelopeKeyVersion,
  isEncrypted,
  keyringFromEnv,
  needsRotation,
  openFields,
  parseKey,
  PiiDecryptError,
  PiiKeyError,
  piiEncryptionConfigured,
  rotateField,
  sealFields,
  setPiiKeyring,
} from "./crypto";

const K1 = randomBytes(32).toString("base64");
const K2 = randomBytes(32).toString("hex");
const ring1 = createKeyring({ version: 1, key: K1 });
const ring2 = createKeyring({ version: 2, key: K2 }, [{ version: 1, key: K1 }]);
const ctx = { context: "principals.ssn:6f1b5c1e", keyring: ring1 };

afterEach(() => setPiiKeyring(undefined));

describe("keys", () => {
  it("accepts base64, base64url and hex 32-byte keys", () => {
    const raw = randomBytes(32);
    expect(parseKey(raw.toString("base64"))).toEqual(raw);
    expect(parseKey(raw.toString("base64url"))).toEqual(raw);
    expect(parseKey(raw.toString("hex"))).toEqual(raw);
  });

  it("rejects short or malformed keys", () => {
    expect(() => parseKey(randomBytes(16).toString("base64"))).toThrow(PiiKeyError);
    expect(() => parseKey("not a key")).toThrow(PiiKeyError);
  });

  it("reads the keyring and previous keys from the environment", () => {
    expect(keyringFromEnv({})).toBeNull();
    const ring = keyringFromEnv({ PII_ENCRYPTION_KEY: K2, PII_ENCRYPTION_KEY_VERSION: "2", PII_ENCRYPTION_PREVIOUS_KEYS: `1:${K1}` })!;
    expect(ring.current.version).toBe(2);
    expect([...ring.byVersion.keys()].sort()).toEqual([1, 2]);
    expect(() => keyringFromEnv({ PII_ENCRYPTION_KEY: K1, PII_ENCRYPTION_PREVIOUS_KEYS: K2 })).toThrow(/version/);
    expect(() => keyringFromEnv({ PII_ENCRYPTION_KEY: K1, PII_ENCRYPTION_KEY_VERSION: "0" })).toThrow(PiiKeyError);
    expect(() => createKeyring({ version: 1, key: K1 }, [{ version: 1, key: K2 }])).toThrow(/both current and previous/);
  });

  it("refuses to encrypt without a key (no plaintext fallback)", () => {
    setPiiKeyring(null);
    expect(piiEncryptionConfigured()).toBe(false);
    expect(() => encryptField("123-45-6789", { context: "principals.ssn:x" })).toThrow(PiiKeyError);
  });
});

describe("AES-256-GCM round trip", () => {
  it("encrypts and decrypts, with a fresh IV each time", () => {
    const a = encryptField("123-45-6789", ctx);
    const b = encryptField("123-45-6789", ctx);
    expect(a).not.toBe(b);
    expect(a).not.toContain("6789");
    expect(isEncrypted(a)).toBe(true);
    expect(a.startsWith("pii1.1.")).toBe(true);
    expect(decryptField(a, ctx)).toBe("123-45-6789");
    expect(decryptField(b, ctx)).toBe("123-45-6789");
  });

  it("round-trips unicode and empty strings and JSON", () => {
    for (const s of ["", "José Ñúñez — 東京", "x".repeat(10_000)]) expect(decryptField(encryptField(s, ctx), ctx)).toBe(s);
    const pfs = { assets: [{ kind: "checking", balance: 125_000 }], liabilities: [] };
    expect(decryptJson(encryptJson(pfs, ctx), ctx)).toEqual(pfs);
  });

  it("uses the global keyring when none is passed", () => {
    setPiiKeyring(ring1);
    expect(piiEncryptionConfigured()).toBe(true);
    const env = encryptField("secret", { context: "t.c:1" });
    expect(decryptField(env, { context: "t.c:1" })).toBe("secret");
  });

  it("rejects a ciphertext moved to another context", () => {
    const env = encryptField("123-45-6789", ctx);
    expect(() => decryptField(env, { ...ctx, context: "principals.ssn:other-row" })).toThrow(PiiDecryptError);
    expect(() => decryptField(env, { ...ctx, context: "principals.dob:6f1b5c1e" })).toThrow(PiiDecryptError);
  });

  it("detects tampering with the ciphertext, IV, tag or key version", () => {
    const env = encryptField("123-45-6789", ctx);
    const parts = env.split(".");
    const flip = (s: string) => {
      const buf = Buffer.from(s, "base64url");
      buf[0] = buf[0]! ^ 1;
      return buf.toString("base64url");
    };
    for (const i of [2, 3, 4]) {
      const bad = [...parts];
      bad[i] = flip(bad[i]!);
      expect(() => decryptField(bad.join("."), ctx), `part ${i}`).toThrow(PiiDecryptError);
    }
    // Relabelling the key version changes the AAD and the key lookup.
    expect(() => decryptField(env.replace("pii1.1.", "pii1.2."), { ...ctx, keyring: ring2 })).toThrow(PiiDecryptError);
    expect(() => decryptField("plaintext", ctx)).toThrow(PiiDecryptError);
  });

  it("requires a context", () => {
    expect(() => encryptField("x", { context: "", keyring: ring1 })).toThrow(PiiKeyError);
  });
});

describe("key versioning and rotation", () => {
  it("decrypts old values with a previous key and re-seals them under the current key", () => {
    const old = encryptField("04/12/1971", { context: "principals.dob:1", keyring: ring1 });
    expect(envelopeKeyVersion(old)).toBe(1);
    expect(needsRotation(old, ring2)).toBe(true);
    expect(decryptField(old, { context: "principals.dob:1", keyring: ring2 })).toBe("04/12/1971");

    const rotated = rotateField(old, { context: "principals.dob:1", keyring: ring2 });
    expect(envelopeKeyVersion(rotated)).toBe(2);
    expect(needsRotation(rotated, ring2)).toBe(false);
    expect(rotateField(rotated, { context: "principals.dob:1", keyring: ring2 })).toBe(rotated);
    expect(decryptField(rotated, { context: "principals.dob:1", keyring: ring2 })).toBe("04/12/1971");
    // The old keyring cannot read data sealed with the new key.
    expect(() => decryptField(rotated, { context: "principals.dob:1", keyring: ring1 })).toThrow(/No PII key for version 2/);
  });
});

describe("blind index", () => {
  it("is deterministic, normalized, and bound to its context and key", () => {
    const a = blindIndex("123-45-6789", { context: "principals.ssn", keyring: ring1, digitsOnly: true });
    expect(a).toBe(blindIndex("123 45 6789", { context: "principals.ssn", keyring: ring1, digitsOnly: true }));
    expect(a).toMatch(/^bi1\.1\.[0-9a-f]{64}$/);
    expect(a).not.toBe(blindIndex("123-45-6789", { context: "principals.itin", keyring: ring1, digitsOnly: true }));
    expect(a).not.toBe(blindIndex("123-45-6789", { context: "principals.ssn", keyring: ring2, digitsOnly: true }));
    expect(blindIndex(" Pat@Example.com ", { context: "x.email", keyring: ring1 })).toBe(blindIndex("pat@example.com", { context: "x.email", keyring: ring1 }));
  });
});

describe("sealFields / openFields", () => {
  it("encrypts only the named fields and reverses cleanly", () => {
    const row = { id: "p1", name: "Pat Lee", ssn: "123-45-6789", pfs: { netWorth: 4_000_000 }, dob: null };
    const sealed = sealFields(row, ["ssn", "pfs", "dob"], { contextPrefix: "principals:p1", keyring: ring1 });
    expect(sealed.name).toBe("Pat Lee");
    expect(isEncrypted(sealed.ssn)).toBe(true);
    expect(isEncrypted(sealed.pfs)).toBe(true);
    expect(sealed.dob).toBeNull();
    expect(JSON.stringify(sealed)).not.toContain("6789");
    // Idempotent: sealing again keeps the existing ciphertext.
    expect(sealFields(sealed, ["ssn"], { contextPrefix: "principals:p1", keyring: ring1 }).ssn).toBe(sealed.ssn);
    expect(openFields(sealed, ["ssn", "pfs", "dob"], { contextPrefix: "principals:p1", keyring: ring1 })).toEqual(row);
  });
});
