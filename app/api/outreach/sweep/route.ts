import { handleSweep } from "@/lib/agents/outreach/handlers";
import { outreachRuntime } from "@/lib/agents/outreach/runtime";

export const maxDuration = 60;

// Cron (every 5 minutes, vercel.json): runs every chaser once and backstops
// missed Tier-1/2 speed-to-lead replies. `Authorization: Bearer $CRON_SECRET`.
export async function GET(req: Request) {
  return handleSweep(req, outreachRuntime());
}
