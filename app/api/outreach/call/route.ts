import { handleCallRequest } from "@/lib/agents/outreach/handlers";
import { outreachRuntime } from "@/lib/agents/outreach/runtime";

// Staff-initiated call request, called server-side by the staff app.
// `Authorization: Bearer $NOTIFY_INTERNAL_SECRET`. Returns 503 when voice is not configured.
export async function POST(req: Request) {
  return handleCallRequest(req, { voice: outreachRuntime().voice });
}
