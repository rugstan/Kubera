import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { consentState } from "../consent";
import { DAYTIME, makeHarness, type Harness } from "../testing";
import { parseKeyword } from "./keywords";
import { verifyTelnyxSignature } from "./signature";
import { handleTelnyxWebhook, type TelnyxWebhookDeps } from "./webhook";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUBLIC_KEY_B64 = (publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(-32).toString("base64");
const PHONE = "+14155550100";
const NOW = DAYTIME;
const ts = () => String(Math.floor(NOW.getTime() / 1000));

function signed(body: unknown, opts: { key?: KeyObject; timestamp?: string; raw?: string } = {}): Request {
  const raw = opts.raw ?? JSON.stringify(body);
  const timestamp = opts.timestamp ?? ts();
  const signature = sign(null, Buffer.from(`${timestamp}|${raw}`), opts.key ?? privateKey).toString("base64");
  return new Request("https://kuberacommercial.com/api/webhooks/telnyx", {
    method: "POST",
    headers: { "content-type": "application/json", "telnyx-signature-ed25519": signature, "telnyx-timestamp": timestamp },
    body: raw,
  });
}

const inbound = (text: string, id = "msg_in_1", from = PHONE) => ({
  data: {
    event_type: "message.received",
    id: `evt_${id}`,
    occurred_at: NOW.toISOString(),
    payload: { id, direction: "inbound", text, from: { phone_number: from }, to: [{ phone_number: "+13105550199" }] },
  },
});

function deps(h: Harness, over: Partial<TelnyxWebhookDeps> = {}): TelnyxWebhookDeps {
  return {
    publicKey: PUBLIC_KEY_B64,
    store: h.store,
    notifier: h.notifier,
    ledger: h.ledger,
    consent: h.consent,
    optOut: h.optOut,
    staffEmails: ["deals@kuberacommercial.com"],
    now: () => NOW,
    ...over,
  };
}

describe("signature verification", () => {
  const raw = '{"a":1}';
  const input = (over = {}) => ({
    publicKeyBase64: PUBLIC_KEY_B64,
    signatureBase64: sign(null, Buffer.from(`${ts()}|${raw}`), privateKey).toString("base64"),
    timestamp: ts(),
    rawBody: raw,
    now: NOW,
    ...over,
  });

  it("accepts a valid signature", () => expect(verifyTelnyxSignature(input())).toBe(true));
  it("rejects a tampered body", () => expect(verifyTelnyxSignature(input({ rawBody: '{"a":2}' }))).toBe(false));
  it("rejects a stale timestamp", () => {
    const old = String(Math.floor(NOW.getTime() / 1000) - 3600);
    expect(verifyTelnyxSignature(input({ timestamp: old, signatureBase64: sign(null, Buffer.from(`${old}|${raw}`), privateKey).toString("base64") }))).toBe(false);
  });
  it("rejects a signature from another key", () => {
    const other = generateKeyPairSync("ed25519").privateKey;
    expect(verifyTelnyxSignature(input({ signatureBase64: sign(null, Buffer.from(`${ts()}|${raw}`), other).toString("base64") }))).toBe(false);
  });
  it("rejects missing headers and malformed keys", () => {
    expect(verifyTelnyxSignature(input({ signatureBase64: null }))).toBe(false);
    expect(verifyTelnyxSignature(input({ timestamp: null }))).toBe(false);
    expect(verifyTelnyxSignature(input({ publicKeyBase64: "short" }))).toBe(false);
  });
});

describe("keyword parsing", () => {
  it.each([
    ["STOP", "stop"],
    ["stop", "stop"],
    ["Stop.", "stop"],
    ["STOPALL", "stop"],
    ["UNSUBSCRIBE", "stop"],
    ["opt out", "stop"],
    ["STOP calling me", "stop"],
    ["CANCEL", "stop"],
    ["END", "stop"],
    ["QUIT", "stop"],
    ["HELP", "help"],
    ["help!", "help"],
    ["START", "start"],
    ["unstop", "start"],
  ])("%s -> %s", (text, expected) => expect(parseKeyword(text)).toBe(expected));

  it.each(["", "Thanks, got it", "cancel the appraisal", "end of month works", "yes", "please help me with the T-12", "start Monday?"])('"%s" is not a keyword', (text) =>
    expect(parseKeyword(text)).toBeNull(),
  );
});

describe("webhook auth", () => {
  it("answers 503 when the public key is not configured", async () => {
    const h = makeHarness();
    const res = await handleTelnyxWebhook(signed(inbound("STOP")), deps(h, { publicKey: undefined }));
    expect(res.status).toBe(503);
  });

  it("answers 401 for a bad signature and does nothing", async () => {
    const h = makeHarness();
    const other = generateKeyPairSync("ed25519").privateKey;
    const res = await handleTelnyxWebhook(signed(inbound("STOP"), { key: other }), deps(h));
    expect(res.status).toBe(401);
    expect(h.ledger.events).toHaveLength(0);
    expect(h.store.sms).toHaveLength(0);
  });

  it("acknowledges a signed payload it does not understand", async () => {
    const h = makeHarness();
    const res = await handleTelnyxWebhook(signed(null, { raw: "not json" }), deps(h));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ignored: true });
  });

  it("ignores unrelated event types", async () => {
    const h = makeHarness();
    const res = await handleTelnyxWebhook(signed({ data: { event_type: "number_order.complete" } }), deps(h));
    expect(await res.json()).toMatchObject({ ignored: "number_order.complete" });
  });
});

describe("STOP", () => {
  it("revokes consent in the ledger, flips Twenty smsOptOut, replies once and blocks later texts", async () => {
    const h = makeHarness({ preApproved: ["milestone_update_sms@1"] });
    h.grant({ phone: PHONE, email: "pat@example.com", leadId: "11111111-1111-4111-8111-111111111111", at: new Date(NOW.getTime() - 86_400_000) });
    expect((await h.notifier.send({ templateId: "milestone_update_sms", to: { audience: "borrower", phone: PHONE }, data: { label: "Lender outreach" }, idempotencyKey: "pre" })).status).toBe("sent");

    const res = await handleTelnyxWebhook(signed(inbound("STOP")), deps(h));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, keyword: "stop" });

    const revoked = h.ledger.events.at(-1);
    expect(revoked).toMatchObject({ eventType: "revoked", form: "sms", phone: PHONE, channels: ["sms", "autodialer"], leadId: "11111111-1111-4111-8111-111111111111" });
    expect(revoked?.textSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(h.optOut.calls).toEqual([{ phone: PHONE, optOut: true }]);

    const replies = h.sms.sent.filter((s) => s.text.includes("unsubscribed"));
    expect(replies).toHaveLength(1);
    expect(replies[0]?.text).toContain("Reply START to resubscribe");

    // The inbound text is stored and marked processed.
    expect(h.store.sms.find((s) => s.direction === "inbound")).toMatchObject({ keyword: "stop", status: "received", fromNumber: PHONE });
    expect(h.store.sms.find((s) => s.direction === "inbound")?.processedAt).not.toBeNull();

    // Consent is now revoked for texts, so a new milestone text is blocked.
    const state = consentState(await h.consent.history("sms", { phone: PHONE }), "sms");
    expect(state.state).toBe("revoked");
    const after = await h.notifier.send({ templateId: "milestone_update_sms", to: { audience: "borrower", phone: PHONE }, data: { label: "Closing coordination" }, idempotencyKey: "post" });
    expect(after.status).toBe("skipped_no_consent");
    expect(h.sms.sent.filter((s) => s.text.includes("Closing coordination"))).toHaveLength(0);
  });

  it("does not remove email consent", async () => {
    const h = makeHarness({ preApproved: ["milestone_update@1"] });
    h.grant({ phone: PHONE, email: "pat@example.com" });
    await handleTelnyxWebhook(signed(inbound("stop")), deps(h));
    const out = await h.notifier.send({
      templateId: "milestone_update",
      to: { audience: "borrower", email: "pat@example.com" },
      data: { firstName: "Pat", label: "Lender outreach", message: "Your loan package is being shared with lenders." },
      idempotencyKey: "email-after-stop",
    });
    // A STOP is about texts: the email grant on the same person is untouched.
    expect(out.status).toBe("sent");
  });

  it("is idempotent when Telnyx redelivers the event", async () => {
    const h = makeHarness();
    const d = deps(h);
    await handleTelnyxWebhook(signed(inbound("STOP", "msg_dup")), d);
    const second = await handleTelnyxWebhook(signed(inbound("STOP", "msg_dup")), d);
    expect(await second.json()).toMatchObject({ duplicate: true });
    expect(h.ledger.events.filter((e) => e.eventType === "revoked")).toHaveLength(1);
    expect(h.sms.sent).toHaveLength(1);
  });

  it("answers 500 so Telnyx retries when the ledger write fails, then completes on retry", async () => {
    const h = makeHarness();
    const d = deps(h);
    h.ledger.failNext = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const first = await handleTelnyxWebhook(signed(inbound("STOP", "msg_retry")), d);
    spy.mockRestore();
    expect(first.status).toBe(500);
    expect(h.ledger.events).toHaveLength(0);

    const second = await handleTelnyxWebhook(signed(inbound("STOP", "msg_retry")), d);
    expect(second.status).toBe(200);
    expect(h.ledger.events.filter((e) => e.eventType === "revoked")).toHaveLength(1);
  });

  it("still records the opt-out when Twenty is down", async () => {
    const h = makeHarness();
    h.optOut.failWith = new Error("Twenty 502");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handleTelnyxWebhook(signed(inbound("STOP")), deps(h));
    spy.mockRestore();
    expect(res.status).toBe(200);
    expect(h.ledger.events.at(-1)?.eventType).toBe("revoked");
    expect(h.store.sms.find((s) => s.direction === "inbound")?.error).toMatch(/Twenty sync failed/);
  });

  it("works when Twenty is not configured", async () => {
    const h = makeHarness();
    const res = await handleTelnyxWebhook(signed(inbound("STOP")), deps(h, { optOut: null }));
    expect(res.status).toBe(200);
    expect(h.ledger.events.at(-1)?.eventType).toBe("revoked");
  });
});

describe("HELP and START", () => {
  it("replies to HELP with contact details and the opt-out instruction, without touching consent", async () => {
    const h = makeHarness();
    await handleTelnyxWebhook(signed(inbound("HELP")), deps(h));
    expect(h.sms.sent).toHaveLength(1);
    expect(h.sms.sent[0]?.text).toContain("deals@kuberacommercial.com");
    expect(h.sms.sent[0]?.text).toContain("Reply STOP to opt out");
    expect(h.ledger.events).toHaveLength(0);
  });

  it("START after a STOP restores consent, clears smsOptOut and confirms", async () => {
    const h = makeHarness({ preApproved: ["milestone_update_sms@1"] });
    h.grant({ phone: PHONE, at: new Date(NOW.getTime() - 86_400_000) });
    await handleTelnyxWebhook(signed(inbound("STOP", "m1")), deps(h));
    // Make the START strictly later than the STOP in the ledger.
    h.clock.now = new Date(NOW.getTime() + 1000);
    const res = await handleTelnyxWebhook(signed(inbound("START", "m2")), deps(h, { now: () => new Date(NOW.getTime() + 1000) }));
    expect(await res.json()).toMatchObject({ keyword: "start" });

    expect(h.ledger.events.at(-1)).toMatchObject({ eventType: "granted", form: "sms", phone: PHONE });
    expect(h.optOut.calls).toEqual([
      { phone: PHONE, optOut: true },
      { phone: PHONE, optOut: false },
    ]);
    expect(h.sms.sent.some((s) => s.text.includes("resubscribed"))).toBe(true);
    expect(consentState(await h.consent.history("sms", { phone: PHONE }), "sms").state).toBe("granted");
  });

  it("START from someone who never opted out creates no consent", async () => {
    const h = makeHarness();
    await handleTelnyxWebhook(signed(inbound("START", "m3", "+14155550177")), deps(h));
    expect(h.ledger.events).toHaveLength(0);
    expect(h.optOut.calls).toHaveLength(0);
    expect(h.sms.sent).toHaveLength(0);
  });
});

describe("other inbound texts and delivery status", () => {
  it("stores a plain reply and emails staff", async () => {
    const h = makeHarness();
    await handleTelnyxWebhook(signed(inbound("Can you send the term sheet?", "m_plain")), deps(h));
    expect(h.store.sms[0]).toMatchObject({ keyword: null, body: "Can you send the term sheet?" });
    expect(h.email.sent).toHaveLength(1);
    expect(h.email.sent[0]?.to).toBe("deals@kuberacommercial.com");
    expect(h.email.sent[0]?.text).toContain("term sheet");
    expect(h.ledger.events).toHaveLength(0);
  });

  it("applies delivery receipts to the notification and the sms row, and never moves backwards", async () => {
    const h = makeHarness();
    const out = await h.notifier.send({ templateId: "staff_alert_sms", to: { audience: "staff", phone: PHONE }, data: { text: "hi" }, idempotencyKey: "d1" });
    const id = out.providerMessageId as string;
    const status = (type: string, recipientStatus?: string, errors?: unknown[]) => ({
      data: { event_type: type, occurred_at: NOW.toISOString(), payload: { id, to: [{ phone_number: PHONE, status: recipientStatus }], errors } },
    });

    await handleTelnyxWebhook(signed(status("message.finalized", "delivered")), deps(h));
    expect(h.store.notifications[0]?.status).toBe("delivered");
    expect(h.store.notifications[0]?.deliveredAt).toBe(NOW.toISOString());
    expect(h.store.sms[0]?.status).toBe("delivered");

    await handleTelnyxWebhook(signed(status("message.sent")), deps(h));
    expect(h.store.notifications[0]?.status).toBe("delivered");
  });

  it("marks a failed delivery with the carrier error", async () => {
    const h = makeHarness();
    const out = await h.notifier.send({ templateId: "staff_alert_sms", to: { audience: "staff", phone: PHONE }, data: { text: "hi" }, idempotencyKey: "d2" });
    const body = {
      data: {
        event_type: "message.finalized",
        payload: { id: out.providerMessageId, to: [{ phone_number: PHONE, status: "delivery_failed" }], errors: [{ code: "30003", detail: "Unreachable destination handset" }] },
      },
    };
    await handleTelnyxWebhook(signed(body), deps(h));
    expect(h.store.notifications[0]).toMatchObject({ status: "failed", error: "Unreachable destination handset" });
  });
});
