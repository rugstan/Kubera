import { describe, expect, it, vi } from "vitest";
import { FakeApprovalGate } from "@/lib/compliance/approval-gate";
import { EmailError } from "./email/types";
import { Notifier } from "./service";
import { TelnyxSmsClient } from "./sms/telnyx";
import { SmsError } from "./sms/types";
import { makeHarness, NIGHT } from "./testing";

const PHONE = "+14155550100";
const EMAIL = "pat@example.com";

const milestoneSms = (key = "m1") => ({
  templateId: "milestone_update_sms" as const,
  to: { audience: "borrower" as const, phone: PHONE },
  data: { label: "Lender outreach" },
  idempotencyKey: key,
});

const milestoneEmail = (key = "m1") => ({
  templateId: "milestone_update" as const,
  to: { audience: "borrower" as const, email: EMAIL },
  data: { firstName: "Pat", label: "Lender outreach", message: "Your loan package is being shared with lenders." },
  idempotencyKey: key,
});

describe("consent gating", () => {
  it("sends no text without consent on file", async () => {
    const h = makeHarness({ preApproved: ["milestone_update_sms@1"] });
    const out = await h.notifier.send(milestoneSms());
    expect(out.status).toBe("skipped_no_consent");
    expect(h.sms.sent).toHaveLength(0);
    expect(h.store.notifications[0]?.status).toBe("skipped_no_consent");
  });

  it("sends a text once the person has consented to texting", async () => {
    const h = makeHarness({ preApproved: ["milestone_update_sms@1"] });
    const grant = h.grant({ phone: PHONE, email: EMAIL });
    const out = await h.notifier.send(milestoneSms());
    expect(out.status).toBe("sent");
    expect(h.sms.sent).toHaveLength(1);
    expect(h.sms.sent[0]?.text).toContain("Reply STOP to opt out");
    expect(h.store.notifications[0]?.consentEventId).toBe(grant.id);
    expect(h.store.sms[0]).toMatchObject({ direction: "outbound", toNumber: PHONE, status: "sent" });
  });

  it("does not treat consent to email only as consent to text", async () => {
    const h = makeHarness({ preApproved: ["milestone_update_sms@1"] });
    h.grant({ phone: PHONE, email: EMAIL, channels: ["email"] });
    expect((await h.notifier.send(milestoneSms())).status).toBe("skipped_no_consent");
  });

  it("blocks a text after a later revocation and restores it after a re-grant", async () => {
    const h = makeHarness({ preApproved: ["milestone_update_sms@1"] });
    h.grant({ phone: PHONE, at: new Date("2026-11-03T10:00:00Z") });
    h.ledger.events.push({
      id: "rev1",
      eventType: "revoked",
      form: "sms" as never,
      textVersion: "sms-stop-keyword-2026-11-03",
      textSha256: "b".repeat(64),
      channels: ["sms", "autodialer"],
      email: null,
      phone: PHONE,
      ip: null,
      userAgent: null,
      page: null,
      occurredAt: "2026-11-03T12:00:00.000Z",
    });
    const blocked = await h.notifier.send(milestoneSms("a"));
    expect(blocked.status).toBe("skipped_no_consent");
    expect(blocked.reason).toMatch(/opted out/);

    h.grant({ phone: PHONE, at: new Date("2026-11-03T13:00:00Z") });
    expect((await h.notifier.send(milestoneSms("b"))).status).toBe("sent");
  });

  it("milestone emails need email consent; the lead confirmation does not", async () => {
    const h = makeHarness({ preApproved: ["milestone_update@1"] });
    expect((await h.notifier.send(milestoneEmail())).status).toBe("skipped_no_consent");

    const confirmation = await h.notifier.send({
      templateId: "lead_confirmation",
      to: { audience: "borrower", email: EMAIL },
      data: { firstName: "Pat", reference: "ABCD1234" },
      idempotencyKey: "lc1",
    });
    expect(confirmation.status).toBe("sent");
    expect(h.email.sent).toHaveLength(1);
    expect(h.email.sent[0]?.html).toContain("Pat");
  });

  it("the lead confirmation still honors an email opt-out", async () => {
    const h = makeHarness();
    h.ledger.events.push({
      id: "rev2",
      eventType: "revoked",
      form: "staff" as never,
      textVersion: "x",
      textSha256: "c".repeat(64),
      channels: ["email"],
      email: EMAIL,
      phone: null,
      ip: null,
      userAgent: null,
      page: null,
      occurredAt: "2026-11-03T12:00:00.000Z",
    });
    const out = await h.notifier.send({ templateId: "lead_confirmation", to: { audience: "borrower", email: EMAIL }, data: { firstName: "Pat" }, idempotencyKey: "lc2" });
    expect(out.status).toBe("skipped_no_consent");
    expect(h.email.sent).toHaveLength(0);
  });

  it("a newsletter opt-in does not count as deal-update consent", async () => {
    const h = makeHarness({ preApproved: ["milestone_update@1"] });
    h.grant({ email: EMAIL, form: "newsletter", channels: ["email"] });
    expect((await h.notifier.send(milestoneEmail())).status).toBe("skipped_no_consent");
  });

  it("fails closed when the consent ledger cannot be read", async () => {
    const h = makeHarness({ preApproved: ["milestone_update_sms@1"] });
    vi.spyOn(h.consent, "history").mockRejectedValueOnce(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await h.notifier.send(milestoneSms());
    spy.mockRestore();
    expect(out.status).toBe("failed");
    expect(h.sms.sent).toHaveLength(0);
  });
});

describe("approval gate", () => {
  it("holds a template that is not pre-approved until a broker approves it", async () => {
    const gate = new FakeApprovalGate("pending");
    const h = makeHarness({ gate });
    h.grant({ phone: PHONE });
    const out = await h.notifier.send(milestoneSms());
    expect(out.status).toBe("pending_approval");
    expect(h.sms.sent).toHaveLength(0);
    expect(gate.requests[0]).toMatchObject({ kind: "email", templateId: "milestone_update_sms@1", payload: { channel: "sms" } });
  });

  it("sends on a later retry once the broker approves", async () => {
    const gate = new FakeApprovalGate("pending");
    const h = makeHarness({ gate });
    h.grant({ phone: PHONE });
    expect((await h.notifier.send(milestoneSms("k"))).status).toBe("pending_approval");

    gate.decide("notify:k", { status: "approved", approvalId: "appr_9", decidedBy: "broker@test", decidedAt: new Date(0) });
    const out = await h.notifier.send(milestoneSms("k"));
    expect(out.status).toBe("sent");
    expect(h.sms.sent).toHaveLength(1);
    expect(h.store.notifications).toHaveLength(1);
    expect(h.store.notifications[0]).toMatchObject({ status: "sent", approvalId: "appr_9" });
  });

  it("an expired approval never sends, not even on retry", async () => {
    const gate = new FakeApprovalGate("expired");
    const h = makeHarness({ gate });
    h.grant({ phone: PHONE });
    expect((await h.notifier.send(milestoneSms("k"))).status).toBe("expired");
    expect((await h.notifier.send(milestoneSms("k"))).status).toBe("duplicate");
    expect(h.sms.sent).toHaveLength(0);
  });

  it("a rejected approval never sends", async () => {
    const h = makeHarness({ gate: new FakeApprovalGate("rejected") });
    h.grant({ phone: PHONE });
    expect((await h.notifier.send(milestoneSms())).status).toBe("rejected");
    expect(h.sms.sent).toHaveLength(0);
  });

  it("pre-approved templates send without asking the gate", async () => {
    const gate = new FakeApprovalGate("rejected");
    const h = makeHarness({ gate });
    const out = await h.notifier.send({
      templateId: "staff_tier1_sms",
      to: { audience: "staff", phone: PHONE },
      data: { reference: "ABCD1234", summary: "$12.0M hotel", contactOk: true },
      idempotencyKey: "t1",
    });
    expect(out.status).toBe("sent");
    expect(gate.requests).toHaveLength(0);
  });

  it("the env pre-approval is version-specific", async () => {
    const stale = makeHarness({ gate: new FakeApprovalGate("pending"), preApproved: ["milestone_update_sms@0"] });
    stale.grant({ phone: PHONE });
    expect((await stale.notifier.send(milestoneSms())).status).toBe("pending_approval");
  });
});

describe("quiet hours", () => {
  it("defers a borrower text outside the texting window and sends it on a later retry", async () => {
    const h = makeHarness({ now: NIGHT, preApproved: ["milestone_update_sms@1"] });
    h.grant({ phone: PHONE, at: new Date(NIGHT.getTime() - 86_400_000) });
    const first = await h.notifier.send(milestoneSms("q"));
    expect(first.status).toBe("deferred_quiet_hours");
    expect(h.sms.sent).toHaveLength(0);

    h.clock.now = new Date(NIGHT.getTime() + 15 * 3_600_000); // next day 13:00 ET
    expect((await h.notifier.send(milestoneSms("q"))).status).toBe("sent");
  });

  it("does not defer staff alerts or the STOP reply", async () => {
    const h = makeHarness({ now: NIGHT });
    const staff = await h.notifier.send({ templateId: "staff_alert_sms", to: { audience: "staff", phone: PHONE }, data: { text: "New lead" }, idempotencyKey: "s1" });
    const stop = await h.notifier.send({ templateId: "sms_stop_reply", to: { audience: "borrower", phone: "+14155550111" }, data: {}, idempotencyKey: "s2" });
    expect(staff.status).toBe("sent");
    expect(stop.status).toBe("sent");
  });
});

describe("idempotency and failure handling", () => {
  it("sends once per idempotency key", async () => {
    const h = makeHarness({ preApproved: ["milestone_update_sms@1"] });
    h.grant({ phone: PHONE });
    expect((await h.notifier.send(milestoneSms("same"))).status).toBe("sent");
    const again = await h.notifier.send(milestoneSms("same"));
    expect(again).toMatchObject({ status: "duplicate", previousStatus: "sent" });
    expect(h.sms.sent).toHaveLength(1);
  });

  it("two concurrent retries of a held message send at most once", async () => {
    const gate = new FakeApprovalGate("pending");
    const h = makeHarness({ gate });
    h.grant({ phone: PHONE });
    await h.notifier.send(milestoneSms("c"));
    gate.decide("notify:c", { status: "approved", approvalId: "a1", decidedBy: "b", decidedAt: new Date(0) });
    const [a, b] = await Promise.all([h.notifier.send(milestoneSms("c")), h.notifier.send(milestoneSms("c"))]);
    expect([a.status, b.status].sort()).toEqual(["duplicate", "sent"]);
    expect(h.sms.sent).toHaveLength(1);
  });

  it("records an email provider failure and allows a retry (Resend dedupes on the idempotency key)", async () => {
    const h = makeHarness();
    h.email.failNext = new EmailError("Resend 500: boom", 500);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const req = { templateId: "staff_alert" as const, to: { audience: "staff" as const, email: "deals@kuberacommercial.com" }, data: { title: "Hi", lines: [] }, idempotencyKey: "f1" };
    const first = await h.notifier.send(req);
    spy.mockRestore();
    expect(first.status).toBe("failed");
    expect(h.store.notifications[0]).toMatchObject({ status: "failed", attempts: 1 });
    expect((await h.notifier.send(req)).status).toBe("sent");
    expect(h.store.notifications[0]?.attempts).toBe(2);
  });

  const staffSms = (key: string) => ({ templateId: "staff_tier1_sms" as const, to: { audience: "staff" as const, phone: PHONE }, data: { reference: "ABCD1234", summary: "$5.0M hotel", contactOk: true }, idempotencyKey: key });

  /** A Notifier on the real Telnyx client with a scripted fetch, counting POSTs that reach "Telnyx". */
  const telnyxHarness = (respond: (call: number) => Promise<Response>) => {
    const h = makeHarness({ staffEmails: ["deals@kuberacommercial.com"] });
    const calls = { n: 0 };
    const fetchMock = (async () => respond(++calls.n)) as typeof fetch;
    const sms = new TelnyxSmsClient({ apiKey: "k", from: "+13105550199", fetch: fetchMock });
    const notifier = new Notifier({ email: h.email, sms, store: h.store, consent: h.consent, gate: h.gate, staffEmails: ["deals@kuberacommercial.com"], now: () => h.clock.now });
    return { ...h, notifier, calls };
  };
  const timeout = () => Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
  const ok = () => Promise.resolve(new Response(JSON.stringify({ data: { id: "msg_1" } }), { status: 200 }));

  it("never resends a text whose Telnyx call timed out; staff are told instead", async () => {
    const h = telnyxHarness((n) => (n === 1 ? timeout() : ok()));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const first = await h.notifier.send(staffSms("tier1:lead-1:sms:+14155550100"));
    expect(first.status).toBe("send_unknown");
    expect(first.reason).toMatch(/timed out/);
    const row = h.store.notifications.find((n) => n.idempotencyKey === "tier1:lead-1:sms:+14155550100");
    expect(row).toMatchObject({ status: "send_unknown", provider: "telnyx", attempts: 1 });

    // The sweep cron calls again with the same key: the provider is not reached a second time.
    const again = await h.notifier.send(staffSms("tier1:lead-1:sms:+14155550100"));
    spy.mockRestore();
    expect(again).toMatchObject({ status: "duplicate", previousStatus: "send_unknown" });
    expect(h.calls.n).toBe(1);
    expect(row?.attempts).toBe(1);

    // One staff email, masked number only.
    expect(h.email.sent).toHaveLength(1);
    expect(h.email.sent[0]?.to).toBe("deals@kuberacommercial.com");
    expect(h.email.sent[0]?.text).toContain("staff_tier1_sms");
    expect(h.email.sent[0]?.text).not.toContain(PHONE);
  });

  it.each([
    ["a 5xx", () => Promise.resolve(new Response("upstream", { status: 503 }))],
    ["a 408", () => Promise.resolve(new Response("timeout", { status: 408 }))],
    ["a 429", () => Promise.resolve(new Response("slow down", { status: 429 }))],
    ["a network error", () => Promise.reject(new TypeError("fetch failed"))],
    ["a 2xx without a message id", () => Promise.resolve(new Response("{}", { status: 200 }))],
  ])("treats %s from Telnyx as unknown delivery and never retries it", async (_label, first) => {
    const h = telnyxHarness((n) => (n === 1 ? first() : ok()));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await h.notifier.send(staffSms("u-1"))).status).toBe("send_unknown");
    expect((await h.notifier.send(staffSms("u-1"))).status).toBe("duplicate");
    spy.mockRestore();
    expect(h.calls.n).toBe(1);
  });

  it("retries a text Telnyx definitively refused (4xx)", async () => {
    const h = telnyxHarness((n) => (n === 1 ? Promise.resolve(new Response("bad number", { status: 422 })) : ok()));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const first = await h.notifier.send(staffSms("r-1"));
    spy.mockRestore();
    expect(first.status).toBe("failed");
    expect(h.email.sent).toHaveLength(0);
    expect((await h.notifier.send(staffSms("r-1"))).status).toBe("sent");
    expect(h.calls.n).toBe(2);
  });

  it("marks a text failed (retryable) when the error is raised before the request goes out", async () => {
    const h = makeHarness();
    h.sms.failNext = new SmsError("could not build the request", undefined, { notSent: true });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await h.notifier.send(staffSms("p-1"))).status).toBe("failed");
    spy.mockRestore();
    expect((await h.notifier.send(staffSms("p-1"))).status).toBe("sent");
    expect(h.sms.sent).toHaveLength(1);
  });

  it("keeps a sent text sent when the database write after the send fails", async () => {
    const h = makeHarness();
    const update = h.store.update.bind(h.store);
    let failures = 0;
    h.store.update = async (id, patch) => {
      if (patch.status === "sent" && failures < 1) {
        failures++;
        throw new Error("supabase unavailable");
      }
      return update(id, patch);
    };
    const out = await h.notifier.send(staffSms("b-1"));
    expect(out.status).toBe("sent");
    expect(h.store.notifications[0]).toMatchObject({ status: "sent", providerMessageId: out.providerMessageId });
    expect(h.sms.sent).toHaveLength(1);
  });

  it("never reports or retries a delivered text as failed when every bookkeeping write fails", async () => {
    const h = makeHarness();
    const update = h.store.update.bind(h.store);
    h.store.update = async (id, patch) => {
      if (patch.status === "sent") throw new Error("supabase unavailable");
      return update(id, patch);
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await h.notifier.send(staffSms("b-2"));
    expect(out.status).toBe("sent");
    expect(h.store.notifications[0]?.status).not.toBe("failed");
    expect(spy).toHaveBeenCalledWith(expect.stringMatching(/could not record the send/), "supabase unavailable");
    spy.mockRestore();
    expect((await h.notifier.send(staffSms("b-2"))).status).toBe("duplicate");
    expect(h.sms.sent).toHaveLength(1);
  });

  it("skips quietly when the provider is not configured", async () => {
    const h = makeHarness({ sms: false });
    const out = await h.notifier.send({ templateId: "staff_alert_sms", to: { audience: "staff", phone: PHONE }, data: { text: "x" }, idempotencyKey: "u1" });
    expect(out.status).toBe("skipped_unconfigured");
  });

  it("does not ask the broker to approve a send that has no provider", async () => {
    const gate = new FakeApprovalGate("pending");
    const h = makeHarness({ gate, sms: false });
    h.grant({ phone: PHONE });
    await h.notifier.send(milestoneSms());
    expect(gate.requests).toHaveLength(0);
  });

  it("rejects invalid recipients, audiences and template data", async () => {
    const h = makeHarness();
    expect((await h.notifier.send({ templateId: "staff_alert_sms", to: { audience: "staff", phone: "12" }, data: { text: "x" }, idempotencyKey: "i1" })).status).toBe("invalid");
    expect((await h.notifier.send({ templateId: "staff_alert_sms", to: { audience: "borrower", phone: PHONE }, data: { text: "x" }, idempotencyKey: "i2" })).status).toBe("invalid");
    expect((await h.notifier.send({ templateId: "staff_alert_sms", to: { audience: "staff", phone: PHONE }, data: { text: "" }, idempotencyKey: "i3" })).status).toBe("invalid");
    expect(h.store.notifications).toHaveLength(0);
  });
});
