// Mailflare JMAP connector (read-only): list new messages in a mailbox's
// Inbox, fetch body + raw headers, download attachments. Mailflare is the
// self-hosted mail server for corincommercial.com (github.com/hieunc229/mailflare;
// written against v0.5.4). Corin never sends, moves, flags or deletes mail from
// here; outbound mail goes through the approval gate and Resend.
//
// JMAP (RFC 8620/8621) over a fixed base URL (MAILFLARE_URL):
//   GET  /jmap/session                                   account id
//   POST /jmap/api                                       Mailbox/get, Email/query, Email/get
//   GET  /jmap/download/{accountId}/{blobId}/{name}      raw MIME and attachments
// Auth is "Authorization: Bearer <key>" with a key that has the jmap scope.
// The URLs in the Session object are not used: every request goes to the
// configured origin, and redirects are never followed.
//
// A jmap key can also send, move and delete mail, so this client only ever
// issues the read methods in READ_ONLY_JMAP_METHODS (assertReadOnlyMethods).
//
// Mailbox layout: each address is a top-level Mailbox (name "Display <addr>"
// or "addr") with system children; only the child with role "inbox" is polled,
// as the Zoho client polls only the Inbox folder. Aliases (hello@, info@)
// deliver into their parent mailbox.
//
// Header properties (header:Name) are answered only from fields Mailflare
// stores, so Authentication-Results, Auto-Submitted, Precedence and
// List-Unsubscribe come from the raw MIME (the Email's blobId) instead. A
// sender can write Authentication-Results too: only those stamped by a trusted
// receiver (MAILFLARE_TRUSTED_AUTHSERV_IDS, default mx.cloudflare.net, the
// Cloudflare Email Routing hop in front of Mailflare) count; see trustedDmarcVerdict.

import { INBOUND_MAILBOXES, mailboxAddress, type InboundMailbox } from "./mailboxes";
import { headerValue, htmlToText, isAutomated, isBulk, messageIds, parseAddress, parseHeaders, trustedDmarcVerdict } from "./text";
import { MailProviderError, type KnownIds, type MailAttachmentMeta, type MailMessage, type MailProvider, type MailRef, type MailSummary } from "./types";

const CORE = "urn:ietf:params:jmap:core";
const MAIL = "urn:ietf:params:jmap:mail";

/** The only JMAP methods this client issues. Anything that writes (Email/set, EmailSubmission/set, Mailbox/set, Email/import, …) is refused. */
export const READ_ONLY_JMAP_METHODS = ["Mailbox/get", "Email/query", "Email/get"] as const;
export type ReadOnlyJmapMethod = (typeof READ_ONLY_JMAP_METHODS)[number];

/** Throws before anything is sent if a call is not one of the read-only methods. */
export function assertReadOnlyMethods(calls: readonly (readonly [string, unknown, string])[]): void {
  for (const [name] of calls) {
    if (!(READ_ONLY_JMAP_METHODS as readonly string[]).includes(name)) {
      throw new MailProviderError(`Refusing JMAP method ${name}: the Mailflare connector is read-only`, null, false);
    }
  }
}

/** Mailflare caps Email/query at 250 ids per call. */
const QUERY_PAGE = 250;
/** Hard stop on messages paged through in one listing (stored ids are skipped, not capped). */
const MAX_LIST_SCAN = 100_000;
/** Raw MIME is read only up to the end of the header block, and never past this. */
const MAX_HEADER_BYTES = 512 * 1024;
/** Same ceiling as the document pipeline (lib/agents/documents/pipeline.ts MAX_DOCUMENT_BYTES). */
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const BODY_VALUE_BYTES = 1_000_000;
const TIMEOUT_MS = 30_000;

export const DEFAULT_TRUSTED_AUTHSERV_IDS = ["mx.cloudflare.net"] as const;

export type MailflareConfig = {
  /** Origin only, e.g. https://mail.corincommercial.com. */
  baseUrl: string;
  /** jmap-scoped API key per mailbox (already resolved with the shared fallback). */
  keys: Partial<Record<InboundMailbox, string>>;
  addresses: Record<InboundMailbox, string>;
  trustedAuthServIds: readonly string[];
  fetch?: typeof fetch;
};

const MAILBOX_ENV: Record<InboundMailbox, string> = { deals: "DEALS", docs: "DOCS", lenders: "LENDERS", vendors: "VENDORS", closing: "CLOSING" };

/** The configured origin, or null when MAILFLARE_URL is missing or not https (http only for localhost). */
export function mailflareOrigin(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  if (url.username || url.password) return null;
  return url.origin;
}

export function mailflareConfigFromEnv(env: Record<string, string | undefined> = process.env): MailflareConfig | null {
  const raw = env.MAILFLARE_URL;
  const baseUrl = mailflareOrigin(raw);
  if (!baseUrl) {
    if (raw?.trim()) console.warn("[mail] MAILFLARE_URL must be an https URL; Mailflare polling disabled");
    return null;
  }
  const shared = env.MAILFLARE_JMAP_KEY?.trim();
  const keys: Partial<Record<InboundMailbox, string>> = {};
  for (const [mb, suffix] of Object.entries(MAILBOX_ENV) as [InboundMailbox, string][]) {
    const key = env[`MAILFLARE_JMAP_KEY_${suffix}`]?.trim() || shared;
    if (key) keys[mb] = key;
  }
  if (!Object.keys(keys).length) return null;
  const trusted = (env.MAILFLARE_TRUSTED_AUTHSERV_IDS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return {
    baseUrl,
    keys,
    addresses: Object.fromEntries(INBOUND_MAILBOXES.map((mb) => [mb, mailboxAddress(mb, env)])) as Record<InboundMailbox, string>,
    trustedAuthServIds: trusted.length ? trusted : [...DEFAULT_TRUSTED_AUTHSERV_IDS],
  };
}

type JmapAddress = { name?: string | null; email?: string | null };
type JmapBodyPart = { partId?: string | null; blobId?: string | null; size?: number; name?: string | null; type?: string | null; disposition?: string | null };
type JmapEmail = {
  id: string;
  blobId?: string;
  mailboxIds?: Record<string, boolean>;
  subject?: string | null;
  from?: JmapAddress[] | null;
  to?: JmapAddress[] | null;
  cc?: JmapAddress[] | null;
  receivedAt?: string;
  hasAttachment?: boolean;
  preview?: string;
  messageId?: string[] | null;
  inReplyTo?: string[] | null;
  references?: string[] | null;
  textBody?: JmapBodyPart[];
  htmlBody?: JmapBodyPart[];
  bodyValues?: Record<string, { value: string; isTruncated?: boolean }>;
  attachments?: JmapBodyPart[];
};
type JmapMailbox = { id: string; name?: string; parentId?: string | null; role?: string | null };
type MethodResponse = [string, Record<string, unknown>, string];

const SUMMARY_PROPERTIES = ["id", "mailboxIds", "subject", "from", "to", "cc", "receivedAt", "hasAttachment", "preview"] as const;
const MESSAGE_PROPERTIES = [...SUMMARY_PROPERTIES, "blobId", "messageId", "inReplyTo", "references", "textBody", "htmlBody", "bodyValues", "attachments"] as const;

function addressList(list: JmapAddress[] | null | undefined): string[] {
  return (list ?? []).map((a) => a.email?.trim().toLowerCase() ?? "").filter((a) => a.includes("@"));
}

export class MailflareClient implements MailProvider {
  readonly name = "mailflare";
  private readonly fetchImpl: typeof fetch;
  private readonly accounts = new Map<string, string>();
  private readonly inboxes = new Map<InboundMailbox, string>();

  constructor(private readonly config: MailflareConfig) {
    this.fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);
  }

  configured(mailbox: InboundMailbox): boolean {
    return Boolean(this.config.keys[mailbox]);
  }

  private key(mailbox: InboundMailbox): string {
    const key = this.config.keys[mailbox];
    if (!key) throw new MailProviderError(`No Mailflare JMAP key for ${mailbox}@`, null, false);
    return key;
  }

  /** One HTTP request to the configured origin. Redirects are never followed. */
  private async http(mailbox: InboundMailbox, path: string, init: { method?: "GET" | "POST"; body?: string; accept: string }): Promise<Response> {
    const url = `${this.config.baseUrl}${path}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: init.method ?? "GET",
        headers: { authorization: `Bearer ${this.key(mailbox)}`, accept: init.accept, ...(init.body ? { "content-type": "application/json" } : {}) },
        ...(init.body ? { body: init.body } : {}),
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new MailProviderError(`Mailflare request failed: ${err instanceof Error ? err.message : String(err)}`, null, true);
    }
    const label = path.split("?")[0]!.replace(/\/jmap\/download\/.*/, "/jmap/download");
    if (res.status >= 300 && res.status < 400) throw new MailProviderError(`Mailflare ${label} answered a redirect (HTTP ${res.status}); redirects are not followed`, res.status, false);
    if (res.status === 409) throw new MailProviderError(`Mailflare ${label} → HTTP 409: the server flagged this file and wants it acknowledged; not downloaded`, 409, false);
    if (!res.ok) throw new MailProviderError(`Mailflare ${label} → HTTP ${res.status}`, res.status, res.status === 429 || res.status >= 500);
    return res;
  }

  private async accountId(mailbox: InboundMailbox): Promise<string> {
    const key = this.key(mailbox);
    const known = this.accounts.get(key);
    if (known) return known;
    const res = await this.http(mailbox, "/jmap/session", { accept: "application/json" });
    const session = (await res.json()) as { primaryAccounts?: Record<string, string> };
    const id = session.primaryAccounts?.[MAIL];
    if (!id) throw new MailProviderError("Mailflare session has no mail account; check the key's jmap scope", res.status, false);
    this.accounts.set(key, id);
    return id;
  }

  /** POSTs read-only method calls and returns their responses in order. */
  private async call(mailbox: InboundMailbox, calls: [ReadOnlyJmapMethod, Record<string, unknown>, string][]): Promise<MethodResponse[]> {
    assertReadOnlyMethods(calls);
    const res = await this.http(mailbox, "/jmap/api", { method: "POST", accept: "application/json", body: JSON.stringify({ using: [CORE, MAIL], methodCalls: calls }) });
    const body = (await res.json()) as { methodResponses?: MethodResponse[] };
    const responses = body.methodResponses ?? [];
    for (const [name, args] of responses) {
      if (name === "error") {
        const type = String(args.type ?? "unknown");
        throw new MailProviderError(`Mailflare JMAP error: ${type}${args.description ? ` (${String(args.description)})` : ""}`, res.status, type === "serverFail" || type === "serverUnavailable");
      }
    }
    return responses;
  }

  private async inboxId(mailbox: InboundMailbox): Promise<string> {
    const known = this.inboxes.get(mailbox);
    if (known) return known;
    const accountId = await this.accountId(mailbox);
    const [[, result]] = (await this.call(mailbox, [["Mailbox/get", { accountId, ids: null, properties: ["id", "name", "parentId", "role"] }, "m"]])) as [MethodResponse];
    const list = (result.list ?? []) as JmapMailbox[];
    const address = this.config.addresses[mailbox].toLowerCase();
    const top = list.find((m) => !m.parentId && parseAddress(m.name ?? "").address === address);
    if (!top) throw new MailProviderError(`No Mailflare mailbox for ${address} visible to this key`, null, false);
    const inbox = list.find((m) => m.parentId === top.id && m.role === "inbox");
    if (!inbox) throw new MailProviderError(`No Inbox under the Mailflare mailbox for ${address}`, null, false);
    this.inboxes.set(mailbox, inbox.id);
    return inbox.id;
  }

  private summary(mailbox: InboundMailbox, folderId: string, e: JmapEmail): MailSummary {
    const from = e.from?.[0];
    return {
      mailbox,
      providerMessageId: e.id,
      folderId,
      subject: e.subject ?? "",
      fromAddress: from?.email?.trim().toLowerCase() ?? "",
      fromName: from?.name?.trim() || null,
      toAddresses: addressList(e.to),
      ccAddresses: addressList(e.cc),
      receivedAt: new Date(e.receivedAt ?? 0).toISOString(),
      hasAttachments: e.hasAttachment === true,
      snippet: (e.preview ?? "").slice(0, 500),
    };
  }

  /**
   * Every unstored message newer than `since` (up to `limit`), oldest first.
   * Email/query's `after` is inclusive and compares the stored arrival time,
   * so messages at or before `since` are dropped here as well.
   */
  async listNew(mailbox: InboundMailbox, since: Date | null, limit: number, knownIds?: KnownIds): Promise<MailSummary[]> {
    const accountId = await this.accountId(mailbox);
    const inbox = await this.inboxId(mailbox);
    const pageSize = Math.min(QUERY_PAGE, Math.max(1, limit));
    const filter: Record<string, unknown> = { inMailbox: inbox, ...(since ? { after: since.toISOString() } : {}) };
    const out: MailSummary[] = [];
    let scanned = 0;
    for (let position = 0; out.length < limit && scanned < MAX_LIST_SCAN; position += pageSize) {
      const [[, query]] = (await this.call(mailbox, [["Email/query", { accountId, filter, sort: [{ property: "receivedAt", isAscending: false }], position, limit: pageSize }, "q"]])) as [MethodResponse];
      const ids = ((query.ids ?? []) as string[]).map(String);
      scanned += ids.length;
      if (!ids.length) break;
      const [[, got]] = (await this.call(mailbox, [["Email/get", { accountId, ids, properties: SUMMARY_PROPERTIES }, "g"]])) as [MethodResponse];
      const byId = new Map(((got.list ?? []) as JmapEmail[]).map((e) => [e.id, e]));
      const fresh: MailSummary[] = [];
      for (const id of ids) {
        const e = byId.get(id);
        if (!e) continue;
        const s = this.summary(mailbox, inbox, e);
        if (since && Date.parse(s.receivedAt) <= since.getTime()) continue;
        fresh.push(s);
      }
      const known = knownIds && fresh.length ? await knownIds(fresh.map((m) => m.providerMessageId)) : new Set<string>();
      for (const s of fresh) {
        if (known.has(s.providerMessageId)) continue;
        out.push(s);
        if (out.length >= limit) break;
      }
      if (ids.length < pageSize) break;
    }
    if (scanned >= MAX_LIST_SCAN && out.length < limit) console.warn(`[mail] ${mailbox}@ listing stopped after ${scanned} messages; older unstored ones are not reached`);
    return out.reverse();
  }

  async fetchMessage(mailbox: InboundMailbox, ref: MailRef): Promise<MailMessage> {
    const accountId = await this.accountId(mailbox);
    const [[, got]] = (await this.call(mailbox, [
      ["Email/get", { accountId, ids: [ref.providerMessageId], properties: MESSAGE_PROPERTIES, fetchTextBodyValues: true, fetchHTMLBodyValues: true, maxBodyValueBytes: BODY_VALUE_BYTES }, "g"],
    ])) as [MethodResponse];
    const e = ((got.list ?? []) as JmapEmail[]).find((x) => x.id === ref.providerMessageId);
    if (!e) throw new MailProviderError(`Mailflare message ${ref.providerMessageId} not found`, 404, false);
    // Headers Mailflare does not store (Authentication-Results, Auto-Submitted, …) come from the raw MIME.
    const h = e.blobId ? parseHeaders(await this.rawHeaders(mailbox, accountId, e.blobId)) : new Map<string, string[]>();
    const summary = this.summary(mailbox, ref.folderId, e);
    const attachments: MailAttachmentMeta[] = (e.attachments ?? [])
      .filter((p) => p.blobId && p.disposition !== "inline")
      .map((p) => ({ attachmentId: String(p.blobId), fileName: p.name?.trim() || "attachment", size: Number(p.size ?? 0), contentType: p.type ?? null }));
    return {
      ...summary,
      internetMessageId: e.messageId?.[0]?.toLowerCase() ?? messageIds(headerValue(h, "message-id"))[0] ?? null,
      inReplyTo: e.inReplyTo?.[0]?.toLowerCase() ?? messageIds(headerValue(h, "in-reply-to"))[0] ?? null,
      references: e.references?.length ? e.references.map((r) => r.toLowerCase()) : messageIds(headerValue(h, "references")),
      bodyText: bodyText(e),
      attachments,
      automated: isAutomated(h),
      bulk: isBulk(h),
      dmarc: trustedDmarcVerdict(h, this.config.trustedAuthServIds),
    };
  }

  private downloadPath(accountId: string, blobId: string, name: string): string {
    return `/jmap/download/${encodeURIComponent(accountId)}/${encodeURIComponent(blobId)}/${encodeURIComponent(name)}`;
  }

  /** The raw message's header block (read until the blank line, at most MAX_HEADER_BYTES). */
  private async rawHeaders(mailbox: InboundMailbox, accountId: string, blobId: string): Promise<string> {
    const res = await this.http(mailbox, `${this.downloadPath(accountId, blobId, "message.eml")}?type=message%2Frfc822`, { accept: "message/rfc822" });
    return readHeaderBlock(res);
  }

  async fetchAttachment(mailbox: InboundMailbox, ref: MailRef, attachmentId: string): Promise<{ bytes: Uint8Array; contentType: string | null }> {
    void ref;
    const accountId = await this.accountId(mailbox);
    const res = await this.http(mailbox, this.downloadPath(accountId, attachmentId, "attachment"), { accept: "*/*" });
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_ATTACHMENT_BYTES) throw new MailProviderError(`Mailflare attachment is ${declared} bytes, over the ${MAX_ATTACHMENT_BYTES}-byte limit`, res.status, false);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new MailProviderError(`Mailflare attachment is over the ${MAX_ATTACHMENT_BYTES}-byte limit`, res.status, false);
    return { bytes, contentType: res.headers.get("content-type") };
  }
}

/** Plain text of the message: the text part when there is one, else the HTML converted. */
function bodyText(e: JmapEmail): string {
  const values = e.bodyValues ?? {};
  const text = (e.textBody ?? []).filter((p) => p.type === "text/plain").map((p) => (p.partId ? values[p.partId]?.value : undefined)).filter((v): v is string => typeof v === "string");
  if (text.length) return text.join("\n").trim();
  const html = (e.htmlBody ?? []).map((p) => (p.partId ? values[p.partId]?.value : undefined)).filter((v): v is string => typeof v === "string");
  return html.length ? htmlToText(html.join("\n")) : "";
}

/** Reads a MIME stream only up to the end of its header block. */
export async function readHeaderBlock(res: Response, maxBytes = MAX_HEADER_BYTES): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let text = "";
  let read = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      read += value.byteLength;
      text += decoder.decode(value, { stream: true });
      const end = text.search(/\r?\n\r?\n/);
      if (end >= 0) return text.slice(0, end);
      if (read >= maxBytes) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return text.slice(0, maxBytes);
}
