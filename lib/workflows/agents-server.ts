import "server-only";
import { agentSafety } from "@/lib/agents/core/server";
import { documentAgentDeps } from "@/lib/agents/documents/server";
import { documentCleanHandler } from "@/lib/agents/documents/workflow";
import { handleMailRouted } from "@/lib/agents/crm/handlers";
import { crmAgentDeps } from "@/lib/agents/crm/server";
import { indexRatesFromEnv, lenderRuntime, modelGateway } from "@/lib/agents/lenders/runtime";
import { ingestTermSheets } from "@/lib/agents/lenders/service";
import { outreachRuntime } from "@/lib/agents/outreach/runtime";
import { outreachSweepWorkflow, speedToLeadWorkflow } from "@/lib/agents/outreach/workflow";
import { spreadWorkflowDeps } from "@/lib/spreads/server";
import { documentExtractedHandler } from "@/lib/spreads/workflow";
import type { AgentWorkflowHooks } from "./deps";

// Production wiring for the Phase 3 agent workflow functions (document
// extraction, CRM notes, lender term sheets, outreach chasers). Each agent is
// env-gated in its own runtime and returns a skip when it is off. Step results
// carry ids, statuses and counts only.

export function agentWorkflowHooks(): AgentWorkflowHooks {
  return {
    async documentClean(data) {
      const deps = documentAgentDeps();
      if (!deps) return null;
      const r = await documentCleanHandler(data, deps);
      return r.skipped ? null : { name: r.emit.name, data: r.emit.data };
    },
    async documentExtracted(data) {
      const deps = spreadWorkflowDeps();
      if (!deps) return { status: "skipped", reason: "spreads_off" };
      return documentExtractedHandler(data, deps);
    },
    async crmMailRouted(data) {
      const deps = crmAgentDeps();
      if (!deps) return { status: "skipped", reason: "crm_agent_off" };
      const r = await handleMailRouted(data, deps);
      return { note: r.note.status, task: r.task.status };
    },
    async termSheets(dealId) {
      const rt = lenderRuntime();
      if (!rt) return { status: "skipped", reason: "lender_desk_off" };
      const r = await ingestTermSheets(
        { quotes: rt.store, desk: rt.desk.store, mail: rt.mail, gateway: modelGateway(), now: rt.desk.now, indexRates: indexRatesFromEnv(), events: agentSafety().events },
        { dealId, limit: 10, actor: "agent:lenders" },
      );
      return { parsed: r.parsed, needsReview: r.needsReview, skipped: r.skipped, errors: r.errors.length };
    },
    async speedToLead(ctx) {
      const rt = outreachRuntime();
      return speedToLeadWorkflow(ctx, { ...rt, sources: rt.sources });
    },
    async outreachSweep(ctx) {
      return outreachSweepWorkflow(ctx, outreachRuntime());
    },
  };
}
