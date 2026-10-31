// Staff identity for the checklist desk. Staff auth (Supabase Auth with MFA,
// profiles and roles) is WS-I's lib/auth; its session resolver is plugged in
// with setStaffResolver(). Until then a single shared access token
// (STAFF_ACCESS_TOKEN, 32+ characters) signs in one operator, and without it
// the staff pages and actions are closed.

import { createHmac, timingSafeEqual } from "node:crypto";

export const STAFF_ROLES = ["admin", "broker", "analyst"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export type StaffIdentity = {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
  /** DRE license number on the staff profile (brokers and licensees). */
  dreLicense: string | null;
};

/** Brokers and admins can clear screenings, waive items and invite borrowers; analysts prepare. */
export function canDecide(staff: StaffIdentity): boolean {
  return staff.role === "admin" || staff.role === "broker";
}

export type StaffResolver = (cookieValue: (name: string) => string | undefined) => Promise<StaffIdentity | null>;

export const STAFF_COOKIE = "kubera_staff";
const MIN_TOKEN = 32;

/** Value stored in the interim staff cookie: an HMAC of the token, never the token itself. */
export function staffCookieValue(token: string): string {
  return createHmac("sha256", token).update("kubera-staff-session:v1").digest("base64url");
}

export function interimStaffConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return (env.STAFF_ACCESS_TOKEN?.trim().length ?? 0) >= MIN_TOKEN;
}

export function verifyStaffToken(given: string, env: Record<string, string | undefined> = process.env): boolean {
  const token = env.STAFF_ACCESS_TOKEN?.trim();
  if (!token || token.length < MIN_TOKEN) return false;
  const a = Buffer.from(given.trim());
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The single interim operator. Its role is broker so it can act on the desk; replace with WS-I profiles. */
export function interimStaffIdentity(env: Record<string, string | undefined> = process.env): StaffIdentity {
  return {
    id: "staff:interim",
    email: env.STAFF_ACCESS_EMAIL?.trim() || "deals@kuberacommercial.com",
    name: env.STAFF_ACCESS_NAME?.trim() || "Kubera staff",
    role: "broker",
    dreLicense: env.NEXT_PUBLIC_DRE_OFFICER_LICENSE?.trim() || null,
  };
}

const interimResolver: StaffResolver = async (cookie) => {
  const token = process.env.STAFF_ACCESS_TOKEN?.trim();
  if (!token || token.length < MIN_TOKEN) return null;
  const value = cookie(STAFF_COOKIE);
  if (!value) return null;
  const expected = Buffer.from(staffCookieValue(token));
  const got = Buffer.from(value);
  return expected.length === got.length && timingSafeEqual(expected, got) ? interimStaffIdentity() : null;
};

let resolver: StaffResolver = interimResolver;

/** WS-I plugs its Supabase Auth session lookup in here. */
export function setStaffResolver(next: StaffResolver | null): void {
  resolver = next ?? interimResolver;
}

export function resolveStaff(cookie: (name: string) => string | undefined): Promise<StaffIdentity | null> {
  return resolver(cookie);
}
