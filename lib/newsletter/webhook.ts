import { createHmac, timingSafeEqual } from "node:crypto";
import type { NewsletterService } from "./service";

// Resend webhook (signed with Svix). A subscriber who clicks the unsubscribe
// link in a broadcast is handled by Resend; this endpoint brings that decision
// back into the consent ledger so our records and the audience agree. A spam
// complaint is treated as an unsubscribe.

export const SVIX_TOLERANCE_SECONDS = 5 * 60;

export type SvixHeaders = { id: string | null; timestamp: string | null; signature: string | null };

export function svixHeaders(headers: Headers): SvixHeaders {
  return { id: headers.get("svix-id"), timestamp: headers.get("svix-timestamp"), signature: headers.get("svix-signature") };
}

/**
 * Verifies a Svix signature: HMAC-SHA256 over `${id}.${timestamp}.${body}` with
 * the base64 key after the `whsec_` prefix, compared in constant time against
 * every space-separated `v1,<signature>` in the header. Stale timestamps are rejected.
 */
export function verifySvixSignature(secret: string, rawBody: string, headers: SvixHeaders, now: Date = new Date()): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt) || Math.abs(Math.floor(now.getTime() / 1000) - sentAt) > SVIX_TOLERANCE_SECONDS) return false;

  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`, "utf8").digest();
  for (const candidate of signature.split(" ")) {
    const [version, value] = candidate.split(",");
    if (version !== "v1" || !value) continue;
    const given = Buffer.from(value, "base64");
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
  }
  return false;
}

/** Test helper and documentation of the scheme: the header value Resend would send. */
export function signSvix(secret: string, id: string, timestamp: number, rawBody: string): string {
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`, "utf8").digest("base64")}`;
}

export type WebhookOutcome = { handled: boolean; unsubscribed: number; ignored?: string };

type ResendEvent = { type?: unknown; data?: { email?: unknown; to?: unknown; unsubscribed?: unknown; audience_id?: unknown } };

/**
 * Applies a Resend event. Only the audience this site manages is honoured
 * (when an audience id is configured), so a second audience on the same
 * account cannot unsubscribe newsletter readers.
 */
export async function handleResendEvent(event: unknown, service: NewsletterService, opts: { audienceId?: string } = {}): Promise<WebhookOutcome> {
  const e = (event && typeof event === "object" ? event : {}) as ResendEvent;
  const type = typeof e.type === "string" ? e.type : "";
  const data = e.data ?? {};

  if (type === "contact.updated" || type === "contact.deleted") {
    if (opts.audienceId && data.audience_id !== opts.audienceId) return { handled: false, unsubscribed: 0, ignored: "other audience" };
    if (type === "contact.updated" && data.unsubscribed !== true) return { handled: false, unsubscribed: 0, ignored: "not an unsubscribe" };
    if (typeof data.email !== "string") return { handled: false, unsubscribed: 0, ignored: "no email" };
    const result = await service.unsubscribeByEmail(data.email, { page: "/webhooks/resend" });
    return { handled: true, unsubscribed: result.status === "unsubscribed" ? 1 : 0 };
  }

  if (type === "email.complained") {
    const recipients = Array.isArray(data.to) ? data.to.filter((v): v is string => typeof v === "string") : [];
    let count = 0;
    for (const address of recipients) {
      const result = await service.unsubscribeByEmail(address, { page: "/webhooks/resend" });
      if (result.status === "unsubscribed") count += 1;
    }
    return { handled: true, unsubscribed: count };
  }

  return { handled: false, unsubscribed: 0, ignored: `event ${type || "unknown"}` };
}
