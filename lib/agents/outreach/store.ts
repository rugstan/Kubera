import { randomUUID } from "node:crypto";
import type { OutreachAudience, OutreachChannel, OutreachKind, OutreachMessageRow, OutreachStatus } from "./types";

// Persistence for the chasers' message log (public.outreach_messages). The
// Supabase implementation is in ./supabase-store.ts; MemoryOutreachStore backs
// tests and the no-database fallback. Voice calls and AI-voice consents have
// their own store in ./voice/store.ts.

export type NewOutreachMessage = {
  kind: OutreachKind;
  channel: OutreachChannel;
  templateId: string;
  templateVersion: number;
  audience: OutreachAudience;
  recipient: string;
  idempotencyKey: string;
  leadId?: string | null;
  dealId?: string | null;
  subjectKey?: string | null;
  sequence?: number;
  metadata?: Record<string, unknown>;
};

export type OutreachMessagePatch = Partial<
  Pick<OutreachMessageRow, "status" | "reasonCode" | "approvalId" | "consentEventId" | "provider" | "providerMessageId" | "error" | "sentAt" | "metadata">
> & { incrementAttempts?: boolean };

export type SubjectQuery = {
  kind: OutreachKind;
  dealId?: string | null;
  leadId?: string | null;
  /** Exact subject key. */
  subjectKey?: string | null;
};

export interface OutreachStore {
  /** Inserts the message, or returns the existing row for the same idempotency key. */
  claim(input: NewOutreachMessage): Promise<{ row: OutreachMessageRow; fresh: boolean }>;
  update(id: string, patch: OutreachMessagePatch): Promise<OutreachMessageRow>;
  /**
   * Atomically moves a retryable row back to `queued` so exactly one concurrent
   * caller attempts the send. Null when another caller won or the row moved on.
   */
  reopen(id: string, expected: readonly OutreachStatus[]): Promise<OutreachMessageRow | null>;
  findByKey(idempotencyKey: string): Promise<OutreachMessageRow | null>;
  /** Messages of one series (deal and/or lead, kind, subject), oldest first. */
  listSeries(query: SubjectQuery): Promise<OutreachMessageRow[]>;
  /** Rows still waiting on something a later run can resolve (approval, quiet hours). */
  listRetryable(kind: OutreachKind, since: Date, limit?: number): Promise<OutreachMessageRow[]>;
}

export class MemoryOutreachStore implements OutreachStore {
  readonly rows: OutreachMessageRow[] = [];
  constructor(private readonly clock: () => Date = () => new Date()) {}

  async claim(input: NewOutreachMessage) {
    const existing = this.rows.find((r) => r.idempotencyKey === input.idempotencyKey);
    if (existing) return { row: existing, fresh: false };
    const at = this.clock().toISOString();
    const row: OutreachMessageRow = {
      id: randomUUID(),
      createdAt: at,
      updatedAt: at,
      kind: input.kind,
      channel: input.channel,
      templateId: input.templateId,
      templateVersion: input.templateVersion,
      audience: input.audience,
      recipient: input.recipient,
      status: "queued",
      reasonCode: null,
      idempotencyKey: input.idempotencyKey,
      leadId: input.leadId ?? null,
      dealId: input.dealId ?? null,
      subjectKey: input.subjectKey ?? null,
      sequence: input.sequence ?? 1,
      approvalId: null,
      consentEventId: null,
      provider: null,
      providerMessageId: null,
      attempts: 0,
      error: null,
      metadata: input.metadata ?? {},
      sentAt: null,
    };
    this.rows.push(row);
    return { row, fresh: true };
  }

  async update(id: string, patch: OutreachMessagePatch) {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new Error(`outreach message ${id} not found`);
    const { incrementAttempts, ...fields } = patch;
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) (row as Record<string, unknown>)[k] = v;
    row.updatedAt = this.clock().toISOString();
    if (incrementAttempts) row.attempts += 1;
    return row;
  }

  async reopen(id: string, expected: readonly OutreachStatus[]) {
    const row = this.rows.find((r) => r.id === id);
    if (!row || !expected.includes(row.status)) return null;
    row.status = "queued";
    row.updatedAt = this.clock().toISOString();
    return row;
  }

  async findByKey(key: string) {
    return this.rows.find((r) => r.idempotencyKey === key) ?? null;
  }

  async listSeries(q: SubjectQuery) {
    return this.rows
      .filter((r) => r.kind === q.kind)
      .filter((r) => (q.dealId === undefined ? true : r.dealId === q.dealId))
      .filter((r) => (q.leadId === undefined ? true : r.leadId === q.leadId))
      .filter((r) => (q.subjectKey === undefined ? true : r.subjectKey === q.subjectKey))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.sequence - b.sequence);
  }

  async listRetryable(kind: OutreachKind, since: Date, limit = 100) {
    return this.rows
      .filter((r) => r.kind === kind && ["pending_approval", "deferred_quiet_hours"].includes(r.status) && r.createdAt >= since.toISOString())
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit);
  }
}
