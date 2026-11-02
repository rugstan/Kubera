// In-memory mail provider for tests and local development.

import type { InboundMailbox } from "./mailboxes";
import { MailProviderError, type KnownIds, type MailAttachmentMeta, type MailMessage, type MailProvider, type MailRef, type MailSummary } from "./types";

export type FakeMail = Omit<Partial<MailMessage>, "attachments"> & {
  mailbox: InboundMailbox;
  subject: string;
  fromAddress: string;
  bodyText: string;
  attachments?: (Partial<MailAttachmentMeta> & { fileName: string; bytes: Uint8Array })[];
};

let seq = 0;

export class FakeMailProvider implements MailProvider {
  readonly name = "fake";
  readonly messages: MailMessage[] = [];
  private readonly blobs = new Map<string, { bytes: Uint8Array; contentType: string | null }>();
  readonly fetched: string[] = [];

  constructor(private readonly unconfigured: InboundMailbox[] = []) {}

  configured(mailbox: InboundMailbox): boolean {
    return !this.unconfigured.includes(mailbox);
  }

  add(mail: FakeMail): MailMessage {
    const id = mail.providerMessageId ?? `fake-${++seq}`;
    const attachments: MailAttachmentMeta[] = (mail.attachments ?? []).map((a, i) => {
      const attachmentId = a.attachmentId ?? `${id}-att-${i}`;
      this.blobs.set(`${id}/${attachmentId}`, { bytes: a.bytes, contentType: a.contentType ?? null });
      return { attachmentId, fileName: a.fileName, size: a.size ?? a.bytes.byteLength, contentType: a.contentType ?? null };
    });
    const msg: MailMessage = {
      providerMessageId: id,
      folderId: mail.folderId ?? "inbox",
      fromName: null,
      toAddresses: [`${mail.mailbox}@corincommercial.com`],
      ccAddresses: [],
      receivedAt: new Date(Date.UTC(2026, 10, 3, 16, 0, seq)).toISOString(),
      hasAttachments: attachments.length > 0,
      snippet: mail.bodyText.slice(0, 120),
      internetMessageId: `${id}@mail.test`,
      inReplyTo: null,
      references: [],
      automated: false,
      bulk: false,
      dmarc: "pass",
      ...mail,
      attachments,
    };
    this.messages.push(msg);
    return msg;
  }

  async listNew(mailbox: InboundMailbox, since: Date | null, limit: number, knownIds?: KnownIds): Promise<MailSummary[]> {
    const inWindow = this.messages
      .filter((m) => m.mailbox === mailbox && (!since || Date.parse(m.receivedAt) > since.getTime()))
      .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
    const known = knownIds && inWindow.length ? await knownIds(inWindow.map((m) => m.providerMessageId)) : new Set<string>();
    // Like Zoho: the newest `limit` unstored messages, returned oldest first.
    return inWindow
      .filter((m) => !known.has(m.providerMessageId))
      .slice(0, limit)
      .reverse()
      .map(({ mailbox: mb, providerMessageId, folderId, subject, fromAddress, fromName, toAddresses, ccAddresses, receivedAt, hasAttachments, snippet }) => ({
        mailbox: mb,
        providerMessageId,
        folderId,
        subject,
        fromAddress,
        fromName,
        toAddresses,
        ccAddresses,
        receivedAt,
        hasAttachments,
        snippet,
      }));
  }

  async fetchMessage(mailbox: InboundMailbox, ref: MailRef): Promise<MailMessage> {
    const msg = this.messages.find((m) => m.mailbox === mailbox && m.providerMessageId === ref.providerMessageId);
    if (!msg) throw new MailProviderError(`fake message ${ref.providerMessageId} not found`, 404, false);
    this.fetched.push(ref.providerMessageId);
    return structuredClone(msg);
  }

  async fetchAttachment(_mailbox: InboundMailbox, ref: MailRef, attachmentId: string): Promise<{ bytes: Uint8Array; contentType: string | null }> {
    const blob = this.blobs.get(`${ref.providerMessageId}/${attachmentId}`);
    if (!blob) throw new MailProviderError("fake attachment not found", 404, false);
    return blob;
  }
}
