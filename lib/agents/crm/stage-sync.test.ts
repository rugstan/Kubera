import { describe, expect, it, vi } from "vitest";
import { DEFAULT_STAGE_MAP, stageMapFromEnv, twentyStageFor } from "./stage-map";
import { crmStageSink, reconcileStages, syncDealStage } from "./stage-sync";
import { DEAL_ID, LEAD_ID, harness, seedDeal } from "./testing";

const change = (over: Record<string, unknown> = {}) => ({ eventId: `deal-stage:${DEAL_ID}:term_sheet:3`, dealId: DEAL_ID, leadId: LEAD_ID, stage: "term_sheet", previousStage: "lender_outreach", event: "advance", borrowerName: null, ...over });

describe("stage map", () => {
  it("maps every deal-desk stage the catalog can produce", async () => {
    const { PIPELINE_STAGES } = await import("@/lib/deals/stage-catalog");
    for (const s of PIPELINE_STAGES) expect(twentyStageFor(s.key), s.key).not.toBeNull();
    expect(twentyStageFor("closed")).toBe("CLOSED_WON");
    expect(twentyStageFor("Lost")).toBe("CLOSED_LOST");
    expect(twentyStageFor("something_new")).toBeNull();
  });

  it("can be overridden from env, ignoring bad entries", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const map = stageMapFromEnv({ TWENTY_STAGE_MAP: JSON.stringify({ term_sheet: "TERM_SHEET", closing: "lowercase", "bad key": "X_Y" }) });
    expect(map.term_sheet).toBe("TERM_SHEET");
    expect(map.closing).toBe(DEFAULT_STAGE_MAP.closing);
    expect(stageMapFromEnv({ TWENTY_STAGE_MAP: "{not json" })).toEqual(DEFAULT_STAGE_MAP);
    warn.mockRestore();
  });
});

describe("syncDealStage", () => {
  it("asks a broker to move the opportunity, naming both stages", async () => {
    const h = harness();
    seedDeal(h);
    const out = await syncDealStage(change(), h.deps);
    expect(out.status).toBe("pending_approval");
    const [a] = await h.pending();
    expect(a!.payload).toMatchObject({ agent: "crm", task: "stage_sync", operation: { type: "stage_update", toStage: "NEGOTIATION", fromStage: "QUALIFICATION", dealStage: "term_sheet" } });
    expect(h.crm.writes).toEqual([]);
  });

  it("skips unmapped stages and deals with no Twenty opportunity", async () => {
    const h = harness();
    seedDeal(h);
    expect(await syncDealStage(change({ stage: "mystery" }), h.deps)).toEqual({ status: "skipped", reason: "stage_not_mapped" });
    h.links.deals.set(DEAL_ID, { ...h.links.deals.get(DEAL_ID)!, opportunityId: null });
    expect(await syncDealStage(change(), h.deps)).toEqual({ status: "skipped", reason: "no_crm_opportunity" });
    expect(await h.pending()).toHaveLength(0);
  });

  it("is idempotent per stage event", async () => {
    const h = harness();
    seedDeal(h);
    await syncDealStage(change(), h.deps);
    await syncDealStage(change(), h.deps);
    expect(await h.pending()).toHaveLength(1);
  });
});

describe("crmStageSink", () => {
  it("proposes the stage change and creates the advisor task for the stage", async () => {
    const h = harness();
    seedDeal(h);
    await crmStageSink(h.deps).stageChanged(change());
    expect(await h.pending()).toHaveLength(1);
    expect(h.crm.tasks).toHaveLength(1);
    expect(h.crm.tasks[0]).toMatchObject({ title: expect.stringMatching(/lender terms/i), assigneeId: "member-1", targets: { opportunityId: "opp-1", personId: "person-1" } });
    expect(h.crm.tasks[0]!.dueAt).toMatch(/^2026-11-0[5-9]T/);
  });

  it("never throws into the deal desk when the CRM is down", async () => {
    const h = harness();
    seedDeal(h);
    h.crm.getOpportunity = async () => {
      throw new Error("Twenty is down");
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(crmStageSink(h.deps).stageChanged(change())).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("adds no task for stages without one", async () => {
    const h = harness();
    seedDeal(h);
    await crmStageSink(h.deps).stageChanged(change({ stage: "hud_review", eventId: "deal-stage:x:hud_review:4" }));
    expect(h.crm.tasks).toHaveLength(0);
  });
});

describe("reconcileStages", () => {
  it("proposes a fix only where Twenty differs from the deal desk", async () => {
    const h = harness();
    seedDeal(h, { stage: "term_sheet", crmStage: "QUALIFICATION" });
    h.crm.addOpportunity({ id: "opp-2", stage: "NEGOTIATION" });
    h.links.deals.set("30000000-0000-4000-8000-000000000001", { dealId: "30000000-0000-4000-8000-000000000001", leadId: null, opportunityId: "opp-2", personId: null, dealStage: "term_sheet", ownerUserId: null });
    const r = await reconcileStages(h.deps);
    expect(r).toEqual({ checked: 2, proposed: 1, inSync: 1, skipped: 0, failed: 0 });
    const again = await reconcileStages(h.deps);
    expect(again.proposed).toBe(1);
    expect(await h.pending()).toHaveLength(1);
  });

  it("caps proposals per run", async () => {
    const h = harness();
    for (let i = 0; i < 5; i++) {
      const id = `30000000-0000-4000-8000-00000000000${i}`;
      h.crm.addOpportunity({ id: `o${i}`, stage: "QUALIFICATION" });
      h.links.deals.set(id, { dealId: id, leadId: null, opportunityId: `o${i}`, personId: null, dealStage: "closing", ownerUserId: null });
    }
    const r = await reconcileStages(h.deps, { maxProposals: 2 });
    expect(r.proposed).toBe(2);
  });
});
