import "server-only";
import { queueApprovalGate } from "@/lib/approvals/gate";
import { approvalService } from "@/lib/approvals/server";
import { closedApprovalGate } from "@/lib/compliance/approval-gate";
import type { ApprovalExecutor } from "@/lib/approvals/executors";
import { supabaseAgentEventStore } from "@/lib/agents/core/events";
import { modelGateway } from "@/lib/ai/gateway";
import { supabaseAdmin } from "@/lib/supabase/server";
import { supabaseIdempotencyStore } from "@/lib/workflows/idempotency";
import { crmApprovalExecutor } from "./executor";
import { supabaseAgentEventSink } from "./events";
import type { CrmAgentDeps } from "./handlers";
import { supabaseCrmLinks } from "./links";
import { supabaseRoutedMailSource } from "./mail-source";
import { parseAutonomy } from "./policy";
import { stageMapFromEnv } from "./stage-map";
import { TwentyCrmClient, twentyAgentConfigFromEnv } from "./twenty-client";
import { CrmAgentWriter } from "./writer";

// Production wiring for the CRM agents (Global rule 3: env-gated). They run
// only with Twenty configured AND Supabase configured: Supabase holds the
// event log and the approvals queue, and a CRM write that cannot be logged or
// approved does not happen. Otherwise this returns null (logged once).

let override: CrmAgentDeps | null | undefined;
let cached: CrmAgentDeps | null | undefined;
let warned = false;

/** Test hook (undefined restores env wiring). */
export function setCrmAgentDeps(deps: CrmAgentDeps | null | undefined): void {
  override = deps;
}

export function crmAgentDeps(): CrmAgentDeps | null {
  if (override !== undefined) return override;
  if (cached !== undefined) return cached;
  const config = twentyAgentConfigFromEnv();
  const db = supabaseAdmin();
  if (!config || !db) {
    if (config && !db && !warned) {
      warned = true;
      console.info("[crm-agent] Supabase is not configured: no event log or approval queue, so the CRM agents stay off.");
    }
    return (cached = null);
  }
  const client = new TwentyCrmClient(config);
  let members: Promise<{ id: string; email: string | null }[]> | null = null;
  const links = supabaseCrmLinks(db, () => (members ??= client.listMembers()));
  const writer = new CrmAgentWriter({
    client,
    // The approvals queue (WS-I); the closed gate, which never approves, when it is not configured.
    gate: (o) => {
      const service = approvalService();
      return service ? queueApprovalGate(service, o) : closedApprovalGate;
    },
    events: supabaseAgentEventSink(db),
    effects: supabaseIdempotencyStore(db),
    autonomy: parseAutonomy(process.env.CRM_AGENT_AUTONOMY),
    dealStage: async (dealId) => (await links.forDeal(dealId))?.dealStage ?? null,
  });
  return (cached = { writer, client, links, mail: supabaseRoutedMailSource(db), gateway: modelGateway(), stageMap: stageMapFromEnv(), events: supabaseAgentEventStore(db) });
}

/** Approval executors for lib/approvals/executors-server.ts: empty when the CRM agents are off. */
export function crmApprovalExecutors(): ApprovalExecutor[] {
  const deps = crmAgentDeps();
  return deps ? [crmApprovalExecutor(deps.writer)] : [];
}
