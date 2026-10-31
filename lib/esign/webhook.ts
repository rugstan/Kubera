// Provider-agnostic webhook handler. The route file only wires real
// dependencies; tests drive this function with the fake provider and the
// in-memory store.
//
// Order matters: verify the signature over the raw body before parsing it,
// and answer 5xx only for conditions a retry can fix (storage outage), so the
// provider redelivers; everything else is acknowledged.

import type { DealRecordSink } from "@/lib/disclosures/deal-record";
import { applyEsignEvent, type Clock } from "@/lib/disclosures/service";
import type { DisclosureStore, DocumentStorage } from "@/lib/disclosures/store";
import type { EsignEvent, EsignProvider } from "./types";

export const MAX_WEBHOOK_BYTES = 256 * 1024;

export type WebhookDeps = {
  provider: EsignProvider | null;
  /** False when the provider is configured but its webhook secret is not. */
  secretConfigured: boolean;
  backends: { store: DisclosureStore; storage: DocumentStorage } | null;
  deal?: DealRecordSink;
  /**
   * Requests that are not disclosures (e.g. SBA Form 159 on the deal desk).
   * Returns true when it recognised and recorded the event.
   */
  otherRequest?: (event: EsignEvent) => Promise<boolean>;
  now: Clock;
};

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function handleEsignWebhook(req: Request, deps: WebhookDeps): Promise<Response> {
  if (!deps.provider || !deps.secretConfigured) return json({ error: "E-sign webhook not configured" }, 503);

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_WEBHOOK_BYTES) return json({ error: "Payload too large" }, 413);
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_WEBHOOK_BYTES) return json({ error: "Payload too large" }, 413);

  if (!deps.provider.verifyWebhook(raw, req.headers)) return json({ error: "Invalid signature" }, 401);

  const event = deps.provider.parseWebhook(raw);
  if (!event) return json({ ok: true, ignored: true });

  if (!deps.backends) {
    console.error("[esign] webhook received but Supabase is not configured; asking the provider to retry");
    return json({ error: "Storage unavailable" }, 503);
  }

  try {
    const result = await applyEsignEvent({ ...deps.backends, provider: deps.provider, deal: deps.deal, now: deps.now }, event);
    if (result.outcome === "unknown_request") {
      if (deps.otherRequest && (await deps.otherRequest(event))) return json({ ok: true, outcome: "other_request" });
      console.warn(`[esign] webhook for unknown request ${event.requestId} (${event.providerType})`);
    }
    return json({ ok: true, outcome: result.outcome });
  } catch (err) {
    console.error("[esign] webhook processing failed", err instanceof Error ? err.message : err);
    return json({ error: "Processing failed" }, 500);
  }
}
