import { z } from "zod";
import type { ConsentLedger } from "@/lib/consent/ledger";
import { consentState, recordSmsConsent, type ConsentReader } from "../consent";
import { maskPhone, toE164 } from "../phone";
import type { Notifier } from "../service";
import type { NotifyStore, SmsRow } from "../store";
import type { SmsOptOutSink } from "../optout";
import type { OptOutSyncQueue } from "../optout-sync";
import { classifyInbound } from "./keywords";
import { verifyTelnyxSignature } from "./signature";

// Telnyx webhook handler. The route file (app/api/webhooks/telnyx/route.ts)
// only wires real dependencies; tests drive this function with fakes.
//
// Order matters: verify the Ed25519 signature over the raw body before parsing
// it; answer 5xx only for failures a retry can fix (ledger or database), so
// Telnyx redelivers; acknowledge everything else.
//
//   message.received            inbound text: STOP / HELP / START or a plain reply
//   message.sent / .finalized   delivery status for texts we sent

export const MAX_TELNYX_WEBHOOK_BYTES = 256 * 1024;

export type TelnyxWebhookDeps = {
  /** TELNYX_PUBLIC_KEY (base64, 32 bytes). Unset means the endpoint is not configured. */
  publicKey: string | undefined;
  store: NotifyStore;
  notifier: Notifier;
  ledger: ConsentLedger;
  consent: ConsentReader;
  /** Mirrors opt-outs into Twenty `smsOptOut`; null when Twenty is not configured. */
  optOut: SmsOptOutSink | null;
  /** Opt-outs that did not reach Twenty wait here for the crm-retry cron (crm_optout_sync). */
  optOutSync?: OptOutSyncQueue | null;
  /** Staff who get an email for inbound replies that are not keywords. */
  staffEmails: readonly string[];
  now: () => Date;
};

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

const phoneField = z.object({ phone_number: z.string().optional(), status: z.string().optional() }).passthrough();

const eventSchema = z
  .object({
    data: z
      .object({
        id: z.string().optional(),
        event_type: z.string(),
        occurred_at: z.string().optional(),
        payload: z
          .object({
            id: z.string().optional(),
            direction: z.string().optional(),
            text: z.string().nullish(),
            from: phoneField.optional(),
            to: z.array(phoneField).optional(),
            errors: z.array(z.object({ code: z.union([z.string(), z.number()]).optional(), detail: z.string().optional(), title: z.string().optional() }).passthrough()).optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

export async function handleTelnyxWebhook(req: Request, deps: TelnyxWebhookDeps): Promise<Response> {
  if (!deps.publicKey) return json({ error: "Telnyx webhook not configured" }, 503);

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_TELNYX_WEBHOOK_BYTES) return json({ error: "Payload too large" }, 413);
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_TELNYX_WEBHOOK_BYTES) return json({ error: "Payload too large" }, 413);

  const valid = verifyTelnyxSignature({
    publicKeyBase64: deps.publicKey,
    signatureBase64: req.headers.get("telnyx-signature-ed25519"),
    timestamp: req.headers.get("telnyx-timestamp"),
    rawBody: raw,
    now: deps.now(),
  });
  if (!valid) return json({ error: "Invalid signature" }, 401);

  let parsed: z.infer<typeof eventSchema>;
  try {
    parsed = eventSchema.parse(JSON.parse(raw));
  } catch {
    // Signed but not an event we understand: acknowledge so it is not retried forever.
    return json({ ok: true, ignored: true });
  }

  const eventType = parsed.data.event_type;
  try {
    if (eventType === "message.received") return json({ ok: true, ...(await handleInbound(parsed, deps)) });
    if (eventType === "message.sent" || eventType === "message.finalized") return json({ ok: true, ...(await handleStatus(parsed, deps)) });
    return json({ ok: true, ignored: eventType });
  } catch (err) {
    console.error(`[telnyx] webhook ${eventType} failed`, err instanceof Error ? err.message : err);
    return json({ error: "Processing failed" }, 500);
  }
}

type Parsed = z.infer<typeof eventSchema>;

async function handleInbound(event: Parsed, deps: TelnyxWebhookDeps): Promise<Record<string, unknown>> {
  const payload = event.data.payload;
  if (!payload || (payload.direction && payload.direction !== "inbound")) return { ignored: "not inbound" };
  const from = toE164(payload.from?.phone_number);
  const to = toE164(payload.to?.[0]?.phone_number) ?? payload.to?.[0]?.phone_number ?? "unknown";
  if (!from) return { ignored: "no sender" };

  const text = (payload.text ?? "").trim();
  const { keyword, embeddedRevocation } = classifyInbound(text);
  const providerMessageId = payload.id ?? event.data.id ?? null;

  const { row, fresh } = await deps.store.recordSms({
    direction: "inbound",
    fromNumber: from,
    toNumber: to,
    body: text.slice(0, 4000),
    status: "received",
    providerMessageId,
    keyword,
  });
  // A redelivered event whose effects are already done is acknowledged without repeating them.
  if (!fresh && row.processedAt) return { duplicate: true };

  const now = deps.now();
  let optOutNote: string | null = null;

  if (keyword === "stop") {
    const state = consentState(await deps.consent.history("sms", { phone: from }), "sms");
    // The ledger row is the evidence and the gate for every later send: if it cannot be written, fail so Telnyx retries.
    await recordSmsConsent(deps.ledger, "revoked", { phone: from, leadId: state.leadId, partnerId: state.partnerId, now, source: providerMessageId ?? row.id });
    optOutNote = await mirrorOptOut(deps, from, true, row.id);
    await reply(deps, row, "sms_stop_reply", from, state.leadId ?? null);
    // A revocation inside a longer message ("Please stop texting me", "cancel the appraisal") is honored
    // first; staff still get the text so they can follow up on anything else it says.
    if (embeddedRevocation) await alertStaff(deps, row, from, text, { revoked: true });
  } else if (keyword === "help") {
    await reply(deps, row, "sms_help_reply", from, null);
  } else if (keyword === "start") {
    const state = consentState(await deps.consent.history("sms", { phone: from }), "sms");
    // START only restores texting for someone who opted out. It never creates consent for a stranger.
    if (state.state === "revoked") {
      await recordSmsConsent(deps.ledger, "granted", { phone: from, leadId: state.leadId, partnerId: state.partnerId, now, source: providerMessageId ?? row.id });
      optOutNote = await mirrorOptOut(deps, from, false, row.id);
      await reply(deps, row, "sms_start_reply", from, state.leadId ?? null);
    }
  } else if (text) {
    await alertStaff(deps, row, from, text);
  }

  await deps.store.updateSms(row.id, { keyword, processedAt: now.toISOString(), ...(optOutNote ? { error: optOutNote } : {}) });
  return { keyword };
}

/**
 * Mirrors the change into Twenty. When that fails, or no Twenty person has the
 * number yet (the lead push may still be queued), the change is queued for the
 * crm-retry cron and noted on the row; the ledger already holds the opt-out.
 * A queue write failure throws, so Telnyx redelivers and the change is not lost.
 */
async function mirrorOptOut(deps: TelnyxWebhookDeps, phone: string, optOut: boolean, smsMessageId: string): Promise<string | null> {
  const now = deps.now();
  let note: string;
  if (!deps.optOut) note = "Twenty not configured; opt-out recorded in the consent ledger and queued for CRM sync";
  else {
    try {
      const { updated } = await deps.optOut.setOptOut(phone, optOut);
      if (updated > 0) {
        await deps.optOutSync?.settle(phone, optOut, now);
        return null;
      }
      note = "No Twenty person has this number yet; CRM sync queued for retry";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[telnyx] could not mirror smsOptOut=${optOut} to Twenty for ${maskPhone(phone)}`, message);
      note = `Twenty sync failed (queued for retry): ${message}`;
    }
  }
  note = note.slice(0, 300);
  if (deps.optOutSync) await deps.optOutSync.enqueue({ phone, optOut, reason: note, smsMessageId, at: now });
  else console.warn(`[telnyx] smsOptOut=${optOut} for ${maskPhone(phone)} not in Twenty and no retry queue is configured`);
  return note;
}

async function reply(deps: TelnyxWebhookDeps, row: SmsRow, templateId: "sms_stop_reply" | "sms_help_reply" | "sms_start_reply", phone: string, leadId: string | null) {
  const outcome = await deps.notifier.send({
    templateId,
    to: { audience: "borrower", phone },
    data: {},
    idempotencyKey: `sms-keyword-reply:${row.id}`,
    leadId,
  });
  if (outcome.status !== "sent" && outcome.status !== "duplicate" && outcome.status !== "skipped_unconfigured") {
    console.error(`[telnyx] keyword reply ${templateId} to ${maskPhone(phone)} not sent: ${outcome.status} ${outcome.reason ?? ""}`);
  }
}

async function alertStaff(deps: TelnyxWebhookDeps, row: SmsRow, from: string, text: string, opts: { revoked?: boolean } = {}) {
  const guidance = opts.revoked
    ? "This text was treated as a revocation of text consent (FCC revocation rule): texts to this number are stopped. Follow up on anything else it asks by email or phone, not by text."
    : "Reply from the CRM or the sending number's inbox. Do not reply by text unless the sender has text consent on file.";
  for (const email of deps.staffEmails) {
    await deps.notifier
      .send({
        templateId: "staff_alert",
        to: { audience: "staff", email },
        data: { title: opts.revoked ? "Inbound text: consent revoked" : "Inbound text message", lines: [`From ${from}`, text.slice(0, 400), guidance] },
        idempotencyKey: `sms-inbound:${row.id}:${email}`,
      })
      .catch((err) => console.error("[telnyx] inbound staff alert failed", err instanceof Error ? err.message : err));
  }
}

async function handleStatus(event: Parsed, deps: TelnyxWebhookDeps): Promise<Record<string, unknown>> {
  const payload = event.data.payload;
  const id = payload?.id;
  if (!payload || !id) return { ignored: "no message id" };
  const recipientStatus = payload.to?.[0]?.status?.toLowerCase();
  const at = event.data.occurred_at ? new Date(event.data.occurred_at) : deps.now();
  const when = Number.isNaN(at.getTime()) ? deps.now() : at;

  let status: "sent" | "delivered" | "failed" | null = null;
  if (event.data.event_type === "message.sent") status = "sent";
  else if (recipientStatus === "delivered") status = "delivered";
  else if (recipientStatus === "delivery_failed" || recipientStatus === "sending_failed") status = "failed";
  // delivery_unconfirmed and the like stay "sent": carriers did not confirm either way.
  if (!status) return { ignored: `status ${recipientStatus ?? "unknown"}` };

  const detail = payload.errors?.[0]?.detail ?? payload.errors?.[0]?.title ?? null;
  const applied = await deps.store.applyDelivery(id, status, when, detail);
  return { status, ...applied };
}
