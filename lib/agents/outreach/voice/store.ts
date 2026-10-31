import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NewVoiceCall, VoiceCallPatch, VoiceCallRow, VoiceCallStatus } from "./types";

// Persistence for outbound calls (public.outreach_voice_calls). Updates are
// compare-and-set on the call's status so a redelivered or out-of-order webhook
// can only move a call forward once.

export interface VoiceStore {
  /** Inserts the call, or returns the existing row for the same idempotency key. */
  claim(input: NewVoiceCall): Promise<{ row: VoiceCallRow; fresh: boolean }>;
  get(id: string): Promise<VoiceCallRow | null>;
  findByControlId(callControlId: string): Promise<VoiceCallRow | null>;
  /** Applies the patch only while the call is in one of `expected`; null when it moved on. */
  transition(id: string, expected: readonly VoiceCallStatus[], patch: VoiceCallPatch): Promise<VoiceCallRow | null>;
  /** Patch without a status guard (fields that do not move the call: recording ids). */
  update(id: string, patch: VoiceCallPatch): Promise<VoiceCallRow>;
}

export class MemoryVoiceStore implements VoiceStore {
  readonly rows: VoiceCallRow[] = [];
  constructor(private readonly clock: () => Date = () => new Date()) {}

  async claim(input: NewVoiceCall) {
    const existing = this.rows.find((r) => r.idempotencyKey === input.idempotencyKey);
    if (existing) return { row: existing, fresh: false };
    const at = this.clock().toISOString();
    const row: VoiceCallRow = {
      id: randomUUID(),
      createdAt: at,
      updatedAt: at,
      idempotencyKey: input.idempotencyKey,
      mode: input.mode,
      toNumber: input.toNumber,
      fromNumber: input.fromNumber ?? null,
      status: "queued",
      blockReason: null,
      scriptId: input.scriptId,
      scriptVersion: input.scriptVersion,
      bodyText: null,
      recordRequested: input.recordRequested,
      aiDisclosedAt: null,
      recordingDisclosedAt: null,
      recordingStartedAt: null,
      recordingStoppedAt: null,
      recordingId: null,
      leadId: input.leadId ?? null,
      dealId: input.dealId ?? null,
      approvalId: null,
      consentEventIds: [],
      aiVoiceConsentId: null,
      callControlId: null,
      callSessionId: null,
      handoffNumber: input.handoffNumber ?? null,
      hangupCause: null,
      error: null,
      endedAt: null,
    };
    this.rows.push(row);
    return { row, fresh: true };
  }

  async get(id: string) {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async findByControlId(callControlId: string) {
    return this.rows.find((r) => r.callControlId === callControlId) ?? null;
  }

  async transition(id: string, expected: readonly VoiceCallStatus[], patch: VoiceCallPatch) {
    const row = this.rows.find((r) => r.id === id);
    if (!row || !expected.includes(row.status)) return null;
    return this.apply(row, patch);
  }

  async update(id: string, patch: VoiceCallPatch) {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new Error(`voice call ${id} not found`);
    return this.apply(row, patch);
  }

  private apply(row: VoiceCallRow, patch: VoiceCallPatch) {
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) (row as Record<string, unknown>)[k] = v;
    row.updatedAt = this.clock().toISOString();
    return row;
  }
}

// --- Supabase -------------------------------------------------------------------------------

type Row = Record<string, unknown>;

const COLUMNS: Record<keyof VoiceCallPatch, string> = {
  mode: "mode",
  toNumber: "to_number",
  fromNumber: "from_number",
  status: "status",
  blockReason: "block_reason",
  scriptId: "script_id",
  scriptVersion: "script_version",
  bodyText: "body_text",
  recordRequested: "record_requested",
  aiDisclosedAt: "ai_disclosed_at",
  recordingDisclosedAt: "recording_disclosed_at",
  recordingStartedAt: "recording_started_at",
  recordingStoppedAt: "recording_stopped_at",
  recordingId: "recording_id",
  leadId: "lead_id",
  dealId: "deal_id",
  approvalId: "approval_id",
  consentEventIds: "consent_event_ids",
  aiVoiceConsentId: "ai_voice_consent_id",
  callControlId: "call_control_id",
  callSessionId: "call_session_id",
  handoffNumber: "handoff_number",
  hangupCause: "hangup_cause",
  error: "error",
  endedAt: "ended_at",
};

function toDb(patch: VoiceCallPatch): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(patch) as [keyof VoiceCallPatch, unknown][]) {
    if (v === undefined) continue;
    out[COLUMNS[k]] = k === "error" && typeof v === "string" ? v.slice(0, 1000) : v;
  }
  return out;
}

function toCall(r: Row): VoiceCallRow {
  const s = (k: string) => (r[k] as string | null) ?? null;
  return {
    id: String(r.id),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    idempotencyKey: String(r.idempotency_key),
    mode: r.mode as VoiceCallRow["mode"],
    toNumber: String(r.to_number),
    fromNumber: s("from_number"),
    status: r.status as VoiceCallStatus,
    blockReason: s("block_reason") as VoiceCallRow["blockReason"],
    scriptId: String(r.script_id),
    scriptVersion: Number(r.script_version),
    bodyText: s("body_text"),
    recordRequested: Boolean(r.record_requested),
    aiDisclosedAt: s("ai_disclosed_at"),
    recordingDisclosedAt: s("recording_disclosed_at"),
    recordingStartedAt: s("recording_started_at"),
    recordingStoppedAt: s("recording_stopped_at"),
    recordingId: s("recording_id"),
    leadId: s("lead_id"),
    dealId: s("deal_id"),
    approvalId: s("approval_id"),
    consentEventIds: ((r.consent_event_ids as string[] | null) ?? []).map(String),
    aiVoiceConsentId: s("ai_voice_consent_id"),
    callControlId: s("call_control_id"),
    callSessionId: s("call_session_id"),
    handoffNumber: s("handoff_number"),
    hangupCause: s("hangup_cause"),
    error: s("error"),
    endedAt: s("ended_at"),
  };
}

const UNIQUE_VIOLATION = "23505";

export class SupabaseVoiceStore implements VoiceStore {
  constructor(private readonly db: SupabaseClient) {}

  async claim(input: NewVoiceCall) {
    const { data, error } = await this.db
      .from("outreach_voice_calls")
      .insert({
        idempotency_key: input.idempotencyKey,
        mode: input.mode,
        to_number: input.toNumber,
        from_number: input.fromNumber ?? null,
        script_id: input.scriptId,
        script_version: input.scriptVersion,
        record_requested: input.recordRequested,
        lead_id: input.leadId ?? null,
        deal_id: input.dealId ?? null,
        handoff_number: input.handoffNumber ?? null,
      })
      .select("*")
      .single();
    if (!error && data) return { row: toCall(data), fresh: true };
    if (error?.code === UNIQUE_VIOLATION) {
      const { data: existing } = await this.db.from("outreach_voice_calls").select("*").eq("idempotency_key", input.idempotencyKey).maybeSingle();
      if (existing) return { row: toCall(existing), fresh: false };
    }
    throw new Error(`voice call insert failed: ${error?.message ?? "no row"}`);
  }

  async get(id: string) {
    const { data, error } = await this.db.from("outreach_voice_calls").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`voice call lookup failed: ${error.message}`);
    return data ? toCall(data) : null;
  }

  async findByControlId(callControlId: string) {
    const { data, error } = await this.db.from("outreach_voice_calls").select("*").eq("call_control_id", callControlId).maybeSingle();
    if (error) throw new Error(`voice call lookup failed: ${error.message}`);
    return data ? toCall(data) : null;
  }

  async transition(id: string, expected: readonly VoiceCallStatus[], patch: VoiceCallPatch) {
    const { data, error } = await this.db.from("outreach_voice_calls").update(toDb(patch)).eq("id", id).in("status", [...expected]).select("*");
    if (error) throw new Error(`voice call transition failed: ${error.message}`);
    return data?.[0] ? toCall(data[0]) : null;
  }

  async update(id: string, patch: VoiceCallPatch) {
    const { data, error } = await this.db.from("outreach_voice_calls").update(toDb(patch)).eq("id", id).select("*").single();
    if (error || !data) throw new Error(`voice call update failed: ${error?.message ?? "no row"}`);
    return toCall(data);
  }
}
