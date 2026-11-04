// Approval queue API: request, approve, reject, cancel, expire, execute once.
// Authorization (who may approve) is decided by lib/auth/policy.ts before
// these are called; this layer enforces the lifecycle and idempotency.

import { z } from "zod";
import { reauthSatisfied, requiresReauthentication, type ReauthCheck, type ReauthStore } from "@/lib/agents/core/reauth";
import { DRE_LICENSE_PATTERN } from "@/lib/site";
import { payloadHash } from "./hash";
import type { ApprovalStore } from "./store";
import { KIND_PATTERN, type ApprovalListFilter, type ApprovalRecord, type Approver } from "./types";

type Clock = () => Date;

export const DEFAULT_TTL_MINUTES = 24 * 60;
export const MAX_TTL_MINUTES = 30 * 24 * 60;

export const approvalRequestSchema = z.object({
  kind: z.string().regex(KIND_PATTERN),
  idempotencyKey: z.string().min(8).max(300),
  summary: z.string().trim().min(1).max(500),
  templateId: z.string().min(1).max(120).optional(),
  /** Hash of the template body actually rendered; must match the pre-approved body for auto-approval. */
  templateBodySha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  payload: z.record(z.string(), z.unknown()),
  requestedBy: z.string().trim().min(1).max(200),
  requestedByUser: z.uuid().optional(),
  dealId: z.uuid().optional(),
  leadId: z.uuid().optional(),
  ttlMinutes: z.number().int().min(1).max(MAX_TTL_MINUTES).optional(),
});
export type ApprovalRequest = z.input<typeof approvalRequestSchema>;

export class ApprovalConflictError extends Error {
  constructor(readonly idempotencyKey: string) {
    super(`Idempotency key ${idempotencyKey} was already used for a different payload`);
    this.name = "ApprovalConflictError";
  }
}

export class ApprovalNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`Approval ${id} not found`);
    this.name = "ApprovalNotFoundError";
  }
}

export type DecisionResult =
  | { ok: true; record: ApprovalRecord }
  | { ok: false; reason: "expired" | "already_decided" | "invalid_approver" | "reason_required" | "reauth_required"; record: ApprovalRecord };

export type ExecuteResult =
  | { status: "executed"; record: ApprovalRecord; executionRef?: string }
  | { status: "not_approved"; record: ApprovalRecord }
  | { status: "already_executed"; record: ApprovalRecord };

export type ApprovalHooks = {
  /**
   * Called after approvals leave `pending` (approved, rejected, cancelled or
   * expired) so waiting workflows can wake. Failures are logged, never thrown.
   */
  onDecided?: (records: ApprovalRecord[]) => Promise<void>;
};

export class ApprovalService {
  /**
   * `reauth` holds the step-up proofs (approval_reauthentications). Sensitive
   * approvals (MLDS, Form 159, lender submissions, fee quotes; see
   * requiresReauthentication) can only be approved, and only execute, with a
   * fresh proof by the approving broker. Without a store they fail closed.
   */
  constructor(
    private readonly store: ApprovalStore,
    private readonly now: Clock = () => new Date(),
    private readonly hooks: ApprovalHooks = {},
    private readonly reauth: Pick<ReauthStore, "forApproval"> | null = null,
  ) {}

  /**
   * Whether an approved record may execute: records that need step-up
   * re-authentication need a matching proof (reauthSatisfied); every other
   * approved record passes.
   */
  async reauthCheck(record: ApprovalRecord): Promise<ReauthCheck | { ok: true; proof: null }> {
    if (!requiresReauthentication(record)) return { ok: true, proof: null };
    if (!this.reauth) return { ok: false, reason: "no_proof" };
    return reauthSatisfied(record, await this.reauth.forApproval(record.id));
  }

  private async notify(records: ApprovalRecord[]): Promise<void> {
    if (!records.length || !this.hooks.onDecided) return;
    try {
      await this.hooks.onDecided(records);
    } catch (err) {
      console.warn("[approvals] decision hook failed", err instanceof Error ? err.message : err);
    }
  }

  /**
   * Requests approval for an outbound action (or returns the existing request
   * with the same idempotency key). A request naming an active pre-approved
   * template of the same kind, with a matching body hash, is approved
   * automatically; everything else waits for a broker.
   */
  async request(input: ApprovalRequest): Promise<{ record: ApprovalRecord; created: boolean }> {
    const req = approvalRequestSchema.parse(input);
    const now = this.now();
    const hash = payloadHash(req.payload);

    const existing = await this.store.getByKey(req.idempotencyKey);
    if (existing) {
      if (existing.payloadSha256 !== hash || existing.kind !== req.kind) throw new ApprovalConflictError(req.idempotencyKey);
      return { record: await this.settle(existing), created: false };
    }

    const template = req.templateId ? await this.store.activeTemplate(req.templateId) : null;
    // A sensitive send needs a person who re-authenticated: never auto-approved.
    const sensitive = requiresReauthentication({ kind: req.kind, payload: req.payload, templateId: req.templateId ?? null });
    const auto = !sensitive && Boolean(template && template.kind === req.kind && req.templateBodySha256 && template.bodySha256 === req.templateBodySha256);
    const expiresAt = new Date(now.getTime() + (req.ttlMinutes ?? DEFAULT_TTL_MINUTES) * 60_000);

    const { record, created } = await this.store.insertIfAbsent(
      {
        kind: req.kind,
        idempotencyKey: req.idempotencyKey,
        summary: req.summary,
        templateId: req.templateId ?? null,
        payload: req.payload,
        payloadSha256: hash,
        requestedBy: req.requestedBy,
        requestedByUser: req.requestedByUser ?? null,
        dealId: req.dealId ?? null,
        leadId: req.leadId ?? null,
        status: auto ? "approved" : "pending",
        expiresAt: expiresAt.toISOString(),
        decidedAt: auto ? now.toISOString() : null,
        decidedBy: null,
        decidedByLabel: auto && template ? `Pre-approved template ${template.templateId}` : null,
        decidedByDre: auto && template ? template.approvedByDre : null,
        decisionReason: null,
        autoApproved: auto,
      },
      now,
    );
    // Lost a race with an identical request: same row, same answer.
    if (!created && (record.payloadSha256 !== hash || record.kind !== req.kind)) throw new ApprovalConflictError(req.idempotencyKey);
    return { record: created ? record : await this.settle(record), created };
  }

  async get(id: string): Promise<ApprovalRecord | null> {
    const r = await this.store.get(id);
    return r ? this.settle(r) : null;
  }

  async getByKey(idempotencyKey: string): Promise<ApprovalRecord | null> {
    const r = await this.store.getByKey(idempotencyKey);
    return r ? this.settle(r) : null;
  }

  async list(filter?: ApprovalListFilter): Promise<ApprovalRecord[]> {
    await this.expireDue();
    return this.store.list(filter);
  }

  async approve(id: string, approver: Approver): Promise<DecisionResult> {
    const record = await this.require(id);
    if (!approver.userId || !approver.dreLicense || !DRE_LICENSE_PATTERN.test(approver.dreLicense)) {
      return { ok: false, reason: "invalid_approver", record };
    }
    if (requiresReauthentication(record)) {
      // The broker must have recorded a fresh second factor for this exact
      // approval and payload (ReauthService.record) before approving it.
      const asDecided: ApprovalRecord = { ...record, status: "approved", autoApproved: false, decidedBy: approver.userId, decidedAt: this.now().toISOString() };
      const check = await this.reauthCheck(asDecided);
      if (!check.ok) return { ok: false, reason: "reauth_required", record };
    }
    return this.decide(record, { status: "approved", decidedBy: approver.userId, decidedByLabel: approver.label, decidedByDre: approver.dreLicense, decisionReason: null });
  }

  async reject(id: string, approver: Approver, reason: string): Promise<DecisionResult> {
    const record = await this.require(id);
    const why = reason.trim().slice(0, 1000);
    if (!why) return { ok: false, reason: "reason_required", record };
    return this.decide(record, { status: "rejected", decidedBy: approver.userId, decidedByLabel: approver.label, decidedByDre: approver.dreLicense, decisionReason: why });
  }

  async cancel(id: string, approver: Approver, reason?: string): Promise<DecisionResult> {
    const record = await this.require(id);
    return this.decide(record, {
      status: "cancelled",
      decidedBy: approver.userId,
      decidedByLabel: approver.label,
      decidedByDre: approver.dreLicense,
      decisionReason: reason?.trim().slice(0, 1000) || null,
    });
  }

  /** Moves every pending approval past its expiry to `expired`. Safe to run any time. */
  async expireDue(): Promise<ApprovalRecord[]> {
    const expired = await this.store.expireDue(this.now());
    await this.notify(expired);
    return expired;
  }

  /**
   * Runs `send` at most once, and only for an approved, unexpired-at-decision,
   * never-executed approval. The execution is claimed before `send` runs, so a
   * crash mid-send never causes a second send; a failed send needs a new
   * request (new idempotency key) and a new approval.
   */
  async executeOnce(id: string, send: (record: ApprovalRecord) => Promise<string | void>): Promise<ExecuteResult> {
    const record = await this.require(id);
    if (record.status !== "approved") return { status: "not_approved", record };
    if (record.executedAt) return { status: "already_executed", record };
    if (!(await this.reauthCheck(record)).ok) return { status: "not_approved", record };
    const claimed = await this.store.claimExecution(id, this.now());
    if (!claimed) {
      const latest = await this.require(id);
      return latest.executedAt ? { status: "already_executed", record: latest } : { status: "not_approved", record: latest };
    }
    const ref = await send(claimed);
    if (ref) {
      await this.store.setExecutionRef(id, ref.slice(0, 300));
      return { status: "executed", record: { ...claimed, executionRef: ref.slice(0, 300) }, executionRef: ref.slice(0, 300) };
    }
    return { status: "executed", record: claimed };
  }

  /** Claims the execution without running anything (for callers that send themselves). */
  async claimExecution(id: string): Promise<ApprovalRecord | null> {
    const record = await this.require(id);
    if (record.status !== "approved" || record.executedAt) return null;
    if (!(await this.reauthCheck(record)).ok) return null;
    return this.store.claimExecution(id, this.now());
  }

  private async decide(record: ApprovalRecord, decision: Parameters<ApprovalStore["decide"]>[1]): Promise<DecisionResult> {
    const settled = await this.settle(record);
    if (settled.status === "expired") return { ok: false, reason: "expired", record: settled };
    if (settled.status !== "pending") return { ok: false, reason: "already_decided", record: settled };
    const decided = await this.store.decide(record.id, decision, this.now());
    if (decided) {
      await this.notify([decided]);
      return { ok: true, record: decided };
    }
    const latest = await this.settle(await this.require(record.id));
    return { ok: false, reason: latest.status === "expired" ? "expired" : "already_decided", record: latest };
  }

  /** Applies lazy expiry: a pending row past its deadline is expired before anyone sees it. */
  private async settle(r: ApprovalRecord): Promise<ApprovalRecord> {
    if (r.status === "pending" && Date.parse(r.expiresAt) <= this.now().getTime()) {
      const expired = await this.store.expireDue(this.now());
      await this.notify(expired);
      return expired.find((e) => e.id === r.id) ?? (await this.store.get(r.id)) ?? r;
    }
    return r;
  }

  private async require(id: string): Promise<ApprovalRecord> {
    const r = await this.store.get(id);
    if (!r) throw new ApprovalNotFoundError(id);
    return r;
  }
}
