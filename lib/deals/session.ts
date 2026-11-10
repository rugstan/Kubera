// Staff session for the deal desk. Every page, server action and route under
// app/(staff)/deals verifies the session itself (a layout guard alone does not
// protect server actions), and the check fails closed. The only source is
// WS-I's lib/auth (lib/auth/staff.signedInStaff: active profile, staff role,
// MFA at aal2); lib/deals/runtime.ts maps it to this shape. Without lib/auth
// configured there is no session at all.

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
  /** Audit actor string, e.g. "staff:ana@corincommercial.com". */
  actor: string;
};

/**
 * read: every signed-in staff member. write: admin and broker. officer: the
 * designated officer (a DRE broker-officer license). reveal_account: an admin
 * or the designated officer may open a sealed lender account number; writers
 * can add, replace and delete numbers without being able to read them.
 */
export type Permission = "read" | "write" | "officer" | "reveal_account";

export function can(s: StaffSession, p: Permission): boolean {
  if (p === "read") return true;
  if (p === "write") return s.role === "admin" || s.role === "broker";
  if (p === "reveal_account") return s.role === "admin" || (s.designatedOfficer && Boolean(s.dreLicense));
  return s.designatedOfficer && Boolean(s.dreLicense);
}

export const REVEAL_ACCOUNT_DENIED = "Only an administrator or the designated officer can reveal account numbers";

export class StaffAccessError extends Error {
  constructor(readonly permission: Permission | "session") {
    super(permission === "session" ? "Staff sign-in with multi-factor authentication is required" : permission === "reveal_account" ? REVEAL_ACCOUNT_DENIED : `This action needs ${permission} access`);
    this.name = "StaffAccessError";
  }
}

export function requirePermission(s: StaffSession | null, p: Permission): StaffSession {
  if (!s) throw new StaffAccessError("session");
  if (!can(s, p)) throw new StaffAccessError(p);
  return s;
}
