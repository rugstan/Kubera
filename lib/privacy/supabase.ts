// Supabase (service role) implementations of the privacy stores. Tests use
// MemoryPrivacyDb (./fake.ts), which models the same tables.

import type { SupabaseClient } from "@supabase/supabase-js";
import { EXPORT_COLUMNS, type ExportRecord, type SubjectDataSource } from "./export";
import type { LegalHoldDb } from "./legal-hold";
import type { NewPrivacyRequest, PrivacyPreferences, PrivacyRequestRow, PrivacyRequestStore } from "./requests";
import { normalizeEmail } from "./requests";
import type { DeleteResult, Filter, RetentionDb, RetentionSummary, RowId } from "./retention";

/**
 * ILIKE pattern that matches `value` exactly, ignoring case. LIKE wildcards are
 * escaped; PostgREST also treats `*` as `%`, so it becomes a one-character
 * wildcard and callers re-check the match in code.
 */
export function exactIlikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/\*/g, "_");
}

const sameEmail = (a: unknown, b: string) => typeof a === "string" && normalizeEmail(a) === normalizeEmail(b);

function dedupeById(rows: ExportRecord[]): ExportRecord[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = String(r.id);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function fail(what: string, error: { message: string }): never {
  throw new Error(`${what}: ${error.message}`);
}

export function supabaseRetentionDb(db: SupabaseClient): RetentionDb {
  return {
    async selectExpired(q) {
      let query = db.from(q.table).select("id").lt(q.dateColumn, q.before);
      for (const f of q.filters as Filter[]) {
        if (f.op === "is_null") query = query.is(f.column, null);
        else if (f.op === "not_null") query = query.not(f.column, "is", null);
        else if (f.op === "eq") query = query.eq(f.column, f.value);
        else if (f.op === "in") query = query.in(f.column, [...f.value]);
      }
      if (q.excludeHeld) query = query.eq("legal_hold", false);
      const { data, error } = await query.order(q.dateColumn, { ascending: true }).limit(q.limit);
      if (error) fail(`${q.table} retention scan failed`, error);
      return (data ?? []).map((r) => (r as { id: RowId }).id);
    },
    async selectRows(q) {
      if (q.values.length === 0) return [];
      const { data, error } = await db.from(q.table).select(q.columns.join(",")).in(q.column, [...q.values]);
      if (error) fail(`${q.table} select failed`, error);
      return (data ?? []) as unknown as Record<string, unknown>[];
    },
    async selectByValue(q) {
      if (!q.value) return [];
      const cols = [...new Set([...q.columns, q.column])].join(",");
      const base = db.from(q.table).select(cols);
      const { data, error } = await (q.caseInsensitive ? base.ilike(q.column, exactIlikePattern(q.value)) : base.eq(q.column, q.value)).limit(q.limit);
      if (error) fail(`${q.table} lookup failed`, error);
      const rows = (data ?? []) as unknown as Record<string, unknown>[];
      // ILIKE treats `*` as a one-character wildcard (see exactIlikePattern): re-check the match.
      return q.caseInsensitive ? rows.filter((r) => typeof r[q.column] === "string" && (r[q.column] as string).toLowerCase() === q.value.toLowerCase()) : rows;
    },
    async deleteRows(table, ids) {
      const out: DeleteResult = { deleted: [], failed: [] };
      if (ids.length === 0) return out;
      const batch = await db.from(table).delete().in("id", [...ids]);
      if (!batch.error) return { deleted: [...ids], failed: [] };
      // One bad row (legal hold, FK restrict) fails the statement; retry row by row.
      for (const id of ids) {
        const { error } = await db.from(table).delete().eq("id", id);
        if (error) out.failed.push({ id, error: error.message });
        else out.deleted.push(id);
      }
      return out;
    },
    async findSubject(table, email) {
      const e = normalizeEmail(email);
      const column = table === "leads" ? "contact->>email" : "email";
      const cols = table === "leads" ? "id, legal_hold, contact" : "id, legal_hold, email";
      const { data, error } = await db.from(table).select(cols).ilike(column, exactIlikePattern(e)).limit(500);
      if (error) fail(`${table} subject lookup failed`, error);
      return ((data ?? []) as unknown as { id: RowId; legal_hold: boolean; email?: string; contact?: { email?: string } }[])
        .filter((r) => sameEmail(table === "leads" ? r.contact?.email : r.email, e))
        .map((r) => ({ id: r.id, legal_hold: r.legal_hold === true }));
    },
  };
}

export function supabaseSubjectSource(db: SupabaseClient): SubjectDataSource {
  const cols = (t: keyof typeof EXPORT_COLUMNS) => EXPORT_COLUMNS[t].join(", ");
  return {
    async leads(email) {
      const { data, error } = await db.from("leads").select(cols("leads")).ilike("contact->>email", exactIlikePattern(email)).limit(500);
      if (error) fail("leads export failed", error);
      return ((data ?? []) as unknown as ExportRecord[]).filter((r) => sameEmail((r.contact as { email?: string } | null)?.email, email));
    },
    async partners(email) {
      const { data, error } = await db.from("partners").select(cols("partners")).ilike("email", exactIlikePattern(email)).limit(500);
      if (error) fail("partners export failed", error);
      return ((data ?? []) as unknown as ExportRecord[]).filter((r) => sameEmail(r.email, email));
    },
    async consentEvents(email) {
      const { data, error } = await db.from("consent_events").select(cols("consent_events")).ilike("email", exactIlikePattern(email)).limit(1000);
      if (error) fail("consent export failed", error);
      return ((data ?? []) as unknown as ExportRecord[]).filter((r) => sameEmail(r.email, email));
    },
    async conversationsForLeads(leadIds) {
      const { data, error } = await db.from("ai_conversations").select(cols("ai_conversations")).in("lead_id", [...leadIds]);
      if (error) fail("conversation export failed", error);
      return (data ?? []) as unknown as ExportRecord[];
    },
    async documentsForLeads(leadIds) {
      const { data, error } = await db.from("documents").select(cols("documents")).in("lead_id", [...leadIds]);
      if (error) fail("document export failed", error);
      return (data ?? []) as unknown as ExportRecord[];
    },
    async privacyRequests(email) {
      const { data, error } = await db.from("privacy_requests").select(cols("privacy_requests")).eq("subject_email", normalizeEmail(email));
      if (error) fail("privacy request export failed", error);
      return (data ?? []) as unknown as ExportRecord[];
    },
    async preferences(email) {
      const { data, error } = await db.from("privacy_preferences").select(cols("privacy_preferences")).eq("subject_email", normalizeEmail(email)).maybeSingle();
      if (error) fail("preferences export failed", error);
      return (data as ExportRecord | null) ?? null;
    },
    async mailFrom(email) {
      const { data, error } = await db.from("mail_messages").select(cols("mail_messages")).ilike("from_address", exactIlikePattern(email)).order("received_at").limit(2000);
      if (error) fail("mail export failed", error);
      return ((data ?? []) as unknown as ExportRecord[]).filter((r) => sameEmail(r.from_address, email));
    },
    async smsForPhones(phones) {
      const list = [...phones];
      const [from, to] = await Promise.all([
        db.from("sms_messages").select(cols("sms_messages")).in("from_number", list).limit(2000),
        db.from("sms_messages").select(cols("sms_messages")).in("to_number", list).limit(2000),
      ]);
      if (from.error) fail("text export failed", from.error);
      if (to.error) fail("text export failed", to.error);
      return dedupeById([...((from.data ?? []) as unknown as ExportRecord[]), ...((to.data ?? []) as unknown as ExportRecord[])]);
    },
    async notificationsFor(q) {
      const queries = [db.from("notifications").select(cols("notifications")).ilike("recipient", exactIlikePattern(q.email)).limit(2000)];
      if (q.phones.length) queries.push(db.from("notifications").select(cols("notifications")).in("recipient", [...q.phones]).limit(2000));
      if (q.leadIds.length) queries.push(db.from("notifications").select(cols("notifications")).in("lead_id", [...q.leadIds]).limit(2000));
      const results = await Promise.all(queries);
      const rows: ExportRecord[] = [];
      for (const [i, r] of results.entries()) {
        if (r.error) fail("notification export failed", r.error);
        const list = (r.data ?? []) as unknown as ExportRecord[];
        // The email query is ILIKE: keep exact matches only.
        rows.push(...(i === 0 ? list.filter((n) => sameEmail(n.recipient, q.email)) : list));
      }
      return dedupeById(rows);
    },
    async newsletter(email) {
      const { data, error } = await db.from("newsletter_subscribers").select(cols("newsletter_subscribers")).eq("email", normalizeEmail(email));
      if (error) fail("newsletter export failed", error);
      return (data ?? []) as unknown as ExportRecord[];
    },
    async lenderContacts(email) {
      // Not cols(): lender_name is the joined lender's name, not a column.
      const { data, error } = await db
        .from("lender_contacts")
        .select("id, created_at, full_name, title, role, email, phone_direct, phone_ext, phone_mobile, territory, notes, status, left_at, source, lender:lender_panel(name)")
        .ilike("email", exactIlikePattern(email))
        .limit(500);
      if (error) fail("lender contacts export failed", error);
      return ((data ?? []) as unknown as (ExportRecord & { lender?: { name?: unknown } | { name?: unknown }[] | null })[])
        .filter((r) => sameEmail(r.email, email))
        .map(({ lender, ...r }) => ({ ...r, lender_name: (Array.isArray(lender) ? lender[0]?.name : lender?.name) ?? null }));
    },
  };
}

export function supabasePrivacyRequestStore(db: SupabaseClient): PrivacyRequestStore {
  const store: PrivacyRequestStore = {
    async insert(row: NewPrivacyRequest) {
      const { data, error } = await db.from("privacy_requests").upsert(row, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("*");
      if (error) fail("privacy request insert failed", error);
      if (data && data.length > 0) return { row: data[0] as PrivacyRequestRow, duplicate: false };
      const existing = await db.from("privacy_requests").select("*").eq("dedupe_key", row.dedupe_key).single();
      if (existing.error) fail("privacy request lookup failed", existing.error);
      return { row: existing.data as PrivacyRequestRow, duplicate: true };
    },
    async get(id) {
      const { data, error } = await db.from("privacy_requests").select("*").eq("id", id).maybeSingle();
      if (error) fail("privacy request read failed", error);
      return (data as PrivacyRequestRow | null) ?? null;
    },
    async update(id, patch) {
      const { error } = await db.from("privacy_requests").update(patch).eq("id", id);
      if (error) fail("privacy request update failed", error);
    },
    async listByStatus(type, status, limit) {
      const { data, error } = await db.from("privacy_requests").select("*").eq("request_type", type).eq("status", status).order("created_at", { ascending: true }).limit(limit);
      if (error) fail("privacy request queue read failed", error);
      return (data ?? []) as PrivacyRequestRow[];
    },
    async getPreferences(email) {
      const { data, error } = await db.from("privacy_preferences").select("*").eq("subject_email", normalizeEmail(email)).maybeSingle();
      if (error) fail("preference read failed", error);
      return (data as PrivacyPreferences | null) ?? null;
    },
    async upsertPreferences(email, prefs, sourceRequestId) {
      const key = normalizeEmail(email);
      const current = await store.getPreferences(key);
      // Opt-outs only accumulate here; clearing one is a staff action.
      const next: PrivacyPreferences = {
        subject_email: key,
        human_review_only: Boolean(current?.human_review_only || prefs.human_review_only),
        ai_processing_opt_out: Boolean(current?.ai_processing_opt_out || prefs.ai_processing_opt_out),
        opt_out_sale_share: Boolean(current?.opt_out_sale_share || prefs.opt_out_sale_share),
        source_request_id: sourceRequestId ?? current?.source_request_id ?? null,
      };
      const { error } = await db.from("privacy_preferences").upsert(next, { onConflict: "subject_email" });
      if (error) fail("preference upsert failed", error);
      return next;
    },
  };
  return store;
}

export function supabaseLegalHoldDb(db: SupabaseClient): LegalHoldDb {
  return {
    async setLegalHold(table, id, patch) {
      const { data, error } = await db.from(table).update(patch).eq("id", id).select("id");
      if (error) fail(`${table} legal hold update failed`, error);
      return (data ?? []).length > 0;
    },
  };
}

/** Email on file for a lead (for lead-token verification of privacy requests). */
export function supabaseLeadEmail(db: SupabaseClient): (leadId: string) => Promise<string | null> {
  return async (leadId) => {
    const { data, error } = await db.from("leads").select("contact").eq("id", leadId).maybeSingle();
    if (error || !data) return null;
    const email = (data as { contact?: { email?: unknown } }).contact?.email;
    return typeof email === "string" ? email : null;
  };
}

export async function logRetentionRun(db: SupabaseClient, summary: RetentionSummary, error?: string): Promise<void> {
  const { error: insertError } = await db.from("retention_runs").insert({
    started_at: summary.startedAt,
    finished_at: summary.finishedAt,
    dry_run: summary.dryRun,
    ok: summary.ok && !error,
    summary,
    error: error?.slice(0, 2000) ?? null,
  });
  if (insertError) console.error("retention run log failed", insertError.message);
}
