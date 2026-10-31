import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeApprovalGate } from "@/lib/compliance/approval-gate";
import { MemoryConsentLedger } from "@/lib/consent/ledger";
import { FakeEmailClient } from "@/lib/notify/email/fake";
import { AudienceError, FakeAudienceClient, ResendAudienceClient, audienceClientFromEnv, resendAudienceConfigFromEnv } from "./audience";
import { CURRENT_NEWSLETTER_CONSENT, NEWSLETTER_CONSENT_TEXTS, resolveNewsletterConsent } from "./consent";
import { NEWSLETTER_CONFIRMATION_TEMPLATE, renderNewsletterConfirmation } from "./email";
import { subscribeSchema } from "./schema";
import { CONFIRMATION_COOLDOWN_MS, NEWSLETTER_PREAPPROVED, NewsletterService, normalizeNewsletterEmail } from "./service";
import { MemorySubscriberStore } from "./store";
import { CONFIRM_TTL_SECONDS, signToken, tokenSecretFromEnv, verifyToken } from "./tokens";
import { handleResendEvent, signSvix, svixHeaders, verifySvixSignature } from "./webhook";

vi.mock("server-only", () => ({}));

const SECRET = "test-newsletter-secret-0123456789";
const BASE = "https://kuberacommercial.com";

function setup(overrides: Partial<ConstructorParameters<typeof NewsletterService>[0]> = {}) {
  const clock = { now: new Date("2026-11-05T12:00:00Z") };
  const store = new MemorySubscriberStore(() => clock.now);
  const ledger = new MemoryConsentLedger();
  const email = new FakeEmailClient();
  const audience = new FakeAudienceClient();
  const gate = new FakeApprovalGate("pending");
  const service = new NewsletterService({
    store,
    ledger,
    email,
    audience,
    gate,
    tokenSecret: SECRET,
    baseUrl: BASE,
    contactEmail: "deals@kuberacommercial.com",
    now: () => clock.now,
    ...overrides,
  });
  return { clock, store, ledger, email, audience, gate, service };
}

const tokenFromEmail = (html: string, purpose = "confirm") => {
  const m = new RegExp(`/newsletter/${purpose}\\?token=([^"&\\s<]+)`).exec(html);
  if (!m) throw new Error("no link in email");
  return decodeURIComponent(m[1]!);
};

afterEach(() => vi.restoreAllMocks());

describe("consent wording", () => {
  it("pins the hash of every published version", () => {
    const hashes = Object.fromEntries(Object.values(NEWSLETTER_CONSENT_TEXTS).map((t) => [t.id, createHash("sha256").update(t.text, "utf8").digest("hex")]));
    expect(hashes).toEqual({ "newsletter-signup-2026-11-05": "42bb791502cfb693ef7238df08775511701ffee5b24258defb0c8677952da108" });
  });

  it("covers email only, for the newsletter form, and resolves unknown versions to the current one", () => {
    const text = resolveNewsletterConsent("nope");
    expect(text.id).toBe(CURRENT_NEWSLETTER_CONSENT);
    expect(text.form).toBe("newsletter");
    expect(text.channels).toEqual(["email"]);
    expect(text.text).toMatch(/not a condition of any service/i);
  });
});

describe("tokens", () => {
  const id = "6f1b5c1e-2a8e-4c39-9a55-3d3c1b7f2a10";
  const now = new Date("2026-11-05T12:00:00Z");

  it("round-trips and keeps purposes apart", () => {
    const confirm = signToken(SECRET, "confirm", id, { ttlSeconds: CONFIRM_TTL_SECONDS, now });
    expect(verifyToken(SECRET, confirm, { now })).toEqual({ ok: true, purpose: "confirm", subscriberId: id });
    const unsub = signToken(SECRET, "unsubscribe", id, { now });
    expect(verifyToken(SECRET, unsub, { now })).toEqual({ ok: true, purpose: "unsubscribe", subscriberId: id });
    // A confirm token cannot be re-labelled as an unsubscribe token.
    const [, ...rest] = confirm.split(".");
    expect(verifyToken(SECRET, ["u", ...rest].join("."), { now })).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects expired, forged and malformed tokens", () => {
    const token = signToken(SECRET, "confirm", id, { ttlSeconds: 60, now });
    expect(verifyToken(SECRET, token, { now: new Date(now.getTime() + 61_000) })).toEqual({ ok: false, reason: "expired" });
    expect(verifyToken("another-secret-another-secret", token, { now })).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyToken(SECRET, token.replace(id, "11111111-1111-4111-8111-111111111111"), { now })).toEqual({ ok: false, reason: "bad_signature" });
    for (const bad of ["", "abc", "c.not-a-uuid.0.sig", `x.${id}.0.sig`, `c.${id}.abc.sig`, `c.${id}.0.`]) {
      expect(verifyToken(SECRET, bad, { now }), bad).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("unsubscribe tokens never expire", () => {
    const token = signToken(SECRET, "unsubscribe", id, { now });
    expect(verifyToken(SECRET, token, { now: new Date("2040-01-01T00:00:00Z") }).ok).toBe(true);
  });

  it("reads the secret from the environment, preferring the newsletter one", () => {
    expect(tokenSecretFromEnv({ NEWSLETTER_TOKEN_SECRET: "n".repeat(20), LEAD_TOKEN_SECRET: "l".repeat(20) })).toBe("n".repeat(20));
    expect(tokenSecretFromEnv({ LEAD_TOKEN_SECRET: "l".repeat(20) })).toBe("l".repeat(20));
    expect(tokenSecretFromEnv({ NEWSLETTER_TOKEN_SECRET: "short" })).toBeNull();
    expect(tokenSecretFromEnv({})).toBeNull();
  });
});

describe("signup request schema", () => {
  it("requires a valid email and a ticked consent box", () => {
    expect(subscribeSchema.safeParse({ email: " Pat@Example.com ", consent: true }).success).toBe(true);
    const unticked = subscribeSchema.safeParse({ email: "pat@example.com", consent: false });
    expect(unticked.success).toBe(false);
    expect(unticked.error?.issues[0]?.path).toEqual(["consent"]);
    expect(subscribeSchema.safeParse({ email: "nope", consent: true }).success).toBe(false);
    expect(subscribeSchema.safeParse({ email: "", consent: true }).success).toBe(false);
  });

  it("normalizes addresses", () => {
    expect(normalizeNewsletterEmail("  Pat@Example.COM ")).toBe("pat@example.com");
    expect(normalizeNewsletterEmail("pat@")).toBeNull();
    expect(normalizeNewsletterEmail(`${"a".repeat(200)}@example.com`)).toBeNull();
  });
});

describe("double opt-in", () => {
  it("signup records consent, creates a pending row and sends one confirmation email", async () => {
    const { service, store, ledger, email, audience } = setup({ gate: new FakeApprovalGate("approved") });
    const outcome = await service.subscribe({ email: "Pat@Example.com", page: "/insights", ip: "203.0.113.9", userAgent: "vitest" });
    expect(outcome).toEqual({ status: "pending_confirmation" });

    const row = (await store.findByEmail("pat@example.com"))!;
    expect(row).toMatchObject({ status: "pending", sourcePage: "/insights", consentTextVersion: CURRENT_NEWSLETTER_CONSENT, confirmationCount: 1 });
    expect(row.signupConsentEventId).toBeTruthy();

    expect(ledger.events).toHaveLength(1);
    expect(ledger.events[0]).toMatchObject({ eventType: "granted", form: "newsletter", channels: ["email"], email: "pat@example.com", ip: "203.0.113.9", page: "/insights", textVersion: CURRENT_NEWSLETTER_CONSENT });

    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]).toMatchObject({ to: "pat@example.com", subject: expect.stringContaining("Confirm") });
    expect(email.sent[0]!.html).toContain(`${BASE}/newsletter/confirm?token=`);
    // Nothing goes to the audience before the click.
    expect(audience.contacts.size).toBe(0);
  });

  it("the pre-approved confirmation template sends without asking the gate", async () => {
    const { service, email, gate } = setup();
    expect(NEWSLETTER_PREAPPROVED.has(`${NEWSLETTER_CONFIRMATION_TEMPLATE.id}@${NEWSLETTER_CONFIRMATION_TEMPLATE.version}`)).toBe(true);
    await service.subscribe({ email: "pat@example.com" });
    expect(email.sent).toHaveLength(1);
    expect(gate.requests).toHaveLength(0);
  });

  it("a template version that is not pre-approved goes to the gate and never sends while it is pending, rejected or expired", async () => {
    for (const status of ["pending", "rejected", "expired"] as const) {
      const gate = new FakeApprovalGate(status);
      const { service, email } = setup({ gate, preApproved: new Set() });
      const outcome = await service.subscribe({ email: "pat@example.com" });
      expect(outcome.status).toBe("unavailable");
      expect(email.sent, status).toHaveLength(0);
      expect(gate.requests).toHaveLength(1);
      expect(gate.requests[0]).toMatchObject({ kind: "email", templateId: "newsletter_confirmation@1" });
    }
    const approved = new FakeApprovalGate("approved");
    const { service, email } = setup({ gate: approved, preApproved: new Set() });
    expect((await service.subscribe({ email: "pat@example.com" })).status).toBe("pending_confirmation");
    expect(email.sent).toHaveLength(1);
  });

  it("clicking the emailed link confirms, writes a confirmed ledger row and adds the contact to the audience", async () => {
    const { service, store, ledger, email, audience, clock } = setup();
    await service.subscribe({ email: "pat@example.com" });
    const token = tokenFromEmail(email.sent[0]!.html);

    clock.now = new Date("2026-11-05T12:30:00Z");
    const outcome = await service.confirm(token, { ip: "203.0.113.20", userAgent: "mail-client" });
    expect(outcome).toEqual({ status: "confirmed" });

    const row = (await store.findByEmail("pat@example.com"))!;
    expect(row).toMatchObject({ status: "confirmed", confirmedAt: "2026-11-05T12:30:00.000Z", audienceError: null });
    expect(row.confirmedConsentEventId).toBeTruthy();
    expect(row.audienceSyncedAt).toBeTruthy();
    expect(ledger.events.map((e) => e.eventType)).toEqual(["granted", "confirmed"]);
    expect(ledger.events[1]).toMatchObject({ ip: "203.0.113.20", textVersion: CURRENT_NEWSLETTER_CONSENT });
    expect(audience.contacts.get("pat@example.com")).toMatchObject({ unsubscribed: false });

    // Pressing it twice is harmless and writes nothing more.
    expect(await service.confirm(token)).toEqual({ status: "already_confirmed" });
    expect(ledger.events).toHaveLength(2);
  });

  it("an unconfirmed signup is never added to the audience and an expired link does not confirm", async () => {
    const { service, store, audience, email, clock } = setup();
    await service.subscribe({ email: "pat@example.com" });
    const token = tokenFromEmail(email.sent[0]!.html);
    clock.now = new Date(clock.now.getTime() + (CONFIRM_TTL_SECONDS + 5) * 1000);
    expect(await service.confirm(token)).toEqual({ status: "invalid", reason: "expired" });
    expect((await store.findByEmail("pat@example.com"))!.status).toBe("pending");
    expect(audience.contacts.size).toBe(0);
  });

  it("rejects forged links, unsubscribe links used as confirm links, and unknown subscribers", async () => {
    const { service } = setup();
    expect((await service.confirm("c.6f1b5c1e-2a8e-4c39-9a55-3d3c1b7f2a10.0.forged")).status).toBe("invalid");
    const unsub = signToken(SECRET, "unsubscribe", "6f1b5c1e-2a8e-4c39-9a55-3d3c1b7f2a10");
    expect(await service.confirm(unsub)).toEqual({ status: "invalid", reason: "malformed" });
    const unknown = signToken(SECRET, "confirm", "6f1b5c1e-2a8e-4c39-9a55-3d3c1b7f2a10", { ttlSeconds: 60, now: new Date("2026-11-05T12:00:00Z") });
    expect(await service.confirm(unknown)).toEqual({ status: "invalid", reason: "unknown_subscriber" });
  });

  it("an audience failure leaves the subscriber confirmed and records the error for a retry", async () => {
    const { service, store, audience, email } = setup();
    await service.subscribe({ email: "pat@example.com" });
    audience.failNext = new AudienceError("Resend audience create 500", 500);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await service.confirm(tokenFromEmail(email.sent[0]!.html))).toEqual({ status: "confirmed" });
    const row = (await store.findByEmail("pat@example.com"))!;
    expect(row.status).toBe("confirmed");
    expect(row.audienceError).toContain("500");
    expect(row.audienceSyncedAt).toBeNull();
  });

  it("without an audience configured, confirmation is recorded and flagged", async () => {
    const { service, store, email } = setup({ audience: null });
    await service.subscribe({ email: "pat@example.com" });
    expect(await service.confirm(tokenFromEmail(email.sent[0]!.html))).toEqual({ status: "confirmed" });
    expect((await store.findByEmail("pat@example.com"))!.audienceError).toBe("audience not configured");
  });
});

describe("signup edge cases", () => {
  it("throttles repeat signups for a pending address and allows another after the cooldown", async () => {
    const { service, email, clock, ledger } = setup();
    expect((await service.subscribe({ email: "pat@example.com" })).status).toBe("pending_confirmation");
    expect((await service.subscribe({ email: "pat@example.com" })).status).toBe("throttled");
    expect(email.sent).toHaveLength(1);
    expect(ledger.events).toHaveLength(1);

    clock.now = new Date(clock.now.getTime() + CONFIRMATION_COOLDOWN_MS + 1_000);
    expect((await service.subscribe({ email: "pat@example.com" })).status).toBe("pending_confirmation");
    expect(email.sent).toHaveLength(2);
    // Each send has its own idempotency key.
    expect(new Set(email.sent.map((m) => m.idempotencyKey)).size).toBe(2);
  });

  it("does not email an address that is already confirmed", async () => {
    const { service, email } = setup();
    await service.subscribe({ email: "pat@example.com" });
    await service.confirm(tokenFromEmail(email.sent[0]!.html));
    expect((await service.subscribe({ email: "pat@example.com" })).status).toBe("already_subscribed");
    expect(email.sent).toHaveLength(1);
  });

  it("refuses to take signups when email or the token secret is not configured", async () => {
    expect((await setup({ email: null }).service.subscribe({ email: "pat@example.com" })).status).toBe("unavailable");
    const noSecret = setup({ tokenSecret: null });
    expect((await noSecret.service.subscribe({ email: "pat@example.com" })).status).toBe("unavailable");
    expect(noSecret.store.rows.size).toBe(0);
    expect((await setup().service.subscribe({ email: "nope" })).status).toBe("invalid_email");
  });

  it("fails closed when the consent ledger cannot record the grant", async () => {
    const { service, store, email, ledger } = setup();
    vi.spyOn(ledger, "record").mockRejectedValueOnce(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await service.subscribe({ email: "pat@example.com" })).status).toBe("unavailable");
    expect(store.rows.size).toBe(0);
    expect(email.sent).toHaveLength(0);
  });

  it("leaves the row retryable when the email provider fails", async () => {
    const { service, store, email } = setup();
    email.failNext = Object.assign(new Error("Resend 500"), { name: "EmailError", status: 500 }) as never;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await service.subscribe({ email: "pat@example.com" })).status).toBe("unavailable");
    const row = (await store.findByEmail("pat@example.com"))!;
    expect(row.confirmationSentAt).toBeNull();
    // No cooldown applies, so an immediate retry sends.
    expect((await service.subscribe({ email: "pat@example.com" })).status).toBe("pending_confirmation");
    expect(email.sent).toHaveLength(1);
  });
});

describe("unsubscribe", () => {
  async function confirmed() {
    const ctx = setup();
    await ctx.service.subscribe({ email: "pat@example.com" });
    await ctx.service.confirm(tokenFromEmail(ctx.email.sent[0]!.html));
    const row = (await ctx.store.findByEmail("pat@example.com"))!;
    return { ...ctx, row };
  }

  it("a signed link unsubscribes, writes a revoked ledger row and flags the audience contact", async () => {
    const { service, store, ledger, audience, row, clock } = await confirmed();
    const link = service.unsubscribeUrl(row.id)!;
    const token = decodeURIComponent(link.split("token=")[1]!);

    clock.now = new Date("2026-12-01T09:00:00Z");
    expect(await service.unsubscribeWithToken(token, { ip: "203.0.113.30" })).toEqual({ status: "unsubscribed" });
    expect(await store.findByEmail("pat@example.com")).toMatchObject({ status: "unsubscribed", unsubscribedAt: "2026-12-01T09:00:00.000Z" });
    expect(ledger.events.map((e) => e.eventType)).toEqual(["granted", "confirmed", "revoked"]);
    expect(audience.contacts.get("pat@example.com")!.unsubscribed).toBe(true);
    expect(await service.unsubscribeWithToken(token)).toEqual({ status: "already_unsubscribed" });
    expect(ledger.events).toHaveLength(3);
  });

  it("a confirm link cannot unsubscribe", async () => {
    const { service, row } = await confirmed();
    const confirm = signToken(SECRET, "confirm", row.id, { ttlSeconds: 60, now: new Date("2026-11-05T12:00:00Z") });
    expect(await service.unsubscribeWithToken(confirm)).toEqual({ status: "invalid", reason: "malformed" });
  });

  it("a Resend unsubscribe event by address revokes consent; unknown addresses are ignored", async () => {
    const { service, store, ledger } = await confirmed();
    expect(await service.unsubscribeByEmail("PAT@example.com")).toEqual({ status: "unsubscribed" });
    expect((await store.findByEmail("pat@example.com"))!.status).toBe("unsubscribed");
    expect(ledger.events.at(-1)).toMatchObject({ eventType: "revoked", form: "newsletter" });
    expect(await service.unsubscribeByEmail("stranger@example.com")).toEqual({ status: "invalid", reason: "unknown_subscriber" });
  });

  it("a person who unsubscribed can sign up again and must confirm again", async () => {
    const { service, store, email, row, clock } = await confirmed();
    await service.unsubscribeByEmail("pat@example.com");
    clock.now = new Date(clock.now.getTime() + 60_000);
    expect((await service.subscribe({ email: "pat@example.com" })).status).toBe("pending_confirmation");
    expect((await store.findById(row.id))!.status).toBe("pending");
    expect(email.sent).toHaveLength(2);
    expect(await service.confirm(tokenFromEmail(email.sent[1]!.html))).toEqual({ status: "confirmed" });
  });

  it("a pending address that unsubscribes is never touched in the audience", async () => {
    const { service, audience, email } = setup();
    await service.subscribe({ email: "pat@example.com" });
    expect(email.sent).toHaveLength(1);
    await service.unsubscribeByEmail("pat@example.com");
    expect(audience.contacts.size).toBe(0);
  });

  it("a unsubscribed address cannot be confirmed by an old link", async () => {
    const { service, email } = setup();
    await service.subscribe({ email: "pat@example.com" });
    const token = tokenFromEmail(email.sent[0]!.html);
    await service.unsubscribeByEmail("pat@example.com");
    expect(await service.confirm(token)).toEqual({ status: "invalid", reason: "unsubscribed" });
  });
});

describe("confirmation email", () => {
  it("renders the link, the licence line and no forbidden claims", async () => {
    const { subject, html, text } = await renderNewsletterConfirmation({ confirmUrl: `${BASE}/newsletter/confirm?token=abc`, contactEmail: "deals@kuberacommercial.com" });
    expect(subject).toMatch(/confirm/i);
    expect(html).toContain("/newsletter/confirm?token=abc");
    expect(text).toContain("/newsletter/confirm?token=abc");
    expect(html).toMatch(/Real estate broker, California Department of Real Estate/);
    expect(`${html}\n${text}`).not.toMatch(/\bapproved\b|qualified for|will call you today|guaranteed/i);
  });
});

describe("Resend audience client", () => {
  const config = { apiKey: "re_test", audienceId: "aud_1" };

  function client(responses: Response[]) {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), method: String(init?.method), body: JSON.parse(String(init?.body)) });
      return responses.shift()!;
    }) as unknown as typeof fetch;
    return { calls, audience: new ResendAudienceClient({ ...config, fetch: fetchImpl }) };
  }

  it("creates a contact in the configured audience", async () => {
    const { calls, audience } = client([new Response(JSON.stringify({ object: "contact", id: "c_1" }), { status: 200 })]);
    expect(await audience.upsert({ email: "pat@example.com", unsubscribed: false })).toEqual({ contactId: "c_1" });
    expect(calls[0]).toMatchObject({ url: "https://api.resend.com/audiences/aud_1/contacts", method: "POST", body: { email: "pat@example.com", unsubscribed: false } });
  });

  it("falls back to updating the contact when it already exists", async () => {
    const { calls, audience } = client([new Response("exists", { status: 422 }), new Response(JSON.stringify({ id: "c_1" }), { status: 200 })]);
    expect(await audience.upsert({ email: "pat@example.com", unsubscribed: true })).toEqual({ contactId: "c_1" });
    expect(calls[1]).toMatchObject({ url: "https://api.resend.com/audiences/aud_1/contacts/pat%40example.com", method: "PATCH", body: { unsubscribed: true } });
  });

  it("raises on other failures", async () => {
    const { audience } = client([new Response("boom", { status: 500 })]);
    await expect(audience.upsert({ email: "pat@example.com", unsubscribed: false })).rejects.toBeInstanceOf(AudienceError);
  });

  it("is configured only when both the key and the audience id are set", () => {
    expect(resendAudienceConfigFromEnv({ RESEND_API_KEY: "k", RESEND_AUDIENCE_ID: "a" })).toEqual({ apiKey: "k", audienceId: "a" });
    expect(resendAudienceConfigFromEnv({ RESEND_API_KEY: "k" })).toBeNull();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(audienceClientFromEnv({})).toBeNull();
  });
});

describe("Resend webhook", () => {
  const secret = `whsec_${Buffer.from("webhook-signing-key").toString("base64")}`;
  const now = new Date("2026-11-05T12:00:00Z");
  const ts = Math.floor(now.getTime() / 1000);
  const body = JSON.stringify({ type: "contact.updated", data: { email: "pat@example.com", unsubscribed: true, audience_id: "aud_1" } });

  function headers(overrides: Partial<{ id: string; ts: number; sig: string }> = {}) {
    const id = overrides.id ?? "msg_1";
    const t = overrides.ts ?? ts;
    return svixHeaders(new Headers({ "svix-id": id, "svix-timestamp": String(t), "svix-signature": overrides.sig ?? signSvix(secret, id, t, body) }));
  }

  it("accepts a correctly signed payload and rejects tampering, stale timestamps and missing headers", () => {
    expect(verifySvixSignature(secret, body, headers(), now)).toBe(true);
    expect(verifySvixSignature(secret, `${body} `, headers(), now)).toBe(false);
    expect(verifySvixSignature("whsec_" + Buffer.from("other").toString("base64"), body, headers(), now)).toBe(false);
    expect(verifySvixSignature(secret, body, headers({ ts: ts - 3600, sig: signSvix(secret, "msg_1", ts - 3600, body) }), now)).toBe(false);
    expect(verifySvixSignature(secret, body, svixHeaders(new Headers()), now)).toBe(false);
    expect(verifySvixSignature(secret, body, headers({ sig: "v1,AAAA" }), now)).toBe(false);
  });

  it("accepts any matching signature in a rotated list", () => {
    const good = signSvix(secret, "msg_1", ts, body);
    expect(verifySvixSignature(secret, body, headers({ sig: `v1,AAAA ${good}` }), now)).toBe(true);
  });

  it("unsubscribes on contact.updated and spam complaints, and ignores other events and other audiences", async () => {
    const { service, store, email } = setup();
    await service.subscribe({ email: "pat@example.com" });
    await service.confirm(tokenFromEmail(email.sent[0]!.html));

    expect(await handleResendEvent({ type: "contact.updated", data: { email: "pat@example.com", unsubscribed: false, audience_id: "aud_1" } }, service, { audienceId: "aud_1" })).toMatchObject({ handled: false });
    expect(await handleResendEvent({ type: "contact.updated", data: { email: "pat@example.com", unsubscribed: true, audience_id: "aud_other" } }, service, { audienceId: "aud_1" })).toMatchObject({ handled: false, ignored: "other audience" });
    expect(await handleResendEvent({ type: "email.delivered", data: {} }, service)).toMatchObject({ handled: false });
    expect((await store.findByEmail("pat@example.com"))!.status).toBe("confirmed");

    expect(await handleResendEvent(JSON.parse(body), service, { audienceId: "aud_1" })).toEqual({ handled: true, unsubscribed: 1 });
    expect((await store.findByEmail("pat@example.com"))!.status).toBe("unsubscribed");
  });

  it("treats a spam complaint as an unsubscribe", async () => {
    const { service, store, email } = setup();
    await service.subscribe({ email: "pat@example.com" });
    await service.confirm(tokenFromEmail(email.sent[0]!.html));
    expect(await handleResendEvent({ type: "email.complained", data: { to: ["pat@example.com"] } }, service)).toEqual({ handled: true, unsubscribed: 1 });
    expect((await store.findByEmail("pat@example.com"))!.status).toBe("unsubscribed");
  });
});
