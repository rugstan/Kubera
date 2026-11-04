// Deal-desk stage changes drive WS-J milestone notifications: every deal-desk
// stage key maps (or deliberately does not map) to a milestone, and the sink
// sends consent-gated, idempotent messages to the lead's borrower contact.
import { describe, expect, it } from "vitest";
import { FakeApprovalGate } from "@/lib/compliance/approval-gate";
import { MemoryLeadSource } from "@/lib/notify/leads";
import { milestoneForStage, STAGE_TO_MILESTONE } from "@/lib/notify/stage-events";
import { makeHarness } from "@/lib/notify/testing";
import { PIPELINE_STAGES } from "./stage-catalog";
import { notifierStageSink, stageEventId, type DealStageChange } from "./stage-events";

const LEAD = "3f9a12bc-0000-4000-8000-000000000001";
const lead = { id: LEAD, createdAt: "2026-11-01T00:00:00Z", tier: null, loanAmount: null, program: null, assetType: null, contact: { firstName: "Pat", email: "pat@example.com", phone: "+14155550100", consent: true } };
const change = (over: Partial<DealStageChange> = {}): DealStageChange => ({
  eventId: "deal-stage:d1:lender_outreach:4",
  dealId: "d1",
  leadId: LEAD,
  event: "package_sent",
  stage: "lender_outreach",
  previousStage: "packaging",
  borrowerName: "Sunrise Care LLC",
  ...over,
});

describe("deal-desk stage keys and milestones", () => {
  it("maps every deal-desk stage to a milestone, except commitments and exits", () => {
    const silent = new Set(["firm_commitment", "sba_authorization", "commitment", "withdrawn", "lost"]);
    for (const { key } of PIPELINE_STAGES) {
      if (silent.has(key)) expect(milestoneForStage(key), key).toBeNull();
      else expect(STAGE_TO_MILESTONE[key], key).toBeTruthy();
    }
    expect(milestoneForStage("engaged")?.key).toBe("advisor_review");
    expect(milestoneForStage("hud_review")?.key).toBe("lender_underwriting");
    expect(milestoneForStage("closing")?.key).toBe("closing_coordination");
  });

  it("derives a stable event id from deal, stage and record version", () => {
    expect(stageEventId({ id: "d1", stage: "closing", recordVersion: 9 })).toBe("deal-stage:d1:closing:9");
  });
});

describe("notifierStageSink", () => {
  it("sends the milestone to the lead's borrower once per stage change", async () => {
    const h = makeHarness({ preApproved: ["milestone_update@1", "milestone_update_sms@1"] });
    h.grant({ phone: "+14155550100", email: "pat@example.com" });
    const results: unknown[] = [];
    const sink = notifierStageSink({ notifier: h.notifier, leads: new MemoryLeadSource([lead]), onResult: (_c, r) => results.push(r) });
    await sink.stageChanged(change());
    await sink.stageChanged(change());
    expect(h.email.sent).toHaveLength(1);
    expect(h.sms.sent).toHaveLength(1);
    expect(results[0]).toMatchObject({ milestone: "lender_outreach", email: { status: "sent" } });
  });

  it("sends nothing for a move within one milestone, an exit, or a deal without a lead", async () => {
    const h = makeHarness({ preApproved: ["milestone_update@1", "milestone_update_sms@1"] });
    h.grant({ phone: "+14155550100", email: "pat@example.com" });
    const sink = notifierStageSink({ notifier: h.notifier, leads: new MemoryLeadSource([lead]) });
    await sink.stageChanged(change({ eventId: "e2", stage: "hud_review", previousStage: "third_party_reports" }));
    await sink.stageChanged(change({ eventId: "e3", stage: "withdrawn", previousStage: "packaging" }));
    await sink.stageChanged(change({ eventId: "e4", leadId: null }));
    expect(h.email.sent).toHaveLength(0);
    expect(h.sms.sent).toHaveLength(0);
  });

  it("holds the message for broker approval when the template is not pre-approved", async () => {
    const h = makeHarness({ gate: new FakeApprovalGate("pending") });
    h.grant({ phone: "+14155550100", email: "pat@example.com" });
    const results: { email?: { status: string } }[] = [];
    const sink = notifierStageSink({ notifier: h.notifier, leads: new MemoryLeadSource([lead]), onResult: (_c, r) => results.push(r as never) });
    await sink.stageChanged(change({ stage: "closing", previousStage: "firm_commitment" }));
    expect(results[0]?.email?.status).not.toBe("sent");
    expect(h.email.sent).toHaveLength(0);
  });
});
