// Persistence contract for the approval queue plus the in-memory store used
// by tests and fake-auth mode. Every write is conditional ("only from
// pending", "only if not executed") so concurrent deciders and executors
// cannot double-decide or double-send; the database enforces the same rules
// with the approvals_guard trigger.

import { randomUUID } from "node:crypto";
import type { ApprovalListFilter, ApprovalRecord, ApprovalStatus, ApprovalTemplate } from "./types";

export type NewApproval = Omit<ApprovalRecord, "id" | "createdAt" | "executedAt" | "executionRef">;

export type Decision = {
  status: Extract<ApprovalStatus, "approved" | "rejected" | "cancelled">;
  decidedBy: string;
  decidedByLabel: string;
  decidedByDre: string | null;
  decisionReason: string | null;
};

export interface ApprovalStore {
  /** Inserts unless the idempotency key exists; returns the stored row either way. */
  insertIfAbsent(row: NewApproval, now: Date): Promise<{ record: ApprovalRecord; created: boolean }>;
  get(id: string): Promise<ApprovalRecord | null>;
  getByKey(idempotencyKey: string): Promise<ApprovalRecord | null>;
  list(filter?: ApprovalListFilter): Promise<ApprovalRecord[]>;
  /** pending → decision. Approvals also require `now < expires_at`. Null when the row was not pending (or had expired). */
  decide(id: string, decision: Decision, now: Date): Promise<ApprovalRecord | null>;
  /** pending rows whose expiry passed → expired. */
  expireDue(now: Date): Promise<ApprovalRecord[]>;
  /** approved and never executed → executed_at = now. Null when it was not claimable. */
  claimExecution(id: string, now: Date, executionRef?: string): Promise<ApprovalRecord | null>;
  /** Attaches the external id (message id, envelope id) to an executed approval, once. */
  setExecutionRef(id: string, executionRef: string): Promise<void>;
  activeTemplate(templateId: string): Promise<ApprovalTemplate | null>;
}

const byCreatedDesc = (a: ApprovalRecord, b: ApprovalRecord) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);

export function matchesFilter(r: ApprovalRecord, filter: ApprovalListFilter = {}): boolean {
  if (filter.status) {
    const wanted = Array.isArray(filter.status) ? filter.status : [filter.status];
    if (!wanted.includes(r.status)) return false;
  }
  if (filter.dealId && r.dealId !== filter.dealId) return false;
  return true;
}

export class MemoryApprovalStore implements ApprovalStore {
  private readonly rows = new Map<string, ApprovalRecord>();
  private readonly templates = new Map<string, ApprovalTemplate>();

  addTemplate(t: ApprovalTemplate): void {
    this.templates.set(t.templateId, t);
  }

  all(): ApprovalRecord[] {
    return [...this.rows.values()].map((r) => ({ ...r }));
  }

  async insertIfAbsent(row: NewApproval, now: Date) {
    for (const r of this.rows.values()) if (r.idempotencyKey === row.idempotencyKey) return { record: { ...r }, created: false };
    if (Date.parse(row.expiresAt) <= now.getTime()) throw new Error("expires_at must be after created_at");
    const record: ApprovalRecord = { ...row, id: randomUUID(), createdAt: now.toISOString(), executedAt: null, executionRef: null };
    this.rows.set(record.id, record);
    return { record: { ...record }, created: true };
  }

  async get(id: string) {
    const r = this.rows.get(id);
    return r ? { ...r } : null;
  }

  async getByKey(key: string) {
    for (const r of this.rows.values()) if (r.idempotencyKey === key) return { ...r };
    return null;
  }

  async list(filter: ApprovalListFilter = {}) {
    return [...this.rows.values()]
      .filter((r) => matchesFilter(r, filter))
      .sort(byCreatedDesc)
      .slice(0, filter.limit ?? 200)
      .map((r) => ({ ...r }));
  }

  async decide(id: string, d: Decision, now: Date) {
    const r = this.rows.get(id);
    if (!r || r.status !== "pending") return null;
    if (d.status === "approved" && now.getTime() >= Date.parse(r.expiresAt)) return null;
    Object.assign(r, {
      status: d.status,
      decidedAt: now.toISOString(),
      decidedBy: d.decidedBy,
      decidedByLabel: d.decidedByLabel,
      decidedByDre: d.decidedByDre,
      decisionReason: d.decisionReason,
    });
    return { ...r };
  }

  async expireDue(now: Date) {
    const out: ApprovalRecord[] = [];
    for (const r of this.rows.values()) {
      if (r.status === "pending" && Date.parse(r.expiresAt) <= now.getTime()) {
        Object.assign(r, { status: "expired", decidedAt: now.toISOString(), decidedByLabel: "system:expiry" });
        out.push({ ...r });
      }
    }
    return out;
  }

  async claimExecution(id: string, now: Date, executionRef?: string) {
    const r = this.rows.get(id);
    if (!r || r.status !== "approved" || r.executedAt) return null;
    r.executedAt = now.toISOString();
    if (executionRef) r.executionRef = executionRef;
    return { ...r };
  }

  async setExecutionRef(id: string, executionRef: string) {
    const r = this.rows.get(id);
    if (!r || !r.executedAt) throw new Error(`approval ${id} has no execution to reference`);
    if (r.executionRef && r.executionRef !== executionRef) throw new Error(`approval ${id} was already executed`);
    r.executionRef = executionRef;
  }

  async activeTemplate(templateId: string) {
    const t = this.templates.get(templateId);
    return t && !t.revokedAt ? { ...t } : null;
  }
}
