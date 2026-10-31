import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { hashIp } from "@/lib/security";
import { evaluateStaffAccess, toPrincipal, type AccessDecision } from "./policy";
import { authServices, sessionSigningKey, type AuthServices } from "./server";
import {
  SESSION_COOKIE,
  cookieOptions,
  decodeSession,
  encodeSession,
  remainingLifetime,
  sessionMaxAgeSeconds,
  sessionState,
  toStored,
  type StoredSession,
} from "./session";
import { isStaffRole, type AuthSession, type Principal, type Profile, type Role, type StaffPrincipal } from "./types";

// Data Access Layer: the one place request code learns who is signed in.
// Server components call requireStaff()/requireUser() (which redirect), and
// server actions / route handlers call staffForMutation()/userForMutation()
// (which return a result and may refresh the session cookie). Layout checks
// are a convenience only; every page, action and route re-checks here.

const nowSeconds = () => Math.floor(Date.now() / 1000);

type Loaded =
  | { status: "disabled" }
  | { status: "signed_out" }
  | { status: "needs_refresh"; stored: StoredSession }
  | { status: "signed_in"; services: AuthServices; session: AuthSession; stored: StoredSession; profile: Profile | null; roles: Role[] };

async function loadWith(services: AuthServices | null, stored: StoredSession | null): Promise<Loaded> {
  if (!services) return { status: "disabled" };
  const state = sessionState(stored, nowSeconds(), sessionMaxAgeSeconds());
  if (state === "missing" || state === "too_old" || !stored) return { status: "signed_out" };
  if (state === "needs_refresh") return { status: "needs_refresh", stored };
  // A token that is not near expiry but fails validation was revoked (or
  // forged): sign out rather than refresh, so a bad token can never loop.
  const session = await services.provider.getSession(stored);
  if (!session) return { status: "signed_out" };
  const { profile, roles } = await services.directory.load(session.user.id);
  return { status: "signed_in", services, session, stored, profile, roles };
}

/** Reads and validates the session once per request (React cache). */
const loadCurrent = cache(async (): Promise<Loaded> => {
  const jar = await cookies();
  // Session checks compare against the clock, so they only ever run per request.
  await connection();
  return loadWith(authServices(), decodeSession(jar.get(SESSION_COOKIE)?.value, sessionSigningKey()));
});

function decide(l: Extract<Loaded, { status: "signed_in" }>): AccessDecision {
  return evaluateStaffAccess({
    session: { userId: l.session.user.id, email: l.session.user.email, aal: l.session.aal },
    profile: l.profile,
    roles: l.roles,
  });
}

const enc = encodeURIComponent;

export type StaffContext = { principal: StaffPrincipal; accessToken: string; services: AuthServices };
export type UserContext = { principal: Principal; accessToken: string; services: AuthServices };

/** Server components: the signed-in staff member (MFA verified) or a redirect. */
export async function requireStaff(nextPath: string): Promise<StaffContext> {
  const l = await loadCurrent();
  if (l.status === "disabled") redirect("/login?error=unavailable");
  if (l.status === "signed_out") redirect(`/login?next=${enc(nextPath)}`);
  if (l.status === "needs_refresh") redirect(`/auth/refresh?next=${enc(nextPath)}`);
  const d = decide(l);
  if (d.kind === "sign_in") redirect(`/login?next=${enc(nextPath)}`);
  if (d.kind === "mfa") redirect(`/mfa?next=${enc(nextPath)}`);
  if (d.kind === "forbidden") redirect(`/access-denied?reason=${d.reason}`);
  return { principal: d.principal, accessToken: l.session.accessToken, services: l.services };
}

/**
 * Server components for any signed-in person (portal pages). Staff accounts
 * still need MFA, so a staff member's aal1 session never reaches portal data.
 */
export async function requireUser(nextPath: string): Promise<UserContext> {
  const l = await loadCurrent();
  if (l.status === "disabled") redirect("/login?error=unavailable");
  if (l.status === "signed_out") redirect(`/login?next=${enc(nextPath)}`);
  if (l.status === "needs_refresh") redirect(`/auth/refresh?next=${enc(nextPath)}`);
  if (!l.profile || !l.profile.active || l.roles.length === 0) redirect("/access-denied?reason=inactive");
  if (l.roles.some(isStaffRole) && l.session.aal !== "aal2") redirect(`/mfa?next=${enc(nextPath)}`);
  return { principal: toPrincipal({ userId: l.session.user.id, email: l.session.user.email, aal: l.session.aal }, l.profile, l.roles), accessToken: l.session.accessToken, services: l.services };
}

/** The signed-in identity without access decisions (sign-in and MFA pages). */
export async function currentSignIn(): Promise<Loaded> {
  return loadCurrent();
}

// --- Mutations (server actions, route handlers) ---------------------------------

export type MutationDenied = { ok: false; status: 401 | 403 | 503; reason: "unavailable" | "signed_out" | "mfa_required" | "forbidden" };

/** Writes the session cookie (actions and route handlers only). */
export async function writeSessionCookie(stored: StoredSession): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, encodeSession(stored, sessionSigningKey()), cookieOptions(remainingLifetime(stored, nowSeconds(), sessionMaxAgeSeconds())));
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", cookieOptions(0));
}

/**
 * Refreshes an expiring session (rotating the refresh token) and stores it.
 * Returns null when the session can no longer be refreshed; the cookie is
 * cleared in that case.
 */
export async function refreshCurrentSession(): Promise<StoredSession | null> {
  const services = authServices();
  const jar = await cookies();
  const stored = decodeSession(jar.get(SESSION_COOKIE)?.value, sessionSigningKey());
  if (!services || !stored) return null;
  if (sessionState(stored, nowSeconds(), sessionMaxAgeSeconds()) === "too_old") {
    await clearSessionCookie();
    return null;
  }
  try {
    const fresh = await services.provider.refresh(stored.refreshToken);
    const next = toStored(fresh, stored.issuedAt);
    await writeSessionCookie(next);
    return next;
  } catch {
    await clearSessionCookie();
    return null;
  }
}

async function loadForMutation(): Promise<Loaded> {
  const services = authServices();
  const jar = await cookies();
  let stored = decodeSession(jar.get(SESSION_COOKIE)?.value, sessionSigningKey());
  let l = await loadWith(services, stored);
  if (l.status === "needs_refresh") {
    stored = await refreshCurrentSession();
    l = stored ? await loadWith(services, stored) : { status: "signed_out" };
    if (l.status === "needs_refresh") l = { status: "signed_out" };
  }
  return l;
}

export async function staffForMutation(): Promise<{ ok: true; ctx: StaffContext } | MutationDenied> {
  const l = await loadForMutation();
  if (l.status === "disabled") return { ok: false, status: 503, reason: "unavailable" };
  if (l.status !== "signed_in") return { ok: false, status: 401, reason: "signed_out" };
  const d = decide(l);
  if (d.kind === "sign_in") return { ok: false, status: 401, reason: "signed_out" };
  if (d.kind === "mfa") return { ok: false, status: 403, reason: "mfa_required" };
  if (d.kind === "forbidden") return { ok: false, status: 403, reason: "forbidden" };
  return { ok: true, ctx: { principal: d.principal, accessToken: l.session.accessToken, services: l.services } };
}

/** Any signed-in session (MFA pages, sign-out). */
export async function sessionForMutation(): Promise<
  { ok: true; services: AuthServices; session: AuthSession; stored: StoredSession; profile: Profile | null; roles: Role[] } | MutationDenied
> {
  const l = await loadForMutation();
  if (l.status === "disabled") return { ok: false, status: 503, reason: "unavailable" };
  if (l.status !== "signed_in") return { ok: false, status: 401, reason: "signed_out" };
  return { ok: true, services: l.services, session: l.session, stored: l.stored, profile: l.profile, roles: l.roles };
}

/** Client fingerprint for audit rows: salted IP hash and the user agent. */
export async function requestFingerprint(): Promise<{ ipHash?: string; userAgent?: string }> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "";
  return { ipHash: ip ? hashIp(ip) : undefined, userAgent: h.get("user-agent")?.slice(0, 512) || undefined };
}

// --- Step-up (sensitive approvals) ------------------------------------------------

/** Claims of a JWT access token, or null (fake-provider tokens are opaque). Only call on a token the provider already validated. */
function jwtClaims(token: string): Record<string, unknown> | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const claims = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as unknown;
    return claims && typeof claims === "object" && !Array.isArray(claims) ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Claims of the signed-in session's access token (validated with the identity
 * provider by loadWith), e.g. to read the `amr` second-factor time. Null when
 * signed out or the token is not a JWT.
 */
export async function currentAccessTokenClaims(): Promise<Record<string, unknown> | null> {
  const auth = await sessionForMutation();
  return auth.ok ? jwtClaims(auth.stored.accessToken) : null;
}

export type StepUpTotp = { ok: true; verifiedAt: Date; sessionRef: string | null } | { ok: false; reason: "signed_out" | "no_factor" | "invalid_code" };

/**
 * Re-verifies the signed-in user's authenticator (TOTP) right now, for a step-up
 * on a sensitive approval. The provider issues a fresh session on success; it
 * replaces the cookie so the request keeps working.
 */
export async function verifyStepUpTotp(code: string): Promise<StepUpTotp> {
  const auth = await sessionForMutation();
  if (!auth.ok) return { ok: false, reason: "signed_out" };
  const factors = await auth.services.provider.listTotpFactors(auth.stored);
  const factor = factors.find((f) => f.status === "verified");
  if (!factor) return { ok: false, reason: "no_factor" };
  let upgraded: AuthSession;
  try {
    upgraded = await auth.services.provider.verifyTotp(auth.stored, factor.id, code);
  } catch {
    return { ok: false, reason: "invalid_code" };
  }
  await writeSessionCookie(toStored(upgraded, auth.stored.issuedAt));
  const sid = jwtClaims(upgraded.accessToken)?.session_id;
  return { ok: true, verifiedAt: new Date(), sessionRef: typeof sid === "string" ? sid.slice(0, 200) : null };
}
