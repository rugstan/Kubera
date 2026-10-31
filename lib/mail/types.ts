// Mail connector contract (Zoho Mail in production, FakeMailProvider in tests).

import type { InboundMailbox } from "./mailboxes";

export type MailRef = { providerMessageId: string; folderId: string };

export type MailSummary = MailRef & {
  mailbox: InboundMailbox;
  subject: string;
  fromAddress: string;
  fromName: string | null;
  toAddresses: string[];
  ccAddresses: string[];
  /** ISO timestamp. */
  receivedAt: string;
  hasAttachments: boolean;
  snippet: string;
};

export type MailAttachmentMeta = { attachmentId: string; fileName: string; size: number; contentType: string | null };

/** Sender-authentication verdict parsed from Authentication-Results. */
export type AuthVerdict = "pass" | "fail" | "none" | "unknown";

export type MailMessage = MailSummary & {
  internetMessageId: string | null;
  inReplyTo: string | null;
  references: string[];
  bodyText: string;
  attachments: MailAttachmentMeta[];
  /** Auto-Submitted / Precedence / X-Autoreply present (vacation replies, bounces). */
  automated: boolean;
  /** List-Unsubscribe or Precedence: bulk/list. */
  bulk: boolean;
  dmarc: AuthVerdict;
};

export interface MailProvider {
  readonly name: string;
  configured(mailbox: InboundMailbox): boolean;
  /** Messages received after `since` (oldest first), at most `limit`. */
  listNew(mailbox: InboundMailbox, since: Date | null, limit: number): Promise<MailSummary[]>;
  fetchMessage(mailbox: InboundMailbox, ref: MailRef): Promise<MailMessage>;
  fetchAttachment(mailbox: InboundMailbox, ref: MailRef, attachmentId: string): Promise<{ bytes: Uint8Array; contentType: string | null }>;
}

export class MailProviderError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "MailProviderError";
  }
}
