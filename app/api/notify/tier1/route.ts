import { handleTier1 } from "@/lib/notify/handlers";
import { notifyRuntime } from "@/lib/notify/runtime";

export const maxDuration = 30;

// Internal: POST { leadId } with `Authorization: Bearer $NOTIFY_INTERNAL_SECRET`.
// Texts the brokers (pre-approved template) when the lead is Tier 1. Called by
// the qualifier route right after it stores the lead; /api/notify/sweep is the
// backstop.
export async function POST(req: Request) {
  const rt = notifyRuntime();
  return handleTier1(req, { notifier: rt.notifier, leads: rt.leads, staff: rt.staff });
}
