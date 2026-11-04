"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { freshFactorFromAmr, REAUTH_MAX_AGE_MS, ReauthError, ReauthService, requiresReauthentication, type ReauthMethod } from "@/lib/agents/core/reauth";
import { currentAccessTokenClaims, requestFingerprint, staffForMutation, verifyStepUpTotp } from "@/lib/auth/dal";
import { limited } from "@/lib/auth/flows";
import { californiaDate, can } from "@/lib/auth/policy";
import type { StaffPrincipal } from "@/lib/auth/types";
import { getApprovalService, reauthStore } from "@/lib/approvals/server";
import { ApprovalNotFoundError } from "@/lib/approvals/service";
import type { ApprovalRecord } from "@/lib/approvals/types";

// Approve / reject from the queue. Each action re-authenticates the caller,
// re-checks the capability (a currently licensed broker approves) and lets
// the approval service enforce the lifecycle: a request that expired while
// the page was open is reported as expired and never sends.
//
// Sensitive approvals (MLDS, Form 159, lender submissions, fee quotes; see
// requiresReauthentication) need a step-up: the broker enters a fresh
// authenticator code (or has verified a second factor within the last few
// minutes, per the access token's amr claim) and a proof is written to
// approval_reauthentications BEFORE approving. The approval service refuses to
// approve, and the gate refuses to send, without that proof.

export type DecisionState = { ok?: boolean; message?: string };

const decisionSchema = z.object({
  id: z.uuid(),
  decision: z.enum(["approve", "reject"]),
  reason: z.string().trim().max(1000).optional(),
  totp: z
    .string()
    .trim()
    .regex(/^\d{6}$/)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

const MIN = 60_000;

type StepUpOutcome = { ok: true; method: ReauthMethod } | { ok: false; message: string };

/** Verifies a fresh second factor and records the step-up proof for `record`. */
async function stepUp(record: ApprovalRecord, principal: StaffPrincipal, code: string | undefined): Promise<StepUpOutcome> {
  if (await limited(`approvals:step-up:${principal.userId}`, 6, 5 * MIN)) return { ok: false, message: "Too many attempts. Wait a few minutes and try again." };
  let factor: { method: ReauthMethod; verifiedAt: Date; sessionRef: string | null } | null = null;
  if (code) {
    const v = await verifyStepUpTotp(code);
    if (!v.ok) {
      const messages = {
        signed_out: "Your session ended. Sign in again.",
        no_factor: "Set up an authenticator app before approving this request.",
        invalid_code: "That authenticator code did not match. Try the newest code.",
      } as const;
      return { ok: false, message: messages[v.reason] };
    }
    factor = { method: "totp", verifiedAt: v.verifiedAt, sessionRef: v.sessionRef };
  } else {
    // A second factor verified with the identity provider moments ago counts too.
    const amr = freshFactorFromAmr((await currentAccessTokenClaims()) ?? {});
    if (amr && Date.now() - amr.verifiedAt.getTime() <= REAUTH_MAX_AGE_MS) factor = amr;
  }
  if (!factor) return { ok: false, message: "This request sends a sensitive document. Enter the current code from your authenticator app to approve it." };
  try {
    const fp = await requestFingerprint();
    await new ReauthService(reauthStore()).record({
      approval: record,
      user: { userId: principal.userId, dreLicense: principal.profile.dreLicenseNumber },
      factor,
      ipHash: fp.ipHash ?? null,
      userAgent: fp.userAgent ?? null,
    });
  } catch (err) {
    if (err instanceof ReauthError) {
      const messages: Record<ReauthError["code"], string> = {
        not_required: "This request does not need re-authentication.",
        not_pending_or_approved: "This request was already decided.",
        invalid_user: "Your DRE license number is missing from your profile.",
        stale_factor: "Your verification is too old. Enter the current authenticator code.",
        future_factor: "Your verification time could not be read. Enter the current authenticator code.",
        wrong_approver: "Only the approving broker can confirm this send.",
      };
      return { ok: false, message: messages[err.code] };
    }
    throw err;
  }
  return { ok: true, method: factor.method };
}

export async function decideApprovalAction(_prev: DecisionState, formData: FormData): Promise<DecisionState> {
  const auth = await staffForMutation();
  if (!auth.ok) return { ok: false, message: auth.reason === "mfa_required" ? "Confirm two-step verification, then try again." : "Your session ended. Sign in again." };
  const parsed = decisionSchema.safeParse({ id: formData.get("id"), decision: formData.get("decision"), reason: formData.get("reason") ?? undefined, totp: formData.get("totp") ?? undefined });
  if (!parsed.success) return { ok: false, message: parsed.error.issues.some((i) => i.path[0] === "totp") ? "Enter the 6-digit code from your authenticator app." : "That request could not be read. Reload the page and try again." };
  const { id, decision, reason, totp } = parsed.data;
  const { principal, services } = auth.ctx;

  const check = can(principal, decision === "approve" ? "approve" : "reject", californiaDate(new Date()));
  if (!check.ok) return { ok: false, message: check.reason };
  if (decision === "reject" && !reason) return { ok: false, message: "Add a short reason so the requester knows what to change." };

  const service = await getApprovalService();
  if (!service) return { ok: false, message: "The approval queue is not configured." };

  const approver = { userId: principal.userId, label: principal.displayName, dreLicense: principal.profile.dreLicenseNumber };
  let reauthMethod: ReauthMethod | null = null;
  if (decision === "approve") {
    const record = await service.get(id);
    if (!record) return { ok: false, message: "That request no longer exists." };
    if (record.status === "pending" && requiresReauthentication(record)) {
      const stepped = await stepUp(record, principal, totp);
      if (!stepped.ok) return { ok: false, message: stepped.message };
      reauthMethod = stepped.method;
    }
  }
  let result;
  try {
    result = decision === "approve" ? await service.approve(id, approver) : await service.reject(id, approver, reason ?? "");
  } catch (err) {
    if (err instanceof ApprovalNotFoundError) return { ok: false, message: "That request no longer exists." };
    throw err;
  }

  if (!result.ok) {
    refresh();
    const messages: Record<typeof result.reason, string> = {
      expired: "This request expired before it was decided. It will not be sent; the requester has to ask again.",
      already_decided: `This request was already ${result.record.status}.`,
      invalid_approver: "Your DRE license number is missing from your profile.",
      reason_required: "Add a short reason so the requester knows what to change.",
      reauth_required: "This request sends a sensitive document. Enter the current code from your authenticator app to approve it.",
    };
    return { ok: false, message: messages[result.reason] };
  }

  // The approval row itself records who decided, when, and the license used;
  // the audit trail adds the request fingerprint.
  try {
    await services.audit.record({
      actorId: principal.userId,
      actorLabel: principal.displayName,
      action: decision === "approve" ? "approval.approve" : "approval.reject",
      targetType: "approval",
      targetId: id,
      detail: { kind: result.record.kind, idempotencyKey: result.record.idempotencyKey, dealId: result.record.dealId, reason: reason ?? null, reauth: reauthMethod },
      ...(await requestFingerprint()),
    });
  } catch (err) {
    console.error("[approvals] audit write failed after decision", id, err instanceof Error ? err.message : err);
  }
  // The card leaves the queue, so the confirmation lives on the page itself.
  redirect(`/approvals?decided=${id}`);
}

export async function sweepExpiredAction(): Promise<DecisionState> {
  const auth = await staffForMutation();
  if (!auth.ok) return { ok: false, message: "Your session ended. Sign in again." };
  const check = can(auth.ctx.principal, "cancel_approval", californiaDate(new Date()));
  if (!check.ok) return { ok: false, message: check.reason };
  const service = await getApprovalService();
  if (!service) return { ok: false, message: "The approval queue is not configured." };
  const expired = await service.expireDue();
  for (const r of expired) {
    try {
      await auth.ctx.services.audit.record({
        actorId: auth.ctx.principal.userId,
        actorLabel: auth.ctx.principal.displayName,
        action: "approval.expire",
        targetType: "approval",
        targetId: r.id,
        detail: { kind: r.kind, idempotencyKey: r.idempotencyKey },
      });
    } catch (err) {
      console.error("[approvals] audit write failed for expiry", r.id, err instanceof Error ? err.message : err);
    }
  }
  refresh();
  return { ok: true, message: expired.length === 0 ? "Nothing was overdue." : `${expired.length} overdue ${expired.length === 1 ? "request" : "requests"} expired. None will be sent.` };
}
