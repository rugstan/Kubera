import { describe, expect, it } from "vitest";
import { signUploadToken, verifyUploadToken } from "./token";
import { LEAD_ID, TEST_ENV } from "./testing";

const DOC_ID = "9d4a7c3e-1b2f-4e6a-8c5d-7f3a2b1c0d9e";
const NOW = new Date("2026-11-03T12:00:00Z");
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

describe("upload tokens", () => {
  it("round-trips claims while valid", () => {
    const token = signUploadToken({ documentId: DOC_ID, leadId: LEAD_ID, expiresAt: minutes(15) }, TEST_ENV);
    const verdict = verifyUploadToken(token, NOW, TEST_ENV);
    expect(verdict).toEqual({ ok: true, claims: { documentId: DOC_ID, leadId: LEAD_ID, expiresAt: minutes(15) } });
  });

  it("rejects an expired token", () => {
    const token = signUploadToken({ documentId: DOC_ID, leadId: LEAD_ID, expiresAt: minutes(15) }, TEST_ENV);
    expect(verifyUploadToken(token, minutes(15), TEST_ENV)).toEqual({ ok: false, reason: "expired" });
    expect(verifyUploadToken(token, minutes(60), TEST_ENV)).toEqual({ ok: false, reason: "expired" });
    expect(verifyUploadToken(token, minutes(14), TEST_ENV).ok).toBe(true);
  });

  it("rejects tampered payloads and signatures", () => {
    const token = signUploadToken({ documentId: DOC_ID, leadId: LEAD_ID, expiresAt: minutes(15) }, TEST_ENV);
    const [v, body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ d: DOC_ID, l: LEAD_ID, e: Math.floor(minutes(600).getTime() / 1000) })).toString("base64url");
    expect(verifyUploadToken(`${v}.${forged}.${sig}`, NOW, TEST_ENV)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyUploadToken(`${v}.${body}.${sig!.slice(0, -2)}AA`, NOW, TEST_ENV)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyUploadToken("garbage", NOW, TEST_ENV)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyUploadToken("v2.a.b", NOW, TEST_ENV)).toEqual({ ok: false, reason: "malformed" });
  });

  it("is not valid under a different secret", () => {
    const token = signUploadToken({ documentId: DOC_ID, leadId: LEAD_ID, expiresAt: minutes(15) }, TEST_ENV);
    expect(verifyUploadToken(token, NOW, { LEAD_TOKEN_SECRET: "another-secret-another-secret" }).ok).toBe(false);
    expect(verifyUploadToken(token, NOW, {})).toEqual({ ok: false, reason: "not_configured" });
  });

  it("prefers DOCUMENT_TOKEN_SECRET over the lead secret", () => {
    const env = { LEAD_TOKEN_SECRET: "lead-lead-lead-lead", DOCUMENT_TOKEN_SECRET: "doc-doc-doc-doc-doc" };
    const token = signUploadToken({ documentId: DOC_ID, leadId: LEAD_ID, expiresAt: minutes(5) }, env);
    expect(verifyUploadToken(token, NOW, env).ok).toBe(true);
    expect(verifyUploadToken(token, NOW, { LEAD_TOKEN_SECRET: env.LEAD_TOKEN_SECRET }).ok).toBe(false);
  });

  it("refuses to mint without a secret", () => {
    expect(() => signUploadToken({ documentId: DOC_ID, leadId: LEAD_ID, expiresAt: minutes(5) }, {})).toThrow(/must be set/);
  });
});
