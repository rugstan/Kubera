// Authorization rules (pure). The staff app, server actions and route
// handlers all decide access here, and the database enforces the same model
// with RLS (supabase/migrations/20261103000100_i_auth_profiles_approvals.sql).

import { DRE_LICENSE_PATTERN } from "@/lib/site";
import { isStaffRole, type Aal, type Principal, type Profile, type Role, type StaffPrincipal, type StaffRole } from "./types";

export type AccessInput = {
  session: { userId: string; email: string; aal: Aal } | null;
  profile: Profile | null;
  roles: Role[];
};

export type AccessDecision =
  | { kind: "allow"; principal: StaffPrincipal }
  | { kind: "sign_in" }
  | { kind: "mfa" }
  | { kind: "forbidden"; reason: "inactive" | "not_staff" };

export function displayName(profile: Pick<Profile, "fullName" | "email">): string {
  return profile.fullName?.trim() || profile.email;
}

export function toPrincipal(input: { userId: string; email: string; aal: Aal }, profile: Profile, roles: Role[]): Principal {
  return { userId: input.userId, email: input.email, displayName: displayName(profile), roles: [...new Set(roles)].sort(), aal: input.aal, profile };
}

/**
 * Staff areas: a signed-in, active profile with a staff role and an MFA
 * (aal2) session. Missing MFA sends the person to enroll / verify TOTP.
 */
export function evaluateStaffAccess(input: AccessInput): AccessDecision {
  if (!input.session) return { kind: "sign_in" };
  if (!input.profile || !input.profile.active || input.profile.id !== input.session.userId) return { kind: "forbidden", reason: "inactive" };
  const staffRoles = input.roles.filter(isStaffRole);
  if (staffRoles.length === 0) return { kind: "forbidden", reason: "not_staff" };
  if (input.session.aal !== "aal2") return { kind: "mfa" };
  const principal = toPrincipal(input.session, input.profile, input.roles);
  return { kind: "allow", principal: { ...principal, staffRoles: [...new Set(staffRoles)].sort() as StaffRole[] } };
}

/** True when this person must complete TOTP before anything else (any staff role). */
export function requiresMfa(roles: Role[]): boolean {
  return roles.some(isStaffRole);
}

export type LicenseStatus =
  | { status: "current"; daysToExpiry: number }
  | { status: "expiring"; daysToExpiry: number }
  | { status: "missing" | "invalid" | "expired" | "unverified" };

const DAY_MS = 86_400_000;
const EXPIRING_DAYS = 60;

/** DRE license standing for a staff profile on `today` (YYYY-MM-DD, California date). */
export function licenseStatus(profile: Pick<Profile, "dreLicenseNumber" | "dreLicenseExpiresOn" | "dreLicenseVerifiedAt">, today: string): LicenseStatus {
  if (!profile.dreLicenseNumber) return { status: "missing" };
  if (!DRE_LICENSE_PATTERN.test(profile.dreLicenseNumber) || !profile.dreLicenseExpiresOn) return { status: "invalid" };
  const days = Math.round((Date.parse(`${profile.dreLicenseExpiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
  if (!Number.isFinite(days)) return { status: "invalid" };
  if (days < 0) return { status: "expired" };
  if (!profile.dreLicenseVerifiedAt) return { status: "unverified" };
  return days <= EXPIRING_DAYS ? { status: "expiring", daysToExpiry: days } : { status: "current", daysToExpiry: days };
}

export function hasCurrentLicense(profile: Profile, today: string): boolean {
  const s = licenseStatus(profile, today).status;
  return s === "current" || s === "expiring";
}

export type Capability = "view_pipeline" | "view_documents" | "view_approvals" | "approve" | "reject" | "cancel_approval" | "view_audit";

export type CapabilityCheck = { ok: true } | { ok: false; reason: string };

/**
 * What a staff member may do. Approving an outbound action is licensed
 * activity: only a broker with a current, admin-verified DRE license approves.
 * Brokers and admins may reject or cancel (stopping a send is always safe).
 */
export function can(principal: StaffPrincipal, capability: Capability, today: string): CapabilityCheck {
  const roles = new Set(principal.staffRoles);
  switch (capability) {
    case "view_pipeline":
    case "view_documents":
    case "view_approvals":
      return { ok: true };
    case "approve": {
      if (!roles.has("broker")) return { ok: false, reason: "Only a broker can approve outbound actions." };
      const lic = licenseStatus(principal.profile, today);
      if (lic.status === "current" || lic.status === "expiring") return { ok: true };
      const why: Record<string, string> = {
        missing: "Add your DRE license to your profile before approving.",
        invalid: "Your DRE license on file is incomplete.",
        expired: "Your DRE license on file has expired.",
        unverified: "An administrator has not verified your DRE license yet.",
      };
      return { ok: false, reason: why[lic.status] ?? "Your DRE license is not current." };
    }
    case "reject":
    case "cancel_approval":
      return roles.has("broker") || roles.has("admin") ? { ok: true } : { ok: false, reason: "Only a broker or administrator can do this." };
    case "view_audit":
      return roles.has("admin") ? { ok: true } : { ok: false, reason: "Administrators only." };
  }
}

/** California calendar date for `now` (licenses expire on California dates). */
export function californiaDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
