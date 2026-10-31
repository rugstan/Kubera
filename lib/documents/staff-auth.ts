import "server-only";
import { staffForMutation, type MutationDenied } from "@/lib/auth/dal";
import type { StaffRole } from "@/lib/auth/types";

// Staff authentication for the vault API routes (download, delete). The caller
// must hold a WS-I staff session with MFA (aal2). The audit actor comes from
// that verified session, never from a request header.

export type VaultStaff = { actor: string; userId: string; email: string; staffRoles: StaffRole[] };
export type VaultStaffDenied = Pick<MutationDenied, "ok" | "status" | "reason">;
export type VaultStaffResult = { ok: true; staff: VaultStaff } | VaultStaffDenied;

/** Audit actor for document_events (1..200 chars): the staff member's user id and email. */
export function staffActor(userId: string, email: string): string {
  return `staff:${userId}:${email}`.slice(0, 200);
}

/**
 * The signed-in staff member, or why not. `roles` narrows who may act (delete
 * is broker/admin only); when omitted, any staff role with MFA passes.
 */
export async function authenticateVaultStaff(opts: { roles?: readonly StaffRole[] } = {}): Promise<VaultStaffResult> {
  const auth = await staffForMutation();
  if (!auth.ok) return { ok: false, status: auth.status, reason: auth.reason };
  const { principal } = auth.ctx;
  const roles = opts.roles;
  if (roles && !principal.staffRoles.some((r) => roles.includes(r))) return { ok: false, status: 403, reason: "forbidden" };
  return {
    ok: true,
    staff: { actor: staffActor(principal.userId, principal.email), userId: principal.userId, email: principal.email, staffRoles: principal.staffRoles },
  };
}

/** Message for a refused staff call (never says more than the caller needs). */
export function staffDenialMessage(denied: VaultStaffDenied): string {
  switch (denied.reason) {
    case "unavailable":
      return "Staff sign-in is not configured";
    case "signed_out":
      return "Unauthorized";
    case "mfa_required":
      return "Two-step verification required";
    default:
      return "Not allowed";
  }
}
