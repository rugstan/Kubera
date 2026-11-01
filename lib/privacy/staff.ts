import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { AuditAction, AuditSink } from "@/lib/auth/audit";
import { auditQuietly } from "@/lib/auth/audit";
import { requestFingerprint, staffForMutation, verifyStepUpTotp } from "@/lib/auth/dal";
import { limited } from "@/lib/auth/flows";
import type { StaffRole } from "@/lib/auth/types";
import { isAllowedOrigin } from "@/lib/security";

// Staff authentication for the privacy admin API (request view / verify /
// complete / deny, the subject export, legal holds). These routes decrypt
// restricted PII and can lift a legal hold, so:
//   - the caller must hold a WS-I staff session with MFA (aal2) and an admin
//     role (there is no separate compliance role; administrators run privacy);
//   - the actor recorded on the request or the hold comes from that session,
//     never from the request body;
//   - every read or change is written to staff_audit_events BEFORE it takes
//     effect, and the route fails closed when the audit write fails;
//   - the export and releasing a legal hold need a fresh authenticator code
//     (step-up TOTP) on top of the aal2 session.
// The old shared PRIVACY_ADMIN_TOKEN bearer is retired.

export const PRIVACY_ADMIN_ROLES: readonly StaffRole[] = ["admin"];

const NO_STORE = { "cache-control": "no-store", "x-robots-tag": "noindex" };
const MIN = 60_000;

export type PrivacyStaff = {
  userId: string;
  email: string;
  /** Recorded on privacy_requests / legal_hold_set_by (≤ 200 chars). */
  actor: string;
  audit: AuditSink;
};

export type PrivacyStaffResult = { ok: true; staff: PrivacyStaff } | { ok: false; response: NextResponse };

export const privacyJson = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export const totpSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app");

/** The actor string written to privacy records: the verified staff identity. */
export function privacyActor(email: string, userId: string): string {
  return `staff:${email.toLowerCase()}:${userId}`.slice(0, 200);
}

/**
 * The signed-in privacy administrator, or the response to return. Mutations
 * (`mutation: true`) also refuse a cross-site Origin; the session cookie is
 * SameSite=Lax, so this is defense in depth.
 */
export async function privacyStaff(req: Request, opts: { mutation?: boolean } = {}): Promise<PrivacyStaffResult> {
  if (opts.mutation) {
    const origin = req.headers.get("origin");
    if (origin && !isAllowedOrigin(origin)) return { ok: false, response: privacyJson(403, { error: "Not allowed" }) };
  }
  const auth = await staffForMutation();
  if (!auth.ok) {
    const error = auth.reason === "unavailable" ? "Staff sign-in is not configured" : auth.reason === "mfa_required" ? "Two-step verification required" : auth.status === 401 ? "Unauthorized" : "Not allowed";
    return { ok: false, response: privacyJson(auth.status, { error }) };
  }
  const { principal, services } = auth.ctx;
  if (!principal.staffRoles.some((r) => PRIVACY_ADMIN_ROLES.includes(r))) return { ok: false, response: privacyJson(403, { error: "Privacy requests are handled by administrators" }) };
  return { ok: true, staff: { userId: principal.userId, email: principal.email.toLowerCase(), actor: privacyActor(principal.email, principal.userId), audit: services.audit } };
}

/**
 * Writes the audit row for a privacy read or change. Returns a 503 response
 * when the write fails (the caller returns it and discloses / changes nothing).
 */
export async function auditPrivacy(
  staff: PrivacyStaff,
  action: AuditAction,
  target: { type: string; id: string },
  detail: Record<string, unknown> = {},
): Promise<NextResponse | null> {
  try {
    const fp = await requestFingerprint();
    await staff.audit.record({ actorId: staff.userId, actorLabel: staff.email, action, targetType: target.type, targetId: target.id, ...fp, detail });
    return null;
  } catch (err) {
    console.error("[privacy] audit write failed", action, err instanceof Error ? err.message : err);
    return privacyJson(503, { error: "The audit trail is unavailable, so nothing was disclosed or changed. Try again." });
  }
}

/**
 * Step-up: a fresh authenticator code verified with the identity provider
 * right now. Returns null when verified, otherwise the response to return.
 * Failed attempts are rate limited and audited (best effort).
 */
export async function requirePrivacyStepUp(staff: PrivacyStaff, code: string | undefined, purpose: { action: string; target: { type: string; id: string } }): Promise<NextResponse | null> {
  if (await limited(`privacy:step-up:${staff.userId}`, 6, 5 * MIN)) return privacyJson(429, { error: "Too many attempts. Wait a few minutes and try again." });
  const parsed = totpSchema.safeParse(code ?? "");
  if (!parsed.success) return privacyJson(401, { error: "This action needs a fresh code from your authenticator app (totp).", stepUp: "totp_required" });
  const v = await verifyStepUpTotp(parsed.data);
  if (v.ok) return null;
  const fp = await requestFingerprint().catch(() => ({}));
  await auditQuietly(staff.audit, { actorId: staff.userId, actorLabel: staff.email, action: "privacy.step_up_failed", targetType: purpose.target.type, targetId: purpose.target.id, ...fp, detail: { for: purpose.action, reason: v.reason } });
  const messages = {
    signed_out: "Your session ended. Sign in again.",
    no_factor: "Set up an authenticator app before doing this.",
    invalid_code: "That authenticator code did not match. Try the newest code.",
  } as const;
  return privacyJson(401, { error: messages[v.reason], stepUp: v.reason });
}
