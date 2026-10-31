// agent_runs: one row per workflow/agent run, with the model calls it made
// (provider, model, tokens, latency, stop reason; never prompt text), the
// subject it worked on, its outcome and its Langfuse trace id.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { GatewayResponse } from "@/lib/ai/gateway";

export const RUN_STATUSES = ["running", "succeeded", "failed", "skipped", "needs_review"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export type ModelCallRecord = {
  provider: string;
  model: string;
  servedModel: string;
  purpose: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: string;
  latencyMs: number;
  refused: boolean;
  redacted: boolean;
};

export function modelCallFrom(res: GatewayResponse, purpose: string): ModelCallRecord {
  return {
    provider: res.provider,
    model: res.requestedModel,
    servedModel: res.servedModel,
    purpose,
    inputTokens: res.usage.inputTokens,
    outputTokens: res.usage.outputTokens,
    stopReason: res.stopReason,
    latencyMs: res.latencyMs,
    refused: res.refused,
    redacted: res.redacted,
  };
}

export type AgentRunStart = {
  workflow: string;
  /** Unique per logical run; a second start with the same key returns the first row. */
  idempotencyKey?: string;
  triggerEvent?: string;
  triggerEventId?: string;
  inngestRunId?: string;
  subjectType?: string;
  subjectId?: string;
  dealId?: string | null;
  leadId?: string | null;
  traceId?: string;
};

export type AgentRunFinish = {
  status: Exclude<RunStatus, "running">;
  summary?: Record<string, unknown>;
  error?: string;
  modelCalls?: ModelCallRecord[];
  routingRefusals?: number;
  dealId?: string | null;
  leadId?: string | null;
};

export interface AgentRunStore {
  start(run: AgentRunStart, now: Date): Promise<string>;
  finish(id: string, result: AgentRunFinish, now: Date): Promise<void>;
}

export type MemoryRun = AgentRunStart & Partial<Omit<AgentRunFinish, "status">> & { id: string; status: RunStatus; startedAt: string; finishedAt?: string };

export class MemoryAgentRunStore implements AgentRunStore {
  readonly runs: MemoryRun[] = [];

  async start(run: AgentRunStart, now: Date): Promise<string> {
    const existing = run.idempotencyKey ? this.runs.find((r) => r.idempotencyKey === run.idempotencyKey) : undefined;
    if (existing) return existing.id;
    const id = globalThis.crypto.randomUUID();
    this.runs.push({ ...run, id, status: "running", startedAt: now.toISOString() });
    return id;
  }

  async finish(id: string, result: AgentRunFinish, now: Date): Promise<void> {
    const run = this.runs.find((r) => r.id === id);
    if (!run) throw new Error(`agent run ${id} not found`);
    Object.assign(run, result, { finishedAt: now.toISOString() });
  }
}

function totals(calls: ModelCallRecord[] = []) {
  return calls.reduce((t, c) => ({ input: t.input + c.inputTokens, output: t.output + c.outputTokens }), { input: 0, output: 0 });
}

export function supabaseAgentRunStore(db: SupabaseClient): AgentRunStore {
  return {
    async start(run, now) {
      const row = {
        workflow: run.workflow,
        idempotency_key: run.idempotencyKey ?? null,
        trigger_event: run.triggerEvent ?? null,
        trigger_event_id: run.triggerEventId ?? null,
        inngest_run_id: run.inngestRunId ?? null,
        subject_type: run.subjectType ?? null,
        subject_id: run.subjectId ?? null,
        deal_id: run.dealId ?? null,
        lead_id: run.leadId ?? null,
        trace_id: run.traceId ?? null,
        status: "running",
        started_at: now.toISOString(),
      };
      const { data, error } = await db.from("agent_runs").insert(row).select("id").single();
      if (!error) return (data as { id: string }).id;
      if (error.code === "23505" && run.idempotencyKey) {
        const existing = await db.from("agent_runs").select("id").eq("idempotency_key", run.idempotencyKey).single();
        if (!existing.error) return (existing.data as { id: string }).id;
      }
      throw new Error(`agent_runs insert failed: ${error.message}`);
    },
    async finish(id, result, now) {
      const t = totals(result.modelCalls);
      const { error } = await db
        .from("agent_runs")
        .update({
          status: result.status,
          finished_at: now.toISOString(),
          summary: result.summary ?? {},
          error: result.error?.slice(0, 2000) ?? null,
          model_calls: result.modelCalls ?? [],
          input_tokens: t.input,
          output_tokens: t.output,
          routing_refusals: result.routingRefusals ?? 0,
          ...(result.dealId !== undefined ? { deal_id: result.dealId } : {}),
          ...(result.leadId !== undefined ? { lead_id: result.leadId } : {}),
        })
        .eq("id", id);
      if (error) throw new Error(`agent_runs update failed: ${error.message}`);
    },
  };
}
