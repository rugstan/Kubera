// Persistence for the vault: document rows and the append-only event log.
// `SupabaseDocumentStore` talks to Postgres through the service-role client;
// `MemoryDocumentStore` is the in-memory fake the unit tests use. Both enforce
// the same rules: compare-and-set updates, lease-based scan claims, quota usage.

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { QUARANTINE_BUCKET, systemClock, type Clock, type DocumentEvent, type DocumentPatch, type DocumentRow, type DocumentStatus, type NewDocument } from "./types";

/** Statuses that count against a lead's quota. */
export const QUOTA_STATUSES: readonly DocumentStatus[] = ["pending_upload", "quarantined", "clean", "scan_failed"];

export type LeadUsage = { files: number; bytes: number };

export interface DocumentStore {
  insert(doc: NewDocument): Promise<DocumentRow>;
  get(id: string): Promise<DocumentRow | null>;
  /** Files and bytes the lead holds, counting only QUOTA_STATUSES (declared size until the real one is known). */
  usageForLead(leadId: string): Promise<LeadUsage>;
  /** Applies `patch` only while the row is in one of the `expect` statuses; null when it is not (lost the race). */
  update(id: string, patch: DocumentPatch, expect?: DocumentStatus | readonly DocumentStatus[]): Promise<DocumentRow | null>;
  remove(id: string): Promise<boolean>;
  /** Leases up to `limit` quarantined rows to the caller and counts the attempt. */
  claimForScan(limit: number, leaseSeconds: number): Promise<DocumentRow[]>;
  /** pending_upload rows minted before `cutoff` (never finalized). */
  listStalePending(cutoff: Date, limit: number): Promise<DocumentRow[]>;
  listForLead(leadId: string): Promise<DocumentRow[]>;
  /** Every clean document, for backups. */
  listClean(limit: number, afterId?: string): Promise<DocumentRow[]>;
}

export interface DocumentEventLog {
  /** Appends an event. Throws if it cannot be written; callers decide whether that is fatal. */
  record(event: DocumentEvent): Promise<void>;
}

/** For events that must not break the operation they describe (scan results, sweeps). */
export async function recordQuietly(log: DocumentEventLog, event: DocumentEvent): Promise<void> {
  try {
    await log.record(event);
  } catch (err) {
    console.error(`[documents] could not record ${event.event}:`, err instanceof Error ? err.message : err);
  }
}

// --- Supabase ----------------------------------------------------------------------

export function supabaseDocumentStore(db: SupabaseClient): DocumentStore {
  const fail = (op: string, error: { message: string }): never => {
    throw new Error(`documents.${op}: ${error.message}`);
  };
  return {
    async insert(doc) {
      const { data, error } = await db
        .from("documents")
        .insert({ ...doc, status: "pending_upload", bucket: QUARANTINE_BUCKET })
        .select("*")
        .single();
      if (error || !data) return fail("insert", error ?? { message: "no row returned" });
      return data as DocumentRow;
    },
    async get(id) {
      const { data, error } = await db.from("documents").select("*").eq("id", id).maybeSingle();
      if (error) return fail("get", error);
      return (data as DocumentRow | null) ?? null;
    },
    async usageForLead(leadId) {
      const { data, error } = await db
        .from("documents")
        .select("size_bytes, declared_size_bytes")
        .eq("lead_id", leadId)
        .in("status", [...QUOTA_STATUSES])
        .limit(5_000);
      if (error) return fail("usageForLead", error);
      const rows = (data ?? []) as Pick<DocumentRow, "size_bytes" | "declared_size_bytes">[];
      return { files: rows.length, bytes: rows.reduce((sum, r) => sum + Number(r.size_bytes ?? r.declared_size_bytes ?? 0), 0) };
    },
    async update(id, patch, expect) {
      let q = db.from("documents").update(patch).eq("id", id);
      if (expect) q = q.in("status", Array.isArray(expect) ? [...expect] : [expect as DocumentStatus]);
      const { data, error } = await q.select("*").maybeSingle();
      if (error) return fail("update", error);
      return (data as DocumentRow | null) ?? null;
    },
    async remove(id) {
      const { data, error } = await db.from("documents").delete().eq("id", id).select("id");
      if (error) return fail("remove", error);
      return (data ?? []).length > 0;
    },
    async claimForScan(limit, leaseSeconds) {
      const { data, error } = await db.rpc("claim_documents_for_scan", { batch_size: limit, lease_seconds: leaseSeconds });
      if (error) return fail("claimForScan", error);
      return (data ?? []) as DocumentRow[];
    },
    async listStalePending(cutoff, limit) {
      const { data, error } = await db.from("documents").select("*").eq("status", "pending_upload").lt("created_at", cutoff.toISOString()).order("created_at").limit(limit);
      if (error) return fail("listStalePending", error);
      return (data ?? []) as DocumentRow[];
    },
    async listForLead(leadId) {
      const { data, error } = await db.from("documents").select("*").eq("lead_id", leadId).order("created_at");
      if (error) return fail("listForLead", error);
      return (data ?? []) as DocumentRow[];
    },
    async listClean(limit, afterId) {
      let q = db.from("documents").select("*").eq("status", "clean").order("id").limit(limit);
      if (afterId) q = q.gt("id", afterId);
      const { data, error } = await q;
      if (error) return fail("listClean", error);
      return (data ?? []) as DocumentRow[];
    },
  };
}

export function supabaseEventLog(db: SupabaseClient): DocumentEventLog {
  return {
    async record(event) {
      const { error } = await db.from("document_events").insert({
        event: event.event,
        document_id: event.document_id,
        lead_id: event.lead_id,
        actor: event.actor.slice(0, 200) || "system",
        ip_hash: event.ip_hash ?? null,
        detail: event.detail ?? {},
      });
      if (error) throw new Error(`document_events insert: ${error.message}`);
    },
  };
}

// --- In-memory fake ----------------------------------------------------------------

export class MemoryDocumentStore implements DocumentStore {
  readonly rows = new Map<string, DocumentRow>();

  constructor(private readonly clock: Clock = systemClock) {}

  async insert(doc: NewDocument): Promise<DocumentRow> {
    for (const r of this.rows.values()) if (r.storage_path === doc.storage_path) throw new Error("duplicate storage_path");
    const row: DocumentRow = {
      id: randomUUID(),
      created_at: this.clock().toISOString(),
      ...doc,
      status: "pending_upload",
      bucket: QUARANTINE_BUCKET,
      size_bytes: null,
      sha256: null,
      detected_mime: null,
      finalized_at: null,
      reject_reason: null,
      scanned_at: null,
      scan_engine: null,
      scan_signature: null,
      scan_attempts: 0,
      scan_error: null,
      scan_lease_until: null,
      legal_hold: false,
    };
    this.rows.set(row.id, row);
    return { ...row };
  }

  /** Test helper: a row that predates the vault migration (default status, vault bucket). */
  seedLegacy(row: Partial<DocumentRow> & Pick<DocumentRow, "lead_id" | "storage_path">): DocumentRow {
    const full: DocumentRow = {
      id: randomUUID(),
      created_at: this.clock().toISOString(),
      kind: "T12",
      file_name: "legacy.pdf",
      content_type: "application/pdf",
      status: "quarantined",
      bucket: "deal-documents",
      declared_size_bytes: null,
      size_bytes: null,
      sha256: null,
      detected_mime: null,
      upload_expires_at: null,
      finalized_at: null,
      reject_reason: null,
      scanned_at: null,
      scan_engine: null,
      scan_signature: null,
      scan_attempts: 0,
      scan_error: null,
      scan_lease_until: null,
      legal_hold: false,
      ...row,
    };
    this.rows.set(full.id, full);
    return { ...full };
  }

  async get(id: string) {
    const r = this.rows.get(id);
    return r ? { ...r } : null;
  }

  async usageForLead(leadId: string): Promise<LeadUsage> {
    let files = 0;
    let bytes = 0;
    for (const r of this.rows.values()) {
      if (r.lead_id !== leadId || !QUOTA_STATUSES.includes(r.status)) continue;
      files++;
      bytes += Number(r.size_bytes ?? r.declared_size_bytes ?? 0);
    }
    return { files, bytes };
  }

  async update(id: string, patch: DocumentPatch, expect?: DocumentStatus | readonly DocumentStatus[]) {
    const r = this.rows.get(id);
    if (!r) return null;
    if (expect && !(Array.isArray(expect) ? expect : [expect]).includes(r.status)) return null;
    Object.assign(r, patch);
    return { ...r };
  }

  async remove(id: string) {
    const r = this.rows.get(id);
    if (!r) return false;
    if (r.legal_hold) throw new Error(`Row documents.${id} is under legal hold`);
    return this.rows.delete(id);
  }

  async claimForScan(limit: number, leaseSeconds: number) {
    const now = this.clock().getTime();
    const out: DocumentRow[] = [];
    const due = [...this.rows.values()]
      .filter((r) => r.status === "quarantined" && (!r.scan_lease_until || new Date(r.scan_lease_until).getTime() < now))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    for (const r of due.slice(0, limit)) {
      r.scan_attempts += 1;
      r.scan_lease_until = new Date(now + leaseSeconds * 1000).toISOString();
      out.push({ ...r });
    }
    return out;
  }

  async listStalePending(cutoff: Date, limit: number) {
    return [...this.rows.values()]
      .filter((r) => r.status === "pending_upload" && new Date(r.created_at).getTime() < cutoff.getTime())
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }

  async listForLead(leadId: string) {
    return [...this.rows.values()].filter((r) => r.lead_id === leadId).map((r) => ({ ...r }));
  }

  async listClean(limit: number, afterId?: string) {
    return [...this.rows.values()]
      .filter((r) => r.status === "clean" && (!afterId || r.id > afterId))
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }
}

export class MemoryEventLog implements DocumentEventLog {
  readonly events: (DocumentEvent & { occurred_at: string })[] = [];
  /** Set to make record() throw (simulates the audit table being unavailable). */
  failWith: string | null = null;

  constructor(private readonly clock: Clock = systemClock) {}

  async record(event: DocumentEvent) {
    if (this.failWith) throw new Error(this.failWith);
    this.events.push({ ...event, occurred_at: this.clock().toISOString() });
  }

  names(): string[] {
    return this.events.map((e) => e.event);
  }
}
