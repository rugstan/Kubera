import { handleSpeedToLead } from "@/lib/agents/outreach/handlers";
import { outreachRuntime } from "@/lib/agents/outreach/runtime";

export const maxDuration = 60;

// Speed-to-lead reply for a stored, scored lead. Internal only:
// `Authorization: Bearer $NOTIFY_INTERNAL_SECRET`, body `{ leadId }`.
export async function POST(req: Request) {
  const rt = outreachRuntime();
  return handleSpeedToLead(req, { ...rt, sources: rt.sources });
}
