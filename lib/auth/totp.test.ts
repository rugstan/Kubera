import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, generateTotpSecret, hotp, otpauthUri, totp, verifyTotp } from "./totp";

// RFC 6238 Appendix B (SHA-1 seed "12345678901234567890"), truncated to 6 digits.
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

describe("TOTP", () => {
  it("round-trips base32", () => {
    expect(RFC_SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode(RFC_SECRET).toString("ascii")).toBe("12345678901234567890");
    expect(() => base32Decode("not base32!")).toThrow();
  });

  it("matches the RFC 6238 test vectors", () => {
    expect(totp(RFC_SECRET, 59_000)).toBe("287082");
    expect(totp(RFC_SECRET, 1_111_111_109_000)).toBe("081804");
    expect(totp(RFC_SECRET, 1_234_567_890_000)).toBe("005924");
    expect(totp(RFC_SECRET, 2_000_000_000_000)).toBe("279037");
    expect(hotp(RFC_SECRET, 1)).toBe("287082");
  });

  it("verifies within one step of drift and rejects others", () => {
    const at = 1_700_000_000_000;
    const code = totp(RFC_SECRET, at);
    expect(verifyTotp(RFC_SECRET, code, at)).toBe(true);
    expect(verifyTotp(RFC_SECRET, code, at + 30_000)).toBe(true);
    expect(verifyTotp(RFC_SECRET, code, at - 30_000)).toBe(true);
    expect(verifyTotp(RFC_SECRET, code, at + 95_000)).toBe(false);
    expect(verifyTotp(RFC_SECRET, "12345", at)).toBe(false);
    expect(verifyTotp(RFC_SECRET, "abcdef", at)).toBe(false);
  });

  it("generates 160-bit secrets and an authenticator URI", () => {
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(otpauthUri(s, "pat@kubera.test")).toBe(
      `otpauth://totp/Kubera%20Commercial%3Apat%40kubera.test?secret=${s}&issuer=Kubera%20Commercial&algorithm=SHA1&digits=6&period=30`,
    );
  });
});
