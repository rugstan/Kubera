import { z } from "zod";
import type { WorkflowStep } from "@/lib/workflows/step";
import type { LeadRecord } from "@/lib/notify/leads";
import type { OutreachSources } from "./sources";
import { speedToLead, type SpeedToLeadDeps } from "./speed-to-lead";
import { runOutreachSweep, type SweepDeps, type SweepSummary } from "./sweep";

// Workflow bodies for the chasers, written against WorkflowStep so they run the
// same under Inngest and the test FakeStep (the pattern in lib/workflows). The
// Inngest registration (event names, retries, the cron) is a cross-request:
// lib/workflows/functions.ts is WS-Q's file.
//
// Step results are persisted by Inngest, so steps return ids, statuses and
// counts only: never names, phone numbers or message text.

export const OUTREACH_EVENTS = {
  /** A lead was stored and scored; send the speed-to-lead reply. */
  leadScored: "kubera/lead.scored",
  /** Run every chaser once now (a cron also does, every few minutes). */
  sweepRequested: "kubera/outreach.sweep.requested",
} as const;

export const leadScoredSchema = z.object({ leadId: z.uuid() });

export type SpeedToLeadWorkflowResult = {
  handled: boolean;
  sent: "sms" | "email" | null;
  withinSla: boolean;
  latencyMs: number;
  skipped?: string;
  escalated: boolean;
};

export async function speedToLeadWorkflow(
  ctx: { data: unknown; step: WorkflowStep },
  deps: SpeedToLeadDeps & { sources: Pick<OutreachSources, "lead"> },
): Promise<SpeedToLeadWorkflowResult> {
  const { leadId } = leadScoredSchema.parse(ctx.data);
  // The lead is read inside its own step so a replay does not depend on a second read.
  const found = await ctx.step.run("load-lead", async () => {
    const lead = await deps.sources.lead(leadId);
    return lead ? { found: true as const, lead } : { found: false as const };
  });
  if (!found.found) return { handled: false, sent: null, withinSla: false, latencyMs: 0, skipped: "lead_not_found", escalated: false };
  const lead: LeadRecord = found.lead;
  return ctx.step.run("speed-to-lead", async () => {
    const r = await speedToLead(lead, deps);
    return { handled: r.handled, sent: r.sent, withinSla: r.withinSla, latencyMs: r.latencyMs, ...(r.skipped ? { skipped: r.skipped } : {}), escalated: r.escalated };
  });
}

export async function outreachSweepWorkflow(ctx: { step: WorkflowStep }, deps: SweepDeps): Promise<SweepSummary> {
  return ctx.step.run("sweep", () => runOutreachSweep(deps));
}
