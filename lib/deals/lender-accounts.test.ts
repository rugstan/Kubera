// Lender account numbers (lib/deals/lender-accounts.ts): validation, masking,
// sealing bound to the row id, and the no-key and key-rotation paths.
import { afterEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { PiiDecryptError, PiiKeyError, createKeyring, isEncrypted, setPiiKeyring } from "@/lib/privacy/crypto";
import {
  BANNED_LABEL_MESSAGE,
  CARD_OR_SSN_MESSAGE,
  NUMBER_SHAPE_MESSAGE,
  assertSealedAccount,
  lenderAccountContext,
  maskHint,
  maskedNumber,
  openLenderAccountNumber,
  parseLenderAccount,
  sealLenderAccountNumber,
} from "./lender-accounts";
import { lenderAccountKinds } from "./types";

const KEY = createKeyring({ version: 1, key: Buffer.alloc(32, 7) });
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
// Same regex as the lender_accounts.number_enc CHECK (and principals.ssn).
const SQL_ENVELOPE = /^pii1\.\d{1,5}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{22}$/;
const CARD = "4111 1111 1111 1111";

afterEach(() => setPiiKeyring(undefined));

function messages(fn: () => unknown): string[] {
  try {
    fn();
    return [];
  } catch (err) {
    if (err instanceof ZodError) return err.issues.map((i) => i.message);
    throw err;
  }
}

describe("account number validation", () => {
  it("trims, collapses whitespace, and checks the length and characters", () => {
    expect(parseLenderAccount({ kind: "broker_id", number: "  BRK   48210 937 " }).number).toBe("BRK 48210 937");
    expect(parseLenderAccount({ kind: "portal_username", number: "corin.ops@lender.example" }).number).toBe("corin.ops@lender.example");
    expect(parseLenderAccount({ kind: "other", label: "Program code", number: "A1/B2#3+4_5-6" }).number).toBe("A1/B2#3+4_5-6");
    expect(messages(() => parseLenderAccount({ kind: "broker_id", number: "x".repeat(65) }))).toContain(NUMBER_SHAPE_MESSAGE);
    expect(messages(() => parseLenderAccount({ kind: "broker_id", number: "-abc" }))).toContain(NUMBER_SHAPE_MESSAGE);
    expect(messages(() => parseLenderAccount({ kind: "broker_id", number: "ab<c>" }))).toContain(NUMBER_SHAPE_MESSAGE);
    expect(messages(() => parseLenderAccount({ kind: "broker_id", number: "" }))).toContain("Enter the account number");
    expect(parseLenderAccount({ kind: "broker_id", number: "" }, { requireNumber: false }).number).toBeNull();
  });

  it("refuses an SSN for every kind and a card number except as a client account", () => {
    for (const kind of lenderAccountKinds) {
      const m = messages(() => parseLenderAccount({ kind, label: "Label", number: "123-45-6789" }));
      expect(m, kind).toContain(CARD_OR_SSN_MESSAGE);
      expect(m.join(" ")).not.toContain("6789");
    }
    expect(messages(() => parseLenderAccount({ kind: "broker_id", number: CARD }))).toContain(CARD_OR_SSN_MESSAGE);
    expect(messages(() => parseLenderAccount({ kind: "broker_id", number: "4111111111111111" }))).toContain(CARD_OR_SSN_MESSAGE);
    expect(parseLenderAccount({ kind: "client_account", number: "4111111111111111" }).number).toBe("4111111111111111");
  });

  it("defaults labels per kind, needs one for Other, and refuses password and bank labels", () => {
    expect(parseLenderAccount({ kind: "broker_id", number: "BRK-1" }).label).toBe("Broker ID");
    expect(parseLenderAccount({ kind: "client_account", number: "1234" }).label).toBe("Account number");
    expect(parseLenderAccount({ kind: "portal_username", number: "corin" }).label).toBe("Portal username");
    expect(parseLenderAccount({ kind: "broker_id", label: "  Servicing ID ", number: "1" }).label).toBe("Servicing ID");
    expect(messages(() => parseLenderAccount({ kind: "other", number: "1" }))).toContain("Give an Other account number a label");
    for (const label of ["Portal password", "PIN", "Wire", "Routing", "Bank account", "IBAN", "Swift code", "Passcode"]) expect(messages(() => parseLenderAccount({ kind: "other", label, number: "1" })), label).toContain(BANNED_LABEL_MESSAGE);
    expect(messages(() => parseLenderAccount({ kind: "broker_id", label: "x".repeat(81), number: "1" })).length).toBeGreaterThan(0);
  });

  it("scans notes for restricted values", () => {
    expect(() => parseLenderAccount({ kind: "broker_id", number: "1", notes: "password: hunter2" })).toThrow(/remove account numbers, passwords/);
    expect(parseLenderAccount({ kind: "broker_id", number: "1", notes: "Issued at onboarding\nRenew yearly" }).notes).toBe("Issued at onboarding\nRenew yearly");
  });
});

describe("masking", () => {
  it("shows the last 4 of long values, the last 2 of medium ones, nothing for short ones", () => {
    expect(maskHint("ABCDEFGHIJ1234")).toBe("1234");
    expect(maskHint("12345678")).toBe("78");
    expect(maskHint("12345")).toBeNull();
    expect(maskHint("SVC-0099-887766")).toBe("7766");
    expect(maskHint("a.b.c.d.e.f")).toBe("ef");
    for (const v of ["x", "123456", "corin.ops@lender.example", "DEMO-BRK-48210937", "A1/B2#3+4_5-6", "123456789", "1234567890", "  -  "]) {
      const h = maskHint(v);
      expect(h === null || /^[A-Za-z0-9]{2,4}$/.test(h), v).toBe(true);
    }
    expect(maskedNumber("1234")).toBe("•••• 1234");
    expect(maskedNumber(null)).toBe("••••");
  });
});

describe("sealing", () => {
  it("round-trips, and the envelope passes isEncrypted and the SQL check", () => {
    const sealed = sealLenderAccountNumber(A, "DEMO-BRK-48210937", KEY);
    expect(sealed.numberLast4).toBe("0937");
    expect(isEncrypted(sealed.numberEnc)).toBe(true);
    expect(SQL_ENVELOPE.test(sealed.numberEnc)).toBe(true);
    expect(sealed.numberEnc).not.toContain("48210937");
    expect(openLenderAccountNumber({ id: A, numberEnc: sealed.numberEnc }, KEY)).toBe("DEMO-BRK-48210937");
    expect(() => assertSealedAccount(sealed)).not.toThrow();
    expect(() => assertSealedAccount({ numberEnc: "DEMO-BRK-48210937" })).toThrow(/not encrypted/);
  });

  it("binds the envelope to its row: sealed for A, it does not open as B", () => {
    const { numberEnc } = sealLenderAccountNumber(A, "SVC-0099887766", KEY);
    expect(() => openLenderAccountNumber({ id: B, numberEnc }, KEY)).toThrow(PiiDecryptError);
  });

  it("refuses to seal without a key", () => {
    setPiiKeyring(null);
    expect(() => sealLenderAccountNumber(A, "SVC-0099887766", null)).toThrow(PiiKeyError);
  });

  it("refuses an id that is not a UUID", () => {
    expect(() => lenderAccountContext("not-a-uuid")).toThrow();
    expect(lenderAccountContext(A)).toBe(`lender_accounts:${A}.number`);
  });

  it("opens an envelope sealed under v1 with a keyring whose current key is v2", () => {
    const v1 = createKeyring({ version: 1, key: Buffer.alloc(32, 7) });
    const { numberEnc } = sealLenderAccountNumber(A, "SVC-0099887766", v1);
    const v2 = createKeyring({ version: 2, key: Buffer.alloc(32, 9) }, [{ version: 1, key: Buffer.alloc(32, 7) }]);
    expect(openLenderAccountNumber({ id: A, numberEnc }, v2)).toBe("SVC-0099887766");
    expect(sealLenderAccountNumber(A, "x", v2).numberEnc.startsWith("pii1.2.")).toBe(true);
  });
});
