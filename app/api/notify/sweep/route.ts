import { getApprovalService } from "@/lib/approvals/server";
import { resumeApprovedNotifications } from "@/lib/notify/approved";
import { handleSweep } from "@/lib/notify/handlers";
import { notifyRuntime } from "@/lib/notify/runtime";

export const maxDuration = 60;

// Cron backstop (every minute; vercel.json is a cross-request): alerts any
// Tier-1 lead from the last 30 minutes that the in-request trigger missed, and
// sends held notifications a broker approved that the approval executor did not
// finish (lib/notify/approved.ts). `Authorization: Bearer $CRON_SECRET`.
export async function GET(req: Request) {
  const rt = notifyRuntime();
  return handleSweep(req, {
    notifier: rt.notifier,
    leads: rt.leads,
    staff: rt.staff,
    async resumeApproved() {
      const approvals = await getApprovalService();
      if (!approvals) return { checked: 0, sent: 0, deferred: 0, closed: 0, other: 0 };
      return resumeApprovedNotifications({ store: rt.store, notifier: rt.notifier, approvals });
    },
  });
}
