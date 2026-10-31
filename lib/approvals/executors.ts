// Runs the outbound action behind an approval as soon as a broker approves it,
// for approvals whose requester does not wait on a workflow (e.g. the
// borrower-portal invitation email). Each executor runs through
// ApprovalService.executeOnce: only for an approved, never-executed approval,
// and at most once. A failing executor is logged; it never breaks the decision.

import type { ApprovalService } from "./service";
import type { ApprovalRecord } from "./types";

export type ApprovalExecutor = {
  name: string;
  matches(record: ApprovalRecord): boolean;
  run(record: ApprovalRecord): Promise<string | void>;
};

export type ExecutedApproval = { approvalId: string; executor: string; status: "executed" | "not_approved" | "already_executed" | "failed"; ref?: string };

export async function executeApproved(service: Pick<ApprovalService, "executeOnce">, records: readonly ApprovalRecord[], executors: readonly ApprovalExecutor[]): Promise<ExecutedApproval[]> {
  const out: ExecutedApproval[] = [];
  for (const record of records) {
    if (record.status !== "approved" || record.executedAt) continue;
    const executor = executors.find((e) => e.matches(record));
    if (!executor) continue;
    try {
      const r = await service.executeOnce(record.id, (claimed) => executor.run(claimed));
      out.push({ approvalId: record.id, executor: executor.name, status: r.status, ...(r.status === "executed" && r.executionRef ? { ref: r.executionRef } : {}) });
    } catch (err) {
      console.error(`[approvals] ${executor.name} failed for ${record.id}:`, err instanceof Error ? err.message : err);
      out.push({ approvalId: record.id, executor: executor.name, status: "failed" });
    }
  }
  return out;
}
