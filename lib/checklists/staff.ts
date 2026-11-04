// Staff identity for the checklist desk. The session comes only from WS-I's
// lib/auth (Supabase Auth with MFA, active profiles and roles); see
// app/(staff)/checklists/_lib/session.ts. Without it the desk is closed.

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
