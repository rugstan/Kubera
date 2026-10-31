// Safe tool execution for AI agents.
//
// Agents never call integrations directly. They call tools through
// ToolRunner.invoke, which applies, in order:
//
//   1. scope        the tool must be registered and in the run's scope
//   2. input        Zod-validated; custody/draw fields are refused outright
//   3. taint        a run that read flagged untrusted content loses tools that
//                   are unsafe under taint, and recipients must be trusted
//   4. autonomy     audit → logged as a proposal only; assist → broker approval;
//                   automate → pre-approved templates may auto-approve
//   5. approval     side-effecting tools go through the approvals queue with an
//                   idempotency key: one logical action, one approval, at most
//                   one send. Expired or rejected approvals never send.
//   6. re-auth      MLDS, Form 159, lender submissions and fee quotes need a
//                   step-up proof by the approving broker
//   7. execute once ApprovalService.executeOnce claims the execution before the
//                   integration runs, using the payload the broker approved
//
// Every step writes an agent_events row (model, prompt and tool versions,
// approver, external message ids, reason codes). The pre-send audit row is
// written before anything leaves: if it cannot be written, nothing is sent.

import { z } from "zod";
import { ApprovalConflictError, type ApprovalService } from "@/lib/approvals/service";
import { KIND_PATTERN, type ApprovalRecord } from "@/lib/approvals/types";
import { forbiddenTokenIn } from "@/lib/compliance/no-custody";
import { atLeast, minLevel, type AutonomyLevel, type AutonomyPolicy } from "./autonomy";
import type { AgentEventInput, AgentEventOutcome, AgentEventStore } from "./events";
import { CLEAN, isFlagged, type TaintState } from "./injection";
import { requiresReauthentication, type ReauthService } from "./reauth";
import { TOOL_REASONS } from "./reasons";
import type { PromptRef } from "./registry";

export type ToolEffect = "read" | "write";

export type ToolRunResult = {
  /** Provider ids of what went out (message id, envelope id) or of what was read. */
  externalIds?: string[];
  /** Small JSON-safe result for the agent (never secrets). */
  output?: Record<string, unknown>;
} | void;

export type ToolExecution = {
  agent: string;
  task: string;
  dealId: string | null;
  leadId: string | null;
  /** Pass to providers that accept an idempotency key (Resend, Telnyx, Zoho Sign). */
  idempotencyKey: string | null;
  approvalId: string | null;
};

export type ToolSpec<I> = {
  name: string;
  version: string;
  description: string;
  effect: ToolEffect;
  input: z.ZodType<I>;
  /** Approval kind (write tools), e.g. "email", "sms", "crm_update", "lender_submission". */
  approvalKind?: string;
  /** One line the broker sees in the approvals queue. */
  summarize?: (input: I) => string;
  /** Stable key for the logical action, e.g. `${dealId}:doc-reminder:${itemId}:${date}`. */
  actionKey?: (input: I, ctx: AgentRunContext) => string;
  /** The pre-approved template this call renders, if any (used only at automate). */
  template?: (input: I) => { templateId: string; bodySha256: string } | null;
  /** Approving broker must re-authenticate (also implied by the approval kind or payload). */
  reauth?: boolean;
  /** May run after the agent read flagged untrusted content. Default: reads yes, writes no. */
  allowWhenFlagged?: boolean;
  /** Addresses or numbers this call contacts; checked against the run's trusted recipients. */
  recipients?: (input: I) => string[];
  /** Approval expiry (default 24 h). A timed-out approval expires and never sends. */
  ttlMinutes?: number;
  run: (input: I, exec: ToolExecution) => Promise<ToolRunResult>;
};

/** A registered tool with its types erased (inputs are re-validated on every use). */
export type Tool = {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly effect: ToolEffect;
  readonly approvalKind: string | null;
  readonly reauth: boolean;
  readonly allowWhenFlagged: boolean;
  readonly ttlMinutes: number | undefined;
  parse(raw: unknown): { ok: true; value: unknown } | { ok: false; issues: string[] };
  summarize(value: unknown): string;
  actionKey(value: unknown, ctx: AgentRunContext): string;
  template(value: unknown): { templateId: string; bodySha256: string } | null;
  recipients(value: unknown): string[];
  run(value: unknown, exec: ToolExecution): Promise<ToolRunResult>;
};

const TOOL_NAME = /^[a-z][a-z0-9_.]{1,62}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
/** Money movement verbs: no tool may move or hold funds (Global rule 1). */
const MONEY_MOVEMENT = /(wire|payout|pay_out|transfer_funds|remit|disburs|escrow_release|release_funds|draw_)/;

export class ToolDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolDefinitionError";
  }
}

export function defineTool<I>(spec: ToolSpec<I>): Tool {
  if (!TOOL_NAME.test(spec.name)) throw new ToolDefinitionError(`tool name "${spec.name}" is invalid`);
  if (!SEMVER.test(spec.version)) throw new ToolDefinitionError(`tool ${spec.name}: version must be x.y.z`);
  if (MONEY_MOVEMENT.test(spec.name) || forbiddenTokenIn(spec.name)) throw new ToolDefinitionError(`tool ${spec.name}: Kubera never moves or holds funds`);
  if (spec.effect === "write") {
    if (!spec.approvalKind || !KIND_PATTERN.test(spec.approvalKind)) throw new ToolDefinitionError(`write tool ${spec.name} needs a valid approvalKind`);
    if (MONEY_MOVEMENT.test(spec.approvalKind) || forbiddenTokenIn(spec.approvalKind)) throw new ToolDefinitionError(`tool ${spec.name}: approval kind "${spec.approvalKind}" moves funds`);
    if (!spec.actionKey) throw new ToolDefinitionError(`write tool ${spec.name} needs an actionKey (idempotency)`);
  }
  const value = (v: unknown) => v as I;
  return Object.freeze({
    name: spec.name,
    version: spec.version,
    description: spec.description,
    effect: spec.effect,
    approvalKind: spec.approvalKind ?? null,
    reauth: Boolean(spec.reauth),
    allowWhenFlagged: spec.allowWhenFlagged ?? spec.effect === "read",
    ttlMinutes: spec.ttlMinutes,
    parse(raw: unknown) {
      const r = spec.input.safeParse(raw);
      return r.success ? { ok: true as const, value: r.data } : { ok: false as const, issues: r.error.issues.slice(0, 10).map((i) => `${i.path.join(".") || "(root)"}: ${i.code}`) };
    },
    summarize: (v: unknown) => (spec.summarize ? spec.summarize(value(v)) : `${spec.description}`).slice(0, 500),
    actionKey: (v: unknown, ctx: AgentRunContext) => (spec.actionKey ? spec.actionKey(value(v), ctx) : ""),
    template: (v: unknown) => spec.template?.(value(v)) ?? null,
    recipients: (v: unknown) => spec.recipients?.(value(v)) ?? [],
    run: (v: unknown, exec: ToolExecution) => spec.run(value(v), exec),
  });
}

export type AgentRunContext = {
  agent: string;
  agentVersion: string;
  task: string;
  runId?: string | null;
  dealId?: string | null;
  leadId?: string | null;
  prompt?: PromptRef | null;
  model?: string | null;
  servedModel?: string | null;
  /** What untrusted content this run has read (lib/agents/core/injection.ts). */
  taint?: TaintState;
  /** Recipients known from trusted records (deal participants, staff, lender panel). */
  trustedRecipients?: readonly string[];
  /** Tool names this run may call. Defaults to every tool the runner holds. */
  scope?: readonly string[];
};

export type ToolCall = { tool: string; input: unknown };

export type ToolOutcome =
  | { status: "executed"; tool: string; approvalId: string | null; externalIds: string[]; output?: Record<string, unknown> }
  | { status: "already_executed"; tool: string; approvalId: string; executionRef: string | null }
  | { status: "pending_approval"; tool: string; approvalId: string; expiresAt: string }
  | { status: "proposed"; tool: string; reasons: string[] }
  | { status: "rejected"; tool: string; approvalId: string; reason: string | null }
  | { status: "expired"; tool: string; approvalId: string }
  | { status: "blocked"; tool: string; reasons: string[]; approvalId?: string }
  | { status: "failed"; tool: string; reasons: string[]; approvalId?: string; error: string };

/** The parts of the approval queue the runner uses. */
export type ApprovalPort = Pick<ApprovalService, "request" | "executeOnce">;

export type ToolRunnerDeps = {
  tools: readonly Tool[];
  events: AgentEventStore;
  /** Null when no queue is configured: write tools are then blocked (the gate is closed). */
  approvals: ApprovalPort | null;
  autonomy: Pick<AutonomyPolicy, "level" | "policy">;
  reauth: Pick<ReauthService, "check">;
  now?: () => Date;
};

/** A claimed send with no confirmation for this long is treated as interrupted (outcome unknown). */
export const SEND_IN_FLIGHT_MS = 15 * 60_000;

/** Deep-scans object keys for custody/draw identifiers. */
function custodyKeys(value: unknown, depth = 0): string[] {
  if (depth > 6 || !value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((v) => custodyKeys(v, depth + 1));
  const out: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (forbiddenTokenIn(k)) out.push(k);
    out.push(...custodyKeys(v, depth + 1));
  }
  return out;
}

export function normalizeRecipient(r: string): string {
  const s = r.trim().toLowerCase();
  if (s.includes("@")) return s.replace(/^mailto:/, "");
  const digits = s.replace(/[^\d]/g, "");
  return digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : s.startsWith("+") ? `+${digits}` : digits;
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

export class ToolRunner {
  private readonly byName: Map<string, Tool>;

  constructor(private readonly deps: ToolRunnerDeps) {
    this.byName = new Map();
    for (const t of deps.tools) {
      if (this.byName.has(t.name)) throw new ToolDefinitionError(`duplicate tool ${t.name}`);
      this.byName.set(t.name, t);
    }
  }

  tools(): Tool[] {
    return [...this.byName.values()];
  }

  /** Tools a run may see right now (what to offer the model): scope minus taint-unsafe tools. */
  effectiveScope(ctx: AgentRunContext): Tool[] {
    const flagged = isFlagged(ctx.taint ?? CLEAN);
    return this.tools().filter((t) => (!ctx.scope || ctx.scope.includes(t.name)) && (!flagged || t.allowWhenFlagged));
  }

  private base(ctx: AgentRunContext, tool: Tool | null, autonomy: AutonomyLevel | null): AgentEventInput {
    return {
      eventType: "tool.requested",
      agent: ctx.agent,
      agentVersion: ctx.agentVersion,
      task: ctx.task,
      autonomy,
      runId: ctx.runId ?? null,
      dealId: ctx.dealId ?? null,
      leadId: ctx.leadId ?? null,
      promptId: ctx.prompt?.id ?? null,
      promptVersion: ctx.prompt?.version ?? null,
      promptSha256: ctx.prompt?.sha256 ?? null,
      model: ctx.model ?? ctx.prompt?.model ?? null,
      servedModel: ctx.servedModel ?? null,
      toolName: tool?.name ?? null,
      toolVersion: tool?.version ?? null,
    };
  }

  /** Writes an event; returns false (and logs) when the store fails. */
  private async log(event: AgentEventInput): Promise<boolean> {
    try {
      await this.deps.events.append(event);
      return true;
    } catch (err) {
      console.error(`[agents] could not record ${event.eventType} for ${event.agent}:`, errText(err));
      return false;
    }
  }

  private async finish(
    base: AgentEventInput,
    eventType: string,
    outcome: AgentEventOutcome,
    reasons: string[],
    extra: Partial<AgentEventInput> = {},
  ): Promise<void> {
    await this.log({ ...base, ...extra, eventType, outcome, reasonCodes: [...(base.reasonCodes ?? []), ...reasons] });
  }

  /**
   * A second request for an action whose execution was already claimed. With an
   * execution reference it went out, and a recent claim without one is still in
   * flight: suppress the duplicate either way. An old claim without a reference
   * failed or died mid-send and whether it went out is unknown: it is never
   * retried on this approval (a broker re-requests it).
   */
  private async alreadyExecuted(withApproval: AgentEventInput, tool: Tool, record: ApprovalRecord): Promise<ToolOutcome> {
    const now = (this.deps.now ?? (() => new Date()))().getTime();
    const inFlight = !record.executionRef && record.executedAt !== null && now - Date.parse(record.executedAt) < SEND_IN_FLIGHT_MS;
    if (!record.executionRef && !inFlight) {
      await this.finish(withApproval, "tool.blocked", "blocked", [TOOL_REASONS.sendOutcomeUnknown]);
      return { status: "blocked", tool: tool.name, reasons: [TOOL_REASONS.sendOutcomeUnknown], approvalId: record.id };
    }
    await this.finish(withApproval, "tool.duplicate_suppressed", "already_executed", [TOOL_REASONS.duplicateSuppressed], {
      externalMessageIds: record.executionRef ? record.executionRef.split(",") : [],
      ...(inFlight ? { detail: { inFlight: true } } : {}),
    });
    return { status: "already_executed", tool: tool.name, approvalId: record.id, executionRef: record.executionRef };
  }

  async invoke(ctx: AgentRunContext, call: ToolCall): Promise<ToolOutcome> {
    const tool = this.byName.get(call.tool) ?? null;
    const taint = ctx.taint ?? CLEAN;
    const flagged = isFlagged(taint);
    const taintCodes = flagged ? taint.codes : [];

    if (!tool) {
      const base = { ...this.base(ctx, null, null), detail: { requestedTool: String(call.tool).slice(0, 80) } };
      await this.finish(base, "tool.blocked", "blocked", [TOOL_REASONS.unknownTool, ...taintCodes]);
      return { status: "blocked", tool: String(call.tool), reasons: [TOOL_REASONS.unknownTool] };
    }
    const blocked = async (reasons: string[], detail: Record<string, unknown> = {}, autonomy: AutonomyLevel | null = null): Promise<ToolOutcome> => {
      await this.finish({ ...this.base(ctx, tool, autonomy), detail }, "tool.blocked", "blocked", [...reasons, ...taintCodes]);
      return { status: "blocked", tool: tool.name, reasons };
    };

    // 1. Scope.
    if (ctx.scope && !ctx.scope.includes(tool.name)) return blocked([TOOL_REASONS.outOfScope]);

    // 2. Input. Custody fields are checked on the raw input: a schema that strips unknown
    // keys must not turn a request to move funds into an innocent-looking one.
    const custody = [...new Set(custodyKeys(call.input))];
    if (custody.length) return blocked([TOOL_REASONS.custodyForbidden], { fields: custody.slice(0, 10) });
    const parsed = tool.parse(call.input);
    if (!parsed.ok) return blocked([TOOL_REASONS.invalidInput], { issues: parsed.issues });

    // 3. Taint.
    if (flagged && !tool.allowWhenFlagged) return blocked([TOOL_REASONS.taintedScope], { sources: taint.sources.length });
    const recipients = tool.recipients(parsed.value).map(normalizeRecipient);
    if (recipients.length && (ctx.trustedRecipients || flagged)) {
      const trusted = new Set((ctx.trustedRecipients ?? []).map(normalizeRecipient));
      const unknown = recipients.filter((r) => !trusted.has(r));
      if (unknown.length) return blocked([TOOL_REASONS.recipientNotTrusted], { untrustedRecipients: unknown.length });
    }

    // Reads run directly (they change nothing outside Kubera).
    if (tool.effect === "read") {
      const base = this.base(ctx, tool, null);
      try {
        const res = await tool.run(parsed.value, { agent: ctx.agent, task: ctx.task, dealId: ctx.dealId ?? null, leadId: ctx.leadId ?? null, idempotencyKey: null, approvalId: null });
        await this.finish(base, "tool.executed", "executed", [TOOL_REASONS.readExecuted, ...taintCodes], { externalMessageIds: res?.externalIds ?? [] });
        return { status: "executed", tool: tool.name, approvalId: null, externalIds: res?.externalIds ?? [], ...(res?.output ? { output: res.output } : {}) };
      } catch (err) {
        await this.finish(base, "tool.failed", "failed", [TOOL_REASONS.sendFailed, ...taintCodes], { detail: { error: errText(err) } });
        return { status: "failed", tool: tool.name, reasons: [TOOL_REASONS.sendFailed], error: errText(err) };
      }
    }

    // 4. Autonomy.
    const policy = this.deps.autonomy.policy(ctx.task);
    const configured = await this.deps.autonomy.level(ctx.task);
    const sensitive = tool.reauth || Boolean(policy.reauth);
    let level = configured;
    const capReasons: string[] = [];
    if (sensitive && atLeast(level, "automate")) {
      level = "assist";
      capReasons.push(TOOL_REASONS.autonomyCapped);
    }
    if (flagged && atLeast(level, "automate")) {
      level = minLevel(level, "assist");
      capReasons.push(TOOL_REASONS.taintedNoAutomate);
    }
    const base: AgentEventInput = { ...this.base(ctx, tool, level), reasonCodes: [...capReasons, ...taintCodes] };

    const actionKey = tool.actionKey(parsed.value, ctx).trim();
    const idempotencyKey = `agent:${tool.name}:${actionKey}`;
    if (!actionKey || idempotencyKey.length > 300) return blocked([TOOL_REASONS.invalidInput], { issues: ["actionKey: must be 1–280 characters"] }, level);
    const summary = tool.summarize(parsed.value);
    // The payload is what the broker approves and what is sent; it must not depend on the
    // autonomy level, so a retry under a different level still maps to the same approval.
    const payload: Record<string, unknown> = { tool: tool.name, input: parsed.value };

    if (level === "audit") {
      await this.finish({ ...base, idempotencyKey, detail: { summary } }, "tool.proposed", "proposed", [TOOL_REASONS.autonomyAudit]);
      return { status: "proposed", tool: tool.name, reasons: [TOOL_REASONS.autonomyAudit, ...capReasons] };
    }
    if (!this.deps.approvals) return blocked([TOOL_REASONS.approvalUnavailable], {}, level);

    // 5. Approval (audit row first: no audit trail, no request and no send).
    if (!(await this.log({ ...base, eventType: "tool.requested", outcome: null, idempotencyKey, detail: { summary, kind: tool.approvalKind } }))) {
      return { status: "blocked", tool: tool.name, reasons: [TOOL_REASONS.auditUnavailable] };
    }
    const template = level === "automate" && !sensitive ? tool.template(parsed.value) : null;
    let record: ApprovalRecord;
    try {
      ({ record } = await this.deps.approvals.request({
        kind: tool.approvalKind!,
        idempotencyKey,
        summary,
        payload,
        requestedBy: `agent:${ctx.agent}@${ctx.agentVersion}`,
        ...(template ? { templateId: template.templateId, templateBodySha256: template.bodySha256 } : {}),
        ...(ctx.dealId ? { dealId: ctx.dealId } : {}),
        ...(ctx.leadId ? { leadId: ctx.leadId } : {}),
        ...(tool.ttlMinutes ? { ttlMinutes: tool.ttlMinutes } : {}),
      }));
    } catch (err) {
      if (err instanceof ApprovalConflictError) {
        await this.finish({ ...base, idempotencyKey }, "tool.blocked", "blocked", [TOOL_REASONS.approvalConflict]);
        return { status: "blocked", tool: tool.name, reasons: [TOOL_REASONS.approvalConflict] };
      }
      await this.finish({ ...base, idempotencyKey, detail: { error: errText(err) } }, "tool.failed", "failed", [TOOL_REASONS.approvalUnavailable]);
      return { status: "failed", tool: tool.name, reasons: [TOOL_REASONS.approvalUnavailable], error: errText(err) };
    }
    const withApproval: AgentEventInput = {
      ...base,
      idempotencyKey,
      approvalId: record.id,
      approverId: record.decidedBy,
      approverLabel: record.decidedByLabel,
      approverDre: record.decidedByDre,
      reasonCodes: [...(base.reasonCodes ?? []), ...(record.autoApproved ? [TOOL_REASONS.approvalAuto] : [])],
    };

    switch (record.status) {
      case "pending":
        await this.finish(withApproval, "approval.pending", "pending_approval", [TOOL_REASONS.approvalPending], { detail: { expiresAt: record.expiresAt } });
        return { status: "pending_approval", tool: tool.name, approvalId: record.id, expiresAt: record.expiresAt };
      case "expired":
        await this.finish(withApproval, "approval.expired", "expired", [TOOL_REASONS.approvalExpired]);
        return { status: "expired", tool: tool.name, approvalId: record.id };
      case "rejected":
      case "cancelled":
        await this.finish(withApproval, `approval.${record.status}`, "rejected", [record.status === "rejected" ? TOOL_REASONS.approvalRejected : TOOL_REASONS.approvalCancelled]);
        return { status: "rejected", tool: tool.name, approvalId: record.id, reason: record.decisionReason };
      case "approved":
        break;
    }

    if (record.executedAt) return this.alreadyExecuted(withApproval, tool, record);

    // 6. Re-authentication for sensitive actions.
    if (sensitive || requiresReauthentication(record)) {
      const check = await this.deps.reauth.check(record);
      if (!check.ok) {
        await this.finish(withApproval, "tool.blocked", "blocked", [TOOL_REASONS.reauthRequired], { detail: { reauth: check.reason } });
        return { status: "blocked", tool: tool.name, reasons: [TOOL_REASONS.reauthRequired], approvalId: record.id };
      }
      withApproval.reasonCodes = [...(withApproval.reasonCodes ?? []), TOOL_REASONS.reauthVerified];
    }

    // 7. Execute exactly once, with the payload the broker approved.
    let externalIds: string[] = [];
    let output: Record<string, unknown> | undefined;
    try {
      const result = await this.deps.approvals.executeOnce(record.id, async (claimed) => {
        if (claimed.payload.tool !== tool.name) throw new Error(`approval ${claimed.id} is for ${String(claimed.payload.tool)}, not ${tool.name}`);
        const approved = tool.parse(claimed.payload.input);
        if (!approved.ok) throw new Error(`approved payload no longer validates for ${tool.name}@${tool.version}`);
        const res = await tool.run(approved.value, {
          agent: ctx.agent,
          task: ctx.task,
          dealId: ctx.dealId ?? null,
          leadId: ctx.leadId ?? null,
          idempotencyKey,
          approvalId: claimed.id,
        });
        externalIds = (res?.externalIds ?? []).filter(Boolean).map((s) => s.slice(0, 300));
        output = res?.output;
        return (externalIds.join(",") || `sent:${claimed.id}`).slice(0, 300);
      });
      if (result.status === "already_executed") return this.alreadyExecuted(withApproval, tool, result.record);
      if (result.status === "not_approved") {
        await this.finish(withApproval, "tool.blocked", "blocked", [TOOL_REASONS.approvalPending]);
        return { status: "blocked", tool: tool.name, reasons: [TOOL_REASONS.approvalPending], approvalId: record.id };
      }
    } catch (err) {
      // The execution was claimed before the send, so it is never retried on this approval.
      await this.finish(withApproval, "tool.failed", "failed", [TOOL_REASONS.sendFailed], { detail: { error: errText(err), retry: "new_request_required" } });
      return { status: "failed", tool: tool.name, reasons: [TOOL_REASONS.sendFailed], approvalId: record.id, error: errText(err) };
    }
    await this.finish(withApproval, "tool.executed", "executed", [], { externalMessageIds: externalIds });
    return { status: "executed", tool: tool.name, approvalId: record.id, externalIds, ...(output ? { output } : {}) };
  }
}
