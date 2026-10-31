import { createHmac, timingSafeEqual } from "node:crypto";

// Signed, stateless links for the confirmation email and unsubscribe pages.
// A token names the purpose and the subscriber id and carries an expiry; the
// HMAC covers all three, so a confirm token cannot be replayed as an
// unsubscribe (or the reverse) and cannot be forged without the secret.

export type TokenPurpose = "confirm" | "unsubscribe";

const PURPOSE_CODE: Record<TokenPurpose, string> = { confirm: "c", unsubscribe: "u" };
const CODE_PURPOSE: Record<string, TokenPurpose> = { c: "confirm", u: "unsubscribe" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Confirmation links last seven days. Unsubscribe links never expire. */
export const CONFIRM_TTL_SECONDS = 7 * 24 * 60 * 60;

export type TokenFailure = "malformed" | "bad_signature" | "expired";
export type VerifiedToken = { ok: true; purpose: TokenPurpose; subscriberId: string } | { ok: false; reason: TokenFailure };

function sign(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("base64url");
}

/** The signing secret: NEWSLETTER_TOKEN_SECRET, else LEAD_TOKEN_SECRET; null when neither is long enough. */
export function tokenSecretFromEnv(env: Record<string, string | undefined> = process.env): string | null {
  for (const key of ["NEWSLETTER_TOKEN_SECRET", "LEAD_TOKEN_SECRET"]) {
    const v = env[key]?.trim();
    if (v && v.length >= 16) return v;
  }
  return null;
}

export function signToken(secret: string, purpose: TokenPurpose, subscriberId: string, opts: { ttlSeconds?: number; now?: Date } = {}): string {
  const now = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  const expires = opts.ttlSeconds === undefined ? 0 : now + opts.ttlSeconds;
  const body = `${PURPOSE_CODE[purpose]}.${subscriberId}.${expires}`;
  return `${body}.${sign(secret, body)}`;
}

export function verifyToken(secret: string, token: string, opts: { now?: Date } = {}): VerifiedToken {
  const parts = token.split(".");
  if (parts.length !== 4) return { ok: false, reason: "malformed" };
  const [code, id, expiresRaw, signature] = parts as [string, string, string, string];
  const purpose = CODE_PURPOSE[code];
  if (!purpose || !UUID.test(id) || !/^\d{1,12}$/.test(expiresRaw) || !signature) return { ok: false, reason: "malformed" };

  const expected = Buffer.from(sign(secret, `${code}.${id}.${expiresRaw}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "bad_signature" };

  const expires = Number(expiresRaw);
  const now = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  if (expires !== 0 && now > expires) return { ok: false, reason: "expired" };
  return { ok: true, purpose, subscriberId: id.toLowerCase() };
}
