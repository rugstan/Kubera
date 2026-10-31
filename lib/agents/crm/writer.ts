// The single path by which a CRM agent changes Twenty.
//
//   submit(op)
//     1. validate the operation, and check the task's profile allows it
//     2. read-only precheck (skip no-ops and stale changes)
//     3. log `proposed`                     (cannot log -> do nothing)
//     4. autonomy/policy -> audit: log only; direct: write; else approval gate
//     5. approval gate (Global rule 2): pending waits for a broker, rejected or
//        expired never writes, approved writes exactly once
//     6. write through a client limited to the task's scopes, retry only
//        errors where the CRM refused the request outright, log the outcome
//
//   executeApproval(record) is the same write for an approval a broker decided
//   later (registered as an approval executor, ./executor.ts). Both paths share
//   one idempotency key, so a change is written at most once.

import { createHash } from "node:crypto";
import { payloadHash } from "@/lib/approvals/hash";
import type { ApprovalGate, OutboundAction } from "@/lib/compliance/approval-gate";
import { EffectInProgressError, EffectOutcomeUnknownError, idempotentEffect, type IdempotencyStore } from "@/lib/workflows/idempotency";
import { CRM_AGENT_VERSIONS, type AgentEventInput, type AgentEventPhase, type AgentEventSink, type AutonomyLevel } from "./events";
import {
  APPROVAL_IDEMPOTENCY_PREFIX,
  approvalPayloadSchema,
  describeOperation,
  operationSchema,
  targetOf,
  taskMayRun,
  type CompanyMergeOp,
  type CrmApprovalPayload,
  type CrmOperation,
} from "./operations";
import { autonomyFor, DEFAULT_AUTONOMY, dispositionFor, type AutonomyConfig } from "./policy";
import { cleanLine, cleanMarkdown } from "./sanitize";
import { clientForTask, type CrmTask } from "./scopes";
import { isTerminalTwentyStage } from "./stage-map";
import { CrmError, type CrmClient } from "./types";

export type SubmitContext = {
  task: CrmTask;
  /** Stable per logical change, 8+ characters: the same change always carries the same key. */
  idempotencyKey: string;
  actor?: string;
  reasonCodes?: string[];
  dealId?: string | null;
  leadId?: string | null;
  /** How long a pending approval may wait before it expires and never writes. */
  ttlMinutes?: number;
  model?: string | null;
  promptVersion?: string | null;
  /** Extra non-sensitive facts for the event log. */
  detail?: Record<string, unknown>;
};

export type WriteOutcome =
  | { status: "executed"; ref: string | null; approvalId: string | null; replayed: boolean }
  | { status: "pending_approval"; approvalId: string | null }
  | { status: "logged_only" }
  | { status: "skipped"; reason: string }
  | { status: "rejected" | "expired"; approvalId: string | null }
  | { status: "failed"; error: string }
  | { status: "blocked"; reason: string };

export type CrmWriterDeps = {
  /** Unscoped client; the writer narrows it to the task's scopes for every call. */
  client: CrmClient;
  /** The approval gate, or a factory taking the approval wait (queueApprovalGate(service, { ttlMinutes })). */
  gate: ApprovalGate | ((opts: { ttlMinutes?: number }) => ApprovalGate);
  events: AgentEventSink;
  /** workflow_effects in production: one write per idempotency key. */
  effects: IdempotencyStore;
  autonomy?: AutonomyConfig;
  /** Current deal-desk stage of a deal, so a stage write whose deal moved on is dropped. */
  dealStage?: (dealId: string) => Promise<string | null>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

/** A decided approval row, as the approvals executor hands it over. */
export type DecidedApproval = {
  id: string;
  idempotencyKey: string;
  status: string;
  payload: Record<string, unknown>;
  decidedByLabel?: string | null;
  decidedByDre?: string | null;
};

class EventLogUnavailable extends Error {
  constructor(cause: unknown) {
    super(`agent event log unavailable: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "EventLogUnavailable";
  }
}

const MAX_ATTEMPTS = 3;

type Executed = { ref: string | null; detail: Record<string, unknown> } | { skipped: string };

export class CrmAgentWriter {
  private readonly autonomy: AutonomyConfig;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: CrmWriterDeps) {
    this.autonomy = deps.autonomy ?? DEFAULT_AUTONOMY;
    this.now = deps.now ?? (() => new Date());
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  levelFor(task: CrmTask): AutonomyLevel {
    return autonomyFor(this.autonomy, task);
  }

  // --- submit -----------------------------------------------------------------------------------

  async submit(input: CrmOperation, ctx: SubmitContext): Promise<WriteOutcome> {
    const level = this.levelFor(ctx.task);
    const parsed = operationSchema.safeParse(input);
    if (!parsed.success) return this.refuse(ctx, level, "invalid", "invalid_operation", { issues: parsed.error.issues.slice(0, 5).map((i) => i.path.join(".")) });
    const op = parsed.data;
    if (ctx.idempotencyKey.length < 8 || ctx.idempotencyKey.length > 290) return this.refuse(ctx, level, op.type, "invalid_idempotency_key");
    if (!taskMayRun(ctx.task, op.type)) return this.refuse(ctx, level, op.type, "operation_outside_task_scope", {}, op);

    const log = this.logger(ctx, op, level);
    try {
      const skip = await this.evaluate(op, ctx);
      if (skip) {
        await log("skipped", [skip]);
        return { status: "skipped", reason: skip };
      }
      await log("proposed", ctx.reasonCodes ?? []);

      const disposition = dispositionFor(op.type, level);
      if (disposition === "log_only") {
        await log("audit_only", ["audit_autonomy"]);
        return { status: "logged_only" };
      }
      if (disposition === "direct") return await this.execute(op, ctx, level, null);
      return await this.viaGate(op, ctx, level, log);
    } catch (err) {
      return this.failure(err, ctx, op, level);
    }
  }

  private async viaGate(op: CrmOperation, ctx: SubmitContext, level: AutonomyLevel, log: Logger): Promise<WriteOutcome> {
    const payload = this.approvalPayload(op, ctx);
    const action: OutboundAction = {
      kind: "crm_update",
      idempotencyKey: `${APPROVAL_IDEMPOTENCY_PREFIX}${ctx.idempotencyKey}`,
      summary: describeOperation(op).slice(0, 480),
      payload,
      requestedBy: ctx.actor ?? `agent:crm:${ctx.task}`,
    };
    const gate = typeof this.deps.gate === "function" ? this.deps.gate(ctx.ttlMinutes ? { ttlMinutes: ctx.ttlMinutes } : {}) : this.deps.gate;
    const decision = await gate.request(action);
    switch (decision.status) {
      case "approved":
        return this.execute(op, ctx, level, { approvalId: decision.approvalId, approver: decision.decidedBy });
      case "pending":
        await log("approval_requested", ["awaiting_broker"], { approvalId: decision.approvalId ?? null, extra: { payloadSha256: payloadHash(payload) } });
        return { status: "pending_approval", approvalId: decision.approvalId ?? null };
      case "rejected":
        // The queue hands an approved action out once; a later request for the same change is not a rejection.
        if (decision.reason === "already_executed") {
          await log("skipped", ["already_executed"], { approvalId: decision.approvalId });
          return { status: "skipped", reason: "already_executed" };
        }
        await log("approval_rejected", ["broker_rejected"], { approvalId: decision.approvalId });
        return { status: "rejected", approvalId: decision.approvalId };
      case "expired":
        await log("approval_expired", ["approval_timed_out"], { approvalId: decision.approvalId });
        return { status: "expired", approvalId: decision.approvalId };
    }
  }

  private approvalPayload(op: CrmOperation, ctx: SubmitContext): CrmApprovalPayload {
    return { agent: "crm", v: 1, task: ctx.task, operation: op, reasonCodes: (ctx.reasonCodes ?? []).slice(0, 20), dealId: ctx.dealId ?? null, leadId: ctx.leadId ?? null };
  }

  // --- approved later -----------------------------------------------------------------------------

  /** Runs the change behind a broker-approved approval row (never for any other status). */
  async executeApproval(record: DecidedApproval): Promise<WriteOutcome> {
    const parsed = approvalPayloadSchema.safeParse(record.payload);
    if (!parsed.success) return { status: "blocked", reason: "invalid_approval_payload" };
    const { task, operation: op } = parsed.data;
    const ctx: SubmitContext = {
      task,
      idempotencyKey: record.idempotencyKey.startsWith(APPROVAL_IDEMPOTENCY_PREFIX) ? record.idempotencyKey.slice(APPROVAL_IDEMPOTENCY_PREFIX.length) : record.idempotencyKey,
      reasonCodes: parsed.data.reasonCodes,
      dealId: parsed.data.dealId,
      leadId: parsed.data.leadId,
    };
    const level = this.levelFor(task);
    if (record.status !== "approved") return this.refuse(ctx, level, op.type, "approval_not_approved", {}, op);
    if (!taskMayRun(task, op.type)) return this.refuse(ctx, level, op.type, "operation_outside_task_scope", {}, op);
    try {
      if (level === "audit") {
        await this.logger(ctx, op, level)("audit_only", ["audit_autonomy"], { approvalId: record.id });
        return { status: "logged_only" };
      }
      return await this.execute(op, ctx, level, { approvalId: record.id, approver: record.decidedByLabel ?? "broker" });
    } catch (err) {
      return this.failure(err, ctx, op, level);
    }
  }

  // --- the write ------------------------------------------------------------------------------------

  private async execute(op: CrmOperation, ctx: SubmitContext, level: AutonomyLevel, approval: { approvalId: string; approver: string } | null): Promise<WriteOutcome> {
    const log = this.logger(ctx, op, level);
    const extra = approval ? { approvalId: approval.approvalId, approver: approval.approver } : {};
    const { result, replayed } = await idempotentEffect<Executed>(
      this.deps.effects,
      `crm-write:${ctx.idempotencyKey}`,
      { workflow: "agent-crm" },
      async () => {
        // Re-check right before writing: an approval can be hours old.
        const skip = await this.evaluate(op, ctx);
        if (skip) return { skipped: skip };
        await log("write_started", ctx.reasonCodes ?? [], extra);
        return this.perform(op, ctx);
      },
      { now: this.now },
    );
    // The write is done; a log failure now must not turn it into a "blocked" answer.
    const logAfter = async (...args: Parameters<Logger>) => {
      try {
        await log(...args);
      } catch (err) {
        console.error(`[crm-agent] ${op.type} outcome could not be logged: ${err instanceof Error ? err.message : err}`);
      }
    };
    if ("skipped" in result) {
      if (!replayed) await logAfter("skipped", [result.skipped], extra);
      return { status: "skipped", reason: result.skipped };
    }
    if (!replayed) await logAfter("executed", ctx.reasonCodes ?? [], { ...extra, externalRef: result.ref, extra: result.detail });
    return { status: "executed", ref: result.ref, approvalId: approval?.approvalId ?? null, replayed };
  }

  /** A skip reason, or null when the change should go ahead. Reads only. */
  private async evaluate(op: CrmOperation, ctx: SubmitContext): Promise<string | null> {
    const reader = clientForTask(this.deps.client, ctx.task);
    switch (op.type) {
      case "stage_update": {
        const opp = await reader.getOpportunity(op.opportunityId);
        if (!opp) return "opportunity_not_found";
        if (opp.stage === op.toStage) return "already_in_stage";
        if (op.fromStage !== null && opp.stage !== op.fromStage) return "stale_crm_stage";
        if (isTerminalTwentyStage(opp.stage) && !isTerminalTwentyStage(op.toStage)) return "crm_terminal_stage";
        if (op.dealId && op.dealStage && this.deps.dealStage) {
          const current = await this.deps.dealStage(op.dealId);
          if (current && current !== op.dealStage) return "superseded";
        }
        return null;
      }
      case "owner_assign": {
        const opp = await reader.getOpportunity(op.opportunityId);
        if (!opp) return "opportunity_not_found";
        return opp.ownerId === op.memberId ? "already_assigned" : null;
      }
      case "company_merge": {
        const [survivor, dup] = await Promise.all([reader.getCompany(op.survivorId), reader.getCompany(op.duplicateId)]);
        if (!survivor || survivor.deleted) return "survivor_not_found";
        if (!dup || dup.deleted) return "duplicate_already_gone";
        return null;
      }
      case "note_create":
      case "task_create":
        return null;
    }
  }

  private async perform(op: CrmOperation, ctx: SubmitContext): Promise<Executed> {
    const crm = clientForTask(this.deps.client, ctx.task);
    switch (op.type) {
      case "stage_update":
        await this.retry(() => crm.updateOpportunityStage(op.opportunityId, op.toStage));
        return { ref: op.opportunityId, detail: { from: op.fromStage, to: op.toStage } };
      case "owner_assign":
        await this.retry(() => crm.assignOpportunityOwner(op.opportunityId, op.memberId));
        return { ref: op.opportunityId, detail: { assigned: op.memberId !== null } };
      case "note_create": {
        const title = cleanLine(op.title, 200) || "Note";
        const markdown = cleanMarkdown(op.markdown, 20_000);
        const { noteId, targetIds } = await this.retry(() => crm.createNote({ title, markdown, targets: op.targets }));
        return { ref: noteId, detail: { targets: targetIds.length, bodyChars: markdown.length, bodySha256: sha(markdown), source: op.source } };
      }
      case "task_create": {
        const title = cleanLine(op.title, 200) || "Task";
        const markdown = cleanMarkdown(op.markdown, 4_000);
        const { taskId, targetIds } = await this.retry(() => crm.createTask({ title, markdown, dueAt: op.dueAt, assigneeId: op.assigneeId, targets: op.targets }));
        return { ref: taskId, detail: { targets: targetIds.length, assigned: op.assigneeId !== null, dueAt: op.dueAt, source: op.source } };
      }
      case "company_merge":
        return this.mergeCompanies(op, crm);
    }
  }

  /**
   * Re-points everything that references the duplicate, then soft-deletes it
   * only once nothing references it. Each step is idempotent and re-reads the
   * duplicate's relations, so an interrupted merge resumes where it stopped.
   */
  private async mergeCompanies(op: CompanyMergeOp, crm: CrmClient): Promise<Executed> {
    const moved = { people: 0, opportunities: 0, noteTargets: 0, taskTargets: 0 };
    const rel = await this.retry(() => crm.companyRelations(op.duplicateId));
    for (const id of rel.peopleIds) {
      await this.retry(() => crm.setPersonCompany(id, op.survivorId));
      moved.people += 1;
    }
    for (const id of rel.opportunityIds) {
      await this.retry(() => crm.setOpportunityCompany(id, op.survivorId));
      moved.opportunities += 1;
    }
    for (const id of rel.noteTargetIds) {
      await this.retry(() => crm.setNoteTargetCompany(id, op.survivorId));
      moved.noteTargets += 1;
    }
    for (const id of rel.taskTargetIds) {
      await this.retry(() => crm.setTaskTargetCompany(id, op.survivorId));
      moved.taskTargets += 1;
    }
    const left = await this.retry(() => crm.companyRelations(op.duplicateId));
    const remaining = left.peopleIds.length + left.opportunityIds.length + left.noteTargetIds.length + left.taskTargetIds.length;
    if (remaining > 0) throw new CrmError(`company ${op.duplicateId} still has ${remaining} linked records after re-pointing; not deleting it`);
    await this.retry(() => crm.softDeleteCompany(op.duplicateId));
    return { ref: op.survivorId, detail: { duplicateId: op.duplicateId, moved } };
  }

  /** Retries only errors where the CRM refused the request outright (429/503); a timeout may have created the record. */
  private async retry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (!(err instanceof CrmError) || !err.retryable || attempt >= MAX_ATTEMPTS) throw err;
        await this.sleep(250 * 2 ** (attempt - 1));
      }
    }
  }

  // --- logging --------------------------------------------------------------------------------------

  private logger(ctx: SubmitContext, op: CrmOperation, level: AutonomyLevel): Logger {
    const target = targetOf(op);
    return async (phase, reasonCodes, more = {}) => {
      const event: AgentEventInput = {
        agent: "crm",
        task: ctx.task,
        action: op.type,
        phase,
        autonomy: level,
        actor: ctx.actor ?? `agent:crm:${ctx.task}`,
        dealId: ctx.dealId ?? null,
        leadId: ctx.leadId ?? null,
        targetObject: target.object,
        targetId: target.id,
        approvalId: more.approvalId ?? null,
        approver: more.approver ?? null,
        idempotencyKey: ctx.idempotencyKey,
        externalRef: more.externalRef ?? null,
        reasonCodes,
        model: ctx.model ?? null,
        promptVersion: ctx.promptVersion ?? null,
        detail: { ...summaryOf(op), ...(ctx.detail ?? {}), ...(more.extra ?? {}) },
      };
      try {
        await this.deps.events.record(event);
      } catch (err) {
        throw new EventLogUnavailable(err);
      }
    };
  }

  /** Logs a refusal; the refusal stands even if the log is down. */
  private async refuse(ctx: SubmitContext, level: AutonomyLevel, action: string, reason: string, detail: Record<string, unknown> = {}, op?: CrmOperation): Promise<WriteOutcome> {
    try {
      const target = op ? targetOf(op) : null;
      await this.deps.events.record({
        agent: "crm",
        task: ctx.task,
        action,
        phase: "blocked",
        autonomy: level,
        actor: ctx.actor ?? `agent:crm:${ctx.task}`,
        dealId: ctx.dealId ?? null,
        leadId: ctx.leadId ?? null,
        targetObject: target?.object ?? null,
        targetId: target?.id ?? null,
        idempotencyKey: ctx.idempotencyKey,
        reasonCodes: [reason],
        detail,
      });
    } catch (err) {
      console.error("[crm-agent] could not log a refused change:", err instanceof Error ? err.message : err);
    }
    return { status: "blocked", reason };
  }

  private async failure(err: unknown, ctx: SubmitContext, op: CrmOperation, level: AutonomyLevel): Promise<WriteOutcome> {
    if (err instanceof EventLogUnavailable) {
      console.error(`[crm-agent] ${err.message}; ${op.type} not written.`);
      return { status: "blocked", reason: "event_log_unavailable" };
    }
    if (err instanceof EffectInProgressError) return { status: "skipped", reason: "write_in_progress" };
    const reason = err instanceof EffectOutcomeUnknownError ? "outcome_unknown" : err instanceof CrmError ? `crm_error_${err.status ?? "network"}` : "unexpected_error";
    const message = err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
    try {
      await this.logger(ctx, op, level)("failed", [reason], { extra: { error: message } });
    } catch {
      console.error(`[crm-agent] ${op.type} failed (${reason}) and could not be logged: ${message}`);
    }
    return { status: "failed", error: message };
  }
}

type Logger = (phase: AgentEventPhase, reasonCodes: string[], more?: { approvalId?: string | null; approver?: string | null; externalRef?: string | null; extra?: Record<string, unknown> }) => Promise<void>;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** What the log keeps of an operation: ids, stages and sizes, never note text. */
function summaryOf(op: CrmOperation): Record<string, unknown> {
  switch (op.type) {
    case "stage_update":
      return { from: op.fromStage, to: op.toStage, dealStage: op.dealStage };
    case "owner_assign":
      return { memberId: op.memberId };
    case "note_create":
      return { title: op.title.slice(0, 120), targets: op.targets, source: op.source };
    case "task_create":
      return { title: op.title.slice(0, 120), targets: op.targets, source: op.source, dueAt: op.dueAt };
    case "company_merge":
      return { survivorId: op.survivorId, duplicateId: op.duplicateId, score: op.score, reasons: op.reasons };
  }
}
