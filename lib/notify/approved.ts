// Sending notifications a broker approved in /approvals.
//
// A template that is not pre-approved is held at the Notifier's approval step
// (status pending_approval) and filed in the approvals queue under
// `notify:<idempotency key>`. Nothing that triggered it (a stage event, a
// document request) calls again, so the approval itself must cause the send:
//
//   - notifyApprovalExecutor: registered in approvalExecutors()
//     (lib/approvals/executors-server.ts). When a broker approves, the queue
//     claims the approval once (ApprovalService.executeOnce) and this sends the
//     held message through Notifier.sendApproved.
//   - resumeApprovedNotifications: the backstop, run by /api/notify/sweep. It
//     sends held rows whose approval was approved but never executed (the
//     executor did not run), finishes rows the executor claimed but had to stop
//     (deferred to the texting window), and closes rows whose approval expired
//     or was rejected so they stop showing as waiting.

import type { ApprovalService } from "@/lib/approvals/service";
import type { ApprovalRecord } from "@/lib/approvals/types";
import { insideSmsWindow } from "./quiet-hours";
import { claimedApprovalId, isNotifyApproval, notifyApprovalKey, type Notifier } from "./service";
import type { NotifyStore } from "./store";
import type { SendOutcome } from "./types";

/** Execution reference recorded on the approval for a notification send. */
export function notifyExecutionRef(outcome: SendOutcome): string {
  return `notify:${outcome.status}${outcome.notificationId ? `:${outcome.notificationId}` : ""}`;
}

/** The approval executor for held notifications: sends under the claimed approval and returns the execution reference. */
export function notifyApprovalExecutor(notifier: () => Pick<Notifier, "sendApproved">): (record: ApprovalRecord) => Promise<string> {
  return async (record) => notifyExecutionRef(await notifier().sendApproved(record));
}

export { isNotifyApproval };

export type ResumeDeps = {
  store: NotifyStore;
  notifier: Pick<Notifier, "sendApproved">;
  approvals: Pick<ApprovalService, "get" | "executeOnce">;
  now?: () => Date;
};

export type ResumeSummary = { checked: number; sent: number; deferred: number; closed: number; other: number };

/** Held rows older than the longest approval TTL (30 days) cannot still be waiting. */
const LOOKBACK_MS = 31 * 24 * 3_600_000;
const BATCH = 200;

export async function resumeApprovedNotifications(deps: ResumeDeps): Promise<ResumeSummary> {
  const now = deps.now ?? (() => new Date());
  const rows = await deps.store.listHeldForApproval({ since: new Date(now().getTime() - LOOKBACK_MS), limit: BATCH });
  const summary: ResumeSummary = { checked: rows.length, sent: 0, deferred: 0, closed: 0, other: 0 };
  const count = (o: SendOutcome | null) => {
    if (!o) return;
    if (o.status === "sent") summary.sent += 1;
    else if (o.status === "deferred_quiet_hours") summary.deferred += 1;
    else summary.other += 1;
  };

  for (const row of rows) {
    try {
      if (!row.approvalId) continue;
      // A deferred text cannot go out before the window opens; skip the work until then.
      if (row.status === "deferred_quiet_hours" && !insideSmsWindow(now())) continue;
      const approval = await deps.approvals.get(row.approvalId);
      if (!approval || !isNotifyApproval(approval) || approval.idempotencyKey !== notifyApprovalKey(row.idempotencyKey)) continue;

      if (approval.status === "approved" && !approval.executedAt) {
        // Approved, but no executor ran: claim it once and send.
        let outcome: SendOutcome | null = null;
        await deps.approvals.executeOnce(approval.id, async (claimed) => {
          outcome = await deps.notifier.sendApproved(claimed);
          return notifyExecutionRef(outcome);
        });
        count(outcome);
      } else if (approval.status === "approved" && approval.executedAt) {
        // Claimed for this row and then stopped (deferred), or the executor
        // failed before it touched the row (still pending_approval). Any other
        // claim moves the row out of these statuses, so this cannot double-send.
        if (row.status === "pending_approval" || claimedApprovalId(row) === approval.id) count(await deps.notifier.sendApproved(approval));
      } else if (row.status === "pending_approval" && (approval.status === "expired" || approval.status === "rejected" || approval.status === "cancelled")) {
        const status = approval.status === "expired" ? "expired" : "rejected";
        await deps.store.update(row.id, { status, error: `approval ${approval.status}` });
        summary.closed += 1;
      }
    } catch (err) {
      summary.other += 1;
      console.error(`notify: could not resume held notification ${row.id}`, err instanceof Error ? err.message : err);
    }
  }
  return summary;
}
