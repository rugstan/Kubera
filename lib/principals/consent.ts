// Credit and background authorization text shown in the borrower portal.
// Each version is immutable: the stored consent records the version id and
// the SHA-256 of the exact text the principal signed, and consent.test.ts
// pins the hash so a silent edit fails CI. Add a new version to change it.

import { createHash } from "node:crypto";
import type { CreditAuthorization } from "./types";

export type CreditAuthText = { id: string; text: string };

export const CREDIT_AUTH_TEXTS: Record<string, CreditAuthText> = {
  "credit-auth-2026-11-01": {
    id: "credit-auth-2026-11-01",
    text:
      "I authorize Kubera Commercial, Inc., a California licensed real estate broker, and the prospective lenders it presents my loan request to, " +
      "to obtain consumer credit reports about me, to verify the information I provide (including employment, income, assets and real estate owned), " +
      "and to screen my name against government sanctions and watch lists, for the purpose of evaluating and arranging the commercial loan request for this deal. " +
      "This authorization applies to me as an owner, officer or guarantor of the borrower. A copy of this authorization is as valid as the original. " +
      "I can revoke it by writing to compliance@kuberacommercial.com, but that does not affect reports already obtained. " +
      "By typing my full name I sign this authorization electronically.",
  },
};

export const CURRENT_CREDIT_AUTH = "credit-auth-2026-11-01";

export function creditAuthText(id: string = CURRENT_CREDIT_AUTH): CreditAuthText {
  const t = CREDIT_AUTH_TEXTS[id];
  if (!t) throw new Error(`Unknown credit authorization text ${id}`);
  return t;
}

export const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^a-z\s'-]/g, "").replace(/\s+/g, " ").trim();

/** The typed signature must match the principal's legal name (ignoring case, punctuation and middle names). */
export function signatureMatches(typed: string, legalName: string): boolean {
  const t = norm(typed).split(" ").filter(Boolean);
  const l = norm(legalName).split(" ").filter(Boolean);
  if (t.length < 2 || l.length < 2) return norm(typed) === norm(legalName) && t.length > 0;
  return t[0] === l[0] && t.at(-1) === l.at(-1);
}

export function buildCreditAuthorization(input: { signatureName: string; textVersion?: string; ip?: string | null; userAgent?: string | null; capturedVia: CreditAuthorization["capturedVia"]; now: Date }): CreditAuthorization {
  const text = creditAuthText(input.textVersion ?? CURRENT_CREDIT_AUTH);
  return {
    textVersion: text.id,
    textSha256: sha256(text.text),
    consentedAt: input.now.toISOString(),
    signatureName: input.signatureName.trim().slice(0, 200),
    ip: input.ip && input.ip !== "unknown" ? input.ip.slice(0, 64) : null,
    userAgent: input.userAgent?.slice(0, 512) ?? null,
    capturedVia: input.capturedVia,
  };
}
