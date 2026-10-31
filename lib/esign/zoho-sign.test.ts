import { describe, expect, it } from "vitest";
import { EsignError, type FetchLike } from "./types";
import { ZOHO_SIGNATURE_HEADER, ZohoSignProvider, parseZohoWebhook, signZohoPayload, verifyZohoSignature, zohoSignConfigFromEnv, type ZohoSignConfig } from "./zoho-sign";

const config: ZohoSignConfig = { clientId: "cid", clientSecret: "csecret", refreshToken: "rtoken", dc: "com", webhookSecret: "whsec" };

type Call = { url: string; method: string; headers: Record<string, string>; body: string };

function mockFetch(handler: (call: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = init?.body instanceof URLSearchParams ? init.body.toString() : typeof init?.body === "string" ? init.body : "";
    const call = { url, method: init?.method ?? "GET", headers, body };
    calls.push(call);
    return handler(call, calls.length);
  };
  return { calls, fetchImpl };
}

const tokenResponse = (token = "at-1", expires = 3600) => Response.json({ access_token: token, expires_in: expires, token_type: "Bearer" });

const templateResponse = () =>
  Response.json({
    status: "success",
    templates: {
      template_id: "tmpl_1",
      actions: [
        { action_id: "act_b1", role: "Borrower 1", action_type: "SIGN" },
        { action_id: "act_b2", role: "Borrower 2", action_type: "SIGN" },
        { action_id: "act_br", role: "Broker", action_type: "SIGN" },
      ],
    },
  });

describe("Zoho Sign OAuth", () => {
  it("refreshes an access token from the refresh token and reuses it until expiry", async () => {
    let t = 1_000_000;
    const { calls, fetchImpl } = mockFetch((c) => (c.url.includes("/oauth/v2/token") ? tokenResponse(`at-${calls.length}`) : Response.json({ status: "success", requests: { request_status: "inprogress" } })));
    const z = new ZohoSignProvider(config, fetchImpl, () => t);
    await z.getStatus("r1");
    await z.getStatus("r1");
    const tokenCalls = calls.filter((c) => c.url.includes("/oauth/v2/token"));
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0]?.url).toBe("https://accounts.zoho.com/oauth/v2/token");
    expect(tokenCalls[0]?.body).toBe("refresh_token=rtoken&client_id=cid&client_secret=csecret&grant_type=refresh_token");
    expect(calls[1]?.headers.authorization).toBe("Zoho-oauthtoken at-1");

    t += 3600_000; // past expiry (minus the 60 s safety margin)
    await z.getStatus("r1");
    expect(calls.filter((c) => c.url.includes("/oauth/v2/token"))).toHaveLength(2);
  });

  it("refreshes once and retries on a 401", async () => {
    const { calls, fetchImpl } = mockFetch((c) => {
      if (c.url.includes("/oauth/v2/token")) return tokenResponse(`at-${calls.filter((x) => x.url.includes("oauth")).length}`);
      return c.headers.authorization === "Zoho-oauthtoken at-1" ? new Response("expired", { status: 401 }) : Response.json({ status: "success", requests: { request_status: "completed" } });
    });
    const z = new ZohoSignProvider(config, fetchImpl);
    expect(await z.getStatus("r1")).toBe("completed");
    expect(calls.map((c) => c.headers.authorization ?? "token")).toEqual(["token", "Zoho-oauthtoken at-1", "token", "Zoho-oauthtoken at-2"]);
  });

  it("collapses concurrent refreshes", async () => {
    const { calls, fetchImpl } = mockFetch((c) => (c.url.includes("oauth") ? tokenResponse() : Response.json({ status: "success", requests: { request_status: "inprogress" } })));
    const z = new ZohoSignProvider(config, fetchImpl);
    await Promise.all([z.getStatus("a"), z.getStatus("b"), z.getStatus("c")]);
    expect(calls.filter((c) => c.url.includes("oauth"))).toHaveLength(1);
  });

  it("surfaces OAuth errors reported with HTTP 200", async () => {
    const { fetchImpl } = mockFetch(() => Response.json({ error: "invalid_code" }));
    await expect(new ZohoSignProvider(config, fetchImpl).getStatus("r")).rejects.toThrow(/invalid_code/);
  });

  it("uses the configured data center and rejects unknown ones", async () => {
    const { calls, fetchImpl } = mockFetch((c) => (c.url.includes("oauth") ? tokenResponse() : Response.json({ status: "success", requests: { request_status: "inprogress" } })));
    await new ZohoSignProvider({ ...config, dc: "eu" }, fetchImpl).getStatus("r");
    expect(calls[0]?.url).toBe("https://accounts.zoho.eu/oauth/v2/token");
    expect(calls[1]?.url).toBe("https://sign.zoho.eu/api/v1/requests/r");
    expect(() => new ZohoSignProvider({ ...config, dc: "evil.example" })).toThrow(EsignError);
  });
});

describe("Zoho Sign requests", () => {
  it("creates a request from a template with prefilled fields and role-mapped signers", async () => {
    const { calls, fetchImpl } = mockFetch((c) => {
      if (c.url.includes("oauth")) return tokenResponse();
      if (c.url.endsWith("/templates/tmpl_1")) return templateResponse();
      return Response.json({
        status: "success",
        requests: {
          request_id: "req_9",
          request_status: "inprogress",
          actions: [
            { action_id: "a1", role: "Borrower 1", recipient_email: "b@x.co", is_embedded: true },
            { action_id: "a2", role: "Broker", recipient_email: "n@k.co", is_embedded: false },
          ],
        },
      });
    });
    const z = new ZohoSignProvider(config, fetchImpl);
    const created = await z.createFromTemplate({
      templateId: "tmpl_1",
      requestName: "MLDS RE 882",
      recipients: [
        { role: "borrower 1", name: "Borrower", email: "b@x.co", embedded: true, verifyByEmail: true },
        { role: "Broker", name: "Neeli", email: "n@k.co" },
      ],
      fields: { principal_amount: "$8,500,000.00" },
      reference: "disc_1",
    });
    expect(created).toEqual({
      requestId: "req_9",
      status: "in_progress",
      actions: [
        { actionId: "a1", role: "Borrower 1", email: "b@x.co", embedded: true },
        { actionId: "a2", role: "Broker", email: "n@k.co", embedded: false },
      ],
    });
    const create = calls.find((c) => c.url.endsWith("/createdocument"));
    expect(create?.url).toBe("https://sign.zoho.com/api/v1/templates/tmpl_1/createdocument");
    expect(create?.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(create?.body);
    expect(form.get("is_quicksend")).toBe("true");
    const data = JSON.parse(form.get("data") as string);
    expect(data.templates.field_data.field_text_data).toEqual({ principal_amount: "$8,500,000.00" });
    expect(data.templates.actions).toEqual([
      expect.objectContaining({ action_id: "act_b1", action_type: "SIGN", recipient_email: "b@x.co", is_embedded: true, verify_recipient: true, verification_type: "EMAIL" }),
      expect.objectContaining({ action_id: "act_br", recipient_email: "n@k.co", is_embedded: false, verify_recipient: false }),
    ]);
    expect(data.templates.notes).toBe("Reference disc_1");
  });

  it("fails when the template lacks a role", async () => {
    const { fetchImpl } = mockFetch((c) => (c.url.includes("oauth") ? tokenResponse() : templateResponse()));
    await expect(
      new ZohoSignProvider(config, fetchImpl).createFromTemplate({ templateId: "tmpl_1", requestName: "x", recipients: [{ role: "Guarantor", name: "G", email: "g@x.co" }], fields: {}, reference: "r" }),
    ).rejects.toThrow(/no role "Guarantor"/);
  });

  it("gets an embedded signing URL, downloads the signed PDF and recalls", async () => {
    const { calls, fetchImpl } = mockFetch((c) => {
      if (c.url.includes("oauth")) return tokenResponse();
      if (c.url.endsWith("/embedtoken")) return Response.json({ status: "success", sign_url: "https://sign.zoho.com/signembed/abc" });
      if (c.url.endsWith("/pdf")) return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]), { headers: { "content-type": "application/pdf" } });
      return Response.json({ status: "success" });
    });
    const z = new ZohoSignProvider(config, fetchImpl);
    expect(await z.embeddedSigningUrl("req_9", "a1", "https://kuberacommercial.com")).toBe("https://sign.zoho.com/signembed/abc");
    expect(new URLSearchParams(calls.find((c) => c.url.endsWith("/embedtoken"))?.body).get("host")).toBe("https://kuberacommercial.com");
    expect(Buffer.from(await z.downloadSigned("req_9")).toString("latin1")).toBe("%PDF-1");
    await z.recall("req_9", "Terms changed");
    expect(calls.at(-1)?.url).toBe("https://sign.zoho.com/api/v1/requests/req_9/recall");
  });

  it("raises on API errors", async () => {
    const { fetchImpl } = mockFetch((c) => (c.url.includes("oauth") ? tokenResponse() : new Response("nope", { status: 500 })));
    await expect(new ZohoSignProvider(config, fetchImpl).getStatus("r")).rejects.toMatchObject({ status: 500 });
  });
});

describe("Zoho Sign webhooks", () => {
  const body = JSON.stringify({
    requests: { request_id: "req_9", request_status: "completed" },
    notifications: { operation_type: "RequestCompleted", performed_by_email: "b@x.co", performed_at: 1_793_000_000_000 },
  });

  it("verifies the HMAC-SHA256 base64 signature over the raw body", () => {
    const z = new ZohoSignProvider(config);
    const sig = signZohoPayload(body, "whsec");
    expect(z.verifyWebhook(body, new Headers({ [ZOHO_SIGNATURE_HEADER]: sig }))).toBe(true);
    expect(z.verifyWebhook(`${body} `, new Headers({ [ZOHO_SIGNATURE_HEADER]: sig }))).toBe(false);
    expect(z.verifyWebhook(body, new Headers({ [ZOHO_SIGNATURE_HEADER]: signZohoPayload(body, "other") }))).toBe(false);
    expect(z.verifyWebhook(body, new Headers())).toBe(false);
    expect(verifyZohoSignature(body, "short", "whsec")).toBe(false);
  });

  it("fails closed without a webhook secret", () => {
    const z = new ZohoSignProvider({ ...config, webhookSecret: undefined });
    expect(z.verifyWebhook(body, new Headers({ [ZOHO_SIGNATURE_HEADER]: signZohoPayload(body, "") }))).toBe(false);
  });

  it("parses events into the normalized shape with a stable id", () => {
    const e = parseZohoWebhook(body);
    expect(e).toMatchObject({ provider: "zoho_sign", requestId: "req_9", type: "completed", actorEmail: "b@x.co", providerType: "RequestCompleted" });
    expect(e?.occurredAt.toISOString()).toBe(new Date(1_793_000_000_000).toISOString());
    expect(parseZohoWebhook(body)?.eventId).toBe(e?.eventId);
    expect(parseZohoWebhook(body.replace("RequestCompleted", "RequestViewed"))?.eventId).not.toBe(e?.eventId);
  });

  it.each([
    ["RequestSubmitted", "sent"],
    ["RequestViewed", "viewed"],
    ["RequestSigningSuccess", "recipient_signed"],
    ["RequestRejected", "declined"],
    ["RequestExpired", "expired"],
    ["RequestRecalled", "recalled"],
    ["RequestForwarded", "other"],
  ])("maps %s to %s", (op, type) => {
    expect(parseZohoWebhook(body.replace("RequestCompleted", op))?.type).toBe(type);
  });

  it("ignores malformed bodies", () => {
    expect(parseZohoWebhook("not json")).toBeNull();
    expect(parseZohoWebhook(JSON.stringify({ requests: {} }))).toBeNull();
  });
});

describe("Zoho Sign config", () => {
  it("is null unless the OAuth credentials are all present", () => {
    expect(zohoSignConfigFromEnv({ NODE_ENV: "test" })).toBeNull();
    expect(zohoSignConfigFromEnv({ NODE_ENV: "test", ZOHO_SIGN_CLIENT_ID: "a", ZOHO_SIGN_CLIENT_SECRET: "b" })).toBeNull();
    expect(zohoSignConfigFromEnv({ NODE_ENV: "test", ZOHO_SIGN_CLIENT_ID: "a", ZOHO_SIGN_CLIENT_SECRET: "b", ZOHO_SIGN_REFRESH_TOKEN: "c" })).toEqual({
      clientId: "a",
      clientSecret: "b",
      refreshToken: "c",
      dc: "com",
      webhookSecret: undefined,
    });
  });
});
