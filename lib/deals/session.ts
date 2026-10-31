// Staff session for the deal desk. Every page, server action and route under
// app/(staff)/deals verifies the session itself (a layout guard alone does not
// protect server actions), and the check fails closed: no verified Supabase
// Auth session with a staff role and MFA (aal2) → no data.
//
// Roles come from `app_metadata` (only the service role can set it), matching
// WS-I's roles: admin, broker, analyst. WS-I's lib/auth can replace
// `resolveStaffSession` without changing callers.

import type { SupabaseClient } from "@supabase/supabase-js";

export const STAFF_ROLES = ["admin", "broker", "analyst"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export type StaffSession = {
  userId: string;
  email: string;
  name: string;
  role: StaffRole;
  dreLicense: string | null;
  /** The corporation's designated officer (approves gate-H items). */
  designatedOfficer: boolean;
  /** Audit actor string, e.g. "staff:ana@kuberacommercial.com". */
  actor: string;
};

export type Permission = "read" | "write" | "officer";

export function can(s: StaffSession, p: Permission): boolean {
  if (p === "read") return true;
  if (p === "write") return s.role === "admin" || s.role === "broker";
  return s.designatedOfficer && Boolean(s.dreLicense);
}

export class StaffAccessError extends Error {
  constructor(readonly permission: Permission | "session") {
    super(permission === "session" ? "Staff sign-in with multi-factor authentication is required" : `This action needs ${permission} access`);
    this.name = "StaffAccessError";
  }
}

export function requirePermission(s: StaffSession | null, p: Permission): StaffSession {
  if (!s) throw new StaffAccessError("session");
  if (!can(s, p)) throw new StaffAccessError(p);
  return s;
}

// ---------------------------------------------------------------------------
// Supabase Auth cookie → access token

type CookieJar = { name: string; value: string }[];

/** Supabase project ref from the API URL (https://<ref>.supabase.co). */
export function projectRef(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.split(".")[0] || null;
  } catch {
    return null;
  }
}

/**
 * Access token from the `sb-<ref>-auth-token` cookie written by @supabase/ssr
 * (plain or `base64-` JSON, optionally chunked as `.0`, `.1`, …).
 */
export function accessTokenFromCookies(cookies: CookieJar, ref: string): string | null {
  const name = `sb-${ref}-auth-token`;
  const whole = cookies.find((c) => c.name === name)?.value;
  const chunks = cookies
    .filter((c) => c.name.startsWith(`${name}.`) && /^\d+$/.test(c.name.slice(name.length + 1)))
    .sort((a, b) => Number(a.name.slice(name.length + 1)) - Number(b.name.slice(name.length + 1)))
    .map((c) => c.value);
  let raw = whole ?? (chunks.length ? chunks.join("") : null);
  if (!raw) return null;
  try {
    raw = decodeURIComponent(raw);
    if (raw.startsWith("base64-")) raw = Buffer.from(raw.slice(7), "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(raw);
    const token = Array.isArray(parsed) ? parsed[0] : (parsed as { access_token?: unknown })?.access_token;
    return typeof token === "string" && token.split(".").length === 3 ? token : null;
  } catch {
    return null;
  }
}

/** Unverified JWT claims; call only after the token has been verified with Supabase Auth. */
export function jwtClaims(token: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

type AuthUser = { id: string; email?: string; app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> };

export function sessionFromUser(user: AuthUser, claims: Record<string, unknown>): StaffSession | null {
  const meta = user.app_metadata ?? {};
  const role = meta.role;
  if (typeof role !== "string" || !(STAFF_ROLES as readonly string[]).includes(role)) return null;
  // Staff must have completed MFA (TOTP) for this session.
  if (claims.aal !== "aal2") return null;
  if (!user.email) return null;
  const dre = typeof meta.dre_license === "string" && /^\d{8}$/.test(meta.dre_license) ? meta.dre_license : null;
  const name = typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim() ? user.user_metadata.full_name.trim() : user.email;
  return {
    userId: user.id,
    email: user.email.toLowerCase(),
    name,
    role: role as StaffRole,
    dreLicense: dre,
    designatedOfficer: meta.designated_officer === true,
    actor: `staff:${user.email.toLowerCase()}`,
  };
}

/** Verifies the cookie token with Supabase Auth and maps it to a staff session (null when anything is missing). */
export async function resolveStaffSession(deps: { cookies: CookieJar; supabase: Pick<SupabaseClient, "auth"> | null; supabaseUrl: string | undefined }): Promise<StaffSession | null> {
  const ref = projectRef(deps.supabaseUrl);
  if (!deps.supabase || !ref) return null;
  const token = accessTokenFromCookies(deps.cookies, ref);
  if (!token) return null;
  const { data, error } = await deps.supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return sessionFromUser(data.user as AuthUser, jwtClaims(token));
}
