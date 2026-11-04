import { describe, expect, it } from "vitest";
import { FakeApprovalGate } from "@/lib/compliance/approval-gate";
import { findBannedCopy } from "./templates";
import { milestoneForStage, normalizeStage, notifyStageEvent } from "./stage-events";
import { makeHarness } from "./testing";

const contact = { firstName: "Pat", email: "pat@example.com", phone: "+14155550100" };
const event = (over = {}) => ({ eventId: "evt1", stage: "LENDER_OUTREACH", previousStage: "PACKAGE", leadId: "3f9a12bc-0000-4000-8000-000000000001", contact, ...over });

describe("stage to milestone mapping", () => {
  it.each([
    ["QUALIFICATION", "advisor_review"],
    ["Lender outreach", "lender_outreach"],
    ["term-sheet", "lender_terms"],
    ["NEGOTIATION", "lender_terms"],
    ["underwriting", "lender_underwriting"],
    ["closing", "closing_coordination"],
    ["CLOSED_WON", "closed"],
  ])("%s -> %s", (stage, key) => expect(milestoneForStage(stage)?.key).toBe(key));

  it.each(["CLOSED_LOST", "dead", "held_for_counsel", "", "something_new"])("%s sends nothing", (stage) => expect(milestoneForStage(stage)).toBeNull());

  it("normalizes stage names", () => expect(normalizeStage("  Term Sheet! ")).toBe("term_sheet"));

  it("keeps milestone copy within the legal copy rules", () => {
    for (const stage of ["qualification", "package", "lender_outreach", "term_sheet", "underwriting", "closing", "closed"]) {
      const m = milestoneForStage(stage);
      expect(m).not.toBeNull();
      expect(findBannedCopy(`${m?.label}. ${m?.message}`)).toEqual([]);
    }
  });
});

describe("milestone notifications", () => {
  it("sends the email and the text for a consenting borrower", async () => {
    const h = makeHarness({ preApproved: ["milestone_update@1", "milestone_update_sms@1"] });
    h.grant({ phone: "+14155550100", email: "pat@example.com" });
    const res = await notifyStageEvent(event(), h.notifier);
    expect(res).toMatchObject({ milestone: "lender_outreach" });
    expect(res.email?.status).toBe("sent");
    expect(res.sms?.status).toBe("sent");
    expect(h.email.sent[0]?.subject).toBe("Update on your financing request: Lender outreach");
    expect(h.email.sent[0]?.text).toContain("Your loan package is being shared with lenders");
    expect(h.sms.sent[0]?.text).toContain("Lender outreach");
  });

  it("sends nothing to someone who never consented", async () => {
    const h = makeHarness({ preApproved: ["milestone_update@1", "milestone_update_sms@1"] });
    const res = await notifyStageEvent(event(), h.notifier);
    expect(res.email?.status).toBe("skipped_no_consent");
    expect(res.sms?.status).toBe("skipped_no_consent");
    expect(h.email.sent).toHaveLength(0);
    expect(h.sms.sent).toHaveLength(0);
  });

  it("texts only when the person agreed to texts", async () => {
    const h = makeHarness({ preApproved: ["milestone_update@1", "milestone_update_sms@1"] });
    h.grant({ phone: "+14155550100", email: "pat@example.com", channels: ["email"] });
    const res = await notifyStageEvent(event(), h.notifier);
    expect(res.email?.status).toBe("sent");
    expect(res.sms?.status).toBe("skipped_no_consent");
  });

  it("holds milestone messages for broker approval unless the broker pre-approved them", async () => {
    const gate = new FakeApprovalGate("pending");
    const h = makeHarness({ gate });
    h.grant({ phone: "+14155550100", email: "pat@example.com" });
    const res = await notifyStageEvent(event(), h.notifier);
    expect(res.email?.status).toBe("pending_approval");
    expect(res.sms?.status).toBe("pending_approval");
    expect(h.email.sent).toHaveLength(0);
    expect(gate.requests.map((r) => r.templateId).sort()).toEqual(["milestone_update@1", "milestone_update_sms@1"]);
  });

  it("is idempotent per stage event", async () => {
    const h = makeHarness({ preApproved: ["milestone_update@1"] });
    h.grant({ email: "pat@example.com" });
    await notifyStageEvent(event({ contact: { firstName: "Pat", email: "pat@example.com" } }), h.notifier);
    const again = await notifyStageEvent(event({ contact: { firstName: "Pat", email: "pat@example.com" } }), h.notifier);
    expect(again.email?.status).toBe("duplicate");
    expect(h.email.sent).toHaveLength(1);
  });

  it("skips unknown stages and unchanged stages", async () => {
    const h = makeHarness();
    expect(await notifyStageEvent(event({ stage: "CLOSED_LOST" }), h.notifier)).toMatchObject({ milestone: null, skipped: "unknown_stage" });
    expect(await notifyStageEvent(event({ stage: "lender-outreach", previousStage: "LENDER_OUTREACH" }), h.notifier)).toMatchObject({ skipped: "no_change" });
    expect(h.store.notifications).toHaveLength(0);
  });
});
