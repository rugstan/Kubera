// Agent event log for the CRM agents. Every CRM write an agent proposes,
// requests approval for, starts, completes, skips or fails is appended here:
// insert-only (the sink has no update or delete), with the model/prompt/tool
// versions, approver, external record ids and reason codes.
//
// The durable table, `agent_events`, belongs to the agent safety platform
// (WS-AB, migration slot 06); this file writes to it through one mapping
// (`toCoreAgentEvent`) so a column rename there is a one-place change. The
// writer fails closed: if the event for an upcoming write cannot be recorded,
// the write does not happen.

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAgentEventStore, type AgentEventInput as CoreAgentEventInput, type AgentEventOutcome, type AgentEventStore } from "@/lib/agents/core/events";
import { codeSegment } from "@/lib/agents/core/reasons";
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (v: string | null | undefined) => (v && UUID.test(v) ? v : null);

/** Splits a registry id like "crm-tools@1" into the table's slug and semver ("crm-tools", "1.0.0"). */
export function splitVersionedId(id: string | null | undefined): { id: string | null; version: string | null } {
  if (!id) return { id: null, version: null };
  const m = /^([a-z][a-z0-9_.-]{1,62})@(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(id);
  if (!m) return { id: null, version: null };
  return { id: m[1]!, version: `${m[2]}.${m[3] ?? 0}.${m[4] ?? 0}` };
}

/** CRM codes may carry a value after a colon ("category:term_sheet"); the table stores dotted codes ("category.term_sheet"). */
export function toReasonCode(code: string): string {
  return code
    .split(/[:.]/)
    .map((part) => codeSegment(part))
    .join(".");
}

const OUTCOME_BY_PHASE: Record<AgentEventPhase, AgentEventOutcome> = {
  proposed: "proposed",
  audit_only: "recorded",
  approval_requested: "pending_approval",
  approval_rejected: "rejected",
  approval_expired: "expired",
  write_started: "recorded",
  executed: "executed",
  skipped: "recorded",
  failed: "failed",
  blocked: "blocked",
};

/**
 * Maps a CRM agent event onto the shared agent_events row (lib/agents/core/events.ts,
 * WS-AB). The CRM-specific fields (action, phase, actor, CRM target) go in `detail`;
 * the CRM record id is the external message id.
 */
export function toCoreAgentEvent(e: AgentEventInput): CoreAgentEventInput {
  const tool = splitVersionedId(CRM_AGENT_VERSIONS.tool);
  const prompt = splitVersionedId(e.promptVersion);
  const actionSegment = codeSegment(e.action);
  return {
    eventType: `crm.${codeSegment(e.phase)}`,
    agent: e.agent,
    task: `crm.${e.task}`,
    autonomy: e.autonomy,
    dealId: uuidOrNull(e.dealId),
    leadId: uuidOrNull(e.leadId),
    promptId: prompt.id,
    promptVersion: prompt.version,
    model: e.model ? e.model.slice(0, 100) : null,
    toolName: `crm.${actionSegment}`,
    toolVersion: tool.version,
    approvalId: uuidOrNull(e.approvalId),
    idempotencyKey: e.idempotencyKey && e.idempotencyKey.length >= 8 ? e.idempotencyKey.slice(0, 300) : null,
    approverLabel: e.approver ? e.approver.slice(0, 200) : null,
    outcome: OUTCOME_BY_PHASE[e.phase],
    externalMessageIds: e.externalRef ? [e.externalRef] : [],
    reasonCodes: [...new Set(e.reasonCodes.map(toReasonCode))].slice(0, 20),
    detail: {
      ...(e.detail ?? {}),
      action: e.action,
      phase: e.phase,
      actor: e.actor.slice(0, 200),
      targetObject: e.targetObject ?? null,
      targetId: e.targetId ?? null,
      ...(e.approvalId && !uuidOrNull(e.approvalId) ? { approvalRef: e.approvalId.slice(0, 200) } : {}),
    },
  };
}

/** Appends CRM events to an agent_events store (insert only, hash-chained per agent). */
export function agentEventStoreSink(store: AgentEventStore): AgentEventSink {
  return {
    async record(event) {
      await store.append(toCoreAgentEvent(event));
    },
  };
}

/** Appends to `agent_events` (insert only). Throws when the row could not be recorded. */
export function supabaseAgentEventSink(db: SupabaseClient, now: () => Date = () => new Date()): AgentEventSink {
  return agentEventStoreSink(supabaseAgentEventStore(db, now));
}
