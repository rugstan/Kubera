// Persistence for document extractions, their audit events and construction
// budgets. Supabase (service role) in production, in-memory fakes in tests.
// Updates are compare-and-set on status so two reviewers (or a reviewer and a
// re-run) cannot both win.

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptJson, encryptJson, isEncrypted, piiKeyring, type PiiKeyring } from "@/lib/privacy/crypto";
import type { BudgetCategory } from "./specs";
import { systemClock, type Clock, type DocType, type ExtractedField, type ExtractedRow, type ExtractionStatus, type SourceFormat } from "./types";

export type StoredFields = { scalars: Record<string, ExtractedField>; rows: ExtractedRow[] };

export type ExtractionRecord = {
  id: string;
  created_at: string;
  updated_at: string;
  source_type: "vault_document" | "mail_attachment" | "manual";
  document_id: string | null;
  mail_message_id: string | null;
  attachment_name: string | null;
  lead_id: string | null;
  deal_id: string | null;
  doc_type: DocType | null;
  source_format: SourceFormat;
  source_sha256: string | null;
  status: ExtractionStatus;
  engine: string;
  model: string | null;
  prompt_version: string | null;
  fields: StoredFields;
  row_count: number;
  overall_confidence: number | null;
  low_confidence_fields: string[];
  warnings: string[];
  error: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  superseded_by: string | null;
};

export type NewExtraction = Omit<ExtractionRecord, "id" | "created_at" | "updated_at" | "reviewed_by" | "reviewed_at" | "review_notes" | "superseded_by">;
export type ExtractionPatch = Partial<
  Pick<ExtractionRecord, "status" | "fields" | "row_count" | "overall_confidence" | "low_confidence_fields" | "warnings" | "reviewed_by" | "reviewed_at" | "review_notes" | "superseded_by" | "deal_id">
>;

export type LiveKey = { documentId?: string; mailMessageId?: string; attachmentName?: string; docType: DocType };

export interface ExtractionStore {
  insert(row: NewExtraction): Promise<ExtractionRecord>;
  get(id: string): Promise<ExtractionRecord | null>;
  /** Applies the patch only while the row is in one of `expect`; null when it is not. */
  update(id: string, patch: ExtractionPatch, expect?: readonly ExtractionStatus[]): Promise<ExtractionRecord | null>;
  /** The live (not superseded, failed or rejected) extraction for a document or attachment and type. */
  findLive(key: LiveKey): Promise<ExtractionRecord | null>;
  listByStatus(status: ExtractionStatus, limit: number): Promise<ExtractionRecord[]>;
  listForDeal(dealId: string): Promise<ExtractionRecord[]>;
  listForLead(leadId: string): Promise<ExtractionRecord[]>;
  /** False when restricted (PFS) fields cannot be stored encrypted (no PII_ENCRYPTION_KEY); absent = accepts. */
  acceptsRestricted?(): boolean;
}

export const EXTRACTION_EVENT_TYPES = ["extracted", "queued_for_review", "corrected", "approved", "rejected", "superseded", "failed", "routing_refused"] as const;
export type ExtractionEventType = (typeof EXTRACTION_EVENT_TYPES)[number];

/** Detail carries field names and reason codes only, never values. */
export type ExtractionEvent = { extraction_id: string; event_type: ExtractionEventType; actor: string; detail?: Record<string, string | number | boolean | string[] | null> };

export interface ExtractionEventLog {
  record(event: ExtractionEvent): Promise<void>;
}

export type BudgetLine = { description: string; category: BudgetCategory; amount: number; confidence: number };

export type ConstructionBudgetRecord = {
  extraction_id: string;
  deal_id: string | null;
  lead_id: string | null;
  budget_kind: "ground_up" | "renovation" | "pip";
  status: "extracted" | "needs_review" | "approved" | "rejected" | "superseded";
  land_cost: number | null;
  hard_costs: number | null;
  soft_costs: number | null;
  contingency: number | null;
  developer_fee: number | null;
  financing_costs: number | null;
  total_cost: number | null;
  contingency_pct_of_hard: number | null;
  gmp_contract: boolean | null;
  line_items: BudgetLine[];
};

export interface ConstructionBudgetStore {
  upsert(row: ConstructionBudgetRecord): Promise<void>;
  setStatus(extractionId: string, status: ConstructionBudgetRecord["status"]): Promise<void>;
  get(extractionId: string): Promise<ConstructionBudgetRecord | null>;
}

// --- Restricted fields (PFS) ---------------------------------------------------------------
//
// A personal financial statement (doc_type = 'PFS') is restricted personal
// information (lib/privacy/classification.ts), as is anything whose type was
// inferred rather than declared (it could be a PFS; pipeline.ts treats it the
// same way). Its extracted fields, evidence snippets included, are sealed with
// AES-256-GCM (lib/privacy/crypto.ts) bound to the extraction id before they
// reach the database, and opened on read for the review queue and spreads.
// Without PII_ENCRYPTION_KEY a restricted extraction is refused, never stored
// in plaintext (as lib/principals/crypto-fields.ts does for principals.pfs).

export const extractionFieldsContext = (id: string) => `document_extractions:${id}.fields`;
/** Warning added on read when sealed fields cannot be opened (key missing or wrong). */
export const RESTRICTED_FIELDS_UNAVAILABLE = "restricted_fields_unavailable";

export class RestrictedExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RestrictedExtractionError";
  }
}

export function isRestrictedExtraction(r: { doc_type: DocType | null; warnings: readonly string[] }): boolean {
  return r.doc_type === "PFS" || r.warnings.includes("doc_type_inferred");
}

type SealedFields = { sealed: string };

export function isSealedFields(v: unknown): v is SealedFields {
  return !!v && typeof v === "object" && !Array.isArray(v) && isEncrypted((v as { sealed?: unknown }).sealed);
}

const hasContent = (f: StoredFields | undefined) => !!f && (Object.keys(f.scalars ?? {}).length > 0 || (f.rows ?? []).length > 0);

/** Seals extracted fields (values and evidence) for the row `id`. Throws without a key. */
export function sealExtractionFields(id: string, fields: StoredFields, keyring: PiiKeyring | null | undefined = piiKeyring()): SealedFields {
  if (!keyring) throw new RestrictedExtractionError("PII_ENCRYPTION_KEY is not configured; refusing to store a personal financial statement extraction unencrypted");
  return { sealed: encryptJson(fields, { context: extractionFieldsContext(id), keyring }) };
}

/** Opens stored fields; plaintext rows pass through. `unavailable` when sealed fields cannot be opened. */
export function openExtractionFields(id: string, stored: unknown, keyring: PiiKeyring | null | undefined = piiKeyring()): { fields: StoredFields; unavailable: boolean } {
  if (!isSealedFields(stored)) return { fields: (stored ?? { scalars: {}, rows: [] }) as StoredFields, unavailable: false };
  try {
    if (!keyring) throw new Error("no key");
    return { fields: decryptJson<StoredFields>(stored.sealed, { context: extractionFieldsContext(id), keyring }), unavailable: false };
  } catch {
    return { fields: { scalars: {}, rows: [] }, unavailable: true };
  }
}

// --- Supabase ----------------------------------------------------------------------------

const fail = (op: string, error: { message: string }): never => {
  throw new Error(`document_extractions.${op}: ${error.message}`);
};

function fromDb(row: Record<string, unknown>, keyring: PiiKeyring | null | undefined): ExtractionRecord {
  const r = row as unknown as ExtractionRecord;
  const opened = openExtractionFields(r.id, row.fields, keyring);
  return {
    ...r,
    fields: opened.fields,
    warnings: opened.unavailable ? [...(r.warnings ?? []), RESTRICTED_FIELDS_UNAVAILABLE] : r.warnings,
    overall_confidence: row.overall_confidence === null || row.overall_confidence === undefined ? null : Number(row.overall_confidence),
  };
}

export function supabaseExtractionStore(db: SupabaseClient, opts: { keyring?: PiiKeyring | null } = {}): ExtractionStore {
  const live = ["superseded", "failed", "rejected"];
  const keyring = () => (opts.keyring !== undefined ? opts.keyring : piiKeyring());
  const open = (row: Record<string, unknown>) => fromDb(row, keyring());
  return {
    acceptsRestricted: () => keyring() !== null,
    async insert(row) {
      let toInsert: Record<string, unknown> = { ...row };
      if (isRestrictedExtraction(row) && hasContent(row.fields)) {
        // The id is chosen here so the ciphertext can be bound to it.
        const id = randomUUID();
        toInsert = { ...row, id, fields: sealExtractionFields(id, row.fields, keyring()) };
      }
      const { data, error } = await db.from("document_extractions").insert(toInsert).select("*").single();
      if (error || !data) return fail("insert", error ?? { message: "no row returned" });
      return open(data);
    },
    async get(id) {
      const { data, error } = await db.from("document_extractions").select("*").eq("id", id).maybeSingle();
      if (error) return fail("get", error);
      return data ? open(data) : null;
    },
    async update(id, patch, expect) {
      let toWrite: Record<string, unknown> = { ...patch };
      if (patch.fields) {
        const { data: current, error: readError } = await db.from("document_extractions").select("doc_type, warnings, fields").eq("id", id).maybeSingle();
        if (readError) return fail("update", readError);
        if (!current) return null;
        const c = current as { doc_type: DocType | null; warnings: string[] | null; fields: unknown };
        const restricted = isRestrictedExtraction({ doc_type: c.doc_type, warnings: patch.warnings ?? c.warnings ?? [] }) || isSealedFields(c.fields);
        if (restricted && hasContent(patch.fields)) toWrite = { ...patch, fields: sealExtractionFields(id, patch.fields, keyring()) };
      }
      // Never persist the read-side marker.
      if (patch.warnings) toWrite.warnings = patch.warnings.filter((w) => w !== RESTRICTED_FIELDS_UNAVAILABLE);
      let q = db.from("document_extractions").update(toWrite).eq("id", id);
      if (expect) q = q.in("status", [...expect]);
      const { data, error } = await q.select("*").maybeSingle();
      if (error) return fail("update", error);
      return data ? open(data) : null;
    },
    async findLive(key) {
      let q = db.from("document_extractions").select("*").eq("doc_type", key.docType).not("status", "in", `(${live.join(",")})`);
      if (key.documentId) q = q.eq("document_id", key.documentId);
      else if (key.mailMessageId) q = q.eq("mail_message_id", key.mailMessageId).eq("attachment_name", key.attachmentName ?? "");
      else return null;
      const { data, error } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) return fail("findLive", error);
      return data ? open(data) : null;
    },
    async listByStatus(status, limit) {
      const { data, error } = await db.from("document_extractions").select("*").eq("status", status).order("created_at").limit(limit);
      if (error) return fail("listByStatus", error);
      return (data ?? []).map(open);
    },
    async listForDeal(dealId) {
      const { data, error } = await db.from("document_extractions").select("*").eq("deal_id", dealId).order("created_at", { ascending: false }).limit(500);
      if (error) return fail("listForDeal", error);
      return (data ?? []).map(open);
    },
    async listForLead(leadId) {
      const { data, error } = await db.from("document_extractions").select("*").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(500);
      if (error) return fail("listForLead", error);
      return (data ?? []).map(open);
    },
  };
}

export function supabaseExtractionEventLog(db: SupabaseClient): ExtractionEventLog {
  return {
    async record(event) {
      const { error } = await db.from("document_extraction_events").insert({
        extraction_id: event.extraction_id,
        event_type: event.event_type,
        actor: event.actor.slice(0, 200) || "system",
        detail: event.detail ?? {},
      });
      if (error) throw new Error(`document_extraction_events insert: ${error.message}`);
    },
  };
}

export function supabaseConstructionBudgetStore(db: SupabaseClient): ConstructionBudgetStore {
  return {
    async upsert(row) {
      const { error } = await db.from("construction_budgets").upsert(row, { onConflict: "extraction_id" });
      if (error) throw new Error(`construction_budgets upsert: ${error.message}`);
    },
    async setStatus(extractionId, status) {
      const { error } = await db.from("construction_budgets").update({ status }).eq("extraction_id", extractionId);
      if (error) throw new Error(`construction_budgets update: ${error.message}`);
    },
    async get(extractionId) {
      const { data, error } = await db.from("construction_budgets").select("*").eq("extraction_id", extractionId).maybeSingle();
      if (error) throw new Error(`construction_budgets get: ${error.message}`);
      return (data as ConstructionBudgetRecord | null) ?? null;
    },
  };
}

// --- In-memory fakes ---------------------------------------------------------------------

const clone = <T>(v: T): T => structuredClone(v);

export class MemoryExtractionStore implements ExtractionStore {
  readonly rows = new Map<string, ExtractionRecord>();
  constructor(private readonly clock: Clock = systemClock) {}

  private isLive(r: ExtractionRecord) {
    return !["superseded", "failed", "rejected"].includes(r.status);
  }

  async insert(row: NewExtraction): Promise<ExtractionRecord> {
    if (row.doc_type && this.isLive(row as ExtractionRecord)) {
      for (const r of this.rows.values()) {
        if (!this.isLive(r) || r.doc_type !== row.doc_type) continue;
        if (row.document_id && r.document_id === row.document_id) throw new Error("duplicate key value violates unique constraint document_extractions_live_document");
        if (row.mail_message_id && r.mail_message_id === row.mail_message_id && r.attachment_name === row.attachment_name)
          throw new Error("duplicate key value violates unique constraint document_extractions_live_attachment");
      }
    }
    const now = this.clock().toISOString();
    const rec: ExtractionRecord = { ...clone(row), id: randomUUID(), created_at: now, updated_at: now, reviewed_by: null, reviewed_at: null, review_notes: null, superseded_by: null };
    this.rows.set(rec.id, rec);
    return clone(rec);
  }
  async get(id: string) {
    const r = this.rows.get(id);
    return r ? clone(r) : null;
  }
  async update(id: string, patch: ExtractionPatch, expect?: readonly ExtractionStatus[]) {
    const r = this.rows.get(id);
    if (!r || (expect && !expect.includes(r.status))) return null;
    Object.assign(r, clone(patch), { updated_at: this.clock().toISOString() });
    return clone(r);
  }
  async findLive(key: LiveKey) {
    const hits = [...this.rows.values()].filter(
      (r) =>
        this.isLive(r) &&
        r.doc_type === key.docType &&
        ((key.documentId && r.document_id === key.documentId) || (key.mailMessageId && r.mail_message_id === key.mailMessageId && r.attachment_name === (key.attachmentName ?? null))),
    );
    return hits.length ? clone(hits[hits.length - 1]!) : null;
  }
  async listByStatus(status: ExtractionStatus, limit: number) {
    return [...this.rows.values()].filter((r) => r.status === status).slice(0, limit).map(clone);
  }
  async listForDeal(dealId: string) {
    return [...this.rows.values()].filter((r) => r.deal_id === dealId).reverse().map(clone);
  }
  async listForLead(leadId: string) {
    return [...this.rows.values()].filter((r) => r.lead_id === leadId).reverse().map(clone);
  }
}

export class MemoryExtractionEventLog implements ExtractionEventLog {
  readonly events: ExtractionEvent[] = [];
  async record(event: ExtractionEvent) {
    this.events.push(clone(event));
  }
}

export class MemoryConstructionBudgetStore implements ConstructionBudgetStore {
  readonly rows = new Map<string, ConstructionBudgetRecord>();
  async upsert(row: ConstructionBudgetRecord) {
    this.rows.set(row.extraction_id, clone(row));
  }
  async setStatus(extractionId: string, status: ConstructionBudgetRecord["status"]) {
    const r = this.rows.get(extractionId);
    if (r) r.status = status;
  }
  async get(extractionId: string) {
    const r = this.rows.get(extractionId);
    return r ? clone(r) : null;
  }
}
