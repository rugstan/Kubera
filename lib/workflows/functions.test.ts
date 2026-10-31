import { describe, expect, it } from "vitest";
import { DOCUMENT_EVENTS } from "@/lib/agents/documents/workflow";
import { OUTREACH_EVENTS } from "@/lib/agents/outreach/workflow";
import type { AgentWorkflowHooks, WorkflowDeps } from "./deps";
import { EVENTS } from "./events";
import { createWorkflowFunctions, isDealTermSheet } from "./functions";

const deps = () => ({}) as WorkflowDeps;
const hooks = (): AgentWorkflowHooks => ({
  documentClean: async () => null,
  crmMailRouted: async () => ({}),
  termSheets: async () => ({}),
  speedToLead: async () => ({}),
  outreachSweep: async () => ({}),
});

type Fn = { id: (prefix?: string) => string; opts: { triggers?: { event?: string; cron?: string; if?: string }[]; idempotency?: string } };

describe("workflow functions", () => {
  it("serves only the Phase 2 functions without agent hooks", () => {
    expect(createWorkflowFunctions(deps)).toHaveLength(3);
  });

  it("binds the Phase 3 agents to their events", () => {
    const fns = createWorkflowFunctions(deps, hooks) as unknown as Fn[];
    const byId = new Map(fns.map((f) => [f.id(), f.opts]));
    expect([...byId.keys()]).toEqual(["outbound-action", "mail-poll", "inbound-mail", "document-extract", "crm-mail-routed", "lender-term-sheets", "speed-to-lead", "outreach-sweep"]);
    expect(byId.get("document-extract")).toMatchObject({ triggers: [{ event: EVENTS.documentClean }], idempotency: "event.data.documentId" });
    expect(byId.get("crm-mail-routed")?.triggers?.[0]?.event).toBe(EVENTS.mailRouted);
    expect(byId.get("lender-term-sheets")?.triggers?.[0]).toMatchObject({ event: EVENTS.mailRouted, if: expect.stringContaining("term_sheet") });
    expect(byId.get("speed-to-lead")?.triggers?.[0]?.event).toBe("kubera/lead.scored");
    // The sweep runs on the /api/outreach/sweep cron; the function only runs on request.
    expect(byId.get("outreach-sweep")?.triggers).toEqual([{ event: "kubera/outreach.sweep.requested" }]);
  });

  it("uses the agents' own event names", () => {
    expect(EVENTS.documentClean).toBe(DOCUMENT_EVENTS.documentClean);
    expect(EVENTS.documentExtracted).toBe(DOCUMENT_EVENTS.documentExtracted);
    expect(EVENTS.leadScored).toBe(OUTREACH_EVENTS.leadScored);
    expect(EVENTS.outreachSweepRequested).toBe(OUTREACH_EVENTS.sweepRequested);
  });

  it("only treats deal-linked term sheets as quotes", () => {
    expect(isDealTermSheet({ category: "term_sheet", dealId: "d1" })).toBe(true);
    expect(isDealTermSheet({ category: "term_sheet", dealId: null })).toBe(false);
    expect(isDealTermSheet({ category: "borrower_docs", dealId: "d1" })).toBe(false);
  });
});
