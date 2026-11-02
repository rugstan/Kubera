import { describe, expect, it } from "vitest";
import { DOCUMENT_EVENTS } from "@/lib/agents/documents/workflow";
import { INTEL_EVENTS } from "@/lib/agents/intel/workflow";
import { OUTREACH_EVENTS } from "@/lib/agents/outreach/workflow";
import type { AgentWorkflowHooks, WorkflowDeps } from "./deps";
import { EVENTS } from "./events";
import { TERM_SHEET_RECHECK_MS, createWorkflowFunctions, isDealTermSheet, lenderTermSheetsHandler } from "./functions";
import { FakeStep } from "./step";

const deps = () => ({}) as WorkflowDeps;
const hooks = (): AgentWorkflowHooks => ({
  documentClean: async () => null,
  documentExtracted: async () => ({}),
  crmMailRouted: async () => ({}),
  termSheets: async () => ({}),
  speedToLead: async () => ({}),
  outreachSweep: async () => ({}),
  weeklyIntel: async () => ({}),
  prospectScan: async () => ({}),
  prospectSettle: async () => ({}),
});

type Fn = { id: (prefix?: string) => string; opts: { triggers?: { event?: string; cron?: string; if?: string }[]; idempotency?: string } };

describe("workflow functions", () => {
  it("serves only the Phase 2 functions without agent hooks", () => {
    expect(createWorkflowFunctions(deps)).toHaveLength(3);
  });

  it("binds the Phase 3 agents to their events", () => {
    const fns = createWorkflowFunctions(deps, hooks) as unknown as Fn[];
    const byId = new Map(fns.map((f) => [f.id(), f.opts]));
    expect([...byId.keys()]).toEqual(["outbound-action", "mail-poll", "inbound-mail", "document-extract", "spreads-recalculate", "crm-mail-routed", "lender-term-sheets", "speed-to-lead", "outreach-sweep", "intel-weekly", "prospect-scan", "prospect-outreach-settle"]);
    expect(byId.get("document-extract")).toMatchObject({ triggers: [{ event: EVENTS.documentClean }], idempotency: "event.data.documentId" });
    // Extraction results are consumed: spreads and Jev re-sizing subscribe to document.extracted.
    expect(byId.get("spreads-recalculate")).toMatchObject({ triggers: [{ event: EVENTS.documentExtracted }] });
    expect(byId.get("crm-mail-routed")?.triggers?.[0]?.event).toBe(EVENTS.mailRouted);
    expect(byId.get("lender-term-sheets")?.triggers?.[0]).toMatchObject({ event: EVENTS.mailRouted, if: expect.stringContaining("term_sheet") });
    expect(byId.get("speed-to-lead")?.triggers?.[0]?.event).toBe("corin/lead.scored");
    // The sweep runs on the /api/outreach/sweep cron; the function only runs on request.
    expect(byId.get("outreach-sweep")?.triggers).toEqual([{ event: "corin/outreach.sweep.requested" }]);
    // Market intel runs Monday morning Pacific; outreach drafts settle every few minutes; scans run on request.
    expect(byId.get("intel-weekly")?.triggers).toEqual([{ cron: "TZ=America/Los_Angeles 0 7 * * 1" }, { event: "corin/intel.weekly.requested" }]);
    expect(byId.get("prospect-scan")?.triggers).toEqual([{ event: "corin/prospects.scan.requested" }]);
    expect(byId.get("prospect-outreach-settle")?.triggers).toEqual([{ cron: "*/5 * * * *" }, { event: "corin/prospects.settle.requested" }]);
  });

  it("uses the agents' own event names", () => {
    expect(EVENTS.documentClean).toBe(DOCUMENT_EVENTS.documentClean);
    expect(EVENTS.documentExtracted).toBe(DOCUMENT_EVENTS.documentExtracted);
    expect(EVENTS.leadScored).toBe(OUTREACH_EVENTS.leadScored);
    expect(EVENTS.outreachSweepRequested).toBe(OUTREACH_EVENTS.sweepRequested);
    expect(EVENTS.intelWeeklyRequested).toBe(INTEL_EVENTS.weeklyRequested);
    expect(EVENTS.prospectScanRequested).toBe(INTEL_EVENTS.scanRequested);
    expect(EVENTS.prospectSettleRequested).toBe(INTEL_EVENTS.settleRequested);
  });

  it("only treats deal-linked term sheets as quotes", () => {
    expect(isDealTermSheet({ category: "term_sheet", dealId: "d1" })).toBe(true);
    expect(isDealTermSheet({ category: "term_sheet", dealId: null })).toBe(false);
    expect(isDealTermSheet({ category: "borrower_docs", dealId: "d1" })).toBe(false);
  });
});

describe("lender term sheets workflow", () => {
  const data = { category: "term_sheet", dealId: "d1" };

  it("ingests once when nothing is waiting on an attachment", async () => {
    const step = new FakeStep();
    const calls: unknown[] = [];
    const r = await lenderTermSheetsHandler({ data, step }, { termSheets: async (dealId, opts) => (calls.push([dealId, opts]), { parsed: 1, awaiting: 0 }) });
    expect(r).toMatchObject({ parsed: 1 });
    expect(calls).toEqual([["d1", undefined]]);
    expect(step.executed).toEqual(["ingest-term-sheets"]);
  });

  it("re-checks while an attached term sheet is being scanned, then reads it", async () => {
    const step = new FakeStep();
    let n = 0;
    const r = await lenderTermSheetsHandler({ data, step }, { termSheets: async () => (++n < 3 ? { parsed: 0, awaiting: 1 } : { parsed: 1, awaiting: 0 }) });
    expect(r).toMatchObject({ parsed: 1, awaiting: 0 });
    expect(step.executed).toEqual(["ingest-term-sheets", "await-attachments-1", "ingest-term-sheets-1", "await-attachments-2", "ingest-term-sheets-2"]);
  });

  it("falls back to the body on the last pass when the attachment never clears", async () => {
    const step = new FakeStep();
    const start = step.clock.now;
    const calls: ({ attachmentWaitMs?: number } | undefined)[] = [];
    await lenderTermSheetsHandler({ data, step }, { termSheets: async (_d, opts) => (calls.push(opts), opts?.attachmentWaitMs === 0 ? { parsed: 1, awaiting: 0 } : { parsed: 0, awaiting: 1 }) });
    expect(calls).toHaveLength(TERM_SHEET_RECHECK_MS.length + 1);
    expect(calls.at(-1)).toEqual({ attachmentWaitMs: 0 });
    expect(calls.slice(1, -1).every((o) => o !== undefined && o.attachmentWaitMs === undefined)).toBe(true);
    expect(step.clock.now - start).toBeGreaterThanOrEqual(6 * 3_600_000);
    expect(await lenderTermSheetsHandler({ data: { category: "term_sheet", dealId: null }, step: new FakeStep() }, { termSheets: async () => ({}) })).toMatchObject({ status: "skipped" });
  });
});
