// agent_events: the insert-only audit trail of AI agent activity.
//
// Every row says which agent (and version) did what, under which prompt,
// model and tool versions, at which autonomy level, who approved it, what
// went out (external message ids) and why (reason codes). Rows never change:
// the database rejects update, delete and truncate.
//
// Hash chain (optional, on by default per agent): rows in a chain are
// numbered 1, 2, 3 … and each row's hash covers its own canonical content
// plus the previous row's hash, so editing or removing a row breaks every
// later hash. `verifyChain` recomputes it; the database checks the linkage on
// insert (agent_events_chain_guard).

import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { stableStringify } from "@/lib/approvals/hash";
import { normalizeReasonCodes } from "./reasons";
import type { AutonomyLevel } from "./autonomy";

export const AGENT_EVENT_OUTCOMES = [
  "proposed",
  "pending_approval",
  "executed",
  "already_executed",
  "rejected",
  "expired",
  "blocked",
  "failed",
  "recorded",
] as const;
export type AgentEventOutcome = (typeof AGENT_EVENT_OUTCOMES)[number];

const EVENT_TYPE = /^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/;
const SLUG = /^[a-z][a-z0-9_.-]{1,62}$/;
const TOOL = /^[a-z][a-z0-9_.]{1,62}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const CHAIN = /^[a-z][a-z0-9_.:-]{1,120}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const DRE = /^\d{8}$/;
export const MAX_DETAIL_BYTES = 16_000;

/** What callers write. Optional fields are null in the stored row. */
export type AgentEventInput = {
  eventType: string;
  agent: string;
  agentVersion?: string | null;
  task?: string | null;
  autonomy?: AutonomyLevel | null;
  runId?: string | null;
  dealId?: string | null;
  leadId?: string | null;
  promptId?: string | null;
  promptVersion?: string | null;
  promptSha256?: string | null;
  model?: string | null;
  servedModel?: string | null;
  toolName?: string | null;
  toolVersion?: string | null;
  approvalId?: string | null;
  idempotencyKey?: string | null;
  approverId?: string | null;
  approverLabel?: string | null;
  approverDre?: string | null;
  outcome?: AgentEventOutcome | null;
  externalMessageIds?: readonly string[];
  reasonCodes?: readonly string[];
  /** Metadata only (codes, counts, ids). Never message bodies, prompts or restricted values. */
  detail?: Record<string, unknown>;
  /** Hash chain to append to; defaults to `agent:<agent>`. Pass null for an unchained row. */
  chain?: string | null;
  occurredAt?: string;
};

export type AgentEvent = Required<Omit<AgentEventInput, "chain" | "occurredAt" | "externalMessageIds" | "reasonCodes" | "detail">> & {
  id: string;
  occurredAt: string;
  externalMessageIds: string[];
  reasonCodes: string[];
  detail: Record<string, unknown>;
  chain: string | null;
  seq: number | null;
  prevHash: string | null;
  hash: string | null;
};

export class AgentEventValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentEventValidationError";
  }
}

function check(ok: boolean, message: string): void {
  if (!ok) throw new AgentEventValidationError(message);
}

const opt = <T>(v: T | null | undefined): T | null => (v === undefined ? null : v);

/** Validates an event against the same rules the table enforces, so a bad row fails before the insert. */
export function normalizeEvent(input: AgentEventInput, now: Date): Omit<AgentEvent, "id" | "seq" | "prevHash" | "hash"> {
  check(EVENT_TYPE.test(input.eventType), `event_type "${input.eventType}" must look like "tool.executed"`);
  check(SLUG.test(input.agent), `agent "${input.agent}" is not a valid id`);
  for (const [name, v, re] of [
    ["agent_version", input.agentVersion, SEMVER],
    ["task", input.task, SLUG],
    ["prompt_id", input.promptId, SLUG],
    ["prompt_version", input.promptVersion, SEMVER],
    ["prompt_sha256", input.promptSha256, SHA256],
    ["tool_name", input.toolName, TOOL],
    ["tool_version", input.toolVersion, SEMVER],
    ["run_id", input.runId, UUID],
    ["deal_id", input.dealId, UUID],
    ["lead_id", input.leadId, UUID],
    ["approval_id", input.approvalId, UUID],
    ["approver_id", input.approverId, UUID],
    ["approver_dre", input.approverDre, DRE],
  ] as const) {
    if (v != null) check(re.test(v), `${name} "${v}" is invalid`);
  }
  if (input.idempotencyKey != null) check(input.idempotencyKey.length >= 8 && input.idempotencyKey.length <= 300, "idempotency_key must be 8–300 characters");
  if (input.model != null) check(input.model.length <= 100, "model id too long");
  if (input.servedModel != null) check(input.servedModel.length <= 100, "served model id too long");
  if (input.approverLabel != null) check(input.approverLabel.length <= 200, "approver label too long");
  const chain = input.chain === undefined ? `agent:${input.agent}` : input.chain;
  if (chain !== null) check(CHAIN.test(chain), `chain "${chain}" is invalid`);
  const external = [...new Set((input.externalMessageIds ?? []).map((s) => s.slice(0, 300)).filter(Boolean))];
  check(external.length <= 50, "at most 50 external message ids");
  const detail = input.detail ?? {};
  check(typeof detail === "object" && !Array.isArray(detail), "detail must be an object");
  const json = stableStringify(detail);
  check(Buffer.byteLength(json, "utf8") <= MAX_DETAIL_BYTES, "detail is too large (metadata only)");
  let reasonCodes: string[];
  try {
    reasonCodes = normalizeReasonCodes(input.reasonCodes ?? []);
  } catch (err) {
    throw new AgentEventValidationError((err as Error).message);
  }
  const occurredAt = input.occurredAt ?? now.toISOString();
  check(!Number.isNaN(Date.parse(occurredAt)), "occurred_at is not a timestamp");
  return {
    eventType: input.eventType,
    agent: input.agent,
    agentVersion: opt(input.agentVersion),
    task: opt(input.task),
    autonomy: opt(input.autonomy),
    runId: opt(input.runId),
    dealId: opt(input.dealId),
    leadId: opt(input.leadId),
    promptId: opt(input.promptId),
    promptVersion: opt(input.promptVersion),
    promptSha256: opt(input.promptSha256),
    model: opt(input.model),
    servedModel: opt(input.servedModel),
    toolName: opt(input.toolName),
    toolVersion: opt(input.toolVersion),
    approvalId: opt(input.approvalId),
    idempotencyKey: opt(input.idempotencyKey),
    approverId: opt(input.approverId),
    approverLabel: opt(input.approverLabel),
    approverDre: opt(input.approverDre),
    outcome: opt(input.outcome),
    externalMessageIds: external,
    reasonCodes,
    detail: JSON.parse(json) as Record<string, unknown>,
    chain,
    occurredAt: new Date(occurredAt).toISOString(),
  };
}

/** The fields a chain hash covers (everything except the row id and the hash itself). */
function hashedContent(e: Omit<AgentEvent, "id" | "hash">): Record<string, unknown> {
  const { prevHash, ...rest } = e;
  return { ...rest, prevHash };
}

export function eventHash(e: Omit<AgentEvent, "id" | "hash">): string {
  return createHash("sha256").update(stableStringify(hashedContent(e))).digest("hex");
}

export type ChainVerification = { ok: true; length: number } | { ok: false; length: number; brokenAt: number; reason: "seq_gap" | "prev_hash_mismatch" | "hash_mismatch" };

/** Recomputes a chain (rows of one chain, any order) and reports the first break. */
export function verifyChain(events: readonly AgentEvent[]): ChainVerification {
  const rows = [...events].filter((e) => e.chain !== null).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  let prev: string | null = null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.seq !== i + 1) return { ok: false, length: rows.length, brokenAt: r.seq ?? i + 1, reason: "seq_gap" };
    if (r.prevHash !== prev) return { ok: false, length: rows.length, brokenAt: r.seq, reason: "prev_hash_mismatch" };
    const { id: _id, hash, ...content } = r;
    void _id;
    if (eventHash(content) !== hash) return { ok: false, length: rows.length, brokenAt: r.seq, reason: "hash_mismatch" };
    prev = hash;
  }
  return { ok: true, length: rows.length };
}

export type AgentEventFilter = {
  agent?: string;
  dealId?: string;
  leadId?: string;
  approvalId?: string;
  idempotencyKey?: string;
  chain?: string;
  eventType?: string;
  limit?: number;
};

export interface AgentEventStore {
  /** Appends one event (and extends its chain). Throws when the event cannot be stored. */
  append(input: AgentEventInput): Promise<AgentEvent>;
  list(filter?: AgentEventFilter): Promise<AgentEvent[]>;
}

function matches(e: AgentEvent, f: AgentEventFilter): boolean {
  return (
    (!f.agent || e.agent === f.agent) &&
    (!f.dealId || e.dealId === f.dealId) &&
    (!f.leadId || e.leadId === f.leadId) &&
    (!f.approvalId || e.approvalId === f.approvalId) &&
    (!f.idempotencyKey || e.idempotencyKey === f.idempotencyKey) &&
    (!f.chain || e.chain === f.chain) &&
    (!f.eventType || e.eventType === f.eventType)
  );
}

/** In-memory store for tests and fake mode. Same validation and chaining as the database. */
export class MemoryAgentEventStore implements AgentEventStore {
  private readonly rows: AgentEvent[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly now: () => Date = () => new Date()) {}

  /** Snapshot copies (tamper with these in tests, not the store). */
  all(): AgentEvent[] {
    return this.rows.map((r) => structuredClone(r));
  }

  append(input: AgentEventInput): Promise<AgentEvent> {
    // Serialised like the database's per-chain advisory lock.
    const run = this.queue.then(() => this.appendNow(input));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private appendNow(input: AgentEventInput): AgentEvent {
    const base = normalizeEvent(input, this.now());
    let seq: number | null = null;
    let prevHash: string | null = null;
    let hash: string | null = null;
    if (base.chain) {
      const head = this.rows.filter((r) => r.chain === base.chain).reduce<AgentEvent | null>((h, r) => (!h || (r.seq ?? 0) > (h.seq ?? 0) ? r : h), null);
      seq = (head?.seq ?? 0) + 1;
      prevHash = head?.hash ?? null;
      hash = eventHash({ ...base, seq, prevHash });
    }
    const row: AgentEvent = { ...base, id: randomUUID(), seq, prevHash, hash };
    this.rows.push(row);
    return structuredClone(row);
  }

  async list(filter: AgentEventFilter = {}): Promise<AgentEvent[]> {
    return this.rows
      .filter((r) => matches(r, filter))
      .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : (b.seq ?? 0) - (a.seq ?? 0)))
      .slice(0, filter.limit ?? 500)
      .map((r) => structuredClone(r));
  }
}

// --- Supabase -------------------------------------------------------------------------------------

type Row = {
  id: string;
  occurred_at: string;
  event_type: string;
  agent: string;
  agent_version: string | null;
  task: string | null;
  autonomy: AutonomyLevel | null;
  run_id: string | null;
  deal_id: string | null;
  lead_id: string | null;
  prompt_id: string | null;
  prompt_version: string | null;
  prompt_sha256: string | null;
  model: string | null;
  served_model: string | null;
  tool_name: string | null;
  tool_version: string | null;
  approval_id: string | null;
  idempotency_key: string | null;
  approver_id: string | null;
  approver_label: string | null;
  approver_dre: string | null;
  outcome: AgentEventOutcome | null;
  external_message_ids: string[] | null;
  reason_codes: string[] | null;
  detail: Record<string, unknown> | null;
  chain: string | null;
  seq: number | string | null;
  prev_hash: string | null;
  hash: string | null;
};

export function toRow(e: AgentEvent): Row {
  return {
    id: e.id,
    occurred_at: e.occurredAt,
    event_type: e.eventType,
    agent: e.agent,
    agent_version: e.agentVersion,
    task: e.task,
    autonomy: e.autonomy,
    run_id: e.runId,
    deal_id: e.dealId,
    lead_id: e.leadId,
    prompt_id: e.promptId,
    prompt_version: e.promptVersion,
    prompt_sha256: e.promptSha256,
    model: e.model,
    served_model: e.servedModel,
    tool_name: e.toolName,
    tool_version: e.toolVersion,
    approval_id: e.approvalId,
    idempotency_key: e.idempotencyKey,
    approver_id: e.approverId,
    approver_label: e.approverLabel,
    approver_dre: e.approverDre,
    outcome: e.outcome,
    external_message_ids: e.externalMessageIds,
    reason_codes: e.reasonCodes,
    detail: e.detail,
    chain: e.chain,
    seq: e.seq,
    prev_hash: e.prevHash,
    hash: e.hash,
  };
}

export function fromRow(r: Row): AgentEvent {
  return {
    id: r.id,
    occurredAt: new Date(r.occurred_at).toISOString(),
    eventType: r.event_type,
    agent: r.agent,
    agentVersion: r.agent_version,
    task: r.task,
    autonomy: r.autonomy,
    runId: r.run_id,
    dealId: r.deal_id,
    leadId: r.lead_id,
    promptId: r.prompt_id,
    promptVersion: r.prompt_version,
    promptSha256: r.prompt_sha256,
    model: r.model,
    servedModel: r.served_model,
    toolName: r.tool_name,
    toolVersion: r.tool_version,
    approvalId: r.approval_id,
    idempotencyKey: r.idempotency_key,
    approverId: r.approver_id,
    approverLabel: r.approver_label,
    approverDre: r.approver_dre,
    outcome: r.outcome,
    externalMessageIds: r.external_message_ids ?? [],
    reasonCodes: r.reason_codes ?? [],
    detail: r.detail ?? {},
    chain: r.chain,
    seq: r.seq === null ? null : Number(r.seq),
    prevHash: r.prev_hash,
    hash: r.hash,
  };
}

const COLUMNS =
  "id, occurred_at, event_type, agent, agent_version, task, autonomy, run_id, deal_id, lead_id, prompt_id, prompt_version, prompt_sha256, model, served_model, tool_name, tool_version, approval_id, idempotency_key, approver_id, approver_label, approver_dre, outcome, external_message_ids, reason_codes, detail, chain, seq, prev_hash, hash";

/** Postgres codes for "someone else extended the chain first": retry against the new head. */
const RACE_CODES = new Set(["23505", "40001"]);
export const CHAIN_APPEND_ATTEMPTS = 5;

export function supabaseAgentEventStore(db: SupabaseClient, now: () => Date = () => new Date()): AgentEventStore {
  const table = () => db.from("agent_events");
  return {
    async append(input) {
      const base = normalizeEvent(input, now());
      for (let attempt = 1; ; attempt++) {
        let seq: number | null = null;
        let prevHash: string | null = null;
        let hash: string | null = null;
        if (base.chain) {
          const head = await table().select("seq, hash").eq("chain", base.chain).order("seq", { ascending: false }).limit(1).maybeSingle();
          if (head.error) throw new Error(`agent_events head read failed: ${head.error.message}`);
          const h = head.data as { seq: number | string; hash: string } | null;
          seq = h ? Number(h.seq) + 1 : 1;
          prevHash = h?.hash ?? null;
          hash = eventHash({ ...base, seq, prevHash });
        }
        const row: AgentEvent = { ...base, id: randomUUID(), seq, prevHash, hash };
        const { error } = await table().insert(toRow(row));
        if (!error) return row;
        if (base.chain && error.code && RACE_CODES.has(error.code) && attempt < CHAIN_APPEND_ATTEMPTS) continue;
        throw new Error(`agent_events insert failed: ${error.message}`);
      }
    },
    async list(filter = {}) {
      let q = table().select(COLUMNS);
      if (filter.agent) q = q.eq("agent", filter.agent);
      if (filter.dealId) q = q.eq("deal_id", filter.dealId);
      if (filter.leadId) q = q.eq("lead_id", filter.leadId);
      if (filter.approvalId) q = q.eq("approval_id", filter.approvalId);
      if (filter.idempotencyKey) q = q.eq("idempotency_key", filter.idempotencyKey);
      if (filter.chain) q = q.eq("chain", filter.chain);
      if (filter.eventType) q = q.eq("event_type", filter.eventType);
      const { data, error } = await q.order("occurred_at", { ascending: false }).limit(filter.limit ?? 500);
      if (error) throw new Error(`agent_events read failed: ${error.message}`);
      return ((data ?? []) as Row[]).map(fromRow);
    },
  };
}
