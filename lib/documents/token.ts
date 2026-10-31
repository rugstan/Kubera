// Expiring HMAC upload tokens.
//
// POST /api/documents mints a row and returns a token that proves "this caller
// was issued upload <documentId> for lead <leadId>, and it is not past its
// expiry". POST /api/documents/finalize requires that token, so a leaked lead
// capability token alone cannot finalize someone else's upload, and an upload
// that is never finalized in time is swept away.
//
// Format: v1.<base64url(json {d,l,e})>.<base64url(hmac-sha256)>. The HMAC key is
// derived from DOCUMENT_TOKEN_SECRET (falling back to LEAD_TOKEN_SECRET) with a
// purpose label, so a lead token can never be replayed as an upload token.

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const VERSION = "v1";
const PURPOSE = "kubera:document-upload:v1";

const payloadSchema = z.object({ d: z.uuid(), l: z.uuid(), e: z.number().int().positive() });

export type UploadClaims = { documentId: string; leadId: string; expiresAt: Date };
export type TokenVerdict = { ok: true; claims: UploadClaims } | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "not_configured" };

function secret(env: Record<string, string | undefined>): string | null {
  return env.DOCUMENT_TOKEN_SECRET?.trim() || env.LEAD_TOKEN_SECRET?.trim() || null;
}

function mac(key: string, body: string): Buffer {
  const derived = createHmac("sha256", key).update(PURPOSE).digest();
  return createHmac("sha256", derived).update(`${VERSION}.${body}`).digest();
}

export function signUploadToken(
  claims: { documentId: string; leadId: string; expiresAt: Date },
  env: Record<string, string | undefined> = process.env,
): string {
  const key = secret(env);
  if (!key) throw new Error("DOCUMENT_TOKEN_SECRET or LEAD_TOKEN_SECRET must be set to mint upload tokens");
  const body = Buffer.from(JSON.stringify({ d: claims.documentId, l: claims.leadId, e: Math.floor(claims.expiresAt.getTime() / 1000) })).toString("base64url");
  return `${VERSION}.${body}.${mac(key, body).toString("base64url")}`;
}

/** Checks signature first (constant time), then structure, then expiry. */
export function verifyUploadToken(token: string, now: Date = new Date(), env: Record<string, string | undefined> = process.env): TokenVerdict {
  const key = secret(env);
  if (!key) return { ok: false, reason: "not_configured" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION || !parts[1] || !parts[2]) return { ok: false, reason: "malformed" };
  const given = Buffer.from(parts[2], "base64url");
  const expected = mac(key, parts[1]);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "bad_signature" };

  let parsed: z.infer<typeof payloadSchema>;
  try {
    parsed = payloadSchema.parse(JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (parsed.e * 1000 <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true, claims: { documentId: parsed.d, leadId: parsed.l, expiresAt: new Date(parsed.e * 1000) } };
}
