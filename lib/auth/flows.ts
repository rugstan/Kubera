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

export const PORTAL_HOME = "/portal";

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
 * Stores a fresh aal1 session and decides where the person goes next: staff
 * to MFA (always), portal users to their requested page, anyone without an
 * active profile and role to the access-denied page (signed out again).
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
  await writeSessionCookie(toStored(session, nowSeconds()));
  await clearPendingLogin();
  await services.directory.recordSignIn(session.user.id, new Date());
  await auditQuietly(services.audit, { actorId: session.user.id, actorLabel: displayName(profile), action: "auth.sign_in", detail: { aal: session.aal, roles }, ...fp });
  const home = requiresMfa(roles) ? "/pipeline" : PORTAL_HOME;
  const dest = next ? safeNextPath(next, home) : home;
  if (requiresMfa(roles) && session.aal !== "aal2") return `/mfa?next=${encodeURIComponent(dest)}`;
  return dest;
}
