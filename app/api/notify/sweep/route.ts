import { handleSweep } from "@/lib/notify/handlers";
import { notifyRuntime } from "@/lib/notify/runtime";

export const maxDuration = 60;

// Cron backstop (every minute; vercel.json is a cross-request): alerts any
// Tier-1 lead from the last 30 minutes that the in-request trigger missed.
// `Authorization: Bearer $CRON_SECRET`.
export async function GET(req: Request) {
  const rt = notifyRuntime();
  return handleSweep(req, { notifier: rt.notifier, leads: rt.leads, staff: rt.staff });
}
