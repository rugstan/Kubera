import { outreachRuntime } from "@/lib/agents/outreach/runtime";
import { handleVoiceWebhook } from "@/lib/agents/outreach/voice/webhook";

const notConfigured = () => Response.json({ error: "Telnyx voice webhook not configured" }, { status: 503, headers: { "cache-control": "no-store" } });

// Telnyx Call Control webhook (Ed25519-signed with TELNYX_PUBLIC_KEY):
//   https://corincommercial.com/api/webhooks/telnyx-voice
export async function POST(req: Request) {
  const rt = outreachRuntime();
  if (!rt.voice) return notConfigured();
  return handleVoiceWebhook(req, { publicKey: rt.telnyxPublicKey, service: rt.voice, now: () => new Date() });
}
