import "server-only";
import { currentSignIn } from "./dal";
import { evaluateStaffAccess } from "./policy";
import type { StaffPrincipal, StaffRole } from "./types";

// Read-only staff check for the other staff desks (deal desk, checklists,
// construction). It never refreshes or writes the session cookie, so it is
// safe in server components as well as actions and route handlers; an
// expiring session reads as signed out and the (staff) layout sends the
// person through /auth/refresh.

/** The signed-in staff member with MFA (aal2), or null. */
export async function signedInStaff(): Promise<StaffPrincipal | null> {
  const l = await currentSignIn();
  if (l.status !== "signed_in") return null;
  const d = evaluateStaffAccess({ session: { userId: l.session.user.id, email: l.session.user.email, aal: l.session.aal }, profile: l.profile, roles: l.roles });
  return d.kind === "allow" ? d.principal : null;
}

const RANK: Record<StaffRole, number> = { admin: 3, broker: 2, analyst: 1 };

/** The most privileged staff role, for desks that model a single role per person. */
export function primaryStaffRole(principal: Pick<StaffPrincipal, "staffRoles">): StaffRole {
  return [...principal.staffRoles].sort((a, b) => RANK[b] - RANK[a])[0] ?? "analyst";
}

/** The profile's DRE license when it is an 8-digit number. */
export function staffDreLicense(principal: Pick<StaffPrincipal, "profile">): string | null {
  const n = principal.profile.dreLicenseNumber?.trim() ?? "";
  return /^\d{8}$/.test(n) ? n : null;
}
