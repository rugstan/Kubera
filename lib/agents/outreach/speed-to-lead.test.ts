import { describe, expect, it } from "vitest";
import { FakeApprovalGate } from "@/lib/compliance/approval-gate";
import { speedToLead, SPEED_TO_LEAD_SLA_MS } from "./speed-to-lead";
import { DAYTIME, LEAD_EMAIL, LEAD_PHONE, makeHarness, makeLead, NIGHT } from "./testing";

const deps = (h: ReturnType<typeof makeHarness>) => ({ sender: h.sender, store: h.store, escalation: h.escalation, audit: h.audit, now: h.now, calcomHandle: "kubera/intro" });

describe("speed to lead", () => {
  it("texts a Tier-1 lead within 60 seconds with the booking link, through the pre-approved template", async () => {
    const gate = new FakeApprovalGate("rejected");
    const h = makeHarness({ gate });
    const lead = makeLead({}, 4_000);
    h.grant({ phone: LEAD_PHONE, email: LEAD_EMAIL, leadId: lead.id });

    const r = await speedToLead(lead, deps(h));
    expect(r).toMatchObject({ handled: true, sent: "sms", withinSla: true, escalated: false });
    expect(r.latencyMs).toBeLessThanOrEqual(SPEED_TO_LEAD_SLA_MS);
    expect(h.sms.sent).toHaveLength(1);
    expect(h.sms.sent[0]?.text).toContain("https://cal.com/kubera/intro");
    expect(h.sms.sent[0]?.text).toContain("Reply STOP");
    expect(h.sms.sent[0]?.text).not.toContain(LEAD_EMAIL);
    expect(gate.requests).toHaveLength(0);
    expect(h.email.sent).toHaveLength(0);
  });

  it("handles Tier-2 leads too and ignores lower tiers", async () => {
    const h = makeHarness();
    for (const tier of ["TIER_3_NURTURE", "UNQUALIFIED", null]) {
      const lead = makeLead({ tier });
      h.grant({ phone: LEAD_PHONE });
      expect(await speedToLead(lead, deps(h))).toMatchObject({ handled: false, skipped: "not_hot_tier", sent: null });
    }
    const t2 = makeLead({ tier: "TIER_2_QUALIFIED_MIDMARKET" });
    h.grant({ phone: LEAD_PHONE });
    expect((await speedToLead(t2, deps(h))).sent).toBe("sms");
    expect(h.sms.sent).toHaveLength(1);
  });

  it("reports a late text as outside the SLA", async () => {
    const h = makeHarness();
    h.grant({ phone: LEAD_PHONE });
    const r = await speedToLead(makeLead({}, 90_000), deps(h));
    expect(r.sent).toBe("sms");
    expect(r.withinSla).toBe(false);
  });

  it("does not text without text consent: it emails instead, and never texts later", async () => {
    const h = makeHarness();
    const lead = makeLead();
    h.grant({ phone: LEAD_PHONE, email: LEAD_EMAIL, channels: ["email"], leadId: lead.id });

    const r = await speedToLead(lead, deps(h));
    expect(r.sent).toBe("email");
    expect(r.sms?.reason).toBe("no_consent");
    expect(h.sms.sent).toHaveLength(0);
    expect(h.email.sent).toHaveLength(1);
    expect(h.email.sent[0]?.subject).toMatch(/received/i);

    // Texting consent arrives later: the lead has already been answered, so no second message.
    h.grant({ phone: LEAD_PHONE });
    expect((await speedToLead(lead, deps(h))).skipped).toBe("already_sent");
    expect(h.sms.sent).toHaveLength(0);
  });

  it("a STOP keeps the text off even when the form agreed to texts", async () => {
    const h = makeHarness();
    const lead = makeLead();
    h.grant({ phone: LEAD_PHONE, email: LEAD_EMAIL });
    h.stop(LEAD_PHONE);
    const r = await speedToLead(lead, deps(h));
    expect(r.sms?.reason).toBe("consent_revoked");
    expect(h.sms.sent).toHaveLength(0);
    expect(r.sent).toBe("email");
  });

  it("outside the texting window the lead gets the email now and no text later", async () => {
    const h = makeHarness({ now: NIGHT });
    const lead = makeLead({}, 4_000, NIGHT);
    h.grant({ phone: LEAD_PHONE, email: LEAD_EMAIL });
    const r = await speedToLead(lead, deps(h));
    expect(r.sms?.status).toBe("deferred_quiet_hours");
    expect(r.sent).toBe("email");

    h.clock.now = new Date(NIGHT.getTime() + 15 * 3_600_000);
    expect((await speedToLead(lead, deps(h))).skipped).toBe("already_sent");
    expect(h.sms.sent).toHaveLength(0);
  });

  it("with no email, a text held for the window goes out when the window opens", async () => {
    const h = makeHarness({ now: NIGHT });
    const lead = makeLead({ contact: { firstName: "Pat", email: null, phone: LEAD_PHONE, consent: true } }, 4_000, NIGHT);
    h.grant({ phone: LEAD_PHONE });
    const first = await speedToLead(lead, deps(h));
    expect(first.sent).toBeNull();
    expect(first.escalated).toBe(false);
    expect(h.escalation.items).toHaveLength(0);

    h.clock.now = new Date(NIGHT.getTime() + 15 * 3_600_000);
    expect((await speedToLead(lead, deps(h))).sent).toBe("sms");
    expect(h.sms.sent).toHaveLength(1);
  });

  it("asks a broker to follow up once when no consented channel exists", async () => {
    const h = makeHarness();
    const lead = makeLead();
    // No text consent, and the person opted out of email.
    h.grant({ email: LEAD_EMAIL, channels: ["email"], eventType: "revoked" });
    const first = await speedToLead(lead, deps(h));
    expect(first).toMatchObject({ sent: null, escalated: true });
    await speedToLead(lead, deps(h));
    expect(h.escalation.items).toHaveLength(1);
    expect(h.escalation.items[0]?.kind).toBe("speed_to_lead_unsent");
    expect(JSON.stringify(h.escalation.items[0])).not.toContain(LEAD_PHONE);
    expect(JSON.stringify(h.escalation.items[0])).not.toContain(LEAD_EMAIL);
    expect(h.sms.sent).toHaveLength(0);
    expect(h.email.sent).toHaveLength(0);
  });

  it("works with no phone number", async () => {
    const h = makeHarness();
    const lead = makeLead({ contact: { firstName: "Pat", email: LEAD_EMAIL, phone: null, consent: true } });
    h.grant({ email: LEAD_EMAIL });
    expect((await speedToLead(lead, deps(h))).sent).toBe("email");
  });

  it("is idempotent: running twice sends once", async () => {
    const h = makeHarness();
    const lead = makeLead();
    h.grant({ phone: LEAD_PHONE });
    await speedToLead(lead, deps(h));
    const again = await speedToLead(lead, deps(h));
    expect(again.skipped).toBe("already_sent");
    expect(h.sms.sent).toHaveLength(1);
  });

  it("falls back to an email address prefill-free booking link in the email", async () => {
    const h = makeHarness();
    const lead = makeLead();
    h.grant({ email: LEAD_EMAIL, channels: ["email"] });
    await speedToLead(lead, deps(h));
    expect(h.email.sent[0]?.text).toContain("cal.com/kubera/intro");
    expect(DAYTIME.getTime()).toBeGreaterThan(0);
  });
});
