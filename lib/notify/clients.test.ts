import { describe, expect, it, vi } from "vitest";
import { bookingLink, calcomBaseUrl } from "./calcom";
import { ResendEmailClient, resendConfigFromEnv } from "./email/resend";
import { EmailError } from "./email/types";
import { preApprovedFromEnv } from "./gate";
import { MemoryOptOutSink, TwentyOptOutSink } from "./optout";
import { maskPhone, phoneVariants, toE164 } from "./phone";
import { insideSmsWindow } from "./quiet-hours";
import { SmsError } from "./sms/types";
import { TelnyxSmsClient, telnyxConfigFromEnv } from "./sms/telnyx";

const res = (body: unknown, status = 200) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

describe("Resend client", () => {
  it("posts the email with bearer auth, an idempotency key and the default reply-to", async () => {
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => res({ id: "re_123" }));
    const client = new ResendEmailClient({ apiKey: "re_key", from: "Kubera Commercial <notifications@notify.kuberacommercial.com>", replyTo: "deals@kuberacommercial.com", fetch: fetchMock as typeof fetch });
    const out = await client.send({ to: "pat@example.com", subject: "Hi", html: "<p>Hi</p>", text: "Hi", idempotencyKey: "lead-confirmation:1", tags: { template: "lead_confirmation" } });
    expect(out.providerMessageId).toBe("re_123");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer re_key");
    expect(headers["idempotency-key"]).toBe("lead-confirmation:1");
    expect(JSON.parse(init.body as string)).toMatchObject({
      from: "Kubera Commercial <notifications@notify.kuberacommercial.com>",
      to: ["pat@example.com"],
      reply_to: "deals@kuberacommercial.com",
      tags: [{ name: "template", value: "lead_confirmation" }],
    });
  });

  it("sanitizes tag names and values so Resend never rejects the send", async () => {
    // Stub mimics Resend: 422 validation_error when a tag has anything but [A-Za-z0-9_-].
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { tags?: { name: string; value: string }[] };
      const bad = (body.tags ?? []).some((t) => !/^[A-Za-z0-9_-]{1,256}$/.test(t.name) || !/^[A-Za-z0-9_-]{1,256}$/.test(t.value));
      return bad ? res({ statusCode: 422, name: "validation_error", message: "Tags should only contain ASCII letters, numbers, underscores, or dashes" }, 422) : res({ id: "re_ok" });
    });
    const client = new ResendEmailClient({ apiKey: "k", from: "f", replyTo: "r", fetch: fetchMock as unknown as typeof fetch });
    const out = await client.send({ to: "a@b.co", subject: "s", html: "h", text: "t", tags: { template: "newsletter_confirmation@1", "kind.of": "x y", long: "a".repeat(400) } });
    expect(out.providerMessageId).toBe("re_ok");
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    const sent = JSON.parse(String(init.body)) as { tags: { name: string; value: string }[] };
    expect(sent.tags).toEqual([
      { name: "template", value: "newsletter_confirmation_1" },
      { name: "kind_of", value: "x_y" },
      { name: "long", value: "a".repeat(256) },
    ]);
  });

  it("raises an EmailError carrying the status", async () => {
    const client = new ResendEmailClient({ apiKey: "k", from: "f", replyTo: "r", fetch: (async () => res("rate limited", 429)) as typeof fetch });
    await expect(client.send({ to: "a@b.co", subject: "s", html: "h", text: "t" })).rejects.toMatchObject({ name: "EmailError", status: 429 });
    await expect(client.send({ to: "a@b.co", subject: "s", html: "h", text: "t" })).rejects.toBeInstanceOf(EmailError);
  });

  it("rejects a response without an id", async () => {
    const client = new ResendEmailClient({ apiKey: "k", from: "f", replyTo: "r", fetch: (async () => res({})) as typeof fetch });
    await expect(client.send({ to: "a@b.co", subject: "s", html: "h", text: "t" })).rejects.toThrow(/no message id/);
  });

  it("is configured only when RESEND_API_KEY is set", () => {
    expect(resendConfigFromEnv({})).toBeNull();
    expect(resendConfigFromEnv({ RESEND_API_KEY: "k" })).toMatchObject({ from: expect.stringContaining("notify.kuberacommercial.com"), replyTo: "deals@kuberacommercial.com" });
    expect(resendConfigFromEnv({ RESEND_API_KEY: "k", RESEND_FROM: "X <x@notify.example.com>", NOTIFY_REPLY_TO: "r@example.com" })).toMatchObject({ from: "X <x@notify.example.com>", replyTo: "r@example.com" });
  });
});

describe("Telnyx client", () => {
  it("posts the message to /v2/messages", async () => {
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => res({ data: { id: "40000000-aaaa" } }));
    const client = new TelnyxSmsClient({ apiKey: "KEY", from: "+13105550199", messagingProfileId: "prof_1", fetch: fetchMock as typeof fetch });
    const out = await client.send({ to: "+14155550100", text: "hello" });
    expect(out.providerMessageId).toBe("40000000-aaaa");
    expect(client.fromNumber).toBe("+13105550199");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.telnyx.com/v2/messages");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer KEY");
    expect(JSON.parse(init.body as string)).toEqual({ from: "+13105550199", to: "+14155550100", text: "hello", type: "SMS", messaging_profile_id: "prof_1" });
  });

  it("raises an SmsError on failure", async () => {
    const client = new TelnyxSmsClient({ apiKey: "k", from: "+1", fetch: (async () => res({ errors: [{ code: "40300" }] }, 403)) as typeof fetch });
    await expect(client.send({ to: "+14155550100", text: "x" })).rejects.toMatchObject({ name: "SmsError", status: 403 });
    await expect(client.send({ to: "+14155550100", text: "x" })).rejects.toBeInstanceOf(SmsError);
  });

  it("needs both the API key and the from number", () => {
    expect(telnyxConfigFromEnv({ TELNYX_API_KEY: "k" })).toBeNull();
    expect(telnyxConfigFromEnv({ TELNYX_FROM_NUMBER: "+13105550199" })).toBeNull();
    expect(telnyxConfigFromEnv({ TELNYX_API_KEY: "k", TELNYX_FROM_NUMBER: "+13105550199" })).toMatchObject({ apiKey: "k", from: "+13105550199" });
  });
});

describe("Twenty opt-out sink", () => {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const fakeTwenty = (people: Record<string, string[]>): typeof fetch =>
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (init?.method === "PATCH") return res({ data: { updatePerson: { id: "x" } } });
      const filter = decodeURIComponent(url.split("filter=")[1]?.split("&")[0] ?? "");
      const value = /"(.*)"/.exec(filter)?.[1] ?? "";
      return res({ data: { people: (people[value] ?? []).map((id) => ({ id })) } });
    }) as typeof fetch;

  it("patches smsOptOut on persons already tied to the number, without searching", async () => {
    calls.length = 0;
    const sink = new TwentyOptOutSink({ baseUrl: "https://crm.example.com", apiKey: "k", resolveKnownPersonIds: async () => ["p1", "p2"], fetch: fakeTwenty({}) });
    expect(await sink.setOptOut("+14155550100", true)).toEqual({ updated: 2 });
    expect(calls.map((c) => c.method)).toEqual(["PATCH", "PATCH"]);
    expect(calls[0]).toMatchObject({ url: "https://crm.example.com/rest/people/p1", body: { smsOptOut: true } });
  });

  it("falls back to searching the common phone formats", async () => {
    calls.length = 0;
    const sink = new TwentyOptOutSink({ baseUrl: "https://crm.example.com", apiKey: "k", fetch: fakeTwenty({ "(415) 555-0100": ["p9"] }) });
    expect(await sink.setOptOut("+14155550100", false)).toEqual({ updated: 1 });
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch).toMatchObject({ url: "https://crm.example.com/rest/people/p9", body: { smsOptOut: false } });
    expect(calls.filter((c) => c.method === "GET").length).toBeGreaterThan(1);
  });

  it("reports zero updates when no person matches", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sink = new TwentyOptOutSink({ baseUrl: "https://crm.example.com", apiKey: "k", fetch: fakeTwenty({}) });
    expect(await sink.setOptOut("+14155550100", true)).toEqual({ updated: 0 });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("throws on a Twenty error so the caller can note it", async () => {
    const sink = new TwentyOptOutSink({ baseUrl: "https://crm.example.com", apiKey: "k", resolveKnownPersonIds: async () => ["p1"], fetch: (async () => res("no", 500)) as typeof fetch });
    await expect(sink.setOptOut("+14155550100", true)).rejects.toThrow(/Twenty PATCH/);
  });

  it("memory sink records calls", async () => {
    const sink = new MemoryOptOutSink();
    await sink.setOptOut("+14155550100", true);
    expect(sink.calls).toEqual([{ phone: "+14155550100", optOut: true }]);
  });
});

describe("Cal.com booking link", () => {
  it("builds the link from a handle with prefill and attribution", () => {
    const url = new URL(bookingLink({ name: "Pat Lee", email: "pat@example.com", campaign: "lead-confirmation" }, "kubera/intro") as string);
    expect(url.origin + url.pathname).toBe("https://cal.com/kubera/intro");
    expect(url.searchParams.get("name")).toBe("Pat Lee");
    expect(url.searchParams.get("email")).toBe("pat@example.com");
    expect(url.searchParams.get("utm_source")).toBe("kubera");
  });

  it("accepts a full cal.com URL and rejects other hosts, other schemes and junk", () => {
    expect(calcomBaseUrl("https://cal.com/kubera/intro/")).toBe("https://cal.com/kubera/intro");
    expect(calcomBaseUrl("https://team.cal.com/intro")).toBe("https://team.cal.com/intro");
    expect(calcomBaseUrl("https://evil.example.com/kubera")).toBeNull();
    expect(calcomBaseUrl("http://cal.com/kubera")).toBeNull();
    expect(calcomBaseUrl("javascript:alert(1)")).toBeNull();
    expect(calcomBaseUrl("a/../../b")).toBeNull();
  });

  it("returns null when unset", () => {
    expect(bookingLink({ name: "Pat" }, "")).toBeNull();
    expect(bookingLink({}, null)).toBeNull();
  });
});

describe("phone helpers", () => {
  it("normalizes to E.164 the way the consent ledger does", () => {
    expect(toE164("(415) 555-0100")).toBe("+14155550100");
    expect(toE164("1-415-555-0100")).toBe("+14155550100");
    expect(toE164("+14155550100")).toBe("+14155550100");
    expect(toE164("+44 20 7946 0958")).toBe("+442079460958");
  });

  it("refuses numbers that cannot be E.164", () => {
    for (const bad of ["", null, undefined, "12", "555-0100", "+0123456789", "abc"]) expect(toE164(bad as string | null | undefined)).toBeNull();
  });

  it("formats variants and masks numbers for logs", () => {
    expect(phoneVariants("+14155550100")).toEqual(["+14155550100", "4155550100", "(415) 555-0100", "415-555-0100", "415.555.0100"]);
    expect(phoneVariants("+442079460958")).toEqual(["+442079460958"]);
    expect(maskPhone("+14155550100")).toBe("+141***0100");
  });
});

describe("quiet hours window", () => {
  it("is open from 8 a.m. Pacific (11:00 Eastern) to 9 p.m. Eastern", () => {
    // November: Eastern is UTC-5.
    expect(insideSmsWindow(new Date("2026-11-03T15:59:00Z"))).toBe(false); // 10:59 ET
    expect(insideSmsWindow(new Date("2026-11-03T16:00:00Z"))).toBe(true); // 11:00 ET
    expect(insideSmsWindow(new Date("2026-11-04T01:59:00Z"))).toBe(true); // 20:59 ET
    expect(insideSmsWindow(new Date("2026-11-04T02:00:00Z"))).toBe(false); // 21:00 ET
  });

  it("follows daylight saving time", () => {
    // July: Eastern is UTC-4, so 11:00 ET is 15:00Z.
    expect(insideSmsWindow(new Date("2026-07-15T14:59:00Z"))).toBe(false);
    expect(insideSmsWindow(new Date("2026-07-15T15:00:00Z"))).toBe(true);
  });
});

describe("pre-approval env", () => {
  it("parses id@version entries", () => {
    expect([...preApprovedFromEnv({ NOTIFY_PREAPPROVED_TEMPLATES: " Milestone_Update@1 , document_request@2,," })]).toEqual(["milestone_update@1", "document_request@2"]);
    expect(preApprovedFromEnv({}).size).toBe(0);
  });
});
