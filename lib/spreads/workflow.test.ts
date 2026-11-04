// Integration: an extraction event reaches spreads, Jev re-sizing and the
// lenders desk's package metrics (the executive summary's numbers).
import { describe, expect, it } from "vitest";
import { MemoryExtractionStore } from "@/lib/agents/documents/store";
import { mergeSavedSpreads, metricsFromSource, withSavedSpreadDefaults } from "@/app/(staff)/lenders/_lib/forms";
import { buildExecutiveSummary } from "@/lib/agents/lenders/package";
import { createWorkflowFunctions } from "@/lib/workflows/functions";
import type { AgentWorkflowHooks, WorkflowDeps } from "@/lib/workflows/deps";
import { EVENTS } from "@/lib/workflows/events";
import { intakeSchema } from "@/lib/validation";
import { MemorySpreadStore } from "./store";
import { goldenRecord } from "./test-fixtures";
import { documentExtractedHandler, packageSpreadsFromSaved, type SpreadWorkflowDeps } from "./workflow";

const DEAL = "22222222-2222-4222-8222-222222222222";
const LEAD = "33333333-3333-4333-8333-333333333333";
const intake = intakeSchema.parse({ assetType: "MULTIFAMILY", transaction: "REFINANCE", loanAmount: 7_000_000, noi: 400_000, value: 12_000_000, unitCount: 10, occupancyPct: 50 });

async function world() {
  const extractions = new MemoryExtractionStore();
  const spreads = new MemorySpreadStore();
  const t12 = await extractions.insert({ ...goldenRecord("t12-annual-csv", { deal_id: DEAL, lead_id: LEAD }) });
  await extractions.insert({ ...goldenRecord("rent-roll-csv", { deal_id: DEAL, lead_id: LEAD }) });
  const deps: SpreadWorkflowDeps = {
    extractions,
    spreads,
    subject: async () => ({ dealId: DEAL, leadId: LEAD, intake, program: "AGENCY" }),
    now: () => new Date("2026-11-04T17:00:00.000Z"),
  };
  return { extractions, spreads, deps, t12 };
}

describe("document.extracted → spreads → Jev → lenders desk", () => {
  it("is subscribed by an Inngest function", () => {
    const hooks = { documentExtracted: async () => ({}) } as unknown as AgentWorkflowHooks;
    const fns = createWorkflowFunctions(() => ({}) as WorkflowDeps, () => hooks) as unknown as { id: () => string; opts: { triggers?: { event?: string }[] } }[];
    expect(fns.some((f) => f.opts.triggers?.some((t) => t.event === EVENTS.documentExtracted))).toBe(true);
  });

  it("writes spread rows and a Jev re-size, which become the package metrics", async () => {
    const w = await world();
    const r = await documentExtractedHandler({ extractionId: w.t12.id, documentId: null, dealId: DEAL, leadId: LEAD, docType: "T12", status: "extracted" }, w.deps);
    expect(r).toMatchObject({ status: "recalculated" });
    if (r.status !== "recalculated") throw new Error();
    expect(r.spreads).toBeGreaterThan(0);

    const kinds = new Set(w.spreads.rows.map((s) => s.kind));
    expect(kinds).toEqual(new Set(["operating_statement", "rent_roll", "deal_summary", "jev_resize"]));
    expect(w.spreads.rows.every((s) => s.dealId === DEAL && s.leadId === null && s.createdBy === "agent:spreads")).toBe(true);

    // Jev re-sized on the documents: NOI and occupancy came from the T-12 and rent roll.
    const jev = w.spreads.rows.find((s) => s.kind === "jev_resize")!;
    const res = jev.results as { changes: { field: string }[]; primaryLoanAfter: number | null };
    expect(res.changes.map((c) => c.field)).toEqual(expect.arrayContaining(["noi", "occupancyPct"]));
    expect(jev.lenderProfile).toBe("AGENCY");

    // The lenders desk loads the latest bundle as its defaults…
    const saved = await packageSpreadsFromSaved(w.spreads, { dealId: DEAL, leadId: null });
    expect(saved).not.toBeNull();
    expect(saved!.underwrittenNoiCents).toBe(Math.round(((w.spreads.rows.find((s) => s.kind === "operating_statement" && s.lenderProfile === saved!.profile)!.results as { underwrittenNoi: number }).underwrittenNoi) * 100));
    expect(saved!.occupancyPct).not.toBeNull();
    expect(saved!.units).toBe(10);

    const query = withSavedSpreadDefaults(new URLSearchParams(), saved);
    const metrics = metricsFromSource(query, 700_000_000);
    expect(metrics.spreads.noiCents).toBe(saved!.underwrittenNoiCents);
    expect(metrics.overrides.debtYieldPct).toBeCloseTo((saved!.underwrittenNoiCents! / 700_000_000) * 100, 1);
    const spreads = mergeSavedSpreads(metrics.spreads, saved);
    expect(spreads).toMatchObject({ units: 10, unitLabel: "units", underwrittenNoiCents: saved!.underwrittenNoiCents });

    // …and staff can override any figure.
    const typed = metricsFromSource(withSavedSpreadDefaults(new URLSearchParams({ noi: "450000", occupancy: "91" }), saved), 700_000_000);
    expect(mergeSavedSpreads(typed.spreads, saved)).toMatchObject({ noiCents: 45_000_000, occupancyPct: 91, units: 10 });

    // The executive summary is built from deal + spreads.
    const spec = buildExecutiveSummary({ deal: { id: DEAL, title: "Oak Terrace", program: "AGENCY", borrowerName: "Oak LLC", propertyAddress: "1 Oak St", propertyState: "CA", loanAmountCents: 700_000_000 }, spreads, asOf: "2026-11-04" });
    expect(JSON.stringify(spec)).toContain("10");
  });

  it("waits for a reviewer when the extraction is in the review queue", async () => {
    const w = await world();
    expect(await documentExtractedHandler({ extractionId: w.t12.id, dealId: DEAL, leadId: LEAD, status: "needs_review" }, w.deps)).toEqual({ status: "skipped", reason: "extraction_needs_review" });
    expect(w.spreads.rows).toHaveLength(0);
  });
});
