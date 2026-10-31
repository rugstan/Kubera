import { randomUUID } from "node:crypto";
import { EmailError, type EmailClient, type EmailSendResult, type OutboundEmail } from "./types";

/** In-memory email client for tests and local development. */
export class FakeEmailClient implements EmailClient {
  readonly name = "fake" as const;
  readonly sent: (OutboundEmail & { providerMessageId: string })[] = [];
  /** When set, the next send rejects with this error. */
  failNext: EmailError | null = null;

  async send(email: OutboundEmail): Promise<EmailSendResult> {
    if (this.failNext) {
      const err = this.failNext;
      this.failNext = null;
      throw err;
    }
    const providerMessageId = `fake_email_${randomUUID()}`;
    this.sent.push({ ...email, providerMessageId });
    return { providerMessageId };
  }
}
