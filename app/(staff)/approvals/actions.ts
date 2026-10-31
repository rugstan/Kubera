"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requestFingerprint, staffForMutation } from "@/lib/auth/dal";
import { californiaDate, can } from "@/lib/auth/policy";
import { getApprovalService } from "@/lib/approvals/server";
import { ApprovalNotFoundError } from "@/lib/approvals/service";

// Approve / reject from the queue. Each action re-authenticates the caller,
// re-checks the capability (a currently licensed broker approves) and lets
// the approval service enforce the lifecycle: a request that expired while
// the page was open is reported as expired and never sends.

export type DecisionState = { ok?: boolean; message?: string };

const decisionSchema = z.object({
  id: z.uuid(),
  decision: z.enum(["approve", "reject"]),
  reason: z.string().trim().max(1000).optional(),
});

export async function decideApprovalAction(_prev: DecisionState, formData: FormData): Promise<DecisionState> {
  const auth = await staffForMutation();
  if (!auth.ok) return { ok: false, message: auth.reason === "mfa_required" ? "Confirm two-step verification, then try again." : "Your session ended. Sign in again." };
  const parsed = decisionSchema.safeParse({ id: formData.get("id"), decision: formData.get("decision"), reason: formData.get("reason") ?? undefined });
  if (!parsed.success) return { ok: false, message: "That request could not be read. Reload the page and try again." };
  const { id, decision, reason } = parsed.data;
  const { principal, services } = auth.ctx;

  const check = can(principal, decision === "approve" ? "approve" : "reject", californiaDate(new Date()));
  if (!check.ok) return { ok: false, message: check.reason };
  if (decision === "reject" && !reason) return { ok: false, message: "Add a short reason so the requester knows what to change." };

  const service = await getApprovalService();
  if (!service) return { ok: false, message: "The approval queue is not configured." };

  const approver = { userId: principal.userId, label: principal.displayName, dreLicense: principal.profile.dreLicenseNumber };
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
      detail: { kind: result.record.kind, idempotencyKey: result.record.idempotencyKey, dealId: result.record.dealId, reason: reason ?? null },
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
