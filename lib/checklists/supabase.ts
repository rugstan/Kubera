// Supabase (service role) implementation of ChecklistStore and the vault
// storage used for portal uploads. Row mappers are exported for tests.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Condition } from "./conditions";
import type { NewChecklistItem } from "./engine";
import type { HmMetrics, HmUnderwriting, HmUnderwritingData } from "./hm-underwriting";
import type { ChecklistObjectStorage } from "./service";
import { ConcurrentUpdateError, DuplicateChecklistError, type ChecklistStore, type ItemUpdate, type NewConditionRow, type NewDealChecklist, type NewFile } from "./store";
import type { ChecklistItemFile, ChecklistProgram, DealChecklist, DealChecklistItem } from "./types";

type Row = Record<string, unknown>;

function fail(what: string, error: { message: string; code?: string }): never {
  throw new Error(`${what}: ${error.message}`);
}

const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export function checklistFromRow(r: Row): DealChecklist {
  return { id: String(r.id), dealId: String(r.deal_id), leadId: str(r.lead_id), program: r.program as ChecklistProgram, templateVersion: String(r.template_version), title: String(r.title), createdAt: String(r.created_at), createdBy: String(r.created_by), closedAt: str(r.closed_at) };
}

const ITEM_COLUMNS: Record<keyof NewChecklistItem, string> = {
  dealId: "deal_id",
  itemKey: "item_key",
  templateKey: "template_key",
  principalId: "principal_id",
  title: "title",
  description: "description",
  category: "category",
  responsible: "responsible",
  stage: "stage",
  required: "required",
  upload: "upload",
  docKind: "doc_kind",
  recencyDays: "recency_days",
  lookup: "lookup",
  status: "status",
  documentDate: "document_date",
  dueDate: "due_date",
  submittedAt: "submitted_at",
  reviewedAt: "reviewed_at",
  reviewedBy: "reviewed_by",
  reviewNote: "review_note",
  waivedReason: "waived_reason",
  verification: "verification",
  sortOrder: "sort_order",
};

export function itemToRow(patch: Partial<NewChecklistItem>): Row {
  const out: Row = {};
  for (const [k, col] of Object.entries(ITEM_COLUMNS)) {
    const v = patch[k as keyof NewChecklistItem];
    if (v !== undefined) out[col] = v;
  }
  return out;
}

export function itemFromRow(r: Row): DealChecklistItem {
  const out: Record<string, unknown> = { id: String(r.id), checklistId: String(r.checklist_id), version: Number(r.version), createdAt: String(r.created_at), updatedAt: String(r.updated_at) };
  for (const [k, col] of Object.entries(ITEM_COLUMNS)) out[k] = r[col] ?? null;
  out.required = r.required === true;
  out.upload = r.upload === true;
  out.recencyDays = num(r.recency_days);
  out.sortOrder = Number(r.sort_order ?? 0);
  return out as DealChecklistItem;
}

export function fileFromRow(r: Row): ChecklistItemFile {
  return { id: String(r.id), itemId: String(r.item_id), dealId: String(r.deal_id), storagePath: String(r.storage_path), fileName: String(r.file_name), contentType: String(r.content_type), sizeBytes: Number(r.size_bytes), status: r.status as ChecklistItemFile["status"], uploadedBy: String(r.uploaded_by), rejectReason: str(r.reject_reason), createdAt: String(r.created_at), uploadedAt: str(r.uploaded_at) };
}

const CONDITION_COLUMNS: Record<string, string> = {
  dealId: "deal_id",
  source: "source",
  lenderName: "lender_name",
  timing: "timing",
  description: "description",
  status: "status",
  responsible: "responsible",
  dueDate: "due_date",
  checklistItemId: "checklist_item_id",
  notes: "notes",
  clearedBy: "cleared_by",
  clearedAt: "cleared_at",
  waiverReason: "waiver_reason",
  waiverEvidence: "waiver_evidence",
  createdBy: "created_by",
};

export function conditionToRow(c: Partial<Condition>): Row {
  const out: Row = {};
  for (const [k, col] of Object.entries(CONDITION_COLUMNS)) {
    const v = (c as Record<string, unknown>)[k];
    if (v !== undefined) out[col] = v;
  }
  return out;
}

export function conditionFromRow(r: Row): Condition {
  const out: Record<string, unknown> = { id: String(r.id), version: Number(r.version), createdAt: String(r.created_at), updatedAt: String(r.updated_at) };
  for (const [k, col] of Object.entries(CONDITION_COLUMNS)) out[k] = r[col] ?? null;
  return out as Condition;
}

export function hmFromRow(r: Row): HmUnderwriting {
  return {
    id: String(r.id),
    dealId: String(r.deal_id),
    strategy: r.strategy as HmUnderwriting["strategy"],
    purpose: r.purpose as HmUnderwriting["purpose"],
    purchasePrice: Number(r.purchase_price),
    asIsValue: Number(r.as_is_value),
    arv: Number(r.arv),
    arvSource: r.arv_source as HmUnderwriting["arvSource"],
    requestedLoanAmount: Number(r.requested_loan_amount),
    contingencyPct: Number(r.contingency_pct),
    scopeOfWork: (r.scope_of_work ?? []) as HmUnderwriting["scopeOfWork"],
    trackRecord: (r.track_record ?? []) as HmUnderwriting["trackRecord"],
    exitPlan: r.exit_plan as HmUnderwriting["exitPlan"],
    notes: (r.notes as string | null) ?? undefined,
    metrics: r.metrics as HmMetrics,
    preparedBy: String(r.prepared_by),
    version: Number(r.version),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function hmToRow(d: HmUnderwritingData, metrics: HmMetrics, preparedBy: string): Row {
  return {
    deal_id: d.dealId,
    strategy: d.strategy,
    purpose: d.purpose,
    purchase_price: d.purchasePrice,
    as_is_value: d.asIsValue,
    arv: d.arv,
    arv_source: d.arvSource,
    requested_loan_amount: d.requestedLoanAmount,
    contingency_pct: d.contingencyPct,
    scope_of_work: d.scopeOfWork,
    track_record: d.trackRecord,
    exit_plan: d.exitPlan,
    notes: d.notes ?? null,
    metrics,
    prepared_by: preparedBy,
  };
}

export function supabaseChecklistStore(db: SupabaseClient): ChecklistStore {
  return {
    async createChecklist(c: NewDealChecklist, items: NewChecklistItem[], now: Date) {
      const { data, error } = await db
        .from("deal_checklists")
        .insert({ deal_id: c.dealId, lead_id: c.leadId ?? null, program: c.program, template_version: c.templateVersion, title: c.title, created_by: c.createdBy, created_at: now.toISOString() })
        .select("*")
        .single();
      if (error) {
        if (error.code === "23505") throw new DuplicateChecklistError(c.program);
        fail("create checklist failed", error);
      }
      const checklist = checklistFromRow(data as Row);
      const rows = await this.insertItems(checklist.id, items, now);
      return { checklist, items: rows };
    },
    async getChecklist(id) {
      const { data, error } = await db.from("deal_checklists").select("*").eq("id", id).maybeSingle();
      if (error) fail("checklist lookup failed", error);
      return data ? checklistFromRow(data as Row) : null;
    },
    async listChecklists(opts = {}) {
      const { data, error } = await db.from("deal_checklists").select("*").order("created_at", { ascending: false }).limit(opts.limit ?? 100);
      if (error) fail("checklist list failed", error);
      return (data ?? []).map((r) => checklistFromRow(r as Row));
    },
    async checklistsForDeal(dealId) {
      const { data, error } = await db.from("deal_checklists").select("*").eq("deal_id", dealId).order("created_at");
      if (error) fail("checklist lookup failed", error);
      return (data ?? []).map((r) => checklistFromRow(r as Row));
    },
    async itemsForDeal(dealId) {
      const { data, error } = await db.from("deal_checklist_items").select("*").eq("deal_id", dealId).order("sort_order").limit(2000);
      if (error) fail("checklist items lookup failed", error);
      return (data ?? []).map((r) => itemFromRow(r as Row));
    },
    async getItem(id) {
      const { data, error } = await db.from("deal_checklist_items").select("*").eq("id", id).maybeSingle();
      if (error) fail("checklist item lookup failed", error);
      return data ? itemFromRow(data as Row) : null;
    },
    async insertItems(checklistId, items, now) {
      if (items.length === 0) return [];
      const ts = now.toISOString();
      const rows = items.map((i) => ({ ...itemToRow(i), checklist_id: checklistId, created_at: ts, updated_at: ts }));
      const { data, error } = await db.from("deal_checklist_items").upsert(rows, { onConflict: "checklist_id,item_key", ignoreDuplicates: true }).select("*");
      if (error) fail("checklist items insert failed", error);
      return (data ?? []).map((r) => itemFromRow(r as Row));
    },
    async updateItem(id, expectedVersion, patch: ItemUpdate, now) {
      const { data, error } = await db
        .from("deal_checklist_items")
        .update({ ...itemToRow(patch), version: expectedVersion + 1, updated_at: now.toISOString() })
        .eq("id", id)
        .eq("version", expectedVersion)
        .select("*")
        .maybeSingle();
      if (error) fail("checklist item update failed", error);
      if (!data) throw new ConcurrentUpdateError("This checklist item");
      return itemFromRow(data as Row);
    },
    async insertFile(f: NewFile, now) {
      const { data, error } = await db
        .from("checklist_item_files")
        .insert({ id: f.id, item_id: f.itemId, deal_id: f.dealId, storage_path: f.storagePath, file_name: f.fileName, content_type: f.contentType, size_bytes: f.sizeBytes, status: f.status, uploaded_by: f.uploadedBy, created_at: now.toISOString() })
        .select("*")
        .single();
      if (error) fail("file insert failed", error);
      return fileFromRow(data as Row);
    },
    async getFile(id) {
      const { data, error } = await db.from("checklist_item_files").select("*").eq("id", id).maybeSingle();
      if (error) fail("file lookup failed", error);
      return data ? fileFromRow(data as Row) : null;
    },
    async updateFile(id, patch) {
      const row: Row = {};
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.rejectReason !== undefined) row.reject_reason = patch.rejectReason;
      if (patch.uploadedAt !== undefined) row.uploaded_at = patch.uploadedAt;
      if (patch.sizeBytes !== undefined) row.size_bytes = patch.sizeBytes;
      if (patch.contentType !== undefined) row.content_type = patch.contentType;
      const { data, error } = await db.from("checklist_item_files").update(row).eq("id", id).select("*").single();
      if (error) fail("file update failed", error);
      return fileFromRow(data as Row);
    },
    async filesForDeal(dealId) {
      const { data, error } = await db.from("checklist_item_files").select("*").eq("deal_id", dealId).order("created_at").limit(2000);
      if (error) fail("file list failed", error);
      return (data ?? []).map((r) => fileFromRow(r as Row));
    },
    async countFiles(itemId) {
      const { count, error } = await db.from("checklist_item_files").select("id", { count: "exact", head: true }).eq("item_id", itemId).neq("status", "rejected");
      if (error) fail("file count failed", error);
      return count ?? 0;
    },
    async insertCondition(row: NewConditionRow, now) {
      const ts = now.toISOString();
      const { data, error } = await db
        .from("conditions")
        .insert({ ...conditionToRow({ ...row, status: row.status ?? "open" } as Partial<Condition>), created_at: ts, updated_at: ts })
        .select("*")
        .single();
      if (error) fail("condition insert failed", error);
      return conditionFromRow(data as Row);
    },
    async getCondition(id) {
      const { data, error } = await db.from("conditions").select("*").eq("id", id).maybeSingle();
      if (error) fail("condition lookup failed", error);
      return data ? conditionFromRow(data as Row) : null;
    },
    async conditionsForDeal(dealId) {
      const { data, error } = await db.from("conditions").select("*").eq("deal_id", dealId).order("created_at").limit(1000);
      if (error) fail("condition list failed", error);
      return (data ?? []).map((r) => conditionFromRow(r as Row));
    },
    async updateCondition(id, expectedVersion, patch, now) {
      const { data, error } = await db
        .from("conditions")
        .update({ ...conditionToRow(patch as Partial<Condition>), version: expectedVersion + 1, updated_at: now.toISOString() })
        .eq("id", id)
        .eq("version", expectedVersion)
        .select("*")
        .maybeSingle();
      if (error) fail("condition update failed", error);
      if (!data) throw new ConcurrentUpdateError("This condition");
      return conditionFromRow(data as Row);
    },
    async getHmUnderwriting(dealId) {
      const { data, error } = await db.from("hm_underwriting").select("*").eq("deal_id", dealId).maybeSingle();
      if (error) fail("hard money file lookup failed", error);
      return data ? hmFromRow(data as Row) : null;
    },
    async saveHmUnderwriting(d, metrics, preparedBy, expectedVersion, now) {
      const row = hmToRow(d, metrics, preparedBy);
      const ts = now.toISOString();
      if (expectedVersion === null) {
        const { data, error } = await db.from("hm_underwriting").insert({ ...row, created_at: ts, updated_at: ts }).select("*").single();
        if (error) {
          if (error.code === "23505") throw new ConcurrentUpdateError("The hard money file");
          fail("hard money file insert failed", error);
        }
        return hmFromRow(data as Row);
      }
      const { data, error } = await db.from("hm_underwriting").update({ ...row, version: expectedVersion + 1, updated_at: ts }).eq("deal_id", d.dealId).eq("version", expectedVersion).select("*").maybeSingle();
      if (error) fail("hard money file update failed", error);
      if (!data) throw new ConcurrentUpdateError("The hard money file");
      return hmFromRow(data as Row);
    },
  };
}

/** Vault access for checklist uploads (private bucket; signed URLs only). */
export function supabaseChecklistStorage(db: SupabaseClient, bucket: string, fetchImpl: typeof fetch = fetch): ChecklistObjectStorage {
  return {
    async createSignedUploadUrl(path) {
      const { data, error } = await db.storage.from(bucket).createSignedUploadUrl(path);
      if (error || !data) fail("signed upload URL failed", error ?? { message: "no data" });
      return { url: data.signedUrl, token: data.token };
    },
    async readHead(path, bytes) {
      const { data, error } = await db.storage.from(bucket).createSignedUrl(path, 60);
      if (error || !data) return null;
      const res = await fetchImpl(data.signedUrl, { headers: { range: `bytes=0-${bytes - 1}` }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok || !res.body) return null;
      // Read only what we need, even if the server ignored the range.
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (size < bytes) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.byteLength;
      }
      await reader.cancel().catch(() => {});
      const out = new Uint8Array(Math.min(size, bytes));
      let offset = 0;
      for (const c of chunks) {
        const take = Math.min(c.byteLength, out.length - offset);
        out.set(c.subarray(0, take), offset);
        offset += take;
        if (offset >= out.length) break;
      }
      return out;
    },
    async remove(path) {
      const { error } = await db.storage.from(bucket).remove([path]);
      if (error) fail("storage delete failed", error);
    },
  };
}
