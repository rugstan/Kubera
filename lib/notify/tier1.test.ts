import { describe, expect, it } from "vitest";
import { FakeApprovalGate } from "@/lib/compliance/approval-gate";
import type { LeadRecord } from "./leads";
import { DAYTIME, makeHarness, NIGHT } from "./testing";
import { alertTier1Lead, leadReference, staffContactsFromEnv, tier1Summary, TIER1_SLA_MS } from "./tier1";

const STAFF = { phones: ["+13105550111", "+13105550112"], emails: ["deals@kuberacommercial.com"] };

const lead = (over: Partial<LeadRecord> = {}): LeadRecord => ({
  id: "3f9a12bc-0000-4000-8000-000000000001",
  createdAt: new Date(DAYTIME.getTime() - 4_000).toISOString(),
  tier: "TIER_1_INSTITUTIONAL_HOT",
  loanAmount: 12_000_000,
  program: "HUD_232_223F",
  assetType: "ASSISTED_LIVING",
  contact: { firstName: "Pat", email: "pat@example.com", phone: "415-555-0100", consent: true },
  ...over,
});

describe("Tier-1 alert", () => {
  it("texts every broker through the pre-approved template without asking the approval gate", async () => {
    const gate = new FakeApprovalGate("rejected");
    const h = makeHarness({ gate });
    const result = await alertTier1Lead(lead(), h.notifier, STAFF, () => h.clock.now);

    expect(result.alerted).toBe(true);
    expect(result.sms.map((o) => o.status)).toEqual(["sent", "sent"]);
    expect(h.sms.sent.map((s) => s.to).sort()).toEqual(STAFF.phones);
    expect(gate.requests).toHaveLength(0);

    const text = h.sms.sent[0]?.text ?? "";
    expect(text).toContain("Tier-1 lead 3F9A12BC");
    expect(text).toContain("$12.0M");
    expect(text).toContain("HUD 232 223f");
    expect(text).toContain("Phone and text consent on file");
  });

  it("alerts within 60 seconds of lead creation and reports the latency", async () => {
    const h = makeHarness();
    const result = await alertTier1Lead(lead(), h.notifier, STAFF, () => h.clock.now);
    expect(result.latencyMs).toBe(4_000);
    expect(result.latencyMs).toBeLessThanOrEqual(TIER1_SLA_MS);
    expect(result.withinSla).toBe(true);
    expect(h.email.sent[0]?.text).toContain("4 seconds");
  });

  it("flags a late alert as outside the SLA", async () => {
    const h = makeHarness();
    const result = await alertTier1Lead(lead({ createdAt: new Date(DAYTIME.getTime() - 5 * 60_000).toISOString() }), h.notifier, STAFF, () => h.clock.now);
    expect(result.withinSla).toBe(false);
    expect(result.sms.every((o) => o.status === "sent")).toBe(true);
  });

  it("still texts the brokers at night (staff alerts are exempt from quiet hours)", async () => {
    const h = makeHarness({ now: NIGHT });
    const result = await alertTier1Lead(lead({ createdAt: new Date(NIGHT.getTime() - 1000).toISOString() }), h.notifier, STAFF, () => h.clock.now);
    expect(result.sms.map((o) => o.status)).toEqual(["sent", "sent"]);
  });

  it("tells the broker not to call when there is no phone and text consent", async () => {
    const h = makeHarness();
    await alertTier1Lead(lead({ contact: { firstName: "Pat", email: "pat@example.com", phone: "415-555-0100", consent: false } }), h.notifier, STAFF, () => h.clock.now);
    expect(h.sms.sent[0]?.text).toContain("Email only: no phone or text consent");
    expect(h.email.sent[0]?.text).toContain("contact by email only");
  });

  it("never puts the borrower's name, email or phone in the text", async () => {
    const h = makeHarness();
    await alertTier1Lead(lead(), h.notifier, STAFF, () => h.clock.now);
    const text = h.sms.sent[0]?.text ?? "";
    expect(text).not.toMatch(/Pat|pat@example|415/);
  });

  it("sends once per lead even if triggered twice (qualifier route plus cron sweep)", async () => {
    const h = makeHarness();
    await alertTier1Lead(lead(), h.notifier, STAFF, () => h.clock.now);
    const again = await alertTier1Lead(lead(), h.notifier, STAFF, () => h.clock.now);
    expect(again.sms.map((o) => o.status)).toEqual(["duplicate", "duplicate"]);
    expect(h.sms.sent).toHaveLength(2);
    expect(h.email.sent).toHaveLength(1);
  });

  it("ignores leads that are not Tier 1, including advisor-only leads", async () => {
    const h = makeHarness();
    for (const tier of ["TIER_2_QUALIFIED_MIDMARKET", "TIER_3_NURTURE", "UNQUALIFIED", null]) {
      const result = await alertTier1Lead(lead({ tier }), h.notifier, STAFF, () => h.clock.now);
      expect(result).toMatchObject({ alerted: false, skipped: "not_tier_1" });
    }
    expect(h.sms.sent).toHaveLength(0);
    expect(h.email.sent).toHaveLength(0);
  });

  it("does not report within-SLA when the SMS provider is not configured, but still emails", async () => {
    const h = makeHarness({ sms: false });
    const result = await alertTier1Lead(lead(), h.notifier, STAFF, () => h.clock.now);
    expect(result.sms.map((o) => o.status)).toEqual(["skipped_unconfigured", "skipped_unconfigured"]);
    expect(result.withinSla).toBe(false);
    expect(h.email.sent).toHaveLength(1);
  });

  it("retries the text on the next run after a provider failure", async () => {
    const h = makeHarness();
    h.sms.failNext = new (await import("./sms/types")).SmsError("Telnyx 500", 500);
    const first = await alertTier1Lead(lead(), h.notifier, { phones: [STAFF.phones[0] as string], emails: [] }, () => h.clock.now);
    expect(first.sms[0]?.status).toBe("failed");
    const second = await alertTier1Lead(lead(), h.notifier, { phones: [STAFF.phones[0] as string], emails: [] }, () => h.clock.now);
    expect(second.sms[0]?.status).toBe("sent");
  });
});

describe("helpers", () => {
  it("builds a short reference and summary", () => {
    expect(leadReference("3f9a12bc-0000-4000-8000-000000000001")).toBe("3F9A12BC");
    expect(tier1Summary({ loanAmount: 750_000, program: "SBA_7A", assetType: "HOTEL" })).toBe("$750K hotel SBA 7a");
    expect(tier1Summary({ loanAmount: null, program: null, assetType: null })).toBe("amount not given");
  });

  it("reads staff contacts from the environment and defaults the email", () => {
    expect(staffContactsFromEnv({ NOTIFY_STAFF_SMS_NUMBERS: " +13105550111, +13105550112 ", NOTIFY_STAFF_EMAILS: "a@x.com" })).toEqual({
      phones: ["+13105550111", "+13105550112"],
      emails: ["a@x.com"],
    });
    expect(staffContactsFromEnv({})).toEqual({ phones: [], emails: ["deals@kuberacommercial.com"] });
  });
});
