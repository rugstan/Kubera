// Typed email client. The real implementation is Resend (REST); tests use the
// in-memory fake. No key configured means no client (see ./index.ts).

export type OutboundEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /** Sent as the Idempotency-Key header so a retried request never delivers twice. */
  idempotencyKey?: string;
  tags?: Record<string, string>;
};

export type EmailSendResult = { providerMessageId: string };

export class EmailError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "EmailError";
  }
}

export interface EmailClient {
  readonly name: "resend" | "fake";
  send(email: OutboundEmail): Promise<EmailSendResult>;
}
