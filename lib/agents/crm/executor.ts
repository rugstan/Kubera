// Runs a CRM change after a broker approves it. Two adapters over
// CrmAgentWriter.executeApproval:
//
//   crmApprovalExecutor   an ApprovalExecutor (lib/approvals/executors.ts): runs
//                         as soon as a broker approves, through executeOnce, so a
//                         decision executes at most once
//   crmOutboundExecutor   an OutboundExecutor (lib/workflows) for a workflow that
//                         waits on the approval itself
//
// Only approvals the CRM agent itself requested match: kind crm_update, a
// requester starting `agent:crm`, and a payload that validates as a CRM agent
// payload. Anything else (including other crm_update approvals) is left alone.

import type { OutboundAction } from "@/lib/compliance/approval-gate";
import type { ApprovalExecutor } from "@/lib/approvals/executors";
import type { ApprovalRecord } from "@/lib/approvals/types";
import type { OutboundExecutor } from "@/lib/workflows/deps";
import { approvalPayloadSchema } from "./operations";
import type { CrmAgentWriter } from "./writer";

export function isCrmAgentApproval(record: Pick<ApprovalRecord, "kind" | "requestedBy" | "payload">): boolean {
  return record.kind === "crm_update" && record.requestedBy.startsWith("agent:crm") && approvalPayloadSchema.safeParse(record.payload).success;
}

export function crmApprovalExecutor(writer: CrmAgentWriter): ApprovalExecutor {
  return {
    name: "crm_agent",
    matches: isCrmAgentApproval,
    async run(record) {
      const out = await writer.executeApproval(record);
      switch (out.status) {
        case "executed":
          return `crm:${out.ref ?? "done"}`.slice(0, 300);
        case "skipped":
          return `skipped:${out.reason}`.slice(0, 300);
        case "logged_only":
          return "audit_only";
        case "failed":
          // executeApproved logs the failure; a failed change needs a new request.
          throw new Error(out.error);
        default:
          throw new Error(`CRM change not applied (${out.status}${"reason" in out ? `: ${out.reason}` : ""})`);
      }
    },
  };
}

export function crmOutboundExecutor(writer: CrmAgentWriter): OutboundExecutor {
  return async (action: OutboundAction, approval) => {
    const out = await writer.executeApproval({ id: approval.approvalId, idempotencyKey: action.idempotencyKey, status: "approved", payload: action.payload, decidedByLabel: approval.decidedBy });
    if (out.status === "failed") throw new Error(out.error);
    return { status: out.status, ...("ref" in out && out.ref ? { ref: out.ref } : {}), ...("reason" in out ? { reason: out.reason } : {}) };
  };
}
