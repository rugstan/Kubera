import "server-only";
import { primaryStaffRole, signedInStaff, staffDreLicense } from "@/lib/auth/staff";
import type { StaffIdentity } from "@/lib/checklists/staff";

/**
 * The signed-in staff member for this request, or null. Call inside a Suspense
 * boundary or a server action. WS-I's lib/auth session (active profile, staff
 * role, MFA at aal2) is the only way in; without lib/auth configured the desk
 * is closed.
 */
export async function currentStaff(): Promise<StaffIdentity | null> {
  const p = await signedInStaff();
  return p ? { id: p.userId, email: p.email.toLowerCase(), name: p.displayName, role: primaryStaffRole(p), dreLicense: staffDreLicense(p) } : null;
}

export class StaffAuthError extends Error {
  constructor() {
    super("Sign in to the deal desk first.");
    this.name = "StaffAuthError";
  }
}

export async function requireStaff(): Promise<StaffIdentity> {
  const staff = await currentStaff();
  if (!staff) throw new StaffAuthError();
  return staff;
}
