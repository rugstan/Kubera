import type { SupabaseClient } from "@supabase/supabase-js";
import type { NewOutreachMessage, OutreachMessagePatch, OutreachStore, SubjectQuery } from "./store";
import type { OutreachKind, OutreachMessageRow, OutreachStatus } from "./types";

// Supabase implementation of the message log (public.outreach_messages,
// service role only).

type Row = Record<string, unknown>;

function toRow(r: Row): OutreachMessageRow {
  const s = (k: string) => (r[k] as string | null) ?? null;
  return {
    id: String(r.id),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    kind: r.kind as OutreachKind,
    channel: r.channel as OutreachMessageRow["channel"],
    templateId: String(r.template_id),
    templateVersion: Number(r.template_version),
    audience: r.audience as OutreachMessageRow["audience"],
    recipient: String(r.recipient),
    status: r.status as OutreachStatus,
    reasonCode: s("reason_code") as OutreachMessageRow["reasonCode"],
    idempotencyKey: String(r.idempotency_key),
    leadId: s("lead_id"),
    dealId: s("deal_id"),
    subjectKey: s("subject_key"),
    sequence: Number(r.sequence ?? 1),
    approvalId: s("approval_id"),
    consentEventId: s("consent_event_id"),
    provider: s("provider") as OutreachMessageRow["provider"],
    providerMessageId: s("provider_message_id"),
    attempts: Number(r.attempts ?? 0),
    error: s("error"),
    metadata: (r.metadata as Record<string, unknown> | null) ?? {},
    sentAt: s("sent_at"),
  };
}

const UNIQUE_VIOLATION = "23505";

export class SupabaseOutreachStore implements OutreachStore {
  constructor(private readonly db: SupabaseClient) {}

  async claim(input: NewOutreachMessage) {
    const { data, error } = await this.db
      .from("outreach_messages")
      .insert({
        kind: input.kind,
        channel: input.channel,
        template_id: input.templateId,
        template_version: input.templateVersion,
        audience: input.audience,
        recipient: input.recipient,
        idempotency_key: input.idempotencyKey,
        lead_id: input.leadId ?? null,
        deal_id: input.dealId ?? null,
        subject_key: input.subjectKey ?? null,
        sequence: input.sequence ?? 1,
        metadata: input.metadata ?? {},
      })
      .select("*")
      .single();
    if (!error && data) return { row: toRow(data), fresh: true };
    if (error?.code === UNIQUE_VIOLATION) {
      const existing = await this.findByKey(input.idempotencyKey);
      if (existing) return { row: existing, fresh: false };
    }
    throw new Error(`outreach message insert failed: ${error?.message ?? "no row"}`);
  }

  async update(id: string, patch: OutreachMessagePatch) {
    const { incrementAttempts, ...f } = patch;
    const set: Row = {};
    if (f.status !== undefined) set.status = f.status;
    if (f.reasonCode !== undefined) set.reason_code = f.reasonCode;
    if (f.approvalId !== undefined) set.approval_id = f.approvalId;
    if (f.consentEventId !== undefined) set.consent_event_id = f.consentEventId;
    if (f.provider !== undefined) set.provider = f.provider;
    if (f.providerMessageId !== undefined) set.provider_message_id = f.providerMessageId;
    if (f.error !== undefined) set.error = f.error === null ? null : f.error.slice(0, 1000);
    if (f.sentAt !== undefined) set.sent_at = f.sentAt;
    if (f.metadata !== undefined) set.metadata = f.metadata;
    if (incrementAttempts) {
      const { data: cur } = await this.db.from("outreach_messages").select("attempts").eq("id", id).single();
      set.attempts = Number(cur?.attempts ?? 0) + 1;
    }
    const { data, error } = await this.db.from("outreach_messages").update(set).eq("id", id).select("*").single();
    if (error || !data) throw new Error(`outreach message update failed: ${error?.message ?? "no row"}`);
    return toRow(data);
  }

  async reopen(id: string, expected: readonly OutreachStatus[]) {
    const { data, error } = await this.db.from("outreach_messages").update({ status: "queued" }).eq("id", id).in("status", [...expected]).select("*");
    if (error) throw new Error(`outreach message reopen failed: ${error.message}`);
    return data?.[0] ? toRow(data[0]) : null;
  }

  async findByKey(key: string) {
    const { data, error } = await this.db.from("outreach_messages").select("*").eq("idempotency_key", key).maybeSingle();
    if (error) throw new Error(`outreach message lookup failed: ${error.message}`);
    return data ? toRow(data) : null;
  }

  async listSeries(q: SubjectQuery) {
    let query = this.db.from("outreach_messages").select("*").eq("kind", q.kind);
    if (q.dealId !== undefined) query = q.dealId === null ? query.is("deal_id", null) : query.eq("deal_id", q.dealId);
    if (q.leadId !== undefined) query = q.leadId === null ? query.is("lead_id", null) : query.eq("lead_id", q.leadId);
    if (q.subjectKey !== undefined) query = q.subjectKey === null ? query.is("subject_key", null) : query.eq("subject_key", q.subjectKey);
    const { data, error } = await query.order("created_at", { ascending: true }).order("sequence", { ascending: true }).limit(500);
    if (error) throw new Error(`outreach series lookup failed: ${error.message}`);
    return (data ?? []).map(toRow);
  }

  async listRetryable(kind: OutreachKind, since: Date, limit = 100) {
    const { data, error } = await this.db
      .from("outreach_messages")
      .select("*")
      .eq("kind", kind)
      .in("status", ["pending_approval", "deferred_quiet_hours"])
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) throw new Error(`outreach retry lookup failed: ${error.message}`);
    return (data ?? []).map(toRow);
  }
}
