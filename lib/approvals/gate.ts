// Adapter from the approval queue to the ApprovalGate contract in
// lib/compliance/approval-gate.ts, so existing callers (disclosures, e-sign)
// switch from the closed gate to the real queue without code changes.
//
// "approved" is handed out once per approval: the adapter claims the
// execution as it answers, and any later request for the same key gets a
// non-sending answer. That is what makes a duplicate request send once.

import type { ApprovalDecision, ApprovalGate, OutboundAction } from "@/lib/compliance/approval-gate";
import type { ApprovalService } from "./service";

export function queueApprovalGate(service: ApprovalService, opts: { ttlMinutes?: number } = {}): ApprovalGate {
  return {
    async request(action: OutboundAction): Promise<ApprovalDecision> {
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
      switch (record.status) {
        case "pending":
          return { status: "pending", approvalId: record.id };
        case "expired":
          return { status: "expired", approvalId: record.id };
        case "rejected":
        case "cancelled":
          return { status: "rejected", approvalId: record.id, decidedBy: record.decidedByLabel ?? "broker", reason: record.decisionReason ?? record.status };
        case "approved": {
          const claimed = await service.claimExecution(record.id);
          if (!claimed) return { status: "rejected", approvalId: record.id, decidedBy: "system", reason: "already_executed" };
          return { status: "approved", approvalId: record.id, decidedBy: record.decidedByLabel ?? "broker", decidedAt: new Date(record.decidedAt ?? record.createdAt) };
        }
      }
    },
  };
}
