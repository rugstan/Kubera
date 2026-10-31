import { handleStageEvent } from "@/lib/notify/handlers";
import { notifyRuntime } from "@/lib/notify/runtime";

export const maxDuration = 30;

// Internal: POST { eventId, stage, previousStage?, leadId?, dealId?, contact? }
// with `Authorization: Bearer $NOTIFY_INTERNAL_SECRET`. Sends the consent-gated
// milestone email and text for the stage (see lib/notify/stage-events.ts).
export async function POST(req: Request) {
  const rt = notifyRuntime();
  return handleStageEvent(req, { notifier: rt.notifier, leads: rt.leads, staff: rt.staff });
}
