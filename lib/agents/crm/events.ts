// Agent event log for the CRM agents. Every CRM write an agent proposes,
// requests approval for, starts, completes, skips or fails is appended here:
// insert-only (the sink has no update or delete), with the model/prompt/tool
// versions, approver, external record ids and reason codes.
//
// The durable table, `agent_events`, belongs to the agent safety platform
// (WS-AB, migration slot 06); this file writes to it through one mapping
// (`toAgentEventRow`) so a column rename there is a one-place change. The
// writer fails closed: if the event for an upcoming write cannot be recorded,
// the write does not happen.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CrmTask } from "./scopes";

/** Versions stamped on every event (registered in the prompt and model registry by WS-AB). */
export const CRM_AGENT_VERSIONS = {
  tool: "crm-tools@1",
  callSummaryPrompt: "crm-call-summary@1",
} as const;

export const AGENT_EVENT_PHASES = [
  /** The agent decided a change is warranted (before any approval or write). */
  "proposed",
  /** Audit autonomy: logged what it would have done; nothing was requested or written. */
  "audit_only",
  "approval_requested",
  "approval_rejected",
  "approval_expired",
  /** Logged immediately before the CRM request is made. */
  "write_started",
  "executed",
  "skipped",
  "failed",
  /** Refused before acting (scope, invalid payload, event log unavailable). */
  "blocked",
] as const;
export type AgentEventPhase = (typeof AGENT_EVENT_PHASES)[number];

export type AutonomyLevel = "audit" | "assist" | "automate";

export type AgentEventInput = {
  agent: "crm";
  task: CrmTask;
  /** Operation kind, e.g. "stage_update", "note_create", "company_merge". */
  action: string;
  phase: AgentEventPhase;
  autonomy: AutonomyLevel;
  /** Who requested it, e.g. "agent:crm:stage_sync". */
  actor: string;
  dealId?: string | null;
  leadId?: string | null;
  targetObject?: string | null;
  targetId?: string | null;
  approvalId?: string | null;
  approver?: string | null;
  idempotencyKey?: string | null;
  /** Id of the record the CRM created or changed. */
  externalRef?: string | null;
  reasonCodes: string[];
  /** Model that produced content for this write (call summaries), if any. */
  model?: string | null;
  promptVersion?: string | null;
  /** Counts, hashes and ids only; never note bodies, transcripts or contact details. */
  detail?: Record<string, unknown>;
};

export type AgentEvent = AgentEventInput & { id: string; occurredAt: string; toolVersion: string };

export interface AgentEventSink {
  /** Appends one event. Throws when it could not be recorded (the writer then refuses to write). */
  record(event: AgentEventInput): Promise<void>;
}

/** Collects events in memory (tests). */
export class MemoryAgentEventSink implements AgentEventSink {
  readonly events: AgentEvent[] = [];
  /** When set, record() throws (to prove writes stop when the log is down). */
  failWith: Error | null = null;
  private n = 0;

  constructor(private readonly now: () => Date = () => new Date()) {}

  async record(event: AgentEventInput): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.n += 1;
    this.events.push({ ...structuredClone(event), id: `evt_${this.n}`, occurredAt: this.now().toISOString(), toolVersion: CRM_AGENT_VERSIONS.tool });
  }

  phases(action?: string): AgentEventPhase[] {
    return this.events.filter((e) => !action || e.action === action).map((e) => e.phase);
  }
}

export type AgentEventRow = {
  occurred_at: string;
  agent: string;
  task: string;
  action: string;
  phase: string;
  autonomy: string;
  actor: string;
  deal_id: string | null;
  lead_id: string | null;
  target_object: string | null;
  target_id: string | null;
  approval_id: string | null;
  approver: string | null;
  idempotency_key: string | null;
  external_ref: string | null;
  reason_codes: string[];
  model: string | null;
  prompt_version: string | null;
  tool_version: string;
  detail: Record<string, unknown>;
};

const uuidOrNull = (v: string | null | undefined) => (v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null);

export function toAgentEventRow(e: AgentEventInput, now: Date): AgentEventRow {
  return {
    occurred_at: now.toISOString(),
    agent: e.agent,
    task: e.task,
    action: e.action,
    phase: e.phase,
    autonomy: e.autonomy,
    actor: e.actor.slice(0, 200),
    deal_id: uuidOrNull(e.dealId),
    lead_id: uuidOrNull(e.leadId),
    target_object: e.targetObject ?? null,
    target_id: e.targetId ?? null,
    approval_id: uuidOrNull(e.approvalId),
    approver: e.approver ?? null,
    idempotency_key: e.idempotencyKey?.slice(0, 300) ?? null,
    external_ref: e.externalRef ?? null,
    reason_codes: e.reasonCodes.slice(0, 20),
    model: e.model ?? null,
    prompt_version: e.promptVersion ?? null,
    tool_version: CRM_AGENT_VERSIONS.tool,
    detail: e.detail ?? {},
  };
}

/** Appends to `agent_events` (insert only). */
export function supabaseAgentEventSink(db: SupabaseClient, now: () => Date = () => new Date()): AgentEventSink {
  return {
    async record(event) {
      const { error } = await db.from("agent_events").insert(toAgentEventRow(event, now()));
      if (error) throw new Error(`agent_events insert failed: ${error.message}`);
    },
  };
}
