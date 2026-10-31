import { handleLeadConfirmation } from "@/lib/notify/handlers";
import { notifyRuntime } from "@/lib/notify/runtime";

export const maxDuration = 30;

// Internal: POST { leadId } with `Authorization: Bearer $NOTIFY_INTERNAL_SECRET`.
// Sends the lead confirmation email (once per lead).
export async function POST(req: Request) {
  const rt = notifyRuntime();
  return handleLeadConfirmation(req, { notifier: rt.notifier, leads: rt.leads, staff: rt.staff });
}
