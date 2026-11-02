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
