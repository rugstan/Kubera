import { EmailError, maskEmail, type EmailClient, type EmailSendResult, type OutboundEmail } from "./types";

// Cloudflare Email Service (Email Sending) over its REST API, no SDK:
//   POST /client/v4/accounts/{account_id}/email/sending/send
// Sent from the `notify.` subdomain; replies go to deals@ (docs/BUILD_PLAN.md,
// Mailboxes).
//
// Transactional mail only. Cloudflare's terms limit the service to mail that
// answers a specific customer interaction and bar marketing and unsolicited
// messages, so the newsletter and cold prospect outreach stay on Resend
// (resendEmailClientFromEnv in ./index.ts).
//
// Cloudflare takes no idempotency key, so this client reports
// `idempotent = false` and marks an error `notSent` only when nothing can have
// gone out:
//   - a 4xx or 5xx whose body is Cloudflare's own error envelope
//     ({ success: false, errors }). The API reference documents every such
//     answer (400, 401, 403, 409, 429, 500) as "no email was sent";
//   - a 200 that lists our recipient as a permanent bounce or as suppressed.
// A timeout, a network error, a gateway page without that envelope, or a 200
// that cannot be read may mean the message was accepted. Those errors keep
// `notSent = false`, and callers record the delivery as unknown instead of
// sending again (lib/notify/service.ts, lib/agents/outreach/sender.ts).

export type CloudflareEmailConfig = {
  accountId: string;
  apiToken: string;
  /** e.g. "Corin Commercial <notifications@notify.corincommercial.com>" */
  from: string;
  replyTo: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

export const DEFAULT_CLOUDFLARE_FROM = "Corin Commercial <notifications@notify.corincommercial.com>";
export const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

const ACCOUNT_ID_RE = /^[0-9a-f]{32}$/i;

/** Config from env, or null unless both CLOUDFLARE_EMAIL_ACCOUNT_ID (32 hex characters) and CLOUDFLARE_EMAIL_TOKEN are set. */
export function cloudflareEmailConfigFromEnv(env: Record<string, string | undefined> = process.env): CloudflareEmailConfig | null {
  const accountId = env.CLOUDFLARE_EMAIL_ACCOUNT_ID?.trim();
  const apiToken = env.CLOUDFLARE_EMAIL_TOKEN?.trim();
  if (!accountId || !apiToken || !ACCOUNT_ID_RE.test(accountId)) return null;
  return {
    accountId,
    apiToken,
    from: env.EMAIL_FROM?.trim() || DEFAULT_CLOUDFLARE_FROM,
    replyTo: env.NOTIFY_REPLY_TO?.trim() || env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || "deals@corincommercial.com",
  };
}

type CloudflareAddress = string | { address: string; name: string };

/** "Name <a@b>" becomes { address, name }; a bare address stays a string. Cloudflare wants addresses in printable ASCII. */
export function cloudflareAddress(value: string): CloudflareAddress {
  const m = /^\s*"?([^"<]*?)"?\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(value);
  const address = (m ? m[2]! : value).trim();
  if (!/^[\x21-\x7e]+@[\x21-\x7e]+$/.test(address)) throw new EmailError(`Cloudflare email: "${address.slice(0, 80)}" is not a usable address`, undefined, { notSent: true });
  const name = m?.[1]?.trim();
  return name ? { address, name } : address;
}

type Envelope = {
  success?: unknown;
  errors?: unknown;
  result?: {
    message_id?: unknown;
    delivered?: unknown;
    queued?: unknown;
    permanent_bounces?: unknown;
    suppressed_recipients?: unknown;
  } | null;
};

function parseEnvelope(raw: string): Envelope | null {
  try {
    const body = JSON.parse(raw) as unknown;
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Envelope) : null;
  } catch {
    return null;
  }
}

/** "10207 email.sending.error.email.sending_disabled; …" from the errors array. */
function describeErrors(errors: unknown): string {
  if (!Array.isArray(errors)) return "";
  return errors
    .slice(0, 3)
    .map((e) => {
      const { code, message } = (e ?? {}) as { code?: unknown; message?: unknown };
      return [typeof code === "number" ? String(code) : "", typeof message === "string" ? message : ""].filter(Boolean).join(" ");
    })
    .filter(Boolean)
    .join("; ")
    .slice(0, 300);
}

const STATUS_HINTS: Record<number, string> = {
  401: "the API token was refused (CLOUDFLARE_EMAIL_TOKEN)",
  403: "sending is not allowed: the account is not entitled, sending is paused, or the sender domain is not set up",
  409: "Email Sending setup is still in progress",
  429: "throttled",
};

function count(list: unknown): number {
  return Array.isArray(list) ? list.length : 0;
}

export class CloudflareEmailClient implements EmailClient {
  readonly name = "cloudflare" as const;
  /** Cloudflare takes no idempotency key: only a failure that certainly sent nothing may be sent again. */
  readonly idempotent = false;

  constructor(private readonly config: CloudflareEmailConfig) {}

  async send(email: OutboundEmail): Promise<EmailSendResult> {
    const doFetch = this.config.fetch ?? fetch;
    const to = cloudflareAddress(email.to);
    const recipient = (typeof to === "string" ? to : to.address).toLowerCase();
    const url = `${this.config.baseUrl ?? CLOUDFLARE_API_BASE}/accounts/${encodeURIComponent(this.config.accountId)}/email/sending/send`;
    const body = JSON.stringify({
      from: cloudflareAddress(this.config.from),
      to,
      reply_to: cloudflareAddress(email.replyTo ?? this.config.replyTo),
      subject: email.subject,
      html: email.html,
      text: email.text,
    });

    let res: Response;
    try {
      res = await doFetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${this.config.apiToken}`, "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 10_000),
        cache: "no-store",
        redirect: "manual",
      });
    } catch (err) {
      // The request may have reached Cloudflare before the timeout or the network failure.
      const why = err instanceof Error ? (err.name === "TimeoutError" ? "timed out" : err.message) : String(err);
      throw new EmailError(`Cloudflare email: request failed (${why.slice(0, 200)}); delivery unknown`, undefined, { cause: err });
    }

    const raw = await res.text().catch(() => "");
    const envelope = parseEnvelope(raw);

    if (!res.ok) {
      // Cloudflare documents each of its error answers as "no email was sent".
      // Believe that only when the body is its error envelope, not a proxy or gateway page.
      const notSent = envelope?.success === false && res.status >= 400;
      const detail = describeErrors(envelope?.errors) || STATUS_HINTS[res.status] || raw.replace(/\s+/g, " ").trim().slice(0, 200);
      throw new EmailError(`Cloudflare email ${res.status}: ${detail}${notSent ? "" : "; delivery unknown"}`, res.status, { notSent });
    }

    const result = envelope?.success === true ? envelope.result : null;
    if (!result) throw new EmailError(`Cloudflare email ${res.status}: unreadable response; delivery unknown`, res.status);
    // One recipient per request, so any address in delivered or queued is ours.
    if (count(result.delivered) + count(result.queued) === 0) {
      if (count(result.permanent_bounces) > 0) throw new EmailError(`Cloudflare email: ${maskEmail(recipient)} bounced permanently`, res.status, { notSent: true });
      if (count(result.suppressed_recipients) > 0) throw new EmailError(`Cloudflare email: ${maskEmail(recipient)} is on the suppression list; nothing was sent`, res.status, { notSent: true });
      throw new EmailError(`Cloudflare email ${res.status}: the recipient is not listed as delivered or queued; delivery unknown`, res.status);
    }
    const messageId = typeof result.message_id === "string" ? result.message_id.trim() : "";
    if (!messageId) throw new EmailError(`Cloudflare email ${res.status}: accepted but no message id came back; delivery unknown`, res.status);
    return { providerMessageId: messageId.slice(0, 200) };
  }
}
