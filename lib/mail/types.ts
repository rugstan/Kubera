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

/** Which of these provider message ids are already stored. */
export type KnownIds = (ids: string[]) => Promise<Set<string>>;

export interface MailProvider {
  readonly name: string;
  configured(mailbox: InboundMailbox): boolean;
  /**
   * Every message newer than `since` (the newest `limit` when `since` is null), oldest first.
   * `knownIds` returns which of the listed provider ids are already stored: those are
   * skipped and never count toward `limit`, so paging reaches older unstored messages
   * even when the newest `limit` are all stored.
   */
  listNew(mailbox: InboundMailbox, since: Date | null, limit: number, knownIds?: KnownIds): Promise<MailSummary[]>;
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

/**
 * The message was read but its attachment list was not: throttled, 5xx,
 * timeout, token eviction, or any error while the details say it has
 * attachments. Always retryable, so the workflow retries it with backoff.
 * `partial` is the message without attachments, so the last allowed attempt
 * can park it for staff (needs_review, attachment_failed) instead of saving it
 * as processed with its files silently dropped.
 */
export class AttachmentListError extends MailProviderError {
  constructor(
    message: string,
    status: number | null,
    readonly partial: MailMessage,
  ) {
    super(message, status, true);
    this.name = "AttachmentListError";
  }
}
