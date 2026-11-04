// Adapter from the approval queue to the ApprovalGate contract in
// lib/compliance/approval-gate.ts, so existing callers (disclosures, e-sign)
// switch from the closed gate to the real queue without code changes.
//
// "approved" is handed out once per approval by request(): the adapter claims
// the execution as it answers, and any later request for the same key gets a
// non-sending answer. That is what makes a duplicate request send once.
// peek() answers the same question without claiming, for callers that cannot
// send right now (no mailer configured) and must not use the approval up.

import type { ApprovalDecision, ApprovalGate, OutboundAction } from "@/lib/compliance/approval-gate";
import type { ApprovalService } from "./service";
import type { ApprovalRecord } from "./types";

export function queueApprovalGate(service: ApprovalService, opts: { ttlMinutes?: number } = {}): ApprovalGate {
  async function lookup(action: OutboundAction): Promise<ApprovalRecord> {
    const { record } = await service.request({
      kind: action.kind,
      idempotencyKey: action.idempotencyKey,
      summary: action.summary,
      templateId: action.templateId,
      // Callers rendering a pre-approved template put its body hash in the payload.
      templateBodySha256: typeof action.payload.templateBodySha256 === "string" ? action.payload.templateBodySha256 : undefined,
      payload: action.payload,
      requestedBy: action.requestedBy,
      ttlMinutes: opts.ttlMinutes,
    });
    return record;
  }

  return {
    async request(action: OutboundAction): Promise<ApprovalDecision> {
      const record = await lookup(action);
      if (record.status !== "approved") return notApproved(record);
      // A sensitive send (MLDS, Form 159, lender submission, fee quote) needs the
      // approving broker's step-up proof; without it nothing is claimed or sent.
      if (!(await service.reauthCheck(record)).ok) return { status: "pending", approvalId: record.id, reason: "reauth_required" };
      const claimed = await service.claimExecution(record.id);
      if (!claimed) return { status: "rejected", approvalId: record.id, decidedBy: "system", reason: "already_executed" };
      return approved(record);
    },
    async peek(action: OutboundAction): Promise<ApprovalDecision> {
      const record = await lookup(action);
      if (record.status !== "approved") return notApproved(record);
      if (!(await service.reauthCheck(record)).ok) return { status: "pending", approvalId: record.id, reason: "reauth_required" };
      return { ...approved(record), ...(record.executedAt ? { executedAt: new Date(record.executedAt) } : {}) };
    },
  };
}

function approved(record: ApprovalRecord): Extract<ApprovalDecision, { status: "approved" }> {
  return { status: "approved", approvalId: record.id, decidedBy: record.decidedByLabel ?? "broker", decidedAt: new Date(record.decidedAt ?? record.createdAt) };
}

function notApproved(record: ApprovalRecord): ApprovalDecision {
  switch (record.status) {
    case "expired":
      return { status: "expired", approvalId: record.id };
    case "rejected":
    case "cancelled":
      return { status: "rejected", approvalId: record.id, decidedBy: record.decidedByLabel ?? "broker", reason: record.decisionReason ?? record.status };
    default:
      return { status: "pending", approvalId: record.id };
  }
}
