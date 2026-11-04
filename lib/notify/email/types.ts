// Typed email client. The real implementations are Cloudflare Email Service and
// Resend (REST); tests use the in-memory fake. Which one runs, if any, is
// chosen from env (see ./index.ts).

export type OutboundEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /**
   * Stable key for this logical message. Resend dedupes on it (Idempotency-Key
   * header), so a retried request never delivers twice. Cloudflare has no such
   * key: see EmailClient.idempotent and emailRetryIsSafe.
   */
  idempotencyKey?: string;
  /** Resend tags. Cloudflare has no equivalent and does not send them. */
  tags?: Record<string, string>;
};

export type EmailSendResult = { providerMessageId: string };

export type EmailProviderName = "cloudflare" | "resend" | "fake";

export class EmailError extends Error {
  /**
   * True when the provider certainly did not deliver the message: it failed
   * before the request went out, the provider answered with a refusal its API
   * documents as "no email was sent", or the recipient bounced or is
   * suppressed. False when it may have gone out (a timeout, a network error, an
   * unreadable answer).
   */
  readonly notSent: boolean;

  constructor(
    message: string,
    readonly status?: number,
    options: { notSent?: boolean; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "EmailError";
    this.notSent = options.notSent ?? false;
  }
}

export interface EmailClient {
  readonly name: EmailProviderName;
  /**
   * True when the provider honours OutboundEmail.idempotencyKey, so sending the
   * same message again after any failure cannot deliver it twice (Resend).
   * False when it has no idempotency (Cloudflare): only a failure that
   * certainly sent nothing may be sent again.
   */
  readonly idempotent: boolean;
  send(email: OutboundEmail): Promise<EmailSendResult>;
}

/**
 * Whether sending this message again after `err` cannot deliver it twice:
 * the provider dedupes on the idempotency key, or the error says nothing went
 * out. Anything else (a timeout on Cloudflare, say) may already be in the
 * recipient's inbox, so callers must not resend it automatically.
 */
export function emailRetryIsSafe(client: Pick<EmailClient, "idempotent"> | null | undefined, err: unknown): boolean {
  if (err instanceof EmailError && err.notSent) return true;
  return client?.idempotent === true;
}

/** "p***@example.com": enough for staff to recognise the address in a log or alert. */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf("@");
  return at > 0 ? `${address[0]}***${address.slice(at)}` : "***";
}
