import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudflareEmailClient, cloudflareAddress, cloudflareEmailConfigFromEnv, type CloudflareEmailConfig } from "./cloudflare";
import { emailClientFromEnv, resendEmailClientFromEnv } from "./index";
import { EmailError, emailRetryIsSafe } from "./types";

// Responses follow Cloudflare's API reference for
// POST /accounts/{account_id}/email/sending/send (not the live service).

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const res = (body: unknown, status = 200) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
const ok = (result: Partial<Record<"message_id" | "delivered" | "queued" | "permanent_bounces" | "suppressed_recipients", unknown>>) =>
  res({ success: true, errors: [], messages: [], result: { message_id: "cf_msg_1", delivered: [], queued: [], permanent_bounces: [], suppressed_recipients: [], ...result } });
const refused = (status: number, code: number | null, message: string) => res({ success: false, errors: [{ code, message }], messages: [], result: null }, status);

const MSG = { to: "pat@example.com", subject: "Hi", html: "<p>Hi</p>", text: "Hi", idempotencyKey: "lead-confirmation:1", tags: { template: "lead_confirmation" } };

function client(respond: () => Promise<Response> | Response, extra: Partial<CloudflareEmailConfig> = {}) {
  const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => respond());
  const c = new CloudflareEmailClient({
    accountId: ACCOUNT,
    apiToken: "cf_token",
    from: "Corin Commercial <notifications@notify.corincommercial.com>",
    replyTo: "deals@corincommercial.com",
    fetch: fetchMock as typeof fetch,
    ...extra,
  });
  return { c, fetchMock };
}

async function sendError(c: CloudflareEmailClient): Promise<EmailError> {
  const err = await c.send(MSG).then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(EmailError);
  return err as EmailError;
}

describe("Cloudflare email client", () => {
  it("posts the email with bearer auth to the account's send endpoint and returns the message id", async () => {
    const { c, fetchMock } = client(() => ok({ delivered: ["pat@example.com"] }));
    expect(c.name).toBe("cloudflare");
    expect(c.idempotent).toBe(false);
    expect(await c.send(MSG)).toEqual({ providerMessageId: "cf_msg_1" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/email/sending/send`);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer cf_token");
    expect(headers["content-type"]).toBe("application/json");
    expect(init.redirect).toBe("manual");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      from: { address: "notifications@notify.corincommercial.com", name: "Corin Commercial" },
      to: "pat@example.com",
      reply_to: "deals@corincommercial.com",
      subject: "Hi",
      html: "<p>Hi</p>",
      text: "Hi",
    });
    // No Resend-only fields: Cloudflare has no tags and no idempotency key.
    expect(body).not.toHaveProperty("tags");
    expect(JSON.stringify(body)).not.toContain("lead-confirmation:1");
  });

  it("uses the message's reply-to when it has one", async () => {
    const { c, fetchMock } = client(() => ok({ delivered: ["pat@example.com"] }));
    await c.send({ ...MSG, replyTo: "Pat Lee <pat.lee@corincommercial.com>" });
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string) as Record<string, unknown>;
    expect(body.reply_to).toEqual({ address: "pat.lee@corincommercial.com", name: "Pat Lee" });
  });

  it("counts a queued recipient as accepted", async () => {
    const { c } = client(() => ok({ queued: ["pat@example.com"] }));
    expect(await c.send(MSG)).toEqual({ providerMessageId: "cf_msg_1" });
  });

  it("treats a permanent bounce as a failure that sent nothing", async () => {
    const { c } = client(() => ok({ permanent_bounces: ["pat@example.com"] }));
    const err = await sendError(c);
    expect(err.message).toMatch(/bounced permanently/);
    expect(err.message).not.toContain("pat@example.com");
    expect(err.notSent).toBe(true);
  });

  it("treats a suppressed recipient as a failure that sent nothing", async () => {
    const { c } = client(() => ok({ suppressed_recipients: ["pat@example.com"] }));
    const err = await sendError(c);
    expect(err.message).toMatch(/suppression list/);
    expect(err.notSent).toBe(true);
  });

  it.each([
    [401, 10101, "Authentication error"],
    [403, 10102, "Forbidden"],
    [403, 10105, "account is not entitled"],
    [403, 10207, "email.sending.error.email.sending_disabled"],
    [400, null, "email.sending.error.invalid_request_schema"],
    [409, null, "email.sending.error.email.sending_not_ready"],
    [429, 10004, "email.sending.error.throttled"],
    [500, null, "email.sending.error.internal_server"],
  ])("a documented %i (%s) refusal says nothing was sent", async (status, code, message) => {
    const { c } = client(() => refused(status, code, message));
    const err = await sendError(c);
    expect(err.status).toBe(status);
    expect(err.notSent).toBe(true);
    expect(err.message).toContain(message);
    if (code !== null) expect(err.message).toContain(String(code));
    expect(emailRetryIsSafe(c, err)).toBe(true);
  });

  it.each([
    ["a timeout", () => Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError")), /timed out/],
    ["a network error", () => Promise.reject(new TypeError("fetch failed")), /fetch failed/],
    ["a gateway page without Cloudflare's error envelope", () => res("<html>502 Bad Gateway</html>", 502), /502/],
    ["a 200 that is not JSON", () => res("ok"), /unreadable/],
    ["a 200 with success false", () => res({ success: false, errors: [], result: null }), /unreadable/],
    ["a 200 that lists the recipient nowhere", () => ok({}), /not listed/],
    ["a 200 without a message id", () => ok({ delivered: ["pat@example.com"], message_id: "" }), /no message id/],
  ])("treats %s as unknown delivery, never safe to resend", async (_label, respond, pattern) => {
    const { c } = client(respond as () => Promise<Response>);
    const err = await sendError(c);
    expect(err.message).toMatch(pattern);
    expect(err.message).toMatch(/delivery unknown/);
    expect(err.notSent).toBe(false);
    expect(emailRetryIsSafe(c, err)).toBe(false);
  });

  it("gives up after its timeout and reports the delivery as unknown", async () => {
    const fetchMock = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const c = new CloudflareEmailClient({ accountId: ACCOUNT, apiToken: "t", from: "a@notify.example.com", replyTo: "r@example.com", fetch: fetchMock as unknown as typeof fetch, timeoutMs: 20 });
    const err = await sendError(c);
    expect(err.message).toMatch(/\(timed out\); delivery unknown/);
    expect(err.notSent).toBe(false);
  });

  it("refuses an unusable address before anything is sent", async () => {
    const { c, fetchMock } = client(() => ok({ delivered: ["x"] }));
    const err = await c.send({ ...MSG, to: "pät@exämple.com" }).catch((e: unknown) => e as EmailError);
    expect(err).toBeInstanceOf(EmailError);
    expect((err as EmailError).notSent).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("parses display-name addresses into Cloudflare's address object", () => {
    expect(cloudflareAddress("Corin Commercial <notifications@notify.corincommercial.com>")).toEqual({ address: "notifications@notify.corincommercial.com", name: "Corin Commercial" });
    expect(cloudflareAddress('"Lee, Pat" <pat@example.com>')).toEqual({ address: "pat@example.com", name: "Lee, Pat" });
    expect(cloudflareAddress("pat@example.com")).toBe("pat@example.com");
    expect(cloudflareAddress("<pat@example.com>")).toBe("pat@example.com");
  });
});

describe("Cloudflare email config", () => {
  it("is configured only with both an account id (32 hex characters) and a token", () => {
    expect(cloudflareEmailConfigFromEnv({})).toBeNull();
    expect(cloudflareEmailConfigFromEnv({ CLOUDFLARE_EMAIL_ACCOUNT_ID: ACCOUNT })).toBeNull();
    expect(cloudflareEmailConfigFromEnv({ CLOUDFLARE_EMAIL_TOKEN: "t" })).toBeNull();
    expect(cloudflareEmailConfigFromEnv({ CLOUDFLARE_EMAIL_ACCOUNT_ID: "not-an-id", CLOUDFLARE_EMAIL_TOKEN: "t" })).toBeNull();
    expect(cloudflareEmailConfigFromEnv({ CLOUDFLARE_EMAIL_ACCOUNT_ID: ACCOUNT, CLOUDFLARE_EMAIL_TOKEN: "t" })).toMatchObject({
      accountId: ACCOUNT,
      apiToken: "t",
      from: "Corin Commercial <notifications@notify.corincommercial.com>",
      replyTo: "deals@corincommercial.com",
    });
  });

  it("takes the sender from EMAIL_FROM and the reply-to from NOTIFY_REPLY_TO", () => {
    expect(cloudflareEmailConfigFromEnv({ CLOUDFLARE_EMAIL_ACCOUNT_ID: ACCOUNT, CLOUDFLARE_EMAIL_TOKEN: "t", EMAIL_FROM: "X <x@notify.example.com>", NOTIFY_REPLY_TO: "r@example.com" })).toMatchObject({
      from: "X <x@notify.example.com>",
      replyTo: "r@example.com",
    });
  });
});

describe("choosing the email client from env", () => {
  const CF = { CLOUDFLARE_EMAIL_ACCOUNT_ID: ACCOUNT, CLOUDFLARE_EMAIL_TOKEN: "t" };
  const RESEND = { RESEND_API_KEY: "re_k" };
  afterEach(() => vi.restoreAllMocks());

  it("prefers Cloudflare, falls back to Resend, and is null with neither", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(emailClientFromEnv({ ...CF, ...RESEND })?.name).toBe("cloudflare");
    expect(emailClientFromEnv(RESEND)?.name).toBe("resend");
    expect(emailClientFromEnv({})).toBeNull();
  });

  it("follows EMAIL_PROVIDER, and an unknown value or a missing key means no client", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(emailClientFromEnv({ ...CF, ...RESEND, EMAIL_PROVIDER: "resend" })?.name).toBe("resend");
    expect(emailClientFromEnv({ ...CF, ...RESEND, EMAIL_PROVIDER: "Cloudflare" })?.name).toBe("cloudflare");
    expect(emailClientFromEnv({ ...RESEND, EMAIL_PROVIDER: "cloudflare" })).toBeNull();
    expect(emailClientFromEnv({ ...CF, EMAIL_PROVIDER: "resend" })).toBeNull();
    expect(emailClientFromEnv({ ...CF, ...RESEND, EMAIL_PROVIDER: "sendgrid" })).toBeNull();
  });

  it("keeps newsletter and prospect mail on Resend only, never Cloudflare", () => {
    expect(resendEmailClientFromEnv(CF)).toBeNull();
    expect(resendEmailClientFromEnv({ ...CF, ...RESEND, EMAIL_PROVIDER: "cloudflare" })?.name).toBe("resend");
  });
});
