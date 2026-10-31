// Session cookie format and lifetime rules (pure; no Next.js imports).
//
// The cookie holds the provider's access + refresh tokens and the time the
// person first signed in. It is httpOnly, SameSite=Lax and Secure outside
// development, so scripts never see the tokens. Staff sessions have an
// absolute lifetime (default 12 h) after which the person signs in again, no
// matter how often the tokens were refreshed. The value is HMAC-signed so the
// sign-in time (and the token pair) cannot be edited or swapped client-side.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { AuthSession, AuthTokens } from "./types";

export const SESSION_COOKIE = "kc_session";
export const LOGIN_COOKIE = "kc_login";

const DEFAULT_MAX_HOURS = 12;
/** Refresh this many seconds before the access token expires. */
export const REFRESH_LEEWAY_SECONDS = 60;
export const LOGIN_COOKIE_MAX_AGE_SECONDS = 15 * 60;

export type StoredSession = AuthTokens & {
  /** Epoch seconds of the original sign-in (absolute lifetime anchor). */
  issuedAt: number;
};

export function sessionMaxAgeSeconds(env: Record<string, string | undefined> = process.env): number {
  const hours = Number(env.STAFF_SESSION_MAX_HOURS);
  const h = Number.isFinite(hours) && hours > 0 && hours <= 24 * 7 ? hours : DEFAULT_MAX_HOURS;
  return Math.round(h * 3600);
}

function mac(payload: string, key: string): string {
  return createHmac("sha256", key).update(`kc_session.v1.${payload}`).digest("base64url");
}

export function encodeSession(s: StoredSession, key: string): string {
  const payload = Buffer.from(JSON.stringify({ v: 1, a: s.accessToken, r: s.refreshToken, e: s.expiresAt, i: s.issuedAt }), "utf8").toString("base64url");
  return `${payload}.${mac(payload, key)}`;
}

export function decodeSession(value: string | undefined | null, key: string): StoredSession | null {
  if (!value || value.length > 8192) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(mac(payload, key));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const raw = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    if (raw.v !== 1) return null;
    const { a, r, e, i } = raw;
    if (typeof a !== "string" || typeof r !== "string" || !a || !r) return null;
    if (typeof e !== "number" || typeof i !== "number" || !Number.isFinite(e) || !Number.isFinite(i)) return null;
    return { accessToken: a, refreshToken: r, expiresAt: e, issuedAt: i };
  } catch {
    return null;
  }
}

export type SessionState = "missing" | "valid" | "needs_refresh" | "too_old";

/** Where a stored session stands at `nowSeconds`. */
export function sessionState(s: StoredSession | null, nowSeconds: number, maxAgeSeconds: number): SessionState {
  if (!s) return "missing";
  if (nowSeconds - s.issuedAt >= maxAgeSeconds || s.issuedAt > nowSeconds + 300) return "too_old";
  if (s.expiresAt - REFRESH_LEEWAY_SECONDS <= nowSeconds) return "needs_refresh";
  return "valid";
}

/** Stores a provider session, keeping the original sign-in time across refreshes and MFA upgrades. */
export function toStored(session: AuthSession, issuedAt: number): StoredSession {
  return { accessToken: session.accessToken, refreshToken: session.refreshToken, expiresAt: session.expiresAt, issuedAt };
}

export type CookieOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
};

export function cookieOptions(maxAge: number, env: Record<string, string | undefined> = process.env): CookieOptions {
  // Browsers accept Secure cookies on http://localhost, so `next start` in e2e works too.
  const secure = env.NODE_ENV === "production";
  return { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: Math.max(0, Math.floor(maxAge)) };
}

export function remainingLifetime(s: StoredSession, nowSeconds: number, maxAgeSeconds: number): number {
  return Math.max(0, s.issuedAt + maxAgeSeconds - nowSeconds);
}

// Pending sign-in (between "send code" and "enter code").
export type PendingLogin = { email: string; next: string; sentAt: number };

export function encodePendingLogin(p: PendingLogin): string {
  return Buffer.from(JSON.stringify(p), "utf8").toString("base64url");
}

export function decodePendingLogin(value: string | undefined | null, nowSeconds: number): PendingLogin | null {
  if (!value || value.length > 2048) return null;
  try {
    const raw = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<PendingLogin>;
    if (typeof raw.email !== "string" || typeof raw.next !== "string" || typeof raw.sentAt !== "number") return null;
    if (nowSeconds - raw.sentAt > LOGIN_COOKIE_MAX_AGE_SECONDS) return null;
    return { email: raw.email, next: raw.next ? safeNextPath(raw.next) : "", sentAt: raw.sentAt };
  } catch {
    return null;
  }
}

const NEXT_ALLOWED = /^\/(pipeline|approvals|documents|deals|checklists|lenders|construction|reports|ai-review|prospects|portal|mfa)(\/[\w\-./%]*)?(\?[\w\-.=&%]*)?$/;

/**
 * Post-sign-in destination. Only same-origin paths into the authenticated
 * areas are honoured, so `?next=` cannot become an open redirect.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/pipeline"): string {
  if (!next || typeof next !== "string" || next.length > 512) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\") || next.includes("..")) return fallback;
  return NEXT_ALLOWED.test(next) ? next : fallback;
}
