import { describe, expect, it } from "vitest";
import { FakeApprovalGate } from "@/lib/compliance/approval-gate";
import { DAYTIME, LEAD_EMAIL, LEAD_PHONE, makeHarness, NIGHT } from "./testing";

const smsReq = (key = "k1", over = {}) => ({
  templateId: "speed_to_lead_sms" as const,
  to: { audience: "borrower" as const, phone: LEAD_PHONE },
  data: { firstName: "Pat", bookingUrl: "https://cal.com/corin/intro" },
  idempotencyKey: key,
  leadId: "11111111-1111-4111-8111-111111111111",
  ...over,
});

const reminderReq = (key = "r1", over = {}) => ({
  templateId: "document_reminder_email" as const,
  to: { audience: "borrower" as const, email: LEAD_EMAIL },
  data: { firstName: "Pat", items: [{ title: "Rent roll", needsCorrection: false }], reminderNumber: 1 },
  idempotencyKey: key,
  dealId: "22222222-2222-4222-8222-222222222222",
  ...over,
});

describe("consent gate", () => {
  it("sends nothing without consent on the ledger", async () => {
    const h = makeHarness();
    const out = await h.sender.send(smsReq());
    expect(out).toMatchObject({ status: "skipped_no_consent", reason: "no_consent" });
    expect(h.sms.sent).toHaveLength(0);
    expect(h.store.rows[0]?.status).toBe("skipped_no_consent");
  });

  it("a form that only agreed to email does not allow a text", async () => {
    const h = makeHarness();
    h.grant({ phone: LEAD_PHONE, channels: ["email"] });
    expect((await h.sender.send(smsReq())).reason).toBe("no_consent");
    expect(h.sms.sent).toHaveLength(0);
  });

  it("sends once consent is granted and records the ledger row that allowed it", async () => {
    const h = makeHarness();
    const grant = h.grant({ phone: LEAD_PHONE });
    const out = await h.sender.send(smsReq());
    expect(out).toMatchObject({ status: "sent", reason: "sent" });
    expect(h.sms.sent).toHaveLength(1);
    expect(h.sms.sent[0]?.to).toBe(LEAD_PHONE);
    expect(h.store.rows[0]).toMatchObject({ status: "sent", consentEventId: grant.id, provider: "fake" });
  });

  it("an SMS STOP after the grant blocks later texts", async () => {
    const h = makeHarness();
    h.grant({ phone: LEAD_PHONE });
    h.stop(LEAD_PHONE);
    const out = await h.sender.send(smsReq());
    expect(out).toMatchObject({ status: "skipped_no_consent", reason: "consent_revoked" });
    expect(h.sms.sent).toHaveLength(0);
  });

  it("a new grant after a STOP restores texting", async () => {
    const h = makeHarness();
    h.grant({ phone: LEAD_PHONE, at: new Date(DAYTIME.getTime() - 3 * 86_400_000) });
    h.stop(LEAD_PHONE, new Date(DAYTIME.getTime() - 2 * 86_400_000));
    h.grant({ phone: LEAD_PHONE, at: new Date(DAYTIME.getTime() - 1 * 86_400_000) });
    expect((await h.sender.send(smsReq())).status).toBe("sent");
  });

  it("transactional email is allowed unless the person revoked email", async () => {
    const h = makeHarness({ preApproved: ["document_reminder_email@1"] });
    expect((await h.sender.send(reminderReq("e1"))).status).toBe("sent");
    h.grant({ email: LEAD_EMAIL, channels: ["email"], eventType: "revoked", form: "qualifier", at: new Date(DAYTIME.getTime() - 1000) });
    expect((await h.sender.send(reminderReq("e2"))).reason).toBe("consent_revoked");
    expect(h.email.sent).toHaveLength(1);
  });

  it("a newsletter unsubscribe does not stop deal email", async () => {
    const h = makeHarness({ preApproved: ["document_reminder_email@1"] });
    h.grant({ email: LEAD_EMAIL, channels: ["email"], eventType: "revoked", form: "newsletter" });
    expect((await h.sender.send(reminderReq())).status).toBe("sent");
  });

  it("fails closed when the ledger cannot be read", async () => {
    const h = makeHarness();
    h.grant({ phone: LEAD_PHONE });
    h.consent.history = async () => {
      throw new Error("db down");
    };
    const out = await h.sender.send(smsReq());
    expect(out).toMatchObject({ status: "failed", reason: "consent_lookup_failed" });
    expect(h.sms.sent).toHaveLength(0);
  });
});

describe("texting window", () => {
  it("defers a borrower text outside 8 a.m. Pacific to 9 p.m. Eastern, then sends it on retry", async () => {
    const h = makeHarness({ now: NIGHT });
    h.grant({ phone: LEAD_PHONE });
    const first = await h.sender.send(smsReq());
    expect(first).toMatchObject({ status: "deferred_quiet_hours", reason: "outside_texting_window" });
    expect(h.sms.sent).toHaveLength(0);

    h.clock.now = new Date(NIGHT.getTime() + 14 * 3_600_000);
    const retry = await h.sender.send(smsReq());
    expect(retry.status).toBe("sent");
    expect(h.sms.sent).toHaveLength(1);
    expect((await h.sender.send(smsReq())).status).toBe("duplicate");
    expect(h.sms.sent).toHaveLength(1);
  });

  it("does not hold email for the texting window", async () => {
    const h = makeHarness({ now: NIGHT });
    expect((await h.sender.send({ ...reminderReq(), templateId: "speed_to_lead_email", data: { firstName: "Pat" } })).status).toBe("sent");
  });
});

describe("providers", () => {
  it("skips when the SMS provider is not configured", async () => {
    const h = makeHarness({ sms: false });
    h.grant({ phone: LEAD_PHONE });
    expect(await h.sender.send(smsReq())).toMatchObject({ status: "skipped_unconfigured", reason: "provider_unconfigured" });
  });

  it("records a provider failure without throwing", async () => {
    const h = makeHarness();
    h.grant({ phone: LEAD_PHONE });
    h.sms.failNext = Object.assign(new Error("Telnyx 500"), { name: "SmsError" }) as never;
    const out = await h.sender.send(smsReq());
    expect(out).toMatchObject({ status: "failed", reason: "send_failed" });
    // A failed text is not retried automatically: the provider may have sent it.
    expect((await h.sender.send(smsReq())).status).toBe("duplicate");
    expect(h.sms.sent).toHaveLength(0);
  });

  it("the kill switch skips everything", async () => {
    const h = makeHarness({ paused: true });
    h.grant({ phone: LEAD_PHONE });
    expect(await h.sender.send(smsReq())).toMatchObject({ status: "skipped_unconfigured" });
    expect(h.sms.sent).toHaveLength(0);
  });

  it("mirrors a sent text into the SMS ledger so replies attach to it", async () => {
    const h = makeHarness();
    h.grant({ phone: LEAD_PHONE });
    const out = await h.sender.send(smsReq());
    expect(h.smsLog.sms).toHaveLength(1);
    expect(h.smsLog.sms[0]).toMatchObject({ direction: "outbound", toNumber: LEAD_PHONE, providerMessageId: out.providerMessageId });
  });
});

describe("approval gate", () => {
  it("a template that is not pre-approved waits for a broker and sends nothing", async () => {
    const gate = new FakeApprovalGate("pending");
    const h = makeHarness({ gate });
    h.grant({ email: LEAD_EMAIL });
    const out = await h.sender.send(reminderReq());
    expect(out).toMatchObject({ status: "pending_approval", reason: "approval_pending" });
    expect(h.email.sent).toHaveLength(0);
    expect(gate.requests).toHaveLength(1);
    expect(gate.requests[0]).toMatchObject({ kind: "email", templateId: "document_reminder_email@1" });
    expect(gate.requests[0]?.payload.templateBodySha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sends exactly once after the broker approves", async () => {
    const gate = new FakeApprovalGate("pending");
    const h = makeHarness({ gate });
    h.grant({ email: LEAD_EMAIL });
    await h.sender.send(reminderReq());
    gate.decide("outreach:r1", { status: "approved", approvalId: "appr_1", decidedBy: "broker@test", decidedAt: DAYTIME });
    const sent = await h.sender.send(reminderReq());
    expect(sent).toMatchObject({ status: "sent", approvalId: "appr_1" });
    expect((await h.sender.send(reminderReq())).status).toBe("duplicate");
    expect(h.email.sent).toHaveLength(1);
  });

  it("sends the data the broker reviewed, not newer data from a retry", async () => {
    const gate = new FakeApprovalGate("pending");
    const h = makeHarness({ gate });
    h.grant({ email: LEAD_EMAIL });
    await h.sender.send(reminderReq());
    gate.decide("outreach:r1", { status: "approved", approvalId: "appr_1", decidedBy: "broker@test", decidedAt: DAYTIME });
    await h.sender.send(reminderReq("r1", { data: { firstName: "Pat", items: [{ title: "SOMETHING ELSE", needsCorrection: false }], reminderNumber: 1 } }));
    expect(h.email.sent[0]?.text).toContain("Rent roll");
    expect(h.email.sent[0]?.text).not.toContain("SOMETHING ELSE");
  });

  it.each([
    ["rejected", "approval_rejected"],
    ["expired", "approval_expired"],
  ] as const)("a %s approval never sends", async (status, reason) => {
    const gate = new FakeApprovalGate(status);
    const h = makeHarness({ gate });
    h.grant({ email: LEAD_EMAIL });
    const out = await h.sender.send(reminderReq());
    expect(out).toMatchObject({ status, reason });
    expect(h.email.sent).toHaveLength(0);
    // Terminal: a later run with the same key does not ask again.
    expect((await h.sender.send(reminderReq())).status).toBe("duplicate");
  });

  it("pre-approved templates (built in or listed) skip the gate", async () => {
    const gate = new FakeApprovalGate("rejected");
    const h = makeHarness({ gate, preApproved: ["document_reminder_email@1"] });
    h.grant({ phone: LEAD_PHONE, email: LEAD_EMAIL });
    expect((await h.sender.send(smsReq())).status).toBe("sent");
    expect((await h.sender.send(reminderReq())).status).toBe("sent");
    expect(gate.requests).toHaveLength(0);
  });

  it("a pre-approval for version 1 does not cover a reworded version", async () => {
    const gate = new FakeApprovalGate("pending");
    const h = makeHarness({ gate, preApproved: ["document_reminder_email@2"] });
    h.grant({ email: LEAD_EMAIL });
    expect((await h.sender.send(reminderReq())).status).toBe("pending_approval");
  });

  it("consent is checked before the gate, so a person without consent is never put in the approval queue", async () => {
    const gate = new FakeApprovalGate("approved");
    const h = makeHarness({ gate });
    h.stop(LEAD_PHONE);
    await h.sender.send({ ...reminderReq(), templateId: "document_reminder_sms", to: { audience: "borrower", phone: LEAD_PHONE }, data: { count: 2 } });
    expect(gate.requests).toHaveLength(0);
  });

  it("an approval request that cannot be recorded leaves the message pending", async () => {
    const gate = new FakeApprovalGate("approved");
    gate.request = async () => {
      throw new Error("conflict");
    };
    const h = makeHarness({ gate });
    h.grant({ email: LEAD_EMAIL });
    expect((await h.sender.send(reminderReq())).status).toBe("pending_approval");
    expect(h.email.sent).toHaveLength(0);
  });
});

describe("validation and idempotency", () => {
  it("rejects a recipient the template cannot address", async () => {
    const h = makeHarness();
    const out = await h.sender.send({ ...reminderReq(), templateId: "vendor_nudge_email" as const, data: {} });
    expect(out.status).toBe("invalid");
    expect(h.store.rows).toHaveLength(0);
  });

  it("rejects missing or malformed addresses", async () => {
    const h = makeHarness();
    expect((await h.sender.send({ ...smsReq(), to: { audience: "borrower", phone: "555" } })).reason).toBe("invalid_recipient");
    expect((await h.sender.send({ ...reminderReq(), to: { audience: "borrower", email: "not-an-email" } })).reason).toBe("invalid_recipient");
  });

  it("bad template data is recorded as invalid and never sent", async () => {
    const h = makeHarness();
    h.grant({ phone: LEAD_PHONE });
    const out = await h.sender.send(smsReq("bad", { data: { bookingUrl: "http://insecure.example" } }));
    expect(out).toMatchObject({ status: "invalid", reason: "invalid_template_data" });
    expect(h.sms.sent).toHaveLength(0);
  });

  it("a retried trigger with the same key sends once", async () => {
    const h = makeHarness();
    h.grant({ phone: LEAD_PHONE });
    await Promise.all([h.sender.send(smsReq()), h.sender.send(smsReq())]);
    expect(h.sms.sent).toHaveLength(1);
  });

  it("writes an audit entry with a reason code and no contact details", async () => {
    const h = makeHarness();
    await h.sender.send(smsReq());
    const e = h.audit.events.at(-1);
    expect(e).toMatchObject({ agent: "speed_to_lead", action: "skip", reason: "no_consent", templateId: "speed_to_lead_sms" });
    expect(JSON.stringify(e)).not.toContain(LEAD_PHONE);
  });
});
