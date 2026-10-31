import { z } from "zod";
import { verifyTelnyxSignature } from "@/lib/notify/sms/signature";
import type { VoiceEvent, VoiceService } from "./service";

// Telnyx Call Control webhook. The route file (a cross-request:
// app/api/webhooks/telnyx-voice/route.ts) only wires real dependencies; tests
// drive this function with fakes. Same rules as the messaging webhook: verify
// the Ed25519 signature over the raw body before parsing; 5xx only for failures
// a retry can fix; acknowledge everything else.

export const MAX_VOICE_WEBHOOK_BYTES = 128 * 1024;

export type VoiceWebhookDeps = {
  /** TELNYX_PUBLIC_KEY (base64, 32 bytes). Unset means the endpoint is not configured. */
  publicKey: string | undefined;
  service: Pick<VoiceService, "handleEvent">;
  now: () => Date;
};

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

const eventSchema = z
  .object({
    data: z
      .object({
        event_type: z.string(),
        payload: z
          .object({
            call_control_id: z.string().optional(),
            client_state: z.string().nullish(),
            result: z.string().optional(),
            hangup_cause: z.string().optional(),
            recording_id: z.string().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

export function toVoiceEvent(parsed: z.infer<typeof eventSchema>): VoiceEvent {
  const p = parsed.data.payload;
  const result = p?.result;
  return {
    type: parsed.data.event_type,
    callControlId: p?.call_control_id ?? null,
    clientState: p?.client_state ?? null,
    machineResult: result === "human" || result === "machine" || result === "not_sure" ? result : null,
    hangupCause: p?.hangup_cause ?? null,
    recordingId: p?.recording_id ?? null,
  };
}

export async function handleVoiceWebhook(req: Request, deps: VoiceWebhookDeps): Promise<Response> {
  if (!deps.publicKey) return json({ error: "Telnyx voice webhook not configured" }, 503);

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_VOICE_WEBHOOK_BYTES) return json({ error: "Payload too large" }, 413);
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_VOICE_WEBHOOK_BYTES) return json({ error: "Payload too large" }, 413);

  const valid = verifyTelnyxSignature({
    publicKeyBase64: deps.publicKey,
    signatureBase64: req.headers.get("telnyx-signature-ed25519"),
    timestamp: req.headers.get("telnyx-timestamp"),
    rawBody: raw,
    now: deps.now(),
  });
  if (!valid) return json({ error: "Invalid signature" }, 401);

  let event: VoiceEvent;
  try {
    event = toVoiceEvent(eventSchema.parse(JSON.parse(raw)));
  } catch {
    // Signed but not an event we understand: acknowledge so it is not retried forever.
    return json({ ok: true, ignored: true });
  }
  try {
    const result = await deps.service.handleEvent(event);
    return json({ ok: true, ...result });
  } catch (err) {
    console.error(`[telnyx-voice] ${event.type} failed`, err instanceof Error ? err.message : err);
    return json({ error: "Processing failed" }, 500);
  }
}
