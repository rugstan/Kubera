// S4: an unreadable principals list or checklist stops the send the way an
// unreadable hold list does: nothing is stored, locked or requested.

import { describe, expect, it } from "vitest";
import { CHECKLIST_UNREADABLE, PRINCIPALS_UNREADABLE } from "./context";
import { computeSubmissionMetrics } from "./metrics";
import { evaluateReadiness } from "./readiness";
import { submitDealToLenders } from "./send";
import { TEST_ADVISOR, sendWorld } from "./send-test-world";

describe("unreadable principals or checklist", () => {
  it.each([PRINCIPALS_UNREADABLE, CHECKLIST_UNREADABLE])("refuse the request before anything is stored: %s", async (stop) => {
    const w = await sendWorld("bridge", "pending", (ctx) => {
      // What context.ts leaves behind when the read fails: empty lists, and the hard stop.
      if (stop === PRINCIPALS_UNREADABLE) ctx.principals = [];
      else ctx.checklistItems = [];
      ctx.unreadable = [stop];
    });
    await expect(submitDealToLenders(w.deps, { dealId: w.deal.id, targetStage: "underwrite", lenderIds: [w.lenders.a.id], items: w.items, advisor: TEST_ADVISOR, actor: "broker:ana", overrideReason: "A reason to send anyway does not lift this stop." })).rejects.toMatchObject({ reason: "deal_held" });
    expect(w.gate.requests).toHaveLength(0);
    expect(w.summaries.rows.size).toBe(0);
    expect(await w.store.listPackages(w.deal.id)).toEqual([]);
  });

  it("an empty checklist read as a failure no longer drops the Underwrite requirements to nothing", async () => {
    const w = await sendWorld("bridge");
    const withItems = { ...w.ctx, checklistItems: w.ctx.checklistItems.map((i, n) => (i.required && (i.stage === "underwriting" || i.stage === "application") && n % 2 === 0 ? { ...i, status: "requested" as const } : i)) };
    const missing = evaluateReadiness(withItems, computeSubmissionMetrics(withItems), "underwrite").missing.length;
    expect(missing).toBeGreaterThan(0);
    const failed = { ...w.ctx, checklistItems: [], unreadable: [CHECKLIST_UNREADABLE] };
    const r = evaluateReadiness(failed, computeSubmissionMetrics(failed), "underwrite");
    expect(r.hardStops).toContain(CHECKLIST_UNREADABLE);
  });
});
