import { describe, expect, it } from "vitest";
import { executeApproved } from "@/lib/approvals/executors";
import type { OutboundAction } from "@/lib/compliance/approval-gate";
import { crmOutboundExecutor, isCrmAgentApproval } from "./executor";
import { DEAL_ID, harness, seedDeal } from "./testing";
import type { CrmOperation } from "./operations";

const op: CrmOperation = { type: "stage_update", opportunityId: "opp-1", toStage: "NEGOTIATION", fromStage: "QUALIFICATION", dealId: DEAL_ID, dealStage: "term_sheet" };

describe("crmApprovalExecutor", () => {
  it("matches only approvals the CRM agent made", async () => {
    const h = harness();
    seedDeal(h);
    await h.writer.submit(op, { task: "stage_sync", idempotencyKey: "stage:event-1" });
    const { record } = await h.approvals.request({ kind: "crm_update", idempotencyKey: "demo:crm_update:oak:stage:v1", summary: "Move Oak Terrace", payload: { stage: "term_sheet" }, requestedBy: "agent:crm" });
    const [mine] = await h.pending().then((all) => all.filter((r) => r.idempotencyKey === "crm:stage:event-1"));
    expect(isCrmAgentApproval(mine!)).toBe(true);
    // Same kind and requester, but not a CRM agent payload: left alone.
    expect(isCrmAgentApproval(record)).toBe(false);
    expect(isCrmAgentApproval({ ...mine!, kind: "email" })).toBe(false);
    expect(isCrmAgentApproval({ ...mine!, requestedBy: "agent:notifications" })).toBe(false);
  });

  it("does nothing for a pending, rejected or already executed approval", async () => {
    const h = harness();
    seedDeal(h);
    await h.writer.submit(op, { task: "stage_sync", idempotencyKey: "stage:event-1" });
    const [pending] = await h.pending();
    expect(await executeApproved(h.approvals, [pending!], [h.executor])).toEqual([]);
    await h.approvals.reject(pending!.id, { userId: "u", label: "Pat", dreLicense: "01234567" }, "no");
    const rejected = await h.approvals.get(pending!.id);
    expect(await executeApproved(h.approvals, [rejected!], [h.executor])).toEqual([]);
    expect(h.crm.writes).toEqual([]);
  });

  it("reports a failed change as failed so the approvals hook logs it", async () => {
    const h = harness();
    seedDeal(h);
    await h.writer.submit(op, { task: "stage_sync", idempotencyKey: "stage:event-1" });
    h.crm.updateOpportunityStage = async () => {
      throw new Error("Twenty 500");
    };
    const [a] = await h.pending();
    const out = await h.approve(a!.id);
    expect(out).toEqual([expect.objectContaining({ status: "failed" })]);
    expect(h.events.events.at(-1)).toMatchObject({ phase: "failed" });
  });
});

describe("crmOutboundExecutor", () => {
  it("runs an approved action from a workflow", async () => {
    const h = harness();
    seedDeal(h);
    const action: OutboundAction = {
      kind: "crm_update",
      idempotencyKey: "crm:stage:event-9",
      summary: "x",
      requestedBy: "agent:crm:stage_sync",
      payload: { agent: "crm", v: 1, task: "stage_sync", operation: op, reasonCodes: [], dealId: DEAL_ID, leadId: null },
    };
    const exec = crmOutboundExecutor(h.writer);
    expect(await exec(action, { approvalId: "a1", decidedBy: "Pat Broker" })).toMatchObject({ status: "executed", ref: "opp-1" });
    expect(h.crm.opportunities.get("opp-1")!.stage).toBe("NEGOTIATION");
    // A redelivery replays the stored result and does not write again.
    expect(await exec(action, { approvalId: "a1", decidedBy: "Pat Broker" })).toMatchObject({ status: "executed", ref: "opp-1" });
    expect(h.crm.writes).toEqual(["updateOpportunityStage"]);
  });
});
