// What workflow handlers need, injected so tests run them against fakes.
// Production wiring lives in lib/workflows/server.ts.

import type { ApprovalGate, OutboundAction } from "@/lib/compliance/approval-gate";
import type { InboundDeps } from "@/lib/mail/inbound";
import type { IdempotencyStore } from "./idempotency";
import type { AgentRunStore } from "./runs";

/**
 * Performs one approved outbound action. Receives the action exactly as the
 * broker approved it. Must pass `action.idempotencyKey` to the provider where
 * the provider supports idempotency keys. Returns a JSON-safe receipt.
 */
export type OutboundExecutor = (action: OutboundAction, approval: { approvalId: string; decidedBy: string }) => Promise<Record<string, unknown>>;

export type WorkflowDeps = {
  gate: ApprovalGate;
  effects: IdempotencyStore;
  runs: AgentRunStore;
  /** Inbound mail pipeline; null when Zoho Mail or Supabase is not configured. */
  mail: InboundDeps | null;
  /** Executors by action kind (email, sms, crm_update, …). Kinds without one are never sent. */
  executors: Partial<Record<string, OutboundExecutor>>;
  /** Called when an approval wait expires (e.g. to mark the approval row expired). */
  onApprovalExpired?: (approvalId: string | null, action: OutboundAction) => Promise<void>;
  now: () => Date;
};
