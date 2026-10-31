import { describe, expect, it } from "vitest";
import { dmarcVerdict, htmlToText, isAutomated, isBulk, messageIds, parseAddressList, parseHeaders, stripQuotedReply } from "./text";
import { decodeSubject, ZohoMailClient, zohoMailConfigFromEnv, type ZohoMailConfig } from "./zoho";

const RAW_HEADERS = [
  "Message-ID: <ABC-123@mail.lender.test>",
  "In-Reply-To: <kc-outbound-77@kuberacommercial.com>",
  "References: <first@x.test>",
  "  <kc-outbound-77@kuberacommercial.com>",
  "Authentication-Results: mx.zoho.com; spf=pass; dkim=pass; dmarc=pass header.from=lender.test",
  "Subject: Re: terms",
].join("\r\n");

describe("text helpers", () => {
  it("parses folded headers, ids and auth results", () => {
    const h = parseHeaders(RAW_HEADERS);
    expect(messageIds(h.get("message-id")![0]!)).toEqual(["abc-123@mail.lender.test"]);
    expect(messageIds(h.get("references")![0]!)).toEqual(["first@x.test", "kc-outbound-77@kuberacommercial.com"]);
    expect(dmarcVerdict(h)).toBe("pass");
    expect(dmarcVerdict(parseHeaders("Authentication-Results: mx; dmarc=fail"))).toBe("fail");
    expect(dmarcVerdict(parseHeaders("X: y"))).toBe("unknown");
    expect(isAutomated(parseHeaders("Auto-Submitted: auto-replied"))).toBe(true);
    expect(isAutomated(parseHeaders("Auto-Submitted: no"))).toBe(false);
    expect(isBulk(parseHeaders("List-Unsubscribe: <mailto:u@x.test>"))).toBe(true);
  });

  it("converts HTML to text without markup or scripts", () => {
    const text = htmlToText('<html><head><style>p{}</style></head><body><p>Hi&nbsp;team,</p><script>alert(1)</script><p>NOI is &gt; $1.2M &amp; rising</p><ul><li>T-12</li></ul></body></html>');
    expect(text).toBe("Hi team,\nNOI is > $1.2M & rising\n- T-12");
  });

  it("strips quoted replies and parses address lists", () => {
    expect(stripQuotedReply("Thanks, attached.\n\nOn Mon, Nov 2, 2026 at 9:00 AM Kubera wrote:\n> old text")).toBe("Thanks, attached.");
    expect(stripQuotedReply("Line\n> quoted\nmore")).toBe("Line\nmore");
    expect(parseAddressList('"Lee, Pat" <Pat@Example.com>, ops@lender.test; x')).toEqual(["pat@example.com", "ops@lender.test"]);
    expect(decodeSubject("=?UTF-8?B?VGVybSBzaGVldCDigJMgSGFyYm9y?=")).toBe("Term sheet – Harbor");
  });
});

describe("Zoho Mail config", () => {
  it("needs a client and at least one refresh token; per-mailbox tokens override the shared one", () => {
    expect(zohoMailConfigFromEnv({})).toBeNull();
    expect(zohoMailConfigFromEnv({ ZOHO_MAIL_CLIENT_ID: "id", ZOHO_MAIL_CLIENT_SECRET: "s" })).toBeNull();
    const c = zohoMailConfigFromEnv({ ZOHO_MAIL_CLIENT_ID: "id", ZOHO_MAIL_CLIENT_SECRET: "s", ZOHO_MAIL_REFRESH_TOKEN: "shared", ZOHO_MAIL_REFRESH_TOKEN_DOCS: "docs-only", ZOHO_MAIL_ACCOUNT_ID_DEALS: "111" })!;
    expect(c.refreshTokens).toMatchObject({ deals: "shared", docs: "docs-only", lenders: "shared" });
    expect(c.accountIds).toEqual({ deals: "111" });
    expect(c.addresses.closing).toBe("closing@kuberacommercial.com");
  });
});

type Call = { url: string; method: string; auth: string | null; body?: string };

function zohoFake() {
  const calls: Call[] = [];
  let tokenCount = 0;
  const json = (data: unknown) => new Response(JSON.stringify({ status: { code: 200 }, data }), { status: 200, headers: { "content-type": "application/json" } });
  const fetchImpl = (async (input: string, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method ?? "GET", auth: (init.headers as Record<string, string> | undefined)?.authorization ?? null, body: init.body ? String(init.body) : undefined });
    if (url.startsWith("https://accounts.zoho.com/oauth/v2/token")) return new Response(JSON.stringify({ access_token: `tok-${++tokenCount}`, expires_in: 3600 }), { status: 200 });
    const path = new URL(url).pathname.replace("/api", "");
    if (path === "/accounts") return json([{ accountId: "222", primaryEmailAddress: "Lenders@kuberacommercial.com" }]);
    if (path === "/accounts/222/folders") return json([{ folderId: "9", folderName: "Sent", folderType: "Sent" }, { folderId: "10", folderName: "Inbox", folderType: "Inbox" }]);
    if (path === "/accounts/222/messages/view") {
      const start = Number(new URL(url).searchParams.get("start"));
      if (start > 1) return json([]);
      return json([
        { messageId: "m3", folderId: "10", subject: "Newest", fromAddress: "a@lender.test", receivedTime: String(Date.UTC(2026, 10, 3, 12)), hasAttachment: "1", toAddress: "&lt;lenders@kuberacommercial.com&gt;" },
        { messageId: "m2", folderId: "10", subject: "Middle", fromAddress: "b@lender.test", receivedTime: String(Date.UTC(2026, 10, 3, 11)), hasAttachment: "0" },
        { messageId: "m1", folderId: "10", subject: "Old", fromAddress: "c@lender.test", receivedTime: String(Date.UTC(2026, 10, 3, 9)), hasAttachment: "0" },
      ]);
    }
    if (path.endsWith("/details")) return json({ messageId: "m3", folderId: "10", subject: "=?utf-8?Q?Term_sheet?=", sender: "Jordan Chen", fromAddress: "Jordan Chen <j.chen@lender.test>", receivedTime: String(Date.UTC(2026, 10, 3, 12)), ccAddress: "ops@lender.test" });
    if (path.endsWith("/content")) return json({ content: "<div>Indicative terms attached.</div>" });
    if (path.endsWith("/header")) return json({ headerContent: RAW_HEADERS });
    if (path.endsWith("/attachmentinfo")) return json({ attachments: [{ attachmentId: "a1", attachmentName: "terms.pdf", attachmentSize: "1234" }] });
    if (path.endsWith("/attachments/a1")) return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), { status: 200, headers: { "content-type": "application/pdf" } });
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  const config: ZohoMailConfig = {
    clientId: "cid",
    clientSecret: "csecret",
    dc: "com",
    refreshTokens: { lenders: "refresh-lenders" },
    accountIds: {},
    addresses: { deals: "deals@kuberacommercial.com", docs: "docs@kuberacommercial.com", lenders: "lenders@kuberacommercial.com", vendors: "vendors@kuberacommercial.com", closing: "closing@kuberacommercial.com" },
    fetch: fetchImpl,
  };
  return { client: new ZohoMailClient(config), calls };
}

describe("Zoho Mail client", () => {
  it("refreshes the token once, resolves the account and inbox, and lists only new mail oldest first", async () => {
    const { client, calls } = zohoFake();
    expect(client.configured("lenders")).toBe(true);
    expect(client.configured("deals")).toBe(false);
    const listed = await client.listNew("lenders", new Date(Date.UTC(2026, 10, 3, 10)), 50);
    expect(listed.map((m) => m.providerMessageId)).toEqual(["m2", "m3"]);
    expect(listed[1]).toMatchObject({ mailbox: "lenders", folderId: "10", hasAttachments: true, toAddresses: ["lenders@kuberacommercial.com"] });
    const tokenCalls = calls.filter((c) => c.url.includes("/oauth/v2/token"));
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0]!.body).toContain("grant_type=refresh_token");
    expect(calls.filter((c) => c.url.includes("/api/")).every((c) => c.auth === "Zoho-oauthtoken tok-1")).toBe(true);
    expect(calls.find((c) => c.url.includes("/messages/view"))!.url).toContain("folderId=10");
  });

  it("fetches a full message with headers, body text and attachments", async () => {
    const { client } = zohoFake();
    const msg = await client.fetchMessage("lenders", { providerMessageId: "m3", folderId: "10" });
    expect(msg).toMatchObject({
      subject: "Term sheet",
      fromAddress: "j.chen@lender.test",
      fromName: "Jordan Chen",
      ccAddresses: ["ops@lender.test"],
      internetMessageId: "abc-123@mail.lender.test",
      inReplyTo: "kc-outbound-77@kuberacommercial.com",
      bodyText: "Indicative terms attached.",
      dmarc: "pass",
      automated: false,
      attachments: [{ attachmentId: "a1", fileName: "terms.pdf", size: 1234, contentType: null }],
    });
    const att = await client.fetchAttachment("lenders", msg, "a1");
    expect(att.contentType).toBe("application/pdf");
    expect([...att.bytes.slice(0, 4)]).toEqual([0x25, 0x50, 0x44, 0x46]);
  });

  it("fails clearly for a mailbox without a token", async () => {
    const { client } = zohoFake();
    await expect(client.listNew("deals", null, 10)).rejects.toMatchObject({ name: "MailProviderError", retryable: false });
  });
});
