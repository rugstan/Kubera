// In-memory stand-in for the privacy-related Postgres tables, used by tests.
// It models what the engine relies on: foreign-key actions (cascade, set
// null, restrict) and the legal-hold delete trigger, so a test that passes
// here exercises the same refusal paths the database enforces.

import { randomUUID } from "node:crypto";
import type { ExportRecord, SubjectDataSource } from "./export";
import { LEGAL_HOLD_TABLES, type LegalHoldDb, type LegalHoldPatch, type LegalHoldTable } from "./legal-hold";
import type { NewPrivacyRequest, PrivacyPreferences, PrivacyRequestPatch, PrivacyRequestRow, PrivacyRequestStatus, PrivacyRequestStore, PrivacyRequestType } from "./requests";
import type { DeleteResult, Filter, RetentionDb, RowId } from "./retention";

type Row = Record<string, unknown> & { id: RowId };

type Relation = { child: string; column: string; parent: string; onDelete: "cascade" | "set null" | "restrict" };

// Mirrors the foreign keys in supabase/migrations.
const RELATIONS: readonly Relation[] = [
  { child: "documents", column: "lead_id", parent: "leads", onDelete: "cascade" },
  { child: "ai_conversations", column: "lead_id", parent: "leads", onDelete: "set null" },
  { child: "consent_events", column: "lead_id", parent: "leads", onDelete: "set null" },
  { child: "consent_events", column: "partner_id", parent: "partners", onDelete: "set null" },
  { child: "disclosures", column: "lead_id", parent: "leads", onDelete: "restrict" },
  { child: "broker_of_record", column: "lead_id", parent: "leads", onDelete: "restrict" },
  { child: "privacy_requests", column: "lead_id", parent: "leads", onDelete: "set null" },
  { child: "mail_messages", column: "lead_id", parent: "leads", onDelete: "set null" },
  { child: "sms_messages", column: "lead_id", parent: "leads", onDelete: "set null" },
  { child: "notifications", column: "lead_id", parent: "leads", onDelete: "set null" },
  { child: "sms_messages", column: "notification_id", parent: "notifications", onDelete: "set null" },
];

const HOLD_TABLES: ReadonlySet<string> = new Set<string>(LEGAL_HOLD_TABLES);

class DeleteRefused extends Error {}

export class MemoryPrivacyDb implements RetentionDb, SubjectDataSource, PrivacyRequestStore, LegalHoldDb {
  readonly tables = new Map<string, Row[]>();
  readonly prefs = new Map<string, PrivacyPreferences>();
  private seq = 0;

  rows(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table)!;
  }

  insertRow(table: string, row: Record<string, unknown>): Row {
    const full: Row = { id: (row.id as RowId | undefined) ?? (table === "crm_events" || table === "retention_runs" ? ++this.seq : randomUUID()), ...row } as Row;
    if (HOLD_TABLES.has(table) && full.legal_hold === undefined) full.legal_hold = false;
    this.rows(table).push(full);
    return full;
  }

  find(table: string, id: RowId): Row | undefined {
    return this.rows(table).find((r) => r.id === id);
  }

  // --- RetentionDb ----------------------------------------------------------

  async selectExpired(q: { table: string; dateColumn: string; before: string; filters: readonly Filter[]; excludeHeld: boolean; limit: number }): Promise<RowId[]> {
    const before = Date.parse(q.before);
    return this.rows(q.table)
      .filter((r) => {
        const d = r[q.dateColumn];
        if (typeof d !== "string" || !(Date.parse(d) < before)) return false;
        if (q.excludeHeld && r.legal_hold === true) return false;
        return q.filters.every((f) => matches(r, f));
      })
      .sort((a, b) => String(a[q.dateColumn]).localeCompare(String(b[q.dateColumn])))
      .slice(0, q.limit)
      .map((r) => r.id);
  }

  async selectRows(q: { table: string; column: string; values: readonly RowId[]; columns: readonly string[] }): Promise<Record<string, unknown>[]> {
    return this.rows(q.table)
      .filter((r) => q.values.includes(r[q.column] as RowId))
      .map((r) => Object.fromEntries(q.columns.map((c) => [c, r[c]])));
  }

  async selectByValue(q: { table: string; column: string; value: string; caseInsensitive: boolean; columns: readonly string[]; limit: number }): Promise<Record<string, unknown>[]> {
    const want = q.caseInsensitive ? q.value.toLowerCase() : q.value;
    return this.rows(q.table)
      .filter((r) => typeof r[q.column] === "string" && (q.caseInsensitive ? (r[q.column] as string).toLowerCase() : r[q.column]) === want)
      .slice(0, q.limit)
      .map((r) => Object.fromEntries(q.columns.map((c) => [c, r[c]])));
  }

  async deleteRows(table: string, ids: readonly RowId[]): Promise<DeleteResult> {
    const out: DeleteResult = { deleted: [], failed: [] };
    for (const id of ids) {
      try {
        this.deleteOne(table, id);
        out.deleted.push(id);
      } catch (err) {
        out.failed.push({ id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return out;
  }

  /** Deletes with FK semantics; all-or-nothing per parent row. */
  private deleteOne(table: string, id: RowId): void {
    const plan: { table: string; id: RowId }[] = [];
    const nulls: { table: string; id: RowId; column: string }[] = [];
    const visit = (t: string, rowId: RowId) => {
      const row = this.find(t, rowId);
      if (!row) return;
      if (row.legal_hold === true) throw new DeleteRefused(`Row ${t}.${String(rowId)} is under legal hold`);
      plan.push({ table: t, id: rowId });
      for (const rel of RELATIONS.filter((r) => r.parent === t)) {
        for (const child of this.rows(rel.child).filter((c) => c[rel.column] === rowId)) {
          if (rel.onDelete === "restrict") throw new DeleteRefused(`update or delete on table "${t}" violates foreign key constraint on table "${rel.child}"`);
          if (rel.onDelete === "cascade") visit(rel.child, child.id);
          else nulls.push({ table: rel.child, id: child.id, column: rel.column });
        }
      }
    };
    visit(table, id);
    for (const n of nulls) {
      const r = this.find(n.table, n.id);
      if (r) r[n.column] = null;
    }
    for (const p of plan) this.tables.set(p.table, this.rows(p.table).filter((r) => r.id !== p.id));
  }

  async findSubject(table: "leads" | "partners", email: string): Promise<{ id: RowId; legal_hold: boolean }[]> {
    const e = email.toLowerCase();
    return this.rows(table)
      .filter((r) => (table === "leads" ? String((r.contact as { email?: string } | undefined)?.email ?? "") : String(r.email ?? "")).toLowerCase() === e)
      .map((r) => ({ id: r.id, legal_hold: r.legal_hold === true }));
  }

  // --- SubjectDataSource ------------------------------------------------------

  async leads(email: string): Promise<ExportRecord[]> {
    const ids = new Set((await this.findSubject("leads", email)).map((r) => r.id));
    return this.rows("leads").filter((r) => ids.has(r.id));
  }

  async partners(email: string): Promise<ExportRecord[]> {
    const ids = new Set((await this.findSubject("partners", email)).map((r) => r.id));
    return this.rows("partners").filter((r) => ids.has(r.id));
  }

  async consentEvents(email: string): Promise<ExportRecord[]> {
    return this.rows("consent_events").filter((r) => String(r.email ?? "").toLowerCase() === email.toLowerCase());
  }

  async conversationsForLeads(leadIds: readonly string[]): Promise<ExportRecord[]> {
    return this.rows("ai_conversations").filter((r) => leadIds.includes(String(r.lead_id)));
  }

  async documentsForLeads(leadIds: readonly string[]): Promise<ExportRecord[]> {
    return this.rows("documents").filter((r) => leadIds.includes(String(r.lead_id)));
  }

  async privacyRequests(email: string): Promise<ExportRecord[]> {
    return this.rows("privacy_requests").filter((r) => r.subject_email === email.toLowerCase());
  }

  async preferences(email: string): Promise<ExportRecord | null> {
    return (this.prefs.get(email.toLowerCase()) as ExportRecord | undefined) ?? null;
  }

  async mailFrom(email: string): Promise<ExportRecord[]> {
    return this.rows("mail_messages").filter((r) => String(r.from_address ?? "").toLowerCase() === email.toLowerCase());
  }

  async smsForPhones(phones: readonly string[]): Promise<ExportRecord[]> {
    return this.rows("sms_messages").filter((r) => phones.includes(String(r.from_number)) || phones.includes(String(r.to_number)));
  }

  async notificationsFor(q: { email: string; phones: readonly string[]; leadIds: readonly string[] }): Promise<ExportRecord[]> {
    return this.rows("notifications").filter(
      (r) => String(r.recipient ?? "").toLowerCase() === q.email.toLowerCase() || q.phones.includes(String(r.recipient)) || q.leadIds.includes(String(r.lead_id)),
    );
  }

  async newsletter(email: string): Promise<ExportRecord[]> {
    return this.rows("newsletter_subscribers").filter((r) => r.email === email.toLowerCase());
  }

  async lenderContacts(email: string): Promise<ExportRecord[]> {
    const names = new Map(this.rows("lender_panel").map((l) => [l.id, l.name]));
    return this.rows("lender_contacts")
      .filter((r) => String(r.email ?? "").toLowerCase() === email.toLowerCase())
      .map((r) => ({ ...r, lender_name: names.get(r.lender_id as RowId) ?? null }));
  }

  // --- PrivacyRequestStore -------------------------------------------------------

  async insert(row: NewPrivacyRequest): Promise<{ row: PrivacyRequestRow; duplicate: boolean }> {
    const existing = this.rows("privacy_requests").find((r) => r.dedupe_key === row.dedupe_key);
    if (existing) return { row: existing as unknown as PrivacyRequestRow, duplicate: true };
    const saved = this.insertRow("privacy_requests", { created_at: new Date().toISOString(), ...row });
    return { row: saved as unknown as PrivacyRequestRow, duplicate: false };
  }

  async get(id: string): Promise<PrivacyRequestRow | null> {
    return (this.find("privacy_requests", id) as unknown as PrivacyRequestRow | undefined) ?? null;
  }

  async update(id: string, patch: PrivacyRequestPatch): Promise<void> {
    const r = this.find("privacy_requests", id);
    if (!r) throw new Error("privacy request not found");
    Object.assign(r, patch, { updated_at: new Date().toISOString() });
  }

  async listByStatus(type: PrivacyRequestType, status: PrivacyRequestStatus, limit: number): Promise<PrivacyRequestRow[]> {
    return (this.rows("privacy_requests") as unknown as PrivacyRequestRow[])
      .filter((r) => r.request_type === type && r.status === status)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .slice(0, limit);
  }

  async getPreferences(email: string): Promise<PrivacyPreferences | null> {
    return this.prefs.get(email.toLowerCase()) ?? null;
  }

  async upsertPreferences(email: string, prefs: Partial<Omit<PrivacyPreferences, "subject_email">>, sourceRequestId: string | null): Promise<PrivacyPreferences> {
    const key = email.toLowerCase();
    const current = this.prefs.get(key) ?? { subject_email: key, human_review_only: false, ai_processing_opt_out: false, opt_out_sale_share: false };
    const next: PrivacyPreferences = {
      ...current,
      human_review_only: current.human_review_only || Boolean(prefs.human_review_only),
      ai_processing_opt_out: current.ai_processing_opt_out || Boolean(prefs.ai_processing_opt_out),
      opt_out_sale_share: current.opt_out_sale_share || Boolean(prefs.opt_out_sale_share),
      source_request_id: sourceRequestId ?? current.source_request_id ?? null,
    };
    this.prefs.set(key, next);
    return next;
  }

  // --- LegalHoldDb ---------------------------------------------------------------------

  async setLegalHold(table: LegalHoldTable, id: string, patch: LegalHoldPatch): Promise<boolean> {
    const r = this.find(table, id);
    if (!r) return false;
    Object.assign(r, patch);
    return true;
  }
}

function matches(row: Row, f: Filter): boolean {
  const v = row[f.column];
  switch (f.op) {
    case "is_null":
      return v === null || v === undefined;
    case "not_null":
      return v !== null && v !== undefined;
    case "eq":
      return v === f.value;
    case "in":
      return f.value.includes(v as string | number);
  }
}
