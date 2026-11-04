import { describe, expect, it } from "vitest";
import { assertReadOnlyMethods, MailflareClient, mailflareConfigFromEnv, mailflareOrigin, readHeaderBlock, READ_ONLY_JMAP_METHODS, type MailflareConfig } from "./mailflare";
import { mailProviderFromEnv } from "./provider";
import { dmarcVerdict, parseHeaders, trustedDmarcVerdict } from "./text";
import { MailProviderError } from "./types";

// A Mailflare stand-in shaped after its JMAP handler (src/lib/jmap/handler.ts,
// session.ts, mailboxes.ts, email-objects.ts, blobs.ts in hieunc229/mailflare
// v0.5.4): one account per key, each address a top-level Mailbox with a role
// "inbox" child, Email/query sorted by receivedAt with position/limit, and
// /jmap/download serving raw MIME or attachment bytes.

const BASE = "https://mail.corincommercial.test";
const ACCOUNT = "usr_1";
const DEALS_TOP = "mb:acct:deals";
const DEALS_INBOX = "mb:role:deals:inbox";

type Email = {
  id: string;
  receivedAt: string;
  subject?: string;
  from?: { name: string | null; email: string }[];
  raw?: string;
  text?: string;
  html?: string;
  attachments?: { blobId: string; name: string; type: string; size: number; disposition: string }[];
};

type Call = { url: string; method: string; auth: string | null; redirect: RequestRedirect | undefined; methods: string[] };

function mailflareFake(emails: Email[], opts: { download?: (blobId: string) => Response | undefined; session?: () => Response | undefined; api?: () => Response | undefined } = {}) {
  const calls: Call[] = [];
  const byId = new Map(emails.map((e) => [e.id, e]));
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as { methodCalls: [string, Record<string, unknown>, string][] }) : null;
    calls.push({ url, method: init?.method ?? "GET", auth: new Headers(init?.headers).get("authorization"), redirect: init?.redirect, methods: body?.methodCalls.map((c) => c[0]) ?? [] });
    const u = new URL(url);
    if (u.pathname === "/jmap/session") {
      return opts.session?.() ?? Response.json({ primaryAccounts: { "urn:ietf:params:jmap:mail": ACCOUNT }, apiUrl: "https://elsewhere.test/jmap/api", downloadUrl: "https://elsewhere.test/d/{blobId}" });
    }
    if (u.pathname === "/jmap/api") {
      const override = opts.api?.();
      if (override) return override;
      const responses = body!.methodCalls.map(([name, args, id]) => {
        if (name === "Mailbox/get") {
          return [name, { list: [
            { id: "mb:acct:docs", name: "docs@corincommercial.com", parentId: null, role: null },
            { id: "mb:role:docs:inbox", name: "Inbox", parentId: "mb:acct:docs", role: "inbox" },
            { id: DEALS_TOP, name: "Deals Desk <deals@corincommercial.com>", parentId: null, role: null },
            { id: "mb:role:deals:sent", name: "Sent", parentId: DEALS_TOP, role: "sent" },
            { id: DEALS_INBOX, name: "Inbox", parentId: DEALS_TOP, role: "inbox" },
          ] }, id];
        }
        if (name === "Email/query") {
          const after = (args.filter as { after?: string } | undefined)?.after;
          const sorted = [...emails].filter((e) => !after || Date.parse(e.receivedAt) >= Date.parse(after)).sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
          const position = Number(args.position ?? 0);
          return [name, { ids: sorted.slice(position, position + Number(args.limit)).map((e) => e.id), position }, id];
        }
        if (name === "Email/get") {
          const list = (args.ids as string[]).flatMap((eid) => {
            const e = byId.get(eid);
            if (!e) return [];
            const textPart = e.text !== undefined ? { partId: "1", type: "text/plain" } : null;
            const htmlPart = e.html !== undefined ? { partId: "2", type: "text/html" } : null;
            return [{
              id: e.id,
              blobId: `msg_${e.id}`,
              mailboxIds: { [DEALS_INBOX]: true },
              subject: e.subject ?? "Hello",
              from: e.from ?? [{ name: "Pat Lee", email: "Pat@Lender.test" }],
              to: [{ name: null, email: "deals@corincommercial.com" }],
              cc: null,
              receivedAt: e.receivedAt,
              hasAttachment: (e.attachments ?? []).some((a) => a.disposition !== "inline"),
              preview: (e.text ?? "").slice(0, 50),
              messageId: [`${e.id}@lender.test`],
              inReplyTo: null,
              references: null,
              textBody: textPart ? [textPart] : htmlPart ? [htmlPart] : [],
              htmlBody: htmlPart ? [htmlPart] : textPart ? [textPart] : [],
              bodyValues: { ...(e.text !== undefined ? { 1: { value: e.text } } : {}), ...(e.html !== undefined ? { 2: { value: e.html } } : {}) },
              attachments: e.attachments ?? [],
            }];
          });
          return [name, { list, notFound: [] }, id];
        }
        return ["error", { type: "unknownMethod" }, id];
      });
      return Response.json({ methodResponses: responses, sessionState: "s1" });
    }
    const download = /^\/jmap\/download\/([^/]+)\/([^/]+)\//.exec(u.pathname);
    if (download) {
      const blobId = decodeURIComponent(download[2]!);
      const override = opts.download?.(blobId);
      if (override) return override;
      if (blobId.startsWith("msg_")) {
        const e = byId.get(blobId.slice(4));
        return new Response(e?.raw ?? "Subject: x\r\n\r\nbody", { headers: { "content-type": "message/rfc822" } });
      }
      return new Response(new Uint8Array([37, 80, 68, 70]), { headers: { "content-type": "application/pdf", "content-length": "4" } });
    }
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function client(fetchImpl: typeof fetch, overrides: Partial<MailflareConfig> = {}) {
  return new MailflareClient({
    baseUrl: BASE,
    keys: { deals: "mf_key_deals", docs: "mf_key_docs" },
    addresses: { deals: "deals@corincommercial.com", docs: "docs@corincommercial.com", lenders: "lenders@corincommercial.com", vendors: "vendors@corincommercial.com", closing: "closing@corincommercial.com" },
    trustedAuthServIds: ["mx.cloudflare.net"],
    fetch: fetchImpl,
    ...overrides,
  });
}

const RAW_CF_PASS = [
  "Authentication-Results: mx.cloudflare.net; dkim=pass header.d=lender.test; dmarc=pass header.from=lender.test; spf=pass smtp.mailfrom=lender.test",
  "From: Pat Lee <pat@lender.test>",
  "Subject: Term sheet",
  "",
  "body that is never read",
].join("\r\n");

describe("Mailflare config", () => {
  it("needs an https URL and a key; per-mailbox keys override the shared one", () => {
    expect(mailflareConfigFromEnv({})).toBeNull();
    expect(mailflareConfigFromEnv({ MAILFLARE_URL: "https://mail.example.test" })).toBeNull();
    expect(mailflareConfigFromEnv({ MAILFLARE_URL: "http://mail.example.test", MAILFLARE_JMAP_KEY: "k" })).toBeNull();
    const c = mailflareConfigFromEnv({ MAILFLARE_URL: "https://mail.example.test/some/path?x=1", MAILFLARE_JMAP_KEY: "shared", MAILFLARE_JMAP_KEY_DOCS: "docs-only" })!;
    expect(c.baseUrl).toBe("https://mail.example.test");
    expect(c.keys).toMatchObject({ deals: "shared", docs: "docs-only", closing: "shared" });
    expect(c.addresses.lenders).toBe("lenders@corincommercial.com");
    expect(c.trustedAuthServIds).toEqual(["mx.cloudflare.net"]);
    expect(mailflareConfigFromEnv({ MAILFLARE_URL: "https://m.test", MAILFLARE_JMAP_KEY: "k", MAILFLARE_TRUSTED_AUTHSERV_IDS: " MX.Cloudflare.net, mx2.test " })!.trustedAuthServIds).toEqual(["mx.cloudflare.net", "mx2.test"]);
  });

  it("accepts plain http only for localhost and rejects credentials in the URL", () => {
    expect(mailflareOrigin("http://localhost:8787")).toBe("http://localhost:8787");
    expect(mailflareOrigin("https://user:pw@mail.test")).toBeNull();
    expect(mailflareOrigin("not a url")).toBeNull();
  });
});

describe("mail provider choice", () => {
  const zoho = { ZOHO_MAIL_CLIENT_ID: "id", ZOHO_MAIL_CLIENT_SECRET: "s", ZOHO_MAIL_REFRESH_TOKEN: "r" };
  const mailflare = { MAILFLARE_URL: "https://mail.test", MAILFLARE_JMAP_KEY: "k" };

  it("prefers Mailflare when configured, honours MAIL_PROVIDER, and explains when nothing is set", () => {
    expect(mailProviderFromEnv({ ...zoho, ...mailflare }).provider?.name).toBe("mailflare");
    expect(mailProviderFromEnv(zoho).provider?.name).toBe("zoho");
    expect(mailProviderFromEnv({ ...zoho, ...mailflare, MAIL_PROVIDER: "zoho" }).provider?.name).toBe("zoho");
    expect(mailProviderFromEnv({ ...zoho, MAIL_PROVIDER: "mailflare" })).toMatchObject({ provider: null, reason: expect.stringMatching(/MAILFLARE_URL/) });
    expect(mailProviderFromEnv({ MAIL_PROVIDER: "gmail" })).toMatchObject({ provider: null, reason: expect.stringMatching(/gmail/) });
    expect(mailProviderFromEnv({})).toMatchObject({ provider: null });
  });
});

describe("Mailflare connector is read-only", () => {
  it("only knows the read methods", () => {
    expect([...READ_ONLY_JMAP_METHODS]).toEqual(["Mailbox/get", "Email/query", "Email/get"]);
  });

  it.each(["Email/set", "EmailSubmission/set", "Mailbox/set", "Email/import", "Email/copy", "Identity/set", "Core/echo"])("refuses %s before anything is sent", (method) => {
    expect(() => assertReadOnlyMethods([["Email/get", {}, "a"], [method, {}, "b"]])).toThrow(MailProviderError);
  });

  it("issues only read methods and only to the configured origin, never following redirects", async () => {
    const { calls, fetchImpl } = mailflareFake([
      { id: "e1", receivedAt: "2026-11-02T10:00:00.000Z", raw: RAW_CF_PASS, text: "Hi", attachments: [{ blobId: "att_1", name: "T12.pdf", type: "application/pdf", size: 4, disposition: "attachment" }] },
    ]);
    const c = client(fetchImpl);
    const [s] = await c.listNew("deals", null, 10);
    await c.fetchMessage("deals", s!);
    await c.fetchAttachment("deals", s!, "att_1");
    const methods = calls.flatMap((x) => x.methods);
    expect(new Set(methods)).toEqual(new Set(["Mailbox/get", "Email/query", "Email/get"]));
    for (const call of calls) {
      expect(new URL(call.url).origin).toBe(BASE);
      expect(call.redirect).toBe("manual");
      expect(call.auth).toBe("Bearer mf_key_deals");
    }
  });
});

describe("Mailflare listing", () => {
  const emails: Email[] = [1, 2, 3, 4, 5].map((n) => ({ id: `e${n}`, receivedAt: `2026-11-0${n}T09:00:00.000Z`, text: `msg ${n}` }));

  it("reads the Inbox of the right mailbox, newest first in pages, and returns oldest first", async () => {
    const { calls, fetchImpl } = mailflareFake(emails);
    const out = await client(fetchImpl).listNew("deals", null, 3);
    expect(out.map((m) => m.providerMessageId)).toEqual(["e3", "e4", "e5"]);
    expect(out[2]).toMatchObject({ mailbox: "deals", folderId: DEALS_INBOX, fromAddress: "pat@lender.test", fromName: "Pat Lee", toAddresses: ["deals@corincommercial.com"], receivedAt: "2026-11-05T09:00:00.000Z" });
    const query = calls.find((c) => c.methods.includes("Email/query"));
    expect(query).toBeTruthy();
  });

  it("skips stored ids without counting them, and drops messages at or before `since`", async () => {
    const { fetchImpl } = mailflareFake(emails);
    const known = async (ids: string[]) => new Set(ids.filter((id) => id === "e5" || id === "e4"));
    const out = await client(fetchImpl).listNew("deals", new Date("2026-11-02T09:00:00.000Z"), 10, known);
    // e2 is exactly at `since` (Email/query's `after` is inclusive) and is dropped.
    expect(out.map((m) => m.providerMessageId)).toEqual(["e3"]);
  });

  it("fails clearly when the key cannot see the mailbox or it has no Inbox", async () => {
    const { fetchImpl } = mailflareFake([]);
    await expect(client(fetchImpl, { keys: { lenders: "k" } }).listNew("lenders", null, 5)).rejects.toThrow(/No Mailflare mailbox for lenders@/);
  });
});

describe("Mailflare message", () => {
  it("takes the text part as the body and headers from the raw MIME", async () => {
    const raw = ["Auto-Submitted: auto-replied", "List-Unsubscribe: <mailto:u@x.test>", RAW_CF_PASS].join("\r\n");
    const { fetchImpl } = mailflareFake([{ id: "e1", receivedAt: "2026-11-02T10:00:00.000Z", raw, text: "Thanks, attached.", html: "<p>ignored</p>", attachments: [
      { blobId: "att_1", name: "T12.pdf", type: "application/pdf", size: 4, disposition: "attachment" },
      { blobId: "att_logo", name: "logo.png", type: "image/png", size: 9, disposition: "inline" },
    ] }]);
    const c = client(fetchImpl);
    const m = await c.fetchMessage("deals", { providerMessageId: "e1", folderId: DEALS_INBOX });
    expect(m).toMatchObject({ bodyText: "Thanks, attached.", internetMessageId: "e1@lender.test", automated: true, bulk: true, dmarc: "pass", hasAttachments: true });
    expect(m.attachments).toEqual([{ attachmentId: "att_1", fileName: "T12.pdf", size: 4, contentType: "application/pdf" }]);
  });

  it("falls back to the HTML part as plain text", async () => {
    const { fetchImpl } = mailflareFake([{ id: "e1", receivedAt: "2026-11-02T10:00:00.000Z", raw: RAW_CF_PASS, html: "<p>NOI is &gt; $1.2M</p><script>x()</script>" }]);
    const m = await client(fetchImpl).fetchMessage("deals", { providerMessageId: "e1", folderId: DEALS_INBOX });
    expect(m.bodyText).toBe("NOI is > $1.2M");
  });

  it("ignores sender-written Authentication-Results and lets a trusted fail win", async () => {
    const forgedOnly = ["Authentication-Results: mx.lender.test; dmarc=pass", "Subject: x", "", "b"].join("\r\n");
    const realFailForgedPass = ["Authentication-Results: mx.cloudflare.net; dmarc=fail header.from=bank.test", "Authentication-Results: mx.cloudflare.net; dmarc=pass header.from=bank.test", "Subject: x", "", "b"].join("\r\n");
    const { fetchImpl } = mailflareFake([
      { id: "forged", receivedAt: "2026-11-02T10:00:00.000Z", raw: forgedOnly, text: "" },
      { id: "mixed", receivedAt: "2026-11-02T11:00:00.000Z", raw: realFailForgedPass, text: "" },
    ]);
    const c = client(fetchImpl);
    expect((await c.fetchMessage("deals", { providerMessageId: "forged", folderId: DEALS_INBOX })).dmarc).toBe("unknown");
    expect((await c.fetchMessage("deals", { providerMessageId: "mixed", folderId: DEALS_INBOX })).dmarc).toBe("fail");
  });

  it("reads raw MIME only up to the end of the headers", async () => {
    let pulls = 0;
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        pulls++;
        if (pulls === 1) ctrl.enqueue(enc.encode("Subject: big\r\nX-A: 1\r\n\r\nstart of a 20 MB body"));
        else ctrl.enqueue(new Uint8Array(1024 * 1024));
      },
    });
    expect(await readHeaderBlock(new Response(stream))).toBe("Subject: big\r\nX-A: 1");
    expect(pulls).toBeLessThanOrEqual(2);
  });
});

describe("Mailflare errors", () => {
  it("treats a flagged-attachment 409 as final, without retrying", async () => {
    const { calls, fetchImpl } = mailflareFake([], { download: (blobId) => (blobId === "att_bad" ? new Response("flagged", { status: 409 }) : undefined) });
    const err = await client(fetchImpl).fetchAttachment("deals", { providerMessageId: "e1", folderId: DEALS_INBOX }, "att_bad").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MailProviderError);
    expect(err).toMatchObject({ status: 409, retryable: false });
    expect(calls.filter((c) => c.url.includes("att_bad"))).toHaveLength(1);
  });

  it("refuses redirects instead of following them", async () => {
    const { fetchImpl } = mailflareFake([], { session: () => new Response(null, { status: 302, headers: { location: "https://evil.test/jmap/session" } }) });
    await expect(client(fetchImpl).listNew("deals", null, 5)).rejects.toMatchObject({ status: 302, retryable: false });
  });

  it("retries throttling and server errors, not a bad key or a JMAP request error", async () => {
    for (const [status, retryable] of [[401, false], [403, false], [429, true], [503, true]] as const) {
      const { fetchImpl } = mailflareFake([], { session: () => new Response("x", { status }) });
      await expect(client(fetchImpl).listNew("deals", null, 5)).rejects.toMatchObject({ status, retryable });
    }
    const { fetchImpl } = mailflareFake([], { api: () => Response.json({ methodResponses: [["error", { type: "serverFail" }, "m"]] }) });
    await expect(client(fetchImpl).listNew("deals", null, 5)).rejects.toMatchObject({ retryable: true });
    const bad = mailflareFake([], { api: () => Response.json({ methodResponses: [["error", { type: "invalidArguments" }, "m"]] }) });
    await expect(client(bad.fetchImpl).listNew("deals", null, 5)).rejects.toMatchObject({ retryable: false });
  });

  it("rejects attachments over the size limit", async () => {
    const { fetchImpl } = mailflareFake([], { download: () => new Response("x", { headers: { "content-length": String(60 * 1024 * 1024) } }) });
    await expect(client(fetchImpl).fetchAttachment("deals", { providerMessageId: "e1", folderId: DEALS_INBOX }, "att_huge")).rejects.toThrow(/over the/);
  });
});

describe("trusted DMARC verdict", () => {
  const ids = ["mx.cloudflare.net"];
  it("counts only trusted receivers, takes the topmost, and lets a fail win", () => {
    expect(trustedDmarcVerdict(parseHeaders("Authentication-Results: mx.cloudflare.net; dmarc=pass"), ids)).toBe("pass");
    expect(trustedDmarcVerdict(parseHeaders("Authentication-Results: MX.Cloudflare.net 1; dmarc=none"), ids)).toBe("none");
    expect(trustedDmarcVerdict(parseHeaders("Authentication-Results: spoof.test; dmarc=pass"), ids)).toBe("unknown");
    expect(trustedDmarcVerdict(parseHeaders("Authentication-Results: mx.cloudflare.net; dmarc=none\nAuthentication-Results: mx.cloudflare.net; dmarc=pass"), ids)).toBe("none");
    expect(trustedDmarcVerdict(parseHeaders("Authentication-Results: mx.cloudflare.net; dmarc=pass\nAuthentication-Results: mx.cloudflare.net; dmarc=fail"), ids)).toBe("fail");
    expect(trustedDmarcVerdict(parseHeaders("Authentication-Results: spoof.test; dmarc=fail\nAuthentication-Results: mx.cloudflare.net; dmarc=pass"), ids)).toBe("pass");
    expect(trustedDmarcVerdict(parseHeaders("Subject: x"), ids)).toBe("unknown");
  });

  it("leaves the Zoho path's verdict unchanged", () => {
    expect(dmarcVerdict(parseHeaders("Authentication-Results: mx.zoho.com; dmarc=pass"))).toBe("pass");
    expect(dmarcVerdict(parseHeaders("Authentication-Results: anything; dmarc=fail"))).toBe("fail");
  });
});
