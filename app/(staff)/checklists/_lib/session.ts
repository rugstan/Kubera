import "server-only";
import { cookies } from "next/headers";
import { resolveAuthMode } from "@/lib/auth/config";
import { primaryStaffRole, signedInStaff, staffDreLicense } from "@/lib/auth/staff";
import { resolveStaff, type StaffIdentity } from "@/lib/checklists/staff";

/**
 * The signed-in staff member for this request, or null. Call inside a Suspense
 * boundary or a server action. When WS-I staff auth is configured it is the only
 * way in (MFA required); the interim STAFF_ACCESS_TOKEN applies only without it.
 */
export async function currentStaff(): Promise<StaffIdentity | null> {
  if (resolveAuthMode().mode !== "disabled") {
    const p = await signedInStaff();
    return p ? { id: p.userId, email: p.email.toLowerCase(), name: p.displayName, role: primaryStaffRole(p), dreLicense: staffDreLicense(p) } : null;
  }
  const jar = await cookies();
  return resolveStaff((name) => jar.get(name)?.value);
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
