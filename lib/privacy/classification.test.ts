import { describe, expect, it } from "vitest";
import {
  CLASSIFICATION_LEVELS,
  classifyKey,
  classifyPayload,
  detectSensitiveValues,
  encryptedFields,
  FIELD_CLASSIFICATION,
  fieldRule,
  maxLevel,
  redactPayload,
  redactText,
  withinCeiling,
} from "./classification";

const detectors = (s: string) => detectSensitiveValues(s).map((f) => f.detector);

describe("levels", () => {
  it("orders public < internal < confidential < restricted", () => {
    expect(CLASSIFICATION_LEVELS).toEqual(["public", "internal", "confidential", "restricted"]);
    expect(maxLevel("internal", "restricted", "public")).toBe("restricted");
    expect(maxLevel()).toBe("public");
    expect(withinCeiling("confidential", "confidential")).toBe(true);
    expect(withinCeiling("restricted", "confidential")).toBe(false);
  });
});

describe("field registry", () => {
  it("classifies the qualifier contact as confidential borrower PII", () => {
    expect(fieldRule("leads.contact.email")).toMatchObject({ level: "confidential", category: "borrower", pii: true });
    expect(fieldRule("leads.intake.assetType")?.level).toBe("internal");
    expect(fieldRule("kb_chunks.content")?.level).toBe("public");
  });

  it("marks every restricted field for encryption", () => {
    for (const [path, rule] of Object.entries(FIELD_CLASSIFICATION)) {
      if (rule.level === "restricted") expect(rule.encrypt, path).toBe(true);
    }
    expect(encryptedFields("principals")).toEqual(
      expect.arrayContaining(["principals.ssn", "principals.dob", "principals.pfs", "principals.bank_account_number"]),
    );
    expect(encryptedFields("leads")).toEqual([]);
  });
});

describe("key heuristics", () => {
  it.each([
    ["ssn", "restricted"],
    ["guarantor_ssn", "restricted"],
    ["dateOfBirth", "restricted"],
    ["DOB", "restricted"],
    ["bankAccountNumber", "restricted"],
    ["routing_number", "restricted"],
    ["driversLicense", "restricted"],
    ["pfs", "restricted"],
    ["email", "confidential"],
    ["mobilePhone", "confidential"],
    ["firstName", "confidential"],
    ["borrower", "confidential"],
    ["loanAmount", "confidential"],
    ["rentRoll", "confidential"],
  ])("%s → %s", (key, level) => {
    expect(classifyKey(key)?.level).toBe(level);
  });

  it("leaves neutral keys unclassified", () => {
    for (const k of ["assetType", "state", "program", "capRate"]) expect(classifyKey(k), k).toBeUndefined();
  });
});

describe("value detectors", () => {
  it("finds SSNs but not invalid ones", () => {
    expect(detectors("SSN 123-45-6789")).toContain("ssn");
    expect(detectors("my social security number: 123456789")).toContain("ssn");
    expect(detectors("000-12-3456 and 666-12-3456 and 912-34-5678")).not.toContain("ssn");
  });

  it("finds card numbers only when the Luhn check passes", () => {
    expect(detectors("card 4111 1111 1111 1111")).toContain("card_number");
    expect(detectors("card 4111 1111 1111 1112")).not.toContain("card_number");
  });

  it("finds routing numbers with a valid ABA checksum and labelled account numbers", () => {
    expect(detectors("routing # 021000021")).toContain("routing_number");
    expect(detectors("routing 123456789")).not.toContain("routing_number");
    expect(detectors("acct no. 000123456789")).toContain("account_number");
  });

  it("finds dates of birth, EINs, emails and phones", () => {
    expect(detectors("DOB: 04/12/1971")).toContain("date_of_birth");
    expect(detectors("born on March 3, 1980")).toContain("date_of_birth");
    expect(detectors("EIN 12-3456789")).toContain("ein");
    expect(detectors("reach me at pat.lee@example.com")).toContain("email");
    expect(detectors("call (415) 555-0100 or 415-555-0101")).toEqual(["phone", "phone"]);
  });

  it("does not flag loan amounts, rates or years", () => {
    expect(detectSensitiveValues("$2,500,000 loan at 6.25% on a 1985 building with 58 units, NOI 420000")).toEqual([]);
  });
});

describe("classifyPayload", () => {
  it("uses the registry for table rows", () => {
    const row = { contact: { firstName: "Pat", email: "pat@example.com" }, intake: { assetType: "HOTEL", loanAmount: 5_000_000 } };
    const c = classifyPayload(row, { table: "leads" });
    expect(c.level).toBe("confidential");
    expect(c.pii).toBe(true);
    expect(c.categories).toEqual(expect.arrayContaining(["borrower", "deal"]));
    expect(c.findings.find((f) => f.path === "contact.email")).toMatchObject({ source: "registry", level: "confidential" });
  });

  it("raises free text to restricted when it contains an SSN", () => {
    const c = classifyPayload({ messages: [{ role: "user", content: "my SSN is 123-45-6789" }] });
    expect(c.level).toBe("restricted");
    expect(c.findings.some((f) => f.path === "messages[0].content" && f.detail === "ssn")).toBe(true);
  });

  it("treats unclassified text as the default level", () => {
    expect(classifyPayload("Cap rates widened 25 bp in Q3.").level).toBe("internal");
    expect(classifyPayload("Cap rates widened 25 bp in Q3.", { defaultLevel: "public" }).level).toBe("public");
    expect(classifyPayload(null).level).toBe("public");
  });

  it("fails closed on very deep payloads", () => {
    let deep: Record<string, unknown> = { v: "x" };
    for (let i = 0; i < 20; i++) deep = { n: deep };
    expect(classifyPayload(deep).level).toBe("restricted");
  });
});

describe("redaction", () => {
  it("masks sensitive substrings above the ceiling", () => {
    expect(redactText("SSN 123-45-6789, email pat@example.com", "confidential")).toBe("SSN [REDACTED:ssn], email pat@example.com");
    expect(redactText("email pat@example.com", "internal")).toBe("email [REDACTED:email]");
  });

  it("drops whole fields above the ceiling and keeps the rest", () => {
    const out = redactPayload({ ssn: "123-45-6789", assetType: "HOTEL", notes: "acct 1234567890 at First Bank", contact: { email: "a@b.co" } }, "confidential");
    expect(out).toEqual({ ssn: "[REDACTED:restricted]", assetType: "HOTEL", notes: "acct [REDACTED:account_number] at First Bank", contact: { email: "a@b.co" } });
    const pub = redactPayload({ contact: { email: "a@b.co" }, assetType: "HOTEL" }, "public");
    expect(pub).toEqual({ contact: "[REDACTED:confidential]", assetType: "HOTEL" });
  });
});
