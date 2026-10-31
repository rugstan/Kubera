// Route tests for the newsletter endpoints: the shared request guard (origin,
// content type, rate limit, Turnstile), the signup/confirm/unsubscribe flow
// end to end with fakes, the generic signup answer, and the signed webhook.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ supabaseAdmin: () => null, DOCUMENT_BUCKET: "deal-documents" }));

const { MemoryRateLimiter, setRateLimiter } = await import("@/lib/ratelimit");
const { FakeTurnstileVerifier } = await import("@/lib/turnstile/fake");
const { setTurnstileVerifier } = await import("@/lib/turnstile");
const { MemoryConsentLedger } = await import("@/lib/consent/ledger");
const { FakeApprovalGate } = await import("@/lib/compliance/approval-gate");
const { FakeEmailClient } = await import("@/lib/notify/email/fake");
const { FakeAudienceClient } = await import("@/lib/newsletter/audience");
const { NewsletterService } = await import("@/lib/newsletter/service");
const { MemorySubscriberStore } = await import("@/lib/newsletter/store");
const { setNewsletterService } = await import("@/lib/newsletter/runtime");
const { signSvix } = await import("@/lib/newsletter/webhook");

const subscribe = await import("./subscribe/route");
const confirm = await import("./confirm/route");
const unsubscribe = await import("./unsubscribe/route");
const webhook = await import("./webhook/route");

const ORIGIN = "https://kuberacommercial.com";
const SECRET = "route-test-secret-0123456789";

let turnstile: InstanceType<typeof FakeTurnstileVerifier>;
let store: InstanceType<typeof MemorySubscriberStore>;
let ledger: InstanceType<typeof MemoryConsentLedger>;
let email: InstanceType<typeof FakeEmailClient>;
let audience: InstanceType<typeof FakeAudienceClient>;
let ip = 0;
let tokenCounter = 0;

function build(overrides: { email?: InstanceType<typeof FakeEmailClient> | null } = {}) {
  store = new MemorySubscriberStore();
  ledger = new MemoryConsentLedger();
  email = new FakeEmailClient();
  audience = new FakeAudienceClient();
  setNewsletterService(
    new NewsletterService({
      store,
      ledger,
      email: overrides.email === undefined ? email : overrides.email,
      audience,
      gate: new FakeApprovalGate("pending"),
      tokenSecret: SECRET,
      baseUrl: ORIGIN,
      contactEmail: "deals@kuberacommercial.com",
    }),
  );
}

function post(path: string, body: unknown, opts: { origin?: string | null; contentType?: string; turnstile?: boolean; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = {
    "content-type": opts.contentType ?? "application/json",
    "user-agent": "vitest",
    "x-forwarded-for": `198.51.100.${++ip % 250}`,
    ...(opts.origin === null ? {} : { origin: opts.origin ?? ORIGIN }),
    ...(opts.turnstile === false ? {} : { "x-turnstile-token": turnstile.issue(`t${++tokenCounter}`, "qualify") }),
    ...opts.headers,
  };
  return new Request(`${ORIGIN}${path}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
}

const tokenFrom = (html: string, purpose = "confirm") => decodeURIComponent(new RegExp(`/newsletter/${purpose}\\?token=([^"&\\s<]+)`).exec(html)![1]!);

beforeEach(() => {
  setRateLimiter(new MemoryRateLimiter());
  turnstile = new FakeTurnstileVerifier();
  setTurnstileVerifier(turnstile);
  build();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setRateLimiter(undefined);
  setTurnstileVerifier(undefined);
  setNewsletterService(undefined);
});

describe("POST /api/newsletter/subscribe", () => {
  const good = { email: "pat@example.com", consent: true, consentMeta: { page: "/insights" } };

  it("accepts a signup, records consent and sends the confirmation email", async () => {
    const res = await subscribe.POST(post("/api/newsletter/subscribe", good));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, message: expect.stringContaining("not subscribed until you click") });
    expect(email.sent).toHaveLength(1);
    expect(ledger.events[0]).toMatchObject({ eventType: "granted", form: "newsletter", page: "/insights", userAgent: "vitest" });
    expect(audience.contacts.size).toBe(0);
  });

  it("gives the same answer for an address that is already subscribed", async () => {
    const first = await subscribe.POST(post("/api/newsletter/subscribe", good));
    const confirmRes = await confirm.POST(post("/api/newsletter/confirm", { token: tokenFrom(email.sent[0]!.html) }));
    expect(confirmRes.status).toBe(200);
    const again = await subscribe.POST(post("/api/newsletter/subscribe", good));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(await first.json());
    expect(email.sent).toHaveLength(1);
  });

  it("rejects an unticked consent box and a bad email with field issues", async () => {
    const unticked = await subscribe.POST(post("/api/newsletter/subscribe", { email: "pat@example.com", consent: false }));
    expect(unticked.status).toBe(400);
    expect((await unticked.json()).issues).toEqual([{ path: "consent", message: "Tick the box to subscribe." }]);
    const bad = await subscribe.POST(post("/api/newsletter/subscribe", { email: "nope", consent: true }));
    expect(bad.status).toBe(400);
    expect(ledger.events).toHaveLength(0);
    expect(email.sent).toHaveLength(0);
  });

  it("rejects a forged origin, a wrong content type and a missing captcha token", async () => {
    expect((await subscribe.POST(post("/api/newsletter/subscribe", good, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await subscribe.POST(post("/api/newsletter/subscribe", good, { origin: null }))).status).toBe(403);
    expect((await subscribe.POST(post("/api/newsletter/subscribe", JSON.stringify(good), { contentType: "text/plain" }))).status).toBe(415);
    expect((await subscribe.POST(post("/api/newsletter/subscribe", good, { turnstile: false }))).status).toBe(403);
    expect(ledger.events).toHaveLength(0);
    expect(email.sent).toHaveLength(0);
  });

  it("rate limits repeat signups from one address", async () => {
    const sameIp = { "x-forwarded-for": "203.0.113.77" };
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await subscribe.POST(post("/api/newsletter/subscribe", { ...good, email: `p${i}@example.com` }, { headers: sameIp }))).status);
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });

  it("answers 503 when email is not configured, and stores nothing", async () => {
    build({ email: null });
    const res = await subscribe.POST(post("/api/newsletter/subscribe", good));
    expect(res.status).toBe(503);
    expect(store.rows.size).toBe(0);
    expect(ledger.events).toHaveLength(0);
  });
});

describe("confirm and unsubscribe endpoints", () => {
  async function signedUp() {
    await subscribe.POST(post("/api/newsletter/subscribe", { email: "pat@example.com", consent: true }));
    return tokenFrom(email.sent[0]!.html);
  }

  it("confirms with a valid token and reports an expired or invalid one", async () => {
    const token = await signedUp();
    const ok = await confirm.POST(post("/api/newsletter/confirm", { token }, { turnstile: false }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, status: "confirmed" });
    expect(audience.contacts.get("pat@example.com")).toMatchObject({ unsubscribed: false });

    const bad = await confirm.POST(post("/api/newsletter/confirm", { token: "c.6f1b5c1e-2a8e-4c39-9a55-3d3c1b7f2a10.0.forgedsignature" }, { turnstile: false }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).reason).toBe("invalid");
    expect((await confirm.POST(post("/api/newsletter/confirm", {}, { turnstile: false }))).status).toBe(400);
    expect((await confirm.POST(post("/api/newsletter/confirm", { token }, { origin: "https://evil.example", turnstile: false }))).status).toBe(403);
  });

  it("unsubscribes with a signed link and writes a revoked row", async () => {
    const token = await signedUp();
    await confirm.POST(post("/api/newsletter/confirm", { token }, { turnstile: false }));
    const row = [...store.rows.values()][0]!;
    const link = new NewsletterService({ store, ledger, email, audience, gate: new FakeApprovalGate("pending"), tokenSecret: SECRET, baseUrl: ORIGIN, contactEmail: "x@y.z" }).unsubscribeUrl(row.id)!;
    const unsubToken = decodeURIComponent(link.split("token=")[1]!);

    const res = await unsubscribe.POST(post("/api/newsletter/unsubscribe", { token: unsubToken }, { turnstile: false }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "unsubscribed" });
    expect(ledger.events.map((e) => e.eventType)).toEqual(["granted", "confirmed", "revoked"]);
    expect(audience.contacts.get("pat@example.com")!.unsubscribed).toBe(true);

    // The confirmation token is not an unsubscribe token.
    expect((await unsubscribe.POST(post("/api/newsletter/unsubscribe", { token }, { turnstile: false }))).status).toBe(400);
  });
});

describe("POST /api/newsletter/webhook", () => {
  const secret = `whsec_${Buffer.from("route-webhook-key").toString("base64")}`;
  const event = { type: "contact.updated", data: { email: "pat@example.com", unsubscribed: true } };

  function signed(body: string, overrides: { ts?: number; sig?: string } = {}) {
    const ts = overrides.ts ?? Math.floor(Date.now() / 1000);
    return new Request(`${ORIGIN}/api/newsletter/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "svix-id": "msg_1", "svix-timestamp": String(ts), "svix-signature": overrides.sig ?? signSvix(secret, "msg_1", ts, body) },
      body,
    });
  }

  it("answers 503 without a configured secret", async () => {
    expect((await webhook.POST(signed(JSON.stringify(event)))).status).toBe(503);
  });

  it("rejects bad signatures and applies a valid unsubscribe", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", secret);
    await subscribe.POST(post("/api/newsletter/subscribe", { email: "pat@example.com", consent: true }));
    await confirm.POST(post("/api/newsletter/confirm", { token: tokenFrom(email.sent[0]!.html) }, { turnstile: false }));

    const body = JSON.stringify(event);
    expect((await webhook.POST(signed(body, { sig: "v1,AAAA" }))).status).toBe(401);
    expect([...store.rows.values()][0]!.status).toBe("confirmed");

    const ok = await webhook.POST(signed(body));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, handled: true, unsubscribed: 1 });
    expect([...store.rows.values()][0]!.status).toBe("unsubscribed");
    expect(ledger.events.at(-1)).toMatchObject({ eventType: "revoked" });
  });

  it("rejects invalid JSON that is correctly signed", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", secret);
    expect((await webhook.POST(signed("not json"))).status).toBe(400);
  });
});
