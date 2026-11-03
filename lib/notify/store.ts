import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Audience, Channel, NotificationStatus } from "./types";

// Persistence for the notification log (public.notifications) and the SMS
// ledger (public.sms_messages). The Supabase implementation is the real one;
// MemoryNotifyStore backs tests and the no-database fallback.

export type NotificationRow = {
  id: string;
  createdAt: string;
  channel: Channel;
  templateId: string;
  templateVersion: number;
  audience: Audience;
  recipient: string;
  subject: string | null;
  status: NotificationStatus;
  provider: "resend" | "cloudflare" | "telnyx" | "fake" | null;
  providerMessageId: string | null;
  idempotencyKey: string;
  leadId: string | null;
  dealId: string | null;
  approvalId: string | null;
  consentEventId: string | null;
  attempts: number;
  error: string | null;
  metadata: Record<string, unknown>;
  sentAt: string | null;
  deliveredAt: string | null;
};

export type NewNotification = {
  channel: Channel;
  templateId: string;
  templateVersion: number;
  audience: Audience;
  recipient: string;
  idempotencyKey: string;
  subject?: string | null;
  leadId?: string | null;
  dealId?: string | null;
  metadata?: Record<string, unknown>;
};

export type NotificationPatch = Partial<
  Pick<NotificationRow, "status" | "provider" | "providerMessageId" | "approvalId" | "consentEventId" | "error" | "sentAt" | "deliveredAt" | "subject" | "metadata">
> & { incrementAttempts?: boolean };

/** "undelivered": the carrier reported the text was not delivered (a delivery receipt); "failed": it never reached the provider. */
export type SmsStatus = "queued" | "sent" | "delivered" | "failed" | "undelivered" | "received";

export type SmsRow = {
  id: string;
  createdAt: string;
  direction: "inbound" | "outbound";
  fromNumber: string;
  toNumber: string;
  body: string;
  status: SmsStatus;
  providerMessageId: string | null;
  notificationId: string | null;
  leadId: string | null;
  keyword: "stop" | "help" | "start" | null;
  processedAt: string | null;
  deliveredAt: string | null;
  error: string | null;
};

export type NewSms = {
  direction: "inbound" | "outbound";
  fromNumber: string;
  toNumber: string;
  body: string;
  status: SmsStatus;
  providerMessageId?: string | null;
  notificationId?: string | null;
  leadId?: string | null;
  keyword?: SmsRow["keyword"];
};

export type SmsPatch = Partial<Pick<SmsRow, "status" | "keyword" | "processedAt" | "deliveredAt" | "error" | "leadId" | "providerMessageId">>;

/**
 * A provider delivery receipt. "undelivered" is the carrier's report that a text
 * it took was not delivered (Telnyx delivery_failed / sending_failed). It is
 * kept apart from "failed" (nothing reached the provider, so a retry is safe):
 * an undelivered text is never resent automatically, since every resend is a
 * new billed message to a number that just refused one.
 */
export type DeliveryStatus = "sent" | "delivered" | "undelivered";

export interface NotifyStore {
  /** Inserts the notification, or returns the existing row for the same idempotency key. */
  claim(input: NewNotification): Promise<{ row: NotificationRow; fresh: boolean }>;
  update(id: string, patch: NotificationPatch): Promise<NotificationRow>;
  /**
   * Atomically moves a retryable row (pending approval, deferred, skipped, failed) back to
   * `queued` so exactly one concurrent caller attempts the send. Returns null when another
   * caller got there first or the row is no longer in one of the expected statuses.
   */
  reopen(id: string, expected: readonly NotificationStatus[]): Promise<NotificationRow | null>;
  findByKey(idempotencyKey: string): Promise<NotificationRow | null>;
  /**
   * Rows that name a broker approval and are still waiting on it (pending_approval)
   * or were stopped after it (deferred_quiet_hours), created since `since`, oldest
   * first. Read by the notify sweep (lib/notify/approved.ts).
   */
  listHeldForApproval(opts: { since: Date; limit: number }): Promise<NotificationRow[]>;
  /** Inserts the text; for a provider message id already stored, returns the existing row. */
  recordSms(input: NewSms): Promise<{ row: SmsRow; fresh: boolean }>;
  updateSms(id: string, patch: SmsPatch): Promise<SmsRow>;
  /** Applies a provider delivery status to the notification and SMS rows with that provider message id. Never moves a row backwards. */
  applyDelivery(providerMessageId: string, status: DeliveryStatus, at: Date, error?: string | null): Promise<{ notifications: number; sms: number }>;
}

const RANK: Record<string, number> = { queued: 0, sent: 1, failed: 2, undelivered: 2, delivered: 3 };

/** Statuses listHeldForApproval returns. */
export const HELD_STATUSES = ["pending_approval", "deferred_quiet_hours"] as const satisfies readonly NotificationStatus[];

/** A delivery status may only advance a row that has been sent (a late "sent" must not undo "delivered"). */
export function canAdvance(current: string, next: DeliveryStatus): boolean {
  if (!(current in RANK)) return false;
  if (current === "delivered") return false;
  return (RANK[next] ?? 0) > (RANK[current] ?? 0);
}

const nowIso = () => new Date().toISOString();

// --- Memory ---------------------------------------------------------------------------

export class MemoryNotifyStore implements NotifyStore {
  readonly notifications: NotificationRow[] = [];
  readonly sms: SmsRow[] = [];

  async claim(input: NewNotification) {
    const existing = this.notifications.find((n) => n.idempotencyKey === input.idempotencyKey);
    if (existing) return { row: existing, fresh: false };
    const row: NotificationRow = {
      id: randomUUID(),
      createdAt: nowIso(),
      channel: input.channel,
      templateId: input.templateId,
      templateVersion: input.templateVersion,
      audience: input.audience,
      recipient: input.recipient,
      subject: input.subject ?? null,
      status: "queued",
      provider: null,
      providerMessageId: null,
      idempotencyKey: input.idempotencyKey,
      leadId: input.leadId ?? null,
      dealId: input.dealId ?? null,
      approvalId: null,
      consentEventId: null,
      attempts: 0,
      error: null,
      metadata: input.metadata ?? {},
      sentAt: null,
      deliveredAt: null,
    };
    this.notifications.push(row);
    return { row, fresh: true };
  }

  async update(id: string, patch: NotificationPatch) {
    const row = this.notifications.find((n) => n.id === id);
    if (!row) throw new Error(`notification ${id} not found`);
    const { incrementAttempts, ...fields } = patch;
    Object.assign(row, fields);
    if (incrementAttempts) row.attempts += 1;
    return row;
  }

  async reopen(id: string, expected: readonly NotificationStatus[]) {
    const row = this.notifications.find((n) => n.id === id);
    if (!row || !expected.includes(row.status)) return null;
    row.status = "queued";
    return row;
  }

  async findByKey(key: string) {
    return this.notifications.find((n) => n.idempotencyKey === key) ?? null;
  }

  async listHeldForApproval(opts: { since: Date; limit: number }) {
    const since = opts.since.toISOString();
    return this.notifications
      .filter((n) => n.approvalId && (HELD_STATUSES as readonly string[]).includes(n.status) && n.createdAt >= since)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
      .slice(0, opts.limit);
  }

  async recordSms(input: NewSms) {
    if (input.providerMessageId) {
      const existing = this.sms.find((s) => s.providerMessageId === input.providerMessageId);
      if (existing) return { row: existing, fresh: false };
    }
    const row: SmsRow = {
      id: randomUUID(),
      createdAt: nowIso(),
      direction: input.direction,
      fromNumber: input.fromNumber,
      toNumber: input.toNumber,
      body: input.body,
      status: input.status,
      providerMessageId: input.providerMessageId ?? null,
      notificationId: input.notificationId ?? null,
      leadId: input.leadId ?? null,
      keyword: input.keyword ?? null,
      processedAt: null,
      deliveredAt: null,
      error: null,
    };
    this.sms.push(row);
    return { row, fresh: true };
  }

  async updateSms(id: string, patch: SmsPatch) {
    const row = this.sms.find((s) => s.id === id);
    if (!row) throw new Error(`sms ${id} not found`);
    Object.assign(row, patch);
    return row;
  }

  async applyDelivery(providerMessageId: string, status: DeliveryStatus, at: Date, error?: string | null) {
    let notifications = 0;
    let sms = 0;
    for (const n of this.notifications) {
      if (n.providerMessageId !== providerMessageId || !canAdvance(n.status, status)) continue;
      n.status = status;
      if (status === "delivered") n.deliveredAt = at.toISOString();
      if (status === "undelivered") n.error = error ?? "delivery failed";
      notifications += 1;
    }
    for (const s of this.sms) {
      if (s.providerMessageId !== providerMessageId || !canAdvance(s.status, status)) continue;
      s.status = status;
      if (status === "delivered") s.deliveredAt = at.toISOString();
      if (status === "undelivered") s.error = error ?? "delivery failed";
      sms += 1;
    }
    return { notifications, sms };
  }
}

// --- Supabase ----------------------------------------------------------------------------

type Row = Record<string, unknown>;

function toNotification(r: Row): NotificationRow {
  return {
    id: String(r.id),
    createdAt: String(r.created_at),
    channel: r.channel as Channel,
    templateId: String(r.template_id),
    templateVersion: Number(r.template_version),
    audience: r.audience as Audience,
    recipient: String(r.recipient),
    subject: (r.subject as string | null) ?? null,
    status: r.status as NotificationStatus,
    provider: (r.provider as NotificationRow["provider"]) ?? null,
    providerMessageId: (r.provider_message_id as string | null) ?? null,
    idempotencyKey: String(r.idempotency_key),
    leadId: (r.lead_id as string | null) ?? null,
    dealId: (r.deal_id as string | null) ?? null,
    approvalId: (r.approval_id as string | null) ?? null,
    consentEventId: (r.consent_event_id as string | null) ?? null,
    attempts: Number(r.attempts ?? 0),
    error: (r.error as string | null) ?? null,
    metadata: (r.metadata as Record<string, unknown> | null) ?? {},
    sentAt: (r.sent_at as string | null) ?? null,
    deliveredAt: (r.delivered_at as string | null) ?? null,
  };
}

function toSms(r: Row): SmsRow {
  return {
    id: String(r.id),
    createdAt: String(r.created_at),
    direction: r.direction as SmsRow["direction"],
    fromNumber: String(r.from_number),
    toNumber: String(r.to_number),
    body: String(r.body),
    status: r.status as SmsStatus,
    providerMessageId: (r.provider_message_id as string | null) ?? null,
    notificationId: (r.notification_id as string | null) ?? null,
    leadId: (r.lead_id as string | null) ?? null,
    keyword: (r.keyword as SmsRow["keyword"]) ?? null,
    processedAt: (r.processed_at as string | null) ?? null,
    deliveredAt: (r.delivered_at as string | null) ?? null,
    error: (r.error as string | null) ?? null,
  };
}

const UNIQUE_VIOLATION = "23505";

export class SupabaseNotifyStore implements NotifyStore {
  constructor(private readonly db: SupabaseClient) {}

  async claim(input: NewNotification) {
    const { data, error } = await this.db
      .from("notifications")
      .insert({
        channel: input.channel,
        template_id: input.templateId,
        template_version: input.templateVersion,
        audience: input.audience,
        recipient: input.recipient,
        subject: input.subject ?? null,
        idempotency_key: input.idempotencyKey,
        lead_id: input.leadId ?? null,
        deal_id: input.dealId ?? null,
        metadata: input.metadata ?? {},
      })
      .select("*")
      .single();
    if (!error && data) return { row: toNotification(data), fresh: true };
    if (error?.code === UNIQUE_VIOLATION) {
      const existing = await this.findByKey(input.idempotencyKey);
      if (existing) return { row: existing, fresh: false };
    }
    throw new Error(`notification insert failed: ${error?.message ?? "no row"}`);
  }

  async update(id: string, patch: NotificationPatch) {
    const { incrementAttempts, ...fields } = patch;
    const set: Row = {};
    if (fields.status !== undefined) set.status = fields.status;
    if (fields.provider !== undefined) set.provider = fields.provider;
    if (fields.providerMessageId !== undefined) set.provider_message_id = fields.providerMessageId;
    if (fields.approvalId !== undefined) set.approval_id = fields.approvalId;
    if (fields.consentEventId !== undefined) set.consent_event_id = fields.consentEventId;
    if (fields.error !== undefined) set.error = fields.error === null ? null : fields.error.slice(0, 1000);
    if (fields.sentAt !== undefined) set.sent_at = fields.sentAt;
    if (fields.deliveredAt !== undefined) set.delivered_at = fields.deliveredAt;
    if (fields.subject !== undefined) set.subject = fields.subject?.slice(0, 300) ?? null;
    if (fields.metadata !== undefined) set.metadata = fields.metadata;
    if (incrementAttempts) {
      const { data: cur } = await this.db.from("notifications").select("attempts").eq("id", id).single();
      set.attempts = Number(cur?.attempts ?? 0) + 1;
    }
    const { data, error } = await this.db.from("notifications").update(set).eq("id", id).select("*").single();
    if (error || !data) throw new Error(`notification update failed: ${error?.message ?? "no row"}`);
    return toNotification(data);
  }

  async reopen(id: string, expected: readonly NotificationStatus[]) {
    const { data, error } = await this.db.from("notifications").update({ status: "queued" }).eq("id", id).in("status", [...expected]).select("*");
    if (error) throw new Error(`notification reopen failed: ${error.message}`);
    return data?.[0] ? toNotification(data[0]) : null;
  }

  async findByKey(key: string) {
    const { data, error } = await this.db.from("notifications").select("*").eq("idempotency_key", key).maybeSingle();
    if (error) throw new Error(`notification lookup failed: ${error.message}`);
    return data ? toNotification(data) : null;
  }

  async listHeldForApproval(opts: { since: Date; limit: number }) {
    const { data, error } = await this.db
      .from("notifications")
      .select("*")
      .in("status", [...HELD_STATUSES])
      .not("approval_id", "is", null)
      .gte("created_at", opts.since.toISOString())
      .order("created_at", { ascending: true })
      .limit(opts.limit);
    if (error) throw new Error(`held notification lookup failed: ${error.message}`);
    return (data ?? []).map(toNotification);
  }

  async recordSms(input: NewSms) {
    const { data, error } = await this.db
      .from("sms_messages")
      .insert({
        direction: input.direction,
        from_number: input.fromNumber,
        to_number: input.toNumber,
        body: input.body.slice(0, 4000),
        status: input.status,
        provider_message_id: input.providerMessageId ?? null,
        notification_id: input.notificationId ?? null,
        lead_id: input.leadId ?? null,
        keyword: input.keyword ?? null,
      })
      .select("*")
      .single();
    if (!error && data) return { row: toSms(data), fresh: true };
    if (error?.code === UNIQUE_VIOLATION && input.providerMessageId) {
      const { data: existing } = await this.db.from("sms_messages").select("*").eq("provider_message_id", input.providerMessageId).maybeSingle();
      if (existing) return { row: toSms(existing), fresh: false };
    }
    throw new Error(`sms insert failed: ${error?.message ?? "no row"}`);
  }

  async updateSms(id: string, patch: SmsPatch) {
    const set: Row = {};
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.keyword !== undefined) set.keyword = patch.keyword;
    if (patch.processedAt !== undefined) set.processed_at = patch.processedAt;
    if (patch.deliveredAt !== undefined) set.delivered_at = patch.deliveredAt;
    if (patch.error !== undefined) set.error = patch.error === null ? null : patch.error.slice(0, 1000);
    if (patch.leadId !== undefined) set.lead_id = patch.leadId;
    if (patch.providerMessageId !== undefined) set.provider_message_id = patch.providerMessageId;
    const { data, error } = await this.db.from("sms_messages").update(set).eq("id", id).select("*").single();
    if (error || !data) throw new Error(`sms update failed: ${error?.message ?? "no row"}`);
    return toSms(data);
  }

  async applyDelivery(providerMessageId: string, status: DeliveryStatus, at: Date, error?: string | null) {
    // Only rows that can still advance: delivered is terminal, undelivered can still become delivered.
    // ("failed" stays a source for rows recorded before 'undelivered' existed.)
    const advanceFrom: Record<DeliveryStatus, string[]> = {
      sent: ["queued"],
      undelivered: ["queued", "sent"],
      delivered: ["queued", "sent", "failed", "undelivered"],
    };
    const common = { status, ...(status === "undelivered" ? { error: (error ?? "delivery failed").slice(0, 1000) } : {}) };
    const { data: n, error: nErr } = await this.db
      .from("notifications")
      .update({ ...common, ...(status === "delivered" ? { delivered_at: at.toISOString() } : {}) })
      .eq("provider_message_id", providerMessageId)
      .in("status", advanceFrom[status])
      .select("id");
    if (nErr) throw new Error(`notification delivery update failed: ${nErr.message}`);
    const { data: s, error: sErr } = await this.db
      .from("sms_messages")
      .update({ ...common, ...(status === "delivered" ? { delivered_at: at.toISOString() } : {}) })
      .eq("provider_message_id", providerMessageId)
      .in("status", advanceFrom[status])
      .select("id");
    if (sErr) throw new Error(`sms delivery update failed: ${sErr.message}`);
    return { notifications: n?.length ?? 0, sms: s?.length ?? 0 };
  }
}
