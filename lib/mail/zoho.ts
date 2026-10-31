// Zoho Mail REST connector (read-only): OAuth refresh-token flow, list new
// messages in a mailbox's Inbox, fetch body + headers, list and download
// attachments. Kubera never sends mail from here; outbound mail goes through
// the approval gate and Resend (WS-J).
//
// Each inbound mailbox (deals@, docs@, …) is its own Zoho account. A mailbox
// uses ZOHO_MAIL_REFRESH_TOKEN_<MAILBOX> when set (token minted while signed
// in as that mailbox), otherwise ZOHO_MAIL_REFRESH_TOKEN (a user with
// delegated access to every mailbox). The account id comes from
// ZOHO_MAIL_ACCOUNT_ID_<MAILBOX> or is looked up by address via GET /accounts.
// OAuth scopes: ZohoMail.accounts.READ, ZohoMail.folders.READ, ZohoMail.messages.READ.

import { mailboxAddress, type InboundMailbox } from "./mailboxes";
import { dmarcVerdict, headerValue, htmlToText, isAutomated, isBulk, messageIds, parseAddress, parseAddressList, parseHeaders } from "./text";
import { MailProviderError, type MailMessage, type MailProvider, type MailRef, type MailSummary } from "./types";

const DATA_CENTERS = new Set(["com", "eu", "in", "com.au", "jp", "ca", "sa", "com.cn"]);

export type ZohoMailConfig = {
  clientId: string;
  clientSecret: string;
  /** Data-center TLD: com (US), eu, in, com.au, jp, ca, sa. */
  dc: string;
  /** Refresh token per mailbox (already resolved with the shared fallback). */
  refreshTokens: Partial<Record<InboundMailbox, string>>;
  accountIds: Partial<Record<InboundMailbox, string>>;
  addresses: Record<InboundMailbox, string>;
  fetch?: typeof fetch;
  now?: () => number;
};

const MAILBOX_ENV: Record<InboundMailbox, string> = { deals: "DEALS", docs: "DOCS", lenders: "LENDERS", vendors: "VENDORS", closing: "CLOSING" };

export function zohoMailConfigFromEnv(env: Record<string, string | undefined> = process.env): ZohoMailConfig | null {
  const clientId = env.ZOHO_MAIL_CLIENT_ID?.trim();
  const clientSecret = env.ZOHO_MAIL_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const dc = env.ZOHO_MAIL_DC?.trim() || "com";
  if (!DATA_CENTERS.has(dc)) {
    console.warn(`[mail] ZOHO_MAIL_DC "${dc}" is not a Zoho data center; mail polling disabled`);
    return null;
  }
  const shared = env.ZOHO_MAIL_REFRESH_TOKEN?.trim();
  const refreshTokens: Partial<Record<InboundMailbox, string>> = {};
  const accountIds: Partial<Record<InboundMailbox, string>> = {};
  const addresses = {} as Record<InboundMailbox, string>;
  for (const [mb, suffix] of Object.entries(MAILBOX_ENV) as [InboundMailbox, string][]) {
    const token = env[`ZOHO_MAIL_REFRESH_TOKEN_${suffix}`]?.trim() || shared;
    if (token) refreshTokens[mb] = token;
    const account = env[`ZOHO_MAIL_ACCOUNT_ID_${suffix}`]?.trim();
    if (account) accountIds[mb] = account;
    addresses[mb] = mailboxAddress(mb, env);
  }
  if (!Object.keys(refreshTokens).length) return null;
  return { clientId, clientSecret, dc, refreshTokens, accountIds, addresses };
}

type ZohoEnvelope<T> = { status?: { code?: number; description?: string }; data?: T };

type ZohoListItem = {
  messageId: string;
  folderId: string;
  subject?: string;
  sender?: string;
  fromAddress?: string;
  toAddress?: string;
  ccAddress?: string;
  receivedTime?: string | number;
  summary?: string;
  hasAttachment?: string | boolean;
};

type ZohoAccount = { accountId: string; primaryEmailAddress?: string; emailAddress?: { mailId?: string }[]; mailboxAddress?: string };
type ZohoFolder = { folderId: string; folderName?: string; folderType?: string };

export class ZohoMailClient implements MailProvider {
  readonly name = "zoho";
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly tokens = new Map<string, { token: string; expiresAt: number }>();
  private readonly accounts = new Map<InboundMailbox, string>();
  private readonly inboxes = new Map<InboundMailbox, string>();

  constructor(private readonly config: ZohoMailConfig) {
    this.fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);
    this.now = config.now ?? (() => Date.now());
    for (const [mb, id] of Object.entries(config.accountIds)) if (id) this.accounts.set(mb as InboundMailbox, id);
  }

  configured(mailbox: InboundMailbox): boolean {
    return Boolean(this.config.refreshTokens[mailbox]);
  }

  private get accountsBase(): string {
    return `https://accounts.zoho.${this.config.dc}`;
  }
  private get apiBase(): string {
    return `https://mail.zoho.${this.config.dc}/api`;
  }

  private async accessToken(mailbox: InboundMailbox): Promise<string> {
    const refresh = this.config.refreshTokens[mailbox];
    if (!refresh) throw new MailProviderError(`No Zoho Mail refresh token for ${mailbox}@`, null, false);
    const cached = this.tokens.get(refresh);
    if (cached && cached.expiresAt - 60_000 > this.now()) return cached.token;
    const body = new URLSearchParams({ refresh_token: refresh, client_id: this.config.clientId, client_secret: this.config.clientSecret, grant_type: "refresh_token" });
    const res = await this.fetchImpl(`${this.accountsBase}/oauth/v2/token`, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(15_000) });
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !json.access_token) throw new MailProviderError(`Zoho OAuth refresh failed (${res.status}${json.error ? `: ${json.error}` : ""})`, res.status, res.status >= 500);
    this.tokens.set(refresh, { token: json.access_token, expiresAt: this.now() + (json.expires_in ?? 3600) * 1000 });
    return json.access_token;
  }

  private async request(mailbox: InboundMailbox, path: string, init: { raw?: boolean } = {}): Promise<Response> {
    const token = await this.accessToken(mailbox);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.apiBase}${path}`, { headers: { authorization: `Zoho-oauthtoken ${token}`, accept: init.raw ? "*/*" : "application/json" }, signal: AbortSignal.timeout(30_000) });
    } catch (err) {
      throw new MailProviderError(`Zoho Mail request failed: ${err instanceof Error ? err.message : String(err)}`, null, true);
    }
    if (res.status === 401) this.tokens.delete(this.config.refreshTokens[mailbox] ?? "");
    if (!res.ok) throw new MailProviderError(`Zoho Mail ${path.split("?")[0]} → HTTP ${res.status}`, res.status, res.status === 401 || res.status === 429 || res.status >= 500);
    return res;
  }

  private async json<T>(mailbox: InboundMailbox, path: string): Promise<T> {
    const res = await this.request(mailbox, path);
    const env = (await res.json()) as ZohoEnvelope<T>;
    if (env.data === undefined) throw new MailProviderError(`Zoho Mail ${path.split("?")[0]} returned no data (${env.status?.description ?? "unknown"})`, res.status, false);
    return env.data;
  }

  private async accountId(mailbox: InboundMailbox): Promise<string> {
    const known = this.accounts.get(mailbox);
    if (known) return known;
    const address = this.config.addresses[mailbox].toLowerCase();
    const list = await this.json<ZohoAccount[]>(mailbox, "/accounts");
    const match = list.find((a) => [a.primaryEmailAddress, a.mailboxAddress, ...(a.emailAddress ?? []).map((e) => e.mailId)].some((m) => m?.toLowerCase() === address));
    if (!match) throw new MailProviderError(`No Zoho Mail account for ${address}; set ZOHO_MAIL_ACCOUNT_ID_${MAILBOX_ENV[mailbox]}`, null, false);
    this.accounts.set(mailbox, match.accountId);
    return match.accountId;
  }

  private async inboxFolder(mailbox: InboundMailbox): Promise<string> {
    const known = this.inboxes.get(mailbox);
    if (known) return known;
    const account = await this.accountId(mailbox);
    const folders = await this.json<ZohoFolder[]>(mailbox, `/accounts/${encodeURIComponent(account)}/folders`);
    const inbox = folders.find((f) => f.folderType?.toLowerCase() === "inbox") ?? folders.find((f) => f.folderName?.toLowerCase() === "inbox");
    if (!inbox) throw new MailProviderError(`No Inbox folder for ${mailbox}@`, null, false);
    this.inboxes.set(mailbox, inbox.folderId);
    return inbox.folderId;
  }

  private summary(mailbox: InboundMailbox, m: ZohoListItem): MailSummary {
    const from = parseAddress(m.fromAddress ?? m.sender ?? "");
    return {
      mailbox,
      providerMessageId: String(m.messageId),
      folderId: String(m.folderId),
      subject: decodeSubject(m.subject ?? ""),
      fromAddress: from.address,
      fromName: from.name ?? (m.sender && !m.sender.includes("@") ? m.sender : null),
      toAddresses: parseAddressList(m.toAddress?.replace(/&lt;/g, "<").replace(/&gt;/g, ">")),
      ccAddresses: parseAddressList(m.ccAddress?.replace(/&lt;/g, "<").replace(/&gt;/g, ">")),
      receivedAt: new Date(Number(m.receivedTime ?? 0)).toISOString(),
      hasAttachments: m.hasAttachment === true || m.hasAttachment === "1",
      snippet: (m.summary ?? "").slice(0, 500),
    };
  }

  async listNew(mailbox: InboundMailbox, since: Date | null, limit: number): Promise<MailSummary[]> {
    const account = await this.accountId(mailbox);
    const folder = await this.inboxFolder(mailbox);
    const pageSize = Math.min(50, Math.max(1, limit));
    const out: MailSummary[] = [];
    // Newest first; stop at the first message at or before `since`.
    for (let start = 1; out.length < limit && start <= 1000; start += pageSize) {
      const page = await this.json<ZohoListItem[]>(
        mailbox,
        `/accounts/${encodeURIComponent(account)}/messages/view?folderId=${encodeURIComponent(folder)}&start=${start}&limit=${pageSize}&sortBy=date&sortorder=false&includeto=true`,
      );
      let reachedSeen = false;
      for (const item of page) {
        const s = this.summary(mailbox, item);
        if (since && Date.parse(s.receivedAt) <= since.getTime()) {
          reachedSeen = true;
          break;
        }
        out.push(s);
        if (out.length >= limit) break;
      }
      if (reachedSeen || page.length < pageSize) break;
    }
    return out.reverse();
  }

  async fetchMessage(mailbox: InboundMailbox, ref: MailRef): Promise<MailMessage> {
    const account = encodeURIComponent(await this.accountId(mailbox));
    const base = `/accounts/${account}/folders/${encodeURIComponent(ref.folderId)}/messages/${encodeURIComponent(ref.providerMessageId)}`;
    const [details, content, header, attachments] = await Promise.all([
      this.json<ZohoListItem>(mailbox, `${base}/details`),
      this.json<{ content?: string }>(mailbox, `${base}/content?includeBlockContent=true`),
      this.json<{ headerContent?: string | Record<string, string[]> }>(mailbox, `${base}/header?raw=true`),
      this.json<{ attachments?: { attachmentId: string; attachmentName?: string; attachmentSize?: number | string }[] }>(mailbox, `${base}/attachmentinfo`).catch(() => ({ attachments: [] })),
    ]);
    const rawHeaders = typeof header.headerContent === "string" ? header.headerContent : Object.entries(header.headerContent ?? {}).map(([k, v]) => `${k}: ${[v].flat().join(", ")}`).join("\n");
    const h = parseHeaders(rawHeaders);
    const summary = this.summary(mailbox, { ...details, messageId: ref.providerMessageId, folderId: ref.folderId });
    const html = content.content ?? "";
    return {
      ...summary,
      internetMessageId: messageIds(headerValue(h, "message-id"))[0] ?? null,
      inReplyTo: messageIds(headerValue(h, "in-reply-to"))[0] ?? null,
      references: messageIds(headerValue(h, "references")),
      bodyText: /<[a-z][\s\S]*>/i.test(html) ? htmlToText(html) : html.trim(),
      attachments: (attachments.attachments ?? []).map((a) => ({ attachmentId: String(a.attachmentId), fileName: a.attachmentName ?? "attachment", size: Number(a.attachmentSize ?? 0), contentType: null })),
      automated: isAutomated(h),
      bulk: isBulk(h),
      dmarc: dmarcVerdict(h),
    };
  }

  async fetchAttachment(mailbox: InboundMailbox, ref: MailRef, attachmentId: string): Promise<{ bytes: Uint8Array; contentType: string | null }> {
    const account = encodeURIComponent(await this.accountId(mailbox));
    const res = await this.request(
      mailbox,
      `/accounts/${account}/folders/${encodeURIComponent(ref.folderId)}/messages/${encodeURIComponent(ref.providerMessageId)}/attachments/${encodeURIComponent(attachmentId)}`,
      { raw: true },
    );
    return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get("content-type") };
  }
}

/** Decodes RFC 2047 encoded-words (=?utf-8?B?…?= / =?utf-8?Q?…?=) when Zoho passes them through. */
export function decodeSubject(subject: string): string {
  return subject.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (m, charset: string, enc: string, text: string) => {
    try {
      const bytes = enc.toUpperCase() === "B" ? Buffer.from(text, "base64") : Buffer.from(text.replace(/_/g, " ").replace(/=([0-9a-f]{2})/gi, (_x, hex: string) => String.fromCharCode(parseInt(hex, 16))), "binary");
      return new TextDecoder(charset.toLowerCase() === "utf8" ? "utf-8" : charset).decode(bytes);
    } catch {
      return m;
    }
  });
}
