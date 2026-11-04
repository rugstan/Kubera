import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EsignProviderName } from "@/lib/esign/types";
import { DOCUMENT_BUCKET, supabaseAdmin } from "@/lib/supabase/server";
import { brokerOfRecordRow, type BrokerOfRecordInput } from "./broker-of-record";
import { ConcurrentUpdateError, UNDELIVERED_MLDS, type DisclosureEvent, type DisclosureRecord, type DisclosureStore, type DocumentStorage, type NewDisclosure } from "./store";

// Supabase-backed disclosure store (service role; RLS denies anon and
// authenticated roles on these tables). Column names follow the WS-W migration.

type Row = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COLUMNS: Record<keyof Omit<DisclosureRecord, "id" | "createdAt" | "updatedAt" | "version">, string> = {
  kind: "kind",
  status: "status",
  leadId: "lead_id",
  dealId: "deal_id",
  twentyOpportunityId: "twenty_opportunity_id",
  supersedesId: "supersedes_id",
  applicationCompletedAt: "application_completed_at",
  borrowerObligatedAt: "borrower_obligated_at",
  dueAt: "due_at",
  generatedAt: "generated_at",
  sentAt: "sent_at",
  signedAt: "signed_at",
  heldReason: "held_reason",
  flags: "flags",
  templateVersion: "template_version",
  payload: "payload",
  documentPath: "document_path",
  documentSha256: "document_sha256",
  signedDocumentPath: "signed_document_path",
  signedDocumentSha256: "signed_document_sha256",
  provider: "provider",
  providerRequestId: "provider_request_id",
  signerActions: "signer_actions",
  uetaConsent: "ueta_consent",
  retainUntil: "retain_until",
};

function toRow(patch: Partial<DisclosureRecord>): Row {
  const row: Row = {};
  for (const [key, col] of Object.entries(COLUMNS)) {
    const v = (patch as Record<string, unknown>)[key];
    if (v !== undefined) row[col] = v;
  }
  return row;
}

function fromRow(row: Row): DisclosureRecord {
  const out: Record<string, unknown> = { id: row.id, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at };
  for (const [key, col] of Object.entries(COLUMNS)) out[key] = row[col] ?? null;
  out.flags = (row.flags as string[] | null) ?? [];
  out.signerActions = (row.signer_actions as unknown[] | null) ?? [];
  out.uetaConsent = (row.ueta_consent as unknown[] | null) ?? [];
  return out as DisclosureRecord;
}

function eventFromRow(row: Row): DisclosureEvent {
  return {
    disclosureId: String(row.disclosure_id),
    occurredAt: String(row.occurred_at),
    eventType: String(row.event_type),
    fromStatus: (row.from_status as DisclosureEvent["fromStatus"]) ?? null,
    toStatus: (row.to_status as DisclosureEvent["toStatus"]) ?? null,
    actor: String(row.actor),
    providerEventId: (row.provider_event_id as string | null) ?? undefined,
    detail: (row.detail as Record<string, unknown>) ?? {},
  };
}

export class SupabaseDisclosureStore implements DisclosureStore {
  constructor(private readonly db: SupabaseClient) {}

  async insert(record: NewDisclosure, now: Date): Promise<DisclosureRecord> {
    const { data, error } = await this.db
      .from("disclosures")
      .insert({ ...toRow(record), created_at: now.toISOString(), updated_at: now.toISOString() })
      .select()
      .single();
    if (error) throw new Error(`disclosures insert: ${error.message}`);
    return fromRow(data as Row);
  }

  async get(id: string): Promise<DisclosureRecord | null> {
    const { data, error } = await this.db.from("disclosures").select().eq("id", id).maybeSingle();
    if (error) throw new Error(`disclosures get: ${error.message}`);
    return data ? fromRow(data as Row) : null;
  }

  async getByProviderRequest(provider: EsignProviderName, requestId: string): Promise<DisclosureRecord | null> {
    const { data, error } = await this.db.from("disclosures").select().eq("provider", provider).eq("provider_request_id", requestId).maybeSingle();
    if (error) throw new Error(`disclosures by request: ${error.message}`);
    return data ? fromRow(data as Row) : null;
  }

  async listForDeal(ref: { leadId?: string; dealId?: string }): Promise<DisclosureRecord[]> {
    if (!ref.leadId && !ref.dealId) return [];
    for (const v of [ref.leadId, ref.dealId]) if (v && !UUID.test(v)) throw new Error("listForDeal: ids must be UUIDs");
    let q = this.db.from("disclosures").select().neq("status", "superseded");
    q = ref.leadId && ref.dealId ? q.or(`lead_id.eq.${ref.leadId},deal_id.eq.${ref.dealId}`) : ref.leadId ? q.eq("lead_id", ref.leadId) : q.eq("deal_id", ref.dealId as string);
    const { data, error } = await q.order("created_at", { ascending: false });
    if (error) throw new Error(`disclosures list: ${error.message}`);
    return (data as Row[]).map(fromRow);
  }

  async listUndeliveredMlds(limit = 500): Promise<DisclosureRecord[]> {
    const { data, error } = await this.db
      .from("disclosures")
      .select()
      .eq("kind", "MLDS_RE882")
      .in("status", [...UNDELIVERED_MLDS])
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(limit);
    if (error) throw new Error(`disclosures undelivered: ${error.message}`);
    return (data as Row[]).map(fromRow);
  }

  async update(id: string, expectedVersion: number, patch: Partial<DisclosureRecord>, now: Date): Promise<DisclosureRecord> {
    const { data, error } = await this.db
      .from("disclosures")
      .update({ ...toRow(patch), version: expectedVersion + 1, updated_at: now.toISOString() })
      .eq("id", id)
      .eq("version", expectedVersion)
      .select();
    if (error) throw new Error(`disclosures update: ${error.message}`);
    const rows = data as Row[];
    if (!rows.length) throw new ConcurrentUpdateError(id);
    return fromRow(rows[0] as Row);
  }

  async appendEvent(event: DisclosureEvent): Promise<boolean> {
    const { error } = await this.db.from("disclosure_events").insert({
      disclosure_id: event.disclosureId,
      occurred_at: event.occurredAt,
      event_type: event.eventType,
      from_status: event.fromStatus,
      to_status: event.toStatus,
      actor: event.actor,
      provider_event_id: event.providerEventId ?? null,
      detail: event.detail,
    });
    if (error?.code === "23505") return false;
    if (error) throw new Error(`disclosure_events insert: ${error.message}`);
    return true;
  }

  async events(disclosureId: string): Promise<DisclosureEvent[]> {
    const { data, error } = await this.db.from("disclosure_events").select().eq("disclosure_id", disclosureId).order("id");
    if (error) throw new Error(`disclosure_events list: ${error.message}`);
    return (data as Row[]).map(eventFromRow);
  }

  async hasProviderEvent(providerEventId: string): Promise<boolean> {
    const { count, error } = await this.db.from("disclosure_events").select("id", { count: "exact", head: true }).eq("provider_event_id", providerEventId);
    if (error) throw new Error(`disclosure_events lookup: ${error.message}`);
    return (count ?? 0) > 0;
  }
}

/** Write-once uploads into the private vault bucket. */
export class SupabaseDocumentStorage implements DocumentStorage {
  constructor(private readonly db: SupabaseClient) {}

  async put(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const { error } = await this.db.storage.from(DOCUMENT_BUCKET).upload(path, bytes, { contentType, upsert: false });
    // Paths embed the content hash, so "already exists" means the same bytes were stored by an earlier delivery.
    if (error && !/exists|duplicate/i.test(error.message)) throw new Error(`storage upload ${path}: ${error.message}`);
  }
}

/** Insert a broker-of-record file (loan or modification) with its gate H evaluation. */
export async function insertBrokerOfRecord(db: SupabaseClient, input: BrokerOfRecordInput): Promise<{ id: string; gateStatus: string; gateBlocking: boolean }> {
  const { data, error } = await db.from("broker_of_record").insert(brokerOfRecordRow(input)).select("id, gate_status, gate_blocking").single();
  if (error) throw new Error(`broker_of_record insert: ${error.message}`);
  const row = data as Row;
  return { id: String(row.id), gateStatus: String(row.gate_status), gateBlocking: Boolean(row.gate_blocking) };
}

export function supabaseDisclosureBackends(): { store: SupabaseDisclosureStore; storage: SupabaseDocumentStorage } | null {
  const db = supabaseAdmin();
  return db ? { store: new SupabaseDisclosureStore(db), storage: new SupabaseDocumentStorage(db) } : null;
}
