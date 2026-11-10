// Retention engine: deletes personal information when its retention period
// ends, together with the files in storage, and fulfils verified deletion
// requests (CCPA right to delete) with the same machinery.
//
// Rules the engine never breaks:
//   - A row under legal hold (legal_hold = true) is never deleted, and neither
//     is a parent whose children are on hold. The database refuses it too
//     (refuse_delete_on_legal_hold trigger, migrations 20261102000500 and
//     20261105025700).
//   - Records the law makes us keep block deletion: a lead with an MLDS or a
//     broker-of-record file stays until those records' own retention ends
//     (B&P §10148, three years), see `blockers`.
//   - Storage objects are removed before their rows, so a failed Storage call
//     leaves the row in place for the next run instead of orphaning a file.
//     Document files are removed from both vault buckets (a file sits in the
//     quarantine bucket until the scan passes; a failed or interrupted move can
//     leave it in either).
//
// Periods mirror the published schedule in components/legal/legal.ts
// (PI_CATEGORIES.retention and RECORD_RETENTION). VERIFY with counsel before
// launch; "three years after our last contact" is measured from the lead's
// created_at until deal records (WS-T) carry a last-activity date.

import { toE164 } from "@/lib/notify/phone";
import type { ObjectStorage } from "./storage";
import type { PrivacyRequestRow, PrivacyRequestStore } from "./requests";

export type RowId = string | number;

export type Filter =
  | { column: string; op: "is_null" | "not_null" }
  | { column: string; op: "eq"; value: string | number | boolean }
  | { column: string; op: "in"; value: readonly (string | number)[] };

/** Storage objects a row points at, read from `columns` of that row. */
export type StorageSpec = {
  columns: readonly string[];
  objects: (row: Record<string, unknown>) => { bucket: string; path: string }[];
};

export type ChildSpec = {
  table: string;
  foreignKey: string;
  /**
   * "delete": the engine deletes these rows before the parent (their FK would
   * otherwise only null out). "cascade": the FK deletes them with the parent;
   * listed so their storage objects go first.
   */
  mode: "delete" | "cascade";
  storage?: StorageSpec;
  hasLegalHold: boolean;
};

export type Blocker = { table: string; foreignKey: string; reason: string };

export type StoragePrefix = { bucket: string; prefix: (id: RowId) => string };

export type RetentionPolicy = {
  id: string;
  table: string;
  description: string;
  /** Where the period comes from (published schedule / statute). */
  basis: string;
  dateColumn: string;
  retainDays: number;
  filters?: readonly Filter[];
  hasLegalHold: boolean;
  /** Objects the row itself points at (removed before the row). */
  storage?: StorageSpec;
  children?: readonly ChildSpec[];
  blockers?: readonly Blocker[];
  /** Objects under these prefixes are removed with the parent, catching uploads that never got a row. */
  storagePrefixes?: readonly StoragePrefix[];
};

/** Same bucket as DOCUMENT_BUCKET in lib/supabase/server.ts (asserted in tests). */
export const DEAL_DOCUMENTS_BUCKET = "deal-documents";
/**
 * Every upload and every inbound-mail attachment starts here, and pending,
 * quarantined, infected and rejected files stay here (QUARANTINE_BUCKET in
 * lib/documents/types.ts, asserted in tests).
 */
export const DOCUMENT_QUARANTINE_BUCKET = "deal-documents-quarantine";

const YEAR = 365;

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/**
 * A document's file in both buckets: the row's `bucket` says where it should
 * be, and an interrupted scan move can leave it in the other one (the same rule
 * as deleteDocument in lib/documents/lifecycle.ts).
 */
export const DOCUMENT_OBJECTS: StorageSpec = {
  columns: ["storage_path", "bucket"],
  objects: (r) => {
    const path = str(r.storage_path);
    if (!path) return [];
    const own = str(r.bucket) ?? DEAL_DOCUMENTS_BUCKET;
    return [...new Set([own, DEAL_DOCUMENTS_BUCKET, DOCUMENT_QUARANTINE_BUCKET])].map((bucket) => ({ bucket, path }));
  },
};

type AttachmentJson = { status?: unknown; bucket?: unknown; storagePath?: unknown };

function mailAttachments(r: Record<string, unknown>, includeRegistered: boolean): { bucket: string; path: string }[] {
  const list = Array.isArray(r.attachments) ? (r.attachments as AttachmentJson[]) : [];
  return list
    .filter((a) => a && typeof a === "object" && str(a.storagePath) && (includeRegistered || a.status !== "registered"))
    .map((a) => ({ bucket: str(a.bucket) ?? DOCUMENT_QUARANTINE_BUCKET, path: str(a.storagePath)! }));
}

/**
 * Inbound-mail attachments kept with the message (lib/mail/attachments.ts),
 * always in the quarantine bucket. An attachment registered as a vault document
 * is left alone: that `documents` row owns the file and removes it when it goes.
 */
export const MAIL_ATTACHMENT_OBJECTS: StorageSpec = { columns: ["attachments"], objects: (r) => mailAttachments(r, false) };

/** With the lead: every stored attachment goes (the lead's documents rows, registered ones included, go too). */
const LEAD_MAIL_ATTACHMENT_OBJECTS: StorageSpec = { columns: ["attachments"], objects: (r) => mailAttachments(r, true) };

const LEAD_CHILDREN: readonly ChildSpec[] = [
  { table: "documents", foreignKey: "lead_id", mode: "cascade", storage: DOCUMENT_OBJECTS, hasLegalHold: true },
  // The FKs below are ON DELETE SET NULL; records tied to the loan file go with it.
  { table: "ai_conversations", foreignKey: "lead_id", mode: "delete", hasLegalHold: true },
  { table: "mail_messages", foreignKey: "lead_id", mode: "delete", storage: LEAD_MAIL_ATTACHMENT_OBJECTS, hasLegalHold: true },
  { table: "sms_messages", foreignKey: "lead_id", mode: "delete", hasLegalHold: true },
  { table: "notifications", foreignKey: "lead_id", mode: "delete", hasLegalHold: true },
];

const LEAD_BLOCKERS: readonly Blocker[] = [
  { table: "disclosures", foreignKey: "lead_id", reason: "MLDS / disclosure records retained under B&P §10148" },
  { table: "broker_of_record", foreignKey: "lead_id", reason: "Broker-of-record file retained under B&P §10148" },
];

/** Uploads are stored under `<leadId>/` in both buckets (lib/documents/mint.ts). */
const leadPrefix = (id: RowId) => `${id}/`;

export const LEAD_POLICY: RetentionPolicy = {
  id: "leads",
  table: "leads",
  description: "Qualifier submissions with their documents (rows and files), Corin AI conversations, emails, texts and notification records",
  basis: "Privacy policy: three years after last contact (identifiers, loan request, financial documents, communications)",
  dateColumn: "created_at",
  retainDays: 3 * YEAR + 1,
  hasLegalHold: true,
  children: LEAD_CHILDREN,
  blockers: LEAD_BLOCKERS,
  storagePrefixes: [
    { bucket: DEAL_DOCUMENTS_BUCKET, prefix: leadPrefix },
    { bucket: DOCUMENT_QUARANTINE_BUCKET, prefix: leadPrefix },
  ],
};

export const PARTNER_POLICY: RetentionPolicy = {
  id: "partners",
  table: "partners",
  description: "Partner registrations that were never approved",
  basis: "Privacy policy: professional information, three years after the relationship ends",
  dateColumn: "created_at",
  retainDays: 3 * YEAR + 1,
  filters: [{ column: "status", op: "in", value: ["PENDING_REVIEW", "REJECTED"] }],
  hasLegalHold: true,
};

export const RETENTION_POLICIES: readonly RetentionPolicy[] = [
  LEAD_POLICY,
  PARTNER_POLICY,
  {
    id: "ai_conversations",
    table: "ai_conversations",
    description: "Corin AI conversations not tied to a loan file",
    basis: "Privacy policy: up to one year unless part of a loan file",
    dateColumn: "created_at",
    retainDays: YEAR,
    filters: [{ column: "lead_id", op: "is_null" }],
    hasLegalHold: true,
  },
  {
    id: "mail_messages_ignored",
    table: "mail_messages",
    description: "Inbound auto-replies, marketing and spam filed away without review",
    basis: "Privacy policy: security and integration logs up to 90 days",
    dateColumn: "received_at",
    retainDays: 90,
    filters: [{ column: "status", op: "eq", value: "ignored" }],
    hasLegalHold: true,
    storage: MAIL_ATTACHMENT_OBJECTS,
  },
  {
    id: "mail_messages",
    table: "mail_messages",
    description: "Inbound email (deals@, docs@, lenders@, vendors@, closing@) and its stored attachments, not tied to a lead or deal",
    basis: "Privacy policy: communications, three years after our last contact (mail tied to a lead goes with the lead)",
    dateColumn: "received_at",
    retainDays: 3 * YEAR + 1,
    filters: [
      { column: "lead_id", op: "is_null" },
      { column: "deal_id", op: "is_null" },
    ],
    hasLegalHold: true,
    storage: MAIL_ATTACHMENT_OBJECTS,
  },
  {
    id: "sms_messages",
    table: "sms_messages",
    description: "Texts sent and received (including STOP / HELP / START) not tied to a lead",
    basis: "Privacy policy: communications, three years after our last contact; the opt-out itself stays in the consent ledger",
    dateColumn: "created_at",
    retainDays: 3 * YEAR + 1,
    filters: [{ column: "lead_id", op: "is_null" }],
    hasLegalHold: true,
  },
  {
    id: "notifications",
    table: "notifications",
    description: "Log of emails and texts we sent (recipient, template, delivery status) not tied to a lead",
    basis: "Privacy policy: communications, three years after our last contact",
    dateColumn: "created_at",
    retainDays: 3 * YEAR + 1,
    filters: [{ column: "lead_id", op: "is_null" }],
    hasLegalHold: true,
  },
  {
    id: "newsletter_pending",
    table: "newsletter_subscribers",
    description: "Newsletter signups never confirmed (the confirmation link expires after seven days)",
    basis: "Privacy policy: newsletter, until you unsubscribe; an unconfirmed signup is removed after 30 days",
    dateColumn: "created_at",
    retainDays: 30,
    filters: [{ column: "status", op: "eq", value: "pending" }],
    hasLegalHold: true,
  },
  {
    id: "newsletter_unsubscribed",
    table: "newsletter_subscribers",
    description: "Newsletter subscriptions 30 days after the unsubscribe reached the mailing service",
    basis: "Privacy policy: newsletter, until you unsubscribe; the consent ledger keeps the unsubscribe for five years",
    dateColumn: "unsubscribed_at",
    retainDays: 30,
    // A row whose unsubscribe has not reached Resend yet stays until it does, so the address is not left subscribed there.
    filters: [
      { column: "status", op: "eq", value: "unsubscribed" },
      { column: "audience_error", op: "is_null" },
    ],
    hasLegalHold: true,
  },
  {
    id: "crm_optout_sync",
    table: "crm_optout_sync",
    description: "SMS opt-out sync markers already written to Twenty (or given up on)",
    basis: "Privacy policy: security and integration logs up to 90 days; the opt-out itself stays in the consent ledger",
    dateColumn: "updated_at",
    retainDays: 90,
    filters: [{ column: "status", op: "in", value: ["synced", "exhausted"] }],
    hasLegalHold: false,
  },
  {
    id: "consent_events",
    table: "consent_events",
    description: "Consent and opt-out records no longer linked to a lead or partner",
    basis: "Privacy policy: five years, to prove consent and honor opt-outs",
    dateColumn: "occurred_at",
    retainDays: 5 * YEAR + 1,
    filters: [
      { column: "lead_id", op: "is_null" },
      { column: "partner_id", op: "is_null" },
    ],
    hasLegalHold: true,
  },
  {
    id: "crm_events",
    table: "crm_events",
    description: "Raw Twenty webhook payloads",
    basis: "Privacy policy: security and integration logs up to 90 days",
    dateColumn: "received_at",
    retainDays: 90,
    hasLegalHold: false,
  },
  {
    id: "privacy_requests",
    table: "privacy_requests",
    description: "Closed consumer privacy requests",
    basis: "11 CCR §7101: request records kept 24 months",
    dateColumn: "completed_at",
    retainDays: 2 * YEAR,
    filters: [{ column: "completed_at", op: "not_null" }],
    hasLegalHold: true,
  },
  {
    id: "retention_runs",
    table: "retention_runs",
    description: "Retention engine run logs",
    basis: "Operational log, two years",
    dateColumn: "started_at",
    retainDays: 2 * YEAR,
    hasLegalHold: false,
  },
  {
    // Active contacts stay while the lender relationship is active; contacts of an
    // inactive lender are reviewed by hand (there is no deactivation date yet).
    id: "lender_contacts_left",
    table: "lender_contacts",
    description: "Lender contacts who left the lender",
    basis: "Privacy policy: professional information, three years after the relationship ends",
    dateColumn: "left_at",
    retainDays: 3 * YEAR + 1,
    filters: [{ column: "status", op: "eq", value: "left" }],
    hasLegalHold: false,
  },
];

export type DeleteResult = { deleted: RowId[]; failed: { id: RowId; error: string }[] };

/** Database operations the engine needs (Supabase in production, MemoryPrivacyDb in tests). */
export interface RetentionDb {
  /** Ids of rows whose dateColumn is before `before` and that match every filter (held rows excluded when asked). */
  selectExpired(q: { table: string; dateColumn: string; before: string; filters: readonly Filter[]; excludeHeld: boolean; limit: number }): Promise<RowId[]>;
  /** Rows where `column` is one of `values`. */
  selectRows(q: { table: string; column: string; values: readonly RowId[]; columns: readonly string[] }): Promise<Record<string, unknown>[]>;
  /** Rows where `column` equals `value` (ignoring case when asked). */
  selectByValue(q: { table: string; column: string; value: string; caseInsensitive: boolean; columns: readonly string[]; limit: number }): Promise<Record<string, unknown>[]>;
  /** Deletes by id; rows that fail (legal hold, FK restrict) are reported, not thrown. */
  deleteRows(table: string, ids: readonly RowId[]): Promise<DeleteResult>;
  /** Leads (contact email) or partners (email) belonging to a person, case-insensitive. */
  findSubject(table: "leads" | "partners", email: string): Promise<{ id: RowId; legal_hold: boolean }[]>;
}

export type PurgeStatus = "deleted" | "held" | "blocked" | "storage_failed" | "failed";

export type PurgeOutcome = { table: string; id: RowId; status: PurgeStatus; detail?: string; objectsRemoved: number; childRowsDeleted: number };

export type PurgeDeps = { db: RetentionDb; storage: ObjectStorage };

function needsPerRowPurge(p: RetentionPolicy): boolean {
  return Boolean(p.children?.length || p.blockers?.length || p.storagePrefixes?.length || p.storage);
}

const objectKey = (bucket: string, path: string) => `${bucket}\u0000${path}`;

/**
 * Removes objects bucket by bucket (missing ones are not an error). `removed`
 * counts distinct paths, so a document file cleared from both vault buckets
 * counts once.
 */
async function removeObjects(storage: ObjectStorage, keys: Iterable<string>): Promise<{ removed: number; error: string | null }> {
  const byBucket = new Map<string, string[]>();
  const done = new Set<string>();
  for (const key of keys) {
    const [bucket, path] = key.split("\u0000") as [string, string];
    byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), path]);
  }
  try {
    for (const [bucket, list] of byBucket) {
      const { error } = await storage.remove(bucket, list);
      if (error) return { removed: done.size, error };
      for (const p of list) done.add(p);
    }
  } catch (err) {
    return { removed: done.size, error: err instanceof Error ? err.message : String(err) };
  }
  return { removed: done.size, error: null };
}

/**
 * Deletes one parent row with its children and storage objects. Order: hold
 * check → legal blockers → children holds → storage → child rows → parent.
 */
export async function purgeRow(policy: RetentionPolicy, id: RowId, deps: PurgeDeps, opts: { checkParentHold?: boolean } = {}): Promise<PurgeOutcome> {
  const out = (status: PurgeStatus, detail?: string, objectsRemoved = 0, childRowsDeleted = 0): PurgeOutcome => ({
    table: policy.table,
    id,
    status,
    ...(detail ? { detail } : {}),
    objectsRemoved,
    childRowsDeleted,
  });

  const paths = new Set<string>();
  const ownColumns = [...(opts.checkParentHold && policy.hasLegalHold ? ["legal_hold"] : []), ...(policy.storage?.columns ?? [])];
  if (ownColumns.length) {
    const [row] = await deps.db.selectRows({ table: policy.table, column: "id", values: [id], columns: ["id", ...ownColumns] });
    if (!row) return out("deleted", "already gone");
    if (opts.checkParentHold && policy.hasLegalHold && row.legal_hold === true) return out("held", `${policy.table} row is under legal hold`);
    for (const o of policy.storage?.objects(row) ?? []) paths.add(objectKey(o.bucket, o.path));
  }

  for (const b of policy.blockers ?? []) {
    const refs = await deps.db.selectRows({ table: b.table, column: b.foreignKey, values: [id], columns: ["id"] });
    if (refs.length) return out("blocked", b.reason);
  }

  const storageChildRows: { table: string; ids: RowId[] }[] = [];
  const deleteChildRows: { table: string; ids: RowId[] }[] = [];
  for (const c of policy.children ?? []) {
    const columns = [...new Set(["id", ...(c.hasLegalHold ? ["legal_hold"] : []), ...(c.storage?.columns ?? [])])];
    const rows = await deps.db.selectRows({ table: c.table, column: c.foreignKey, values: [id], columns });
    if (c.hasLegalHold && rows.some((r) => r.legal_hold === true)) return out("held", `${c.table} row under legal hold`);
    const ids = rows.map((r) => r.id as RowId);
    if (c.storage) {
      for (const r of rows) for (const o of c.storage.objects(r)) paths.add(objectKey(o.bucket, o.path));
      storageChildRows.push({ table: c.table, ids });
    }
    if (c.mode === "delete" && ids.length) deleteChildRows.push({ table: c.table, ids });
  }

  try {
    for (const sp of policy.storagePrefixes ?? []) {
      const prefix = sp.prefix(id);
      // Never let an empty or root prefix turn into "everything in the bucket".
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,}\//.test(prefix)) return out("failed", `refusing unsafe storage prefix for ${policy.table} row`);
      for (const p of await deps.storage.list(sp.bucket, prefix)) paths.add(objectKey(sp.bucket, p));
    }
  } catch (err) {
    return out("storage_failed", err instanceof Error ? err.message : String(err));
  }
  const removal = await removeObjects(deps.storage, paths);
  if (removal.error) return out("storage_failed", removal.error, removal.removed);
  const objectsRemoved = removal.removed;

  let childRowsDeleted = 0;
  // The rows holding storage paths go first: a later failure must not leave a row pointing at a removed file.
  const ordered = [...deleteChildRows].sort((a, b) => Number(storageChildRows.some((s) => s.table === b.table)) - Number(storageChildRows.some((s) => s.table === a.table)));
  for (const c of ordered) {
    const res = await deps.db.deleteRows(c.table, c.ids);
    childRowsDeleted += res.deleted.length;
    if (res.failed.length) return out("failed", `${c.table}: ${res.failed[0]!.error}`, objectsRemoved, childRowsDeleted);
  }

  const parent = await deps.db.deleteRows(policy.table, [id]);
  const cascaded = storageChildRows.filter((c) => !deleteChildRows.some((d) => d.table === c.table));
  if (parent.failed.length) {
    // The files are gone; drop the rows that pointed at them so nothing references a missing object.
    for (const c of cascaded) {
      if (c.ids.length) childRowsDeleted += (await deps.db.deleteRows(c.table, c.ids)).deleted.length;
    }
    return out("failed", parent.failed[0]!.error, objectsRemoved, childRowsDeleted);
  }
  for (const c of cascaded) childRowsDeleted += c.ids.length;
  return out("deleted", undefined, objectsRemoved, childRowsDeleted);
}

export type PolicySummary = {
  policy: string;
  cutoff: string;
  candidates: number;
  deleted: number;
  held: number;
  blocked: number;
  failed: number;
  objectsRemoved: number;
  childRowsDeleted: number;
  errors: string[];
};

export type RetentionSummary = {
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  ok: boolean;
  policies: PolicySummary[];
  deletionRequests?: DeletionRequestSummary;
};

export type RunOptions = PurgeDeps & {
  now?: () => Date;
  policies?: readonly RetentionPolicy[];
  /** Max rows per policy per run (the cron runs daily; backlogs drain over several runs). */
  limitPerPolicy?: number;
  /** Count candidates without deleting anything. */
  dryRun?: boolean;
};

export function cutoffFor(policy: RetentionPolicy, now: Date): string {
  return new Date(now.getTime() - policy.retainDays * 86_400_000).toISOString();
}

/** Runs every policy once. Never throws for a single row; per-policy errors are collected. */
export async function runRetention(opts: RunOptions): Promise<RetentionSummary> {
  const now = opts.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const policies = opts.policies ?? RETENTION_POLICIES;
  const limit = opts.limitPerPolicy ?? 200;
  const summaries: PolicySummary[] = [];

  for (const policy of policies) {
    const cutoff = cutoffFor(policy, now());
    const s: PolicySummary = { policy: policy.id, cutoff, candidates: 0, deleted: 0, held: 0, blocked: 0, failed: 0, objectsRemoved: 0, childRowsDeleted: 0, errors: [] };
    summaries.push(s);
    try {
      const ids = await opts.db.selectExpired({
        table: policy.table,
        dateColumn: policy.dateColumn,
        before: cutoff,
        filters: policy.filters ?? [],
        excludeHeld: policy.hasLegalHold,
        limit,
      });
      s.candidates = ids.length;
      if (opts.dryRun || ids.length === 0) continue;

      if (!needsPerRowPurge(policy)) {
        const res = await opts.db.deleteRows(policy.table, ids);
        s.deleted = res.deleted.length;
        s.failed = res.failed.length;
        s.errors.push(...res.failed.slice(0, 5).map((f) => `${f.id}: ${f.error}`));
        continue;
      }
      for (const id of ids) {
        const r = await purgeRow(policy, id, opts);
        s.objectsRemoved += r.objectsRemoved;
        s.childRowsDeleted += r.childRowsDeleted;
        if (r.status === "deleted") s.deleted++;
        else if (r.status === "held") s.held++;
        else if (r.status === "blocked") s.blocked++;
        else {
          s.failed++;
          if (s.errors.length < 5) s.errors.push(`${id}: ${r.detail ?? r.status}`);
        }
      }
    } catch (err) {
      s.errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  const ok = summaries.every((s) => s.failed === 0 && s.errors.length === 0);
  return { startedAt, finishedAt: now().toISOString(), dryRun: Boolean(opts.dryRun), ok, policies: summaries };
}

// --- Deletion requests ---------------------------------------------------------------

/**
 * Records about a person found by their email address or phone number rather
 * than by a lead id: mail they sent, texts to and from their number, the log of
 * what we sent them, newsletter signups and pending CRM opt-out syncs. Erasure
 * deletes them (with stored attachments) unless `keep` names a reason.
 */
export type ContactRecordSpec = {
  table: string;
  column: string;
  match: "email" | "phone";
  hasLegalHold: boolean;
  storage?: StorageSpec;
  /** Extra columns `keep` reads. */
  keepColumns?: readonly string[];
  /** Why a matching row stays (null: delete it). `retainedLeads` maps kept lead ids to the reason. */
  keep?: (row: Record<string, unknown>, ctx: { retainedLeads: ReadonlyMap<string, string> }) => string | null;
};

function keptWithLead(row: Record<string, unknown>, ctx: { retainedLeads: ReadonlyMap<string, string> }): string | null {
  const lead = str(row.lead_id);
  const why = lead ? ctx.retainedLeads.get(lead) : undefined;
  return why ? `Part of a loan file we keep (${why})` : null;
}

export const CONTACT_RECORDS: readonly ContactRecordSpec[] = [
  {
    table: "mail_messages",
    column: "from_address",
    match: "email",
    hasLegalHold: true,
    storage: MAIL_ATTACHMENT_OBJECTS,
    keepColumns: ["lead_id", "deal_id"],
    keep: (r, ctx) => keptWithLead(r, ctx) ?? (str(r.deal_id) ? "Filed to a loan we arranged; kept with that loan file under B&P §10148" : null),
  },
  { table: "sms_messages", column: "from_number", match: "phone", hasLegalHold: true, keepColumns: ["lead_id"], keep: keptWithLead },
  { table: "sms_messages", column: "to_number", match: "phone", hasLegalHold: true, keepColumns: ["lead_id"], keep: keptWithLead },
  { table: "notifications", column: "recipient", match: "email", hasLegalHold: true, keepColumns: ["lead_id"], keep: keptWithLead },
  { table: "notifications", column: "recipient", match: "phone", hasLegalHold: true, keepColumns: ["lead_id"], keep: keptWithLead },
  {
    table: "newsletter_subscribers",
    column: "email",
    match: "email",
    hasLegalHold: true,
    keepColumns: ["status", "audience_error"],
    // Deleting the row of a live subscription would leave the address subscribed at the mailing service.
    keep: (r) =>
      r.status === "confirmed" || str(r.audience_error)
        ? "Newsletter subscription still active with our email provider; compliance unsubscribes it there, then this record is deleted"
        : null,
  },
  {
    table: "crm_optout_sync",
    column: "phone",
    match: "phone",
    hasLegalHold: false,
    keepColumns: ["status"],
    keep: (r) => (r.status === "pending" ? "Text opt-out still being copied to our CRM; kept until it is, so the opt-out is honored" : null),
  },
  // People at lenders (lender_contacts). Their audit rows are already redacted; deleting a
  // primary contact moves the package recipient to the lender's submission inbox.
  { table: "lender_contacts", column: "email", match: "email", hasLegalHold: false },
  { table: "lender_contacts", column: "phone_direct", match: "phone", hasLegalHold: false },
  { table: "lender_contacts", column: "phone_mobile", match: "phone", hasLegalHold: false },
];

export type DeletionRequestSummary = { processed: number; completed: number; partial: number; errors: string[] };

export type ErasureResolution = {
  kind: "deletion";
  completedAt: string;
  deleted: { table: string; id: RowId; objectsRemoved: number; childRowsDeleted: number }[];
  /** Rows found by email or phone (mail, texts, notification log, newsletter), counted per table. */
  contactRecords: { table: string; deleted: number; objectsRemoved: number }[];
  retained: { table: string; id: RowId; reason: string }[];
  notes: string[];
};

export const ERASURE_NOTES = [
  // VERIFY with counsel: exceptions relied on under Civ. Code §1798.105(d).
  "Consent and opt-out records are kept for five years to prove consent and honor opt-outs (legal obligation).",
  "Your privacy preferences (for example, advisor-only handling) are kept so we can keep honoring them.",
  "Copies already shared with lenders you asked us to approach are held by those lenders under their own policies.",
] as const;

/** Phone numbers in E.164 form, the way texts and the consent ledger store them; anything else is dropped. */
const e164 = (raw: unknown): string | null => (typeof raw === "string" ? toE164(raw) : null);

const CONTACT_LIMIT = 2_000;

/** Phone numbers tied to the person: given ones, their leads' and partner registrations' contact, and their consent records. */
async function subjectPhones(email: string, leadIds: readonly RowId[], partnerIds: readonly RowId[], given: readonly string[], db: RetentionDb): Promise<string[]> {
  const phones = new Set<string>();
  const add = (v: unknown) => {
    const p = e164(v);
    if (p) phones.add(p);
  };
  given.forEach(add);
  if (leadIds.length) for (const r of await db.selectRows({ table: "leads", column: "id", values: leadIds, columns: ["id", "contact"] })) add((r.contact as { phone?: unknown } | null)?.phone);
  if (partnerIds.length)
    for (const r of await db.selectRows({ table: "partners", column: "id", values: partnerIds, columns: ["id", "profile"] })) add((r.profile as { contact?: { phone?: unknown } } | null)?.contact?.phone);
  for (const r of await db.selectByValue({ table: "consent_events", column: "email", value: email, caseInsensitive: true, columns: ["id", "phone"], limit: CONTACT_LIMIT })) add(r.phone);
  return [...phones];
}

async function eraseContactRecords(
  values: { email: string; phones: readonly string[] },
  ctx: { retainedLeads: ReadonlyMap<string, string> },
  deps: PurgeDeps,
): Promise<{ counts: ErasureResolution["contactRecords"]; retained: ErasureResolution["retained"] }> {
  const counts = new Map<string, { deleted: number; objectsRemoved: number }>();
  const retained: ErasureResolution["retained"] = [];
  const seen = new Set<string>();
  for (const spec of CONTACT_RECORDS) {
    const list = spec.match === "email" ? [values.email] : values.phones;
    for (const value of list) {
      const columns = [...new Set(["id", ...(spec.hasLegalHold ? ["legal_hold"] : []), ...(spec.storage?.columns ?? []), ...(spec.keepColumns ?? [])])];
      const rows = await deps.db.selectByValue({ table: spec.table, column: spec.column, value, caseInsensitive: spec.match === "email", columns, limit: CONTACT_LIMIT });
      const doomed: RowId[] = [];
      const objects = new Set<string>();
      for (const row of rows) {
        const id = row.id as RowId;
        const key = `${spec.table}\u0000${String(id)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (spec.hasLegalHold && row.legal_hold === true) {
          retained.push({ table: spec.table, id, reason: "legal hold" });
          continue;
        }
        const why = spec.keep?.(row, ctx) ?? null;
        if (why) {
          retained.push({ table: spec.table, id, reason: why });
          continue;
        }
        doomed.push(id);
        for (const o of spec.storage?.objects(row) ?? []) objects.add(objectKey(o.bucket, o.path));
      }
      if (!doomed.length) continue;
      const removal = await removeObjects(deps.storage, objects);
      if (removal.error) {
        for (const id of doomed) retained.push({ table: spec.table, id, reason: `stored file could not be deleted yet (${removal.error.slice(0, 120)}); retried by compliance` });
        continue;
      }
      const res = await deps.db.deleteRows(spec.table, doomed);
      for (const f of res.failed) retained.push({ table: spec.table, id: f.id, reason: f.error.slice(0, 200) });
      const c = counts.get(spec.table) ?? { deleted: 0, objectsRemoved: 0 };
      c.deleted += res.deleted.length;
      c.objectsRemoved += removal.removed;
      counts.set(spec.table, c);
    }
  }
  return { counts: [...counts].map(([table, c]) => ({ table, ...c })), retained };
}

/**
 * Erases one person: their leads (with documents, conversations, mail, texts
 * and notification records) and partner registrations, then the mail, texts,
 * notification log and newsletter rows found by their email address or phone
 * numbers. Keeps what the law or a legal hold requires, and says why.
 */
export async function eraseSubject(email: string, deps: PurgeDeps, now: Date = new Date(), opts: { phones?: readonly string[] } = {}): Promise<ErasureResolution> {
  const deleted: ErasureResolution["deleted"] = [];
  const retained: ErasureResolution["retained"] = [];
  const retainedLeads = new Map<string, string>();
  const subjects = {
    leads: await deps.db.findSubject("leads", email),
    partners: await deps.db.findSubject("partners", email),
  };
  // Read phone numbers before the rows that hold them are deleted.
  const phones = await subjectPhones(email, subjects.leads.map((r) => r.id), subjects.partners.map((r) => r.id), opts.phones ?? [], deps.db);

  for (const policy of [LEAD_POLICY, PARTNER_POLICY]) {
    const rows = policy === LEAD_POLICY ? subjects.leads : subjects.partners;
    for (const row of rows) {
      const keep = (reason: string) => {
        retained.push({ table: policy.table, id: row.id, reason });
        if (policy === LEAD_POLICY) retainedLeads.set(String(row.id), reason);
      };
      if (row.legal_hold) {
        keep("legal hold");
        continue;
      }
      const r = await purgeRow(policy, row.id, deps, { checkParentHold: true });
      if (r.status === "deleted") deleted.push({ table: policy.table, id: row.id, objectsRemoved: r.objectsRemoved, childRowsDeleted: r.childRowsDeleted });
      else keep(r.status === "held" ? "legal hold" : (r.detail ?? r.status));
    }
  }

  const contact = await eraseContactRecords({ email, phones }, { retainedLeads }, deps);
  retained.push(...contact.retained);
  return { kind: "deletion", completedAt: now.toISOString(), deleted, contactRecords: contact.counts, retained, notes: [...ERASURE_NOTES] };
}

/**
 * Works verified deletion requests from the compliance queue: marks each
 * in_progress, erases, then closes it as completed or partially_completed with
 * the resolution (what was deleted, what was kept and why).
 */
export async function processDeletionRequests(deps: PurgeDeps & { requests: PrivacyRequestStore; now?: () => Date; limit?: number }): Promise<DeletionRequestSummary> {
  const now = deps.now ?? (() => new Date());
  const summary: DeletionRequestSummary = { processed: 0, completed: 0, partial: 0, errors: [] };
  const queue: PrivacyRequestRow[] = await deps.requests.listByStatus("deletion", "verified", deps.limit ?? 20);
  for (const req of queue) {
    if (!req.verified_at) continue;
    try {
      await deps.requests.update(req.id, { status: "in_progress" });
      const resolution = await eraseSubject(req.subject_email, deps, now(), { phones: req.subject_phone ? [req.subject_phone] : [] });
      const partial = resolution.retained.length > 0;
      await deps.requests.update(req.id, { status: partial ? "partially_completed" : "completed", completed_at: resolution.completedAt, resolution });
      summary.processed++;
      if (partial) summary.partial++;
      else summary.completed++;
    } catch (err) {
      // Leave it in_progress for staff; it will not be picked up again automatically.
      summary.errors.push(`${req.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return summary;
}
