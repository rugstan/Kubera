// What workflow handlers need, injected so tests run them against fakes.
// Production wiring lives in lib/workflows/server.ts.

import type { ApprovalGate, OutboundAction } from "@/lib/compliance/approval-gate";
import type { InboundDeps } from "@/lib/mail/inbound";
import type { IdempotencyStore } from "./idempotency";
import type { AgentRunStore } from "./runs";
import type { WorkflowStep } from "./step";

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

/**
 * Phase 3 agent entry points the workflow functions bind to events. Each is
 * env-gated in its own module and resolves to a skip when its agent is off.
 * Production wiring lives in lib/workflows/agents-server.ts; tests pass fakes.
 */
export type AgentWorkflowHooks = {
  /** kubera/document.clean: extract the document; returns the follow-up event, or null when skipped or the agent is off. */
  documentClean(data: unknown): Promise<{ name: string; data: Record<string, unknown> } | null>;
  /** kubera/document.extracted: recalculate the deal's spreads and re-size the lead with Jev (internal analysis; sends nothing). */
  documentExtracted(data: unknown): Promise<Record<string, unknown>>;
  /** kubera/mail.routed: the CRM agent's note/task for the message (approval-gated writes). */
  crmMailRouted(data: unknown): Promise<Record<string, unknown>>;
  /** kubera/mail.routed for a term sheet tied to a deal: parse lenders@ term sheets into quotes. */
  termSheets(dealId: string): Promise<Record<string, unknown>>;
  /** kubera/lead.scored: the speed-to-lead reply. */
  speedToLead(ctx: { data: unknown; step: WorkflowStep }): Promise<Record<string, unknown>>;
  /** kubera/outreach.sweep.requested: run every chaser once. */
  outreachSweep(ctx: { step: WorkflowStep }): Promise<Record<string, unknown>>;
};
