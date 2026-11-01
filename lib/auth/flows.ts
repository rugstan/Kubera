import "server-only";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { createHash } from "node:crypto";
import { rateLimiter } from "@/lib/ratelimit";
import { resolveAuthMode } from "./config";
import { auditQuietly } from "./audit";
import { clearSessionCookie, requestFingerprint, writeSessionCookie } from "./dal";
import { displayName, requiresMfa } from "./policy";
import type { AuthServices } from "./server";
import { LOGIN_COOKIE, LOGIN_COOKIE_MAX_AGE_SECONDS, cookieOptions, decodePendingLogin, encodePendingLogin, safeNextPath, toStored, type PendingLogin } from "./session";
import type { AuthSession } from "./types";

// Sign-in steps shared by the server actions and route handlers in app/(auth).

const nowSeconds = () => Math.floor(Date.now() / 1000);

export const STAFF_HOME = "/pipeline";

/** Where a borrower or partner who tried the staff sign-in is sent: the portal, told to use their secure link. */
export const PORTAL_USE_LINK = "/portal?state=use_link";

/** Hashed key for rate limits and logs, so raw emails never become cache or limiter keys. */
export function emailKey(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 32);
}

export async function limited(key: string, limit: number, windowMs: number): Promise<boolean> {
  // Fake mode (demo accounts, refused in production) skips sign-in limits: the
  // e2e suite signs the same demo broker in many times from one address.
  if (resolveAuthMode().mode === "fake") return false;
  return !(await rateLimiter().limit(key, { limit, windowMs })).success;
}

export async function setPendingLogin(p: PendingLogin): Promise<void> {
  (await cookies()).set(LOGIN_COOKIE, encodePendingLogin(p), cookieOptions(LOGIN_COOKIE_MAX_AGE_SECONDS));
}

export async function readPendingLogin(): Promise<PendingLogin | null> {
  const value = (await cookies()).get(LOGIN_COOKIE)?.value;
  await connection();
  return decodePendingLogin(value, nowSeconds());
}

export async function clearPendingLogin(): Promise<void> {
  (await cookies()).set(LOGIN_COOKIE, "", cookieOptions(0));
}

/**
 * Stores a fresh aal1 session and decides where the person goes next. /login
 * is staff-only: staff go on to MFA (always); borrower and partner accounts
 * are signed out again and sent to the portal, which they open with the
 * secure link their advisor emails them (the portal does not read this
 * session); anyone without an active profile and role goes to access-denied.
 */
export async function completeSignIn(services: AuthServices, session: AuthSession, next: string): Promise<string> {
  const fp = await requestFingerprint();
  const { profile, roles } = await services.directory.load(session.user.id);
  if (!profile || !profile.active || roles.length === 0) {
    await services.provider.signOut(session);
    await clearSessionCookie();
    await clearPendingLogin();
    await auditQuietly(services.audit, { actorId: profile ? session.user.id : null, actorLabel: session.user.email, action: "auth.access_denied", detail: { reason: !profile ? "no_profile" : !profile.active ? "inactive" : "no_role" }, ...fp });
    return "/access-denied?reason=inactive";
  }
  if (!requiresMfa(roles)) {
    await services.provider.signOut(session);
    await clearSessionCookie();
    await clearPendingLogin();
    await auditQuietly(services.audit, { actorId: session.user.id, actorLabel: displayName(profile), action: "auth.access_denied", detail: { reason: "not_staff", roles }, ...fp });
    return PORTAL_USE_LINK;
  }
  await writeSessionCookie(toStored(session, nowSeconds()));
  await clearPendingLogin();
  await services.directory.recordSignIn(session.user.id, new Date());
  await auditQuietly(services.audit, { actorId: session.user.id, actorLabel: displayName(profile), action: "auth.sign_in", detail: { aal: session.aal, roles }, ...fp });
  const dest = next ? safeNextPath(next, STAFF_HOME) : STAFF_HOME;
  if (session.aal !== "aal2") return `/mfa?next=${encodeURIComponent(dest)}`;
  return dest;
}
