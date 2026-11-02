import { EmailError, type EmailClient, type EmailSendResult, type OutboundEmail } from "./types";

// Resend transactional email over its REST API (no SDK). Sent from the
// `notify.` subdomain; replies go to deals@ (docs/BUILD_PLAN.md, Mailboxes).

export type ResendConfig = {
  apiKey: string;
  /** e.g. "Corin Commercial <notifications@notify.corincommercial.com>" */
  from: string;
  replyTo: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export const DEFAULT_RESEND_FROM = "Corin Commercial <notifications@notify.corincommercial.com>";

export function resendConfigFromEnv(env: Record<string, string | undefined> = process.env): ResendConfig | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    from: env.RESEND_FROM?.trim() || DEFAULT_RESEND_FROM,
    replyTo: env.NOTIFY_REPLY_TO?.trim() || env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || "deals@corincommercial.com",
  };
}

/** Resend accepts only ASCII letters, digits, `_` and `-` in tag names and values (max 256 chars). */
export function sanitizeResendTag(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256);
  return cleaned || "_";
}

export function resendTags(tags: Record<string, string>): { name: string; value: string }[] {
  return Object.entries(tags).map(([name, value]) => ({ name: sanitizeResendTag(name), value: sanitizeResendTag(String(value)) }));
}

export class ResendEmailClient implements EmailClient {
  readonly name = "resend" as const;

  constructor(private readonly config: ResendConfig) {}

  async send(email: OutboundEmail): Promise<EmailSendResult> {
    const doFetch = this.config.fetch ?? fetch;
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.config.apiKey}`,
      "content-type": "application/json",
    };
    if (email.idempotencyKey) headers["idempotency-key"] = email.idempotencyKey.slice(0, 256);
    const res = await doFetch(`${this.config.baseUrl ?? "https://api.resend.com"}/emails`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        from: this.config.from,
        to: [email.to],
        subject: email.subject,
        html: email.html,
        text: email.text,
        reply_to: email.replyTo ?? this.config.replyTo,
        ...(email.tags ? { tags: resendTags(email.tags) } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      throw new EmailError(`Resend ${res.status}: ${detail}`, res.status);
    }
    const body = (await res.json().catch(() => null)) as { id?: unknown } | null;
    if (!body || typeof body.id !== "string" || !body.id) throw new EmailError("Resend: no message id in response");
    return { providerMessageId: body.id };
  }
}
