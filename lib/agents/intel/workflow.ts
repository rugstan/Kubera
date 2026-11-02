import { z } from "zod";
import type { WorkflowStep } from "@/lib/workflows/step";
import { runMarketIntel, type MarketDeps } from "./market";
import { settlePending, type OutreachDeps, type SweepResult } from "./outreach";
import { scanProspects, type ScanDeps } from "./prospects";

// Workflow bodies for market intel and prospecting, written against
// WorkflowStep so they run the same under Inngest and the test FakeStep (the
// pattern in lib/workflows). lib/workflows/functions.ts binds them to their
// events and cron schedules; lib/workflows/agents-server.ts supplies the deps.
//
// Step results are persisted by Inngest, so steps return ids, statuses and
// counts only: never signal text, owner names or message bodies.

export const INTEL_EVENTS = {
  /** Weekly cron (Monday morning, Pacific) or a manual request. */
  weeklyRequested: "corin/intel.weekly.requested",
  /** Refinance-maturity scan request. */
  scanRequested: "corin/prospects.scan.requested",
  /** Check waiting outreach drafts for broker decisions (cron every few minutes). */
  settleRequested: "corin/prospects.settle.requested",
} as const;

export const weeklyIntelSchema = z.object({ weekStart: z.iso.date().optional(), focus: z.string().max(200).optional() });

export const scanRequestSchema = z.object({
  zips: z.array(z.string().regex(/^\d{5}$/)).min(1).max(25),
  fromMonths: z.number().min(-36).max(36).default(0),
  toMonths: z.number().min(-36).max(36).default(18),
  minLoanAmount: z.number().min(0).optional(),
});

export type WeeklyIntelWorkflowResult = { status: "drafted" | "audit_only" | "no_signals"; draftId?: string; usedModel?: boolean; signalCount?: number };

export async function weeklyIntelWorkflow(ctx: { data: unknown; step: WorkflowStep }, deps: MarketDeps): Promise<WeeklyIntelWorkflowResult> {
  const input = weeklyIntelSchema.parse(ctx.data ?? {});
  return ctx.step.run("write-weekly-note", async () => {
    const r = await runMarketIntel(deps, { ...(input.weekStart ? { weekStart: input.weekStart } : {}), focus: input.focus ?? null, actor: "agent:intel" });
    if (r.status === "drafted") return { status: "drafted" as const, draftId: r.draft.id, usedModel: r.usedModel, signalCount: r.draft.signals.length };
    if (r.status === "audit_only") return { status: "audit_only" as const, usedModel: r.usedModel, signalCount: r.signalCount };
    return { status: "no_signals" as const };
  });
}

export type ScanWorkflowResult = { status: string; scanId?: string; found?: number; created?: number; updated?: number };

export async function prospectScanWorkflow(ctx: { data: unknown; step: WorkflowStep }, deps: ScanDeps): Promise<ScanWorkflowResult> {
  const input = scanRequestSchema.parse(ctx.data);
  return ctx.step.run("scan", async () => {
    const r = await scanProspects(deps, { query: { zips: input.zips, fromMonths: input.fromMonths, toMonths: input.toMonths, ...(input.minLoanAmount !== undefined ? { minLoanAmount: input.minLoanAmount } : {}) }, actor: "agent:prospecting" });
    if (r.status === "completed") return { status: r.status, scanId: r.scan.id, found: r.found, created: r.created, updated: r.updated };
    if (r.status === "failed") return { status: r.status, scanId: r.scan.id };
    return { status: r.status };
  });
}

export async function outreachSettleWorkflow(ctx: { step: WorkflowStep }, deps: OutreachDeps): Promise<SweepResult> {
  return ctx.step.run("settle", () => settlePending(deps));
}
