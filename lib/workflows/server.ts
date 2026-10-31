import "server-only";
import { approvalGate } from "@/lib/approvals/server";
import type { ApprovalGate } from "@/lib/compliance/approval-gate";
import { inboundMailDeps } from "@/lib/mail/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { agentWorkflowHooks } from "./agents-server";
import type { OutboundExecutor, WorkflowDeps } from "./deps";
import { createWorkflowFunctions } from "./functions";
import { MemoryIdempotencyStore, supabaseIdempotencyStore } from "./idempotency";
import { MemoryAgentRunStore, supabaseAgentRunStore } from "./runs";

// Production wiring for the workflow functions served at /api/inngest.

/**
 * Resolves the broker approval gate: the approvals queue (lib/approvals/server.ts
 * `approvalGate`), which is the closed gate when the queue is not configured
 * (nothing is ever approved, so nothing sends). Tests swap it with
 * setApprovalGateResolver.
 */
let gateResolver: () => ApprovalGate = approvalGate;

export function setApprovalGateResolver(resolve: () => ApprovalGate): void {
  gateResolver = resolve;
}

const executors: Partial<Record<string, OutboundExecutor>> = {};

/**
 * Registers the executor for an outbound action kind (e.g. "email" by the
 * notifications workstream). Only registered kinds can ever be sent, and
 * only after approval.
 */
export function registerOutboundExecutor(kind: string, executor: OutboundExecutor): void {
  if (!/^[a-z][a-z0-9_]{1,47}$/.test(kind)) throw new Error(`Invalid action kind: ${kind}`);
  executors[kind] = executor;
}

let override: WorkflowDeps | undefined;
let warned = false;

export function setWorkflowDeps(deps: WorkflowDeps | undefined): void {
  override = deps;
}

export function workflowDeps(): WorkflowDeps {
  if (override) return override;
  const db = supabaseAdmin();
  if (!db && !warned) {
    warned = true;
    console.warn("[workflows] Supabase is not configured; agent runs and effect keys are kept in memory only.");
  }
  return {
    gate: gateResolver(),
    effects: db ? supabaseIdempotencyStore(db) : new MemoryIdempotencyStore(),
    runs: db ? supabaseAgentRunStore(db) : new MemoryAgentRunStore(),
    mail: inboundMailDeps(),
    executors,
    now: () => new Date(),
  };
}

let functions: ReturnType<typeof createWorkflowFunctions> | undefined;

/** The functions /api/inngest serves (created once). */
export function workflowFunctions(): ReturnType<typeof createWorkflowFunctions> {
  functions ??= createWorkflowFunctions(workflowDeps, agentWorkflowHooks);
  return functions;
}
