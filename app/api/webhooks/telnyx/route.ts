import { telnyxWebhookDeps } from "@/lib/notify/runtime";
import { handleTelnyxWebhook } from "@/lib/notify/sms/webhook";

// Telnyx Messaging webhook: Mission Control → Messaging → your messaging
// profile → Inbound / Outbound webhook URL
//   https://corincommercial.com/api/webhooks/telnyx
// Signed with Ed25519; set TELNYX_PUBLIC_KEY to the account public key.
// Turn OFF Telnyx's built-in STOP/HELP auto-replies for the profile: this
// route sends the (single) confirmation itself and records the opt-out in the
// consent ledger and Twenty `smsOptOut`.
export async function POST(req: Request) {
  return handleTelnyxWebhook(req, telnyxWebhookDeps());
}
