// Retention engine: deletes personal information when its retention period
// ends, together with the files in storage, and fulfils verified deletion
// requests (CCPA right to delete) with the same machinery.
//
// Rules the engine never breaks:
//   - A row under legal hold (legal_hold = true) is never deleted, and neither
//     is a parent whose children are on hold. The database refuses it too
//     (refuse_delete_on_legal_hold trigger, migration 20261102000500).
//   - Records the law makes us keep block deletion: a lead with an MLDS or a
//     broker-of-record file stays until those records' own retention ends
//     (B&P §10148, three years), see `blockers`.
//   - Storage objects are removed before their rows, so a failed Storage call
//     leaves the row in place for the next run instead of orphaning a file.
//
// Periods mirror the published schedule in components/legal/legal.ts
// (PI_CATEGORIES.retention). VERIFY with counsel before launch; "three years
// after our last contact" is measured from the lead's created_at until deal
// records (WS-T) carry a last-activity date.

import type { ObjectStorage } from "./storage";
import type { PrivacyRequestRow, PrivacyRequestStore } from "./requests";

export type RowId = string | number;

export type Filter =
  | { column: string; op: "is_null" | "not_null" }
  | { column: string; op: "eq"; value: string | number | boolean }
  | { column: string; op: "in"; value: readonly (string | number)[] };

export type ChildSpec = {
  table: string;
  foreignKey: string;
  /**
   * "delete": the engine deletes these rows before the parent (their FK would
   * otherwise only null out). "cascade": the FK deletes them with the parent;
   * listed so their storage objects go first.
   */
  mode: "delete" | "cascade";
  storage?: { bucket: string; pathColumn: string };
  hasLegalHold: boolean;
};

export type Blocker = { table: string; foreignKey: string; reason: string };

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
  children?: readonly ChildSpec[];
  blockers?: readonly Blocker[];
  /** Objects under this prefix are removed with the parent, catching uploads that never got a row. */
  storagePrefix?: { bucket: string; prefix: (id: RowId) => string };
};

/** Same bucket as DOCUMENT_BUCKET in lib/supabase/server.ts (asserted in tests). */
export const DEAL_DOCUMENTS_BUCKET = "deal-documents";

const YEAR = 365;

const LEAD_CHILDREN: readonly ChildSpec[] = [
  { table: "documents", foreignKey: "lead_id", mode: "cascade", storage: { bucket: DEAL_DOCUMENTS_BUCKET, pathColumn: "storage_path" }, hasLegalHold: true },
  // ai_conversations.lead_id is ON DELETE SET NULL; a transcript tied to a loan file goes with it.
  { table: "ai_conversations", foreignKey: "lead_id", mode: "delete", hasLegalHold: true },
];

const LEAD_BLOCKERS: readonly Blocker[] = [
  { table: "disclosures", foreignKey: "lead_id", reason: "MLDS / disclosure records retained under B&P §10148" },
  { table: "broker_of_record", foreignKey: "lead_id", reason: "Broker-of-record file retained under B&P §10148" },
];

export const LEAD_POLICY: RetentionPolicy = {
  id: "leads",
  table: "leads",
  description: "Qualifier submissions, their documents (rows and files) and linked Kubera AI conversations",
  basis: "Privacy policy: three years after last contact (identifiers, loan request, financial documents)",
  dateColumn: "created_at",
  retainDays: 3 * YEAR + 1,
  hasLegalHold: true,
  children: LEAD_CHILDREN,
  blockers: LEAD_BLOCKERS,
  storagePrefix: { bucket: DEAL_DOCUMENTS_BUCKET, prefix: (id) => `${id}/` },
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
    description: "Kubera AI conversations not tied to a loan file",
    basis: "Privacy policy: up to one year unless part of a loan file",
    dateColumn: "created_at",
    retainDays: YEAR,
    filters: [{ column: "lead_id", op: "is_null" }],
    hasLegalHold: true,
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
];

export type DeleteResult = { deleted: RowId[]; failed: { id: RowId; error: string }[] };

/** Database operations the engine needs (Supabase in production, MemoryPrivacyDb in tests). */
export interface RetentionDb {
  /** Ids of rows whose dateColumn is before `before` and that match every filter (held rows excluded when asked). */
  selectExpired(q: { table: string; dateColumn: string; before: string; filters: readonly Filter[]; excludeHeld: boolean; limit: number }): Promise<RowId[]>;
  /** Rows where `column` is one of `values`. */
  selectRows(q: { table: string; column: string; values: readonly RowId[]; columns: readonly string[] }): Promise<Record<string, unknown>[]>;
  /** Deletes by id; rows that fail (legal hold, FK restrict) are reported, not thrown. */
  deleteRows(table: string, ids: readonly RowId[]): Promise<DeleteResult>;
  /** Leads (contact email) or partners (email) belonging to a person, case-insensitive. */
  findSubject(table: "leads" | "partners", email: string): Promise<{ id: RowId; legal_hold: boolean }[]>;
}

export type PurgeStatus = "deleted" | "held" | "blocked" | "storage_failed" | "failed";

export type PurgeOutcome = { table: string; id: RowId; status: PurgeStatus; detail?: string; objectsRemoved: number; childRowsDeleted: number };

export type PurgeDeps = { db: RetentionDb; storage: ObjectStorage };

function needsPerRowPurge(p: RetentionPolicy): boolean {
  return Boolean(p.children?.length || p.blockers?.length || p.storagePrefix);
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

  if (opts.checkParentHold && policy.hasLegalHold) {
    const [row] = await deps.db.selectRows({ table: policy.table, column: "id", values: [id], columns: ["id", "legal_hold"] });
    if (!row) return out("deleted", "already gone");
    if (row.legal_hold === true) return out("held", `${policy.table} row is under legal hold`);
  }

  for (const b of policy.blockers ?? []) {
    const refs = await deps.db.selectRows({ table: b.table, column: b.foreignKey, values: [id], columns: ["id"] });
    if (refs.length) return out("blocked", b.reason);
  }

  const paths = new Set<string>();
  const storageChildRows: { table: string; ids: RowId[] }[] = [];
  const deleteChildRows: { table: string; ids: RowId[] }[] = [];
  for (const c of policy.children ?? []) {
    const columns = ["id", ...(c.hasLegalHold ? ["legal_hold"] : []), ...(c.storage ? [c.storage.pathColumn] : [])];
    const rows = await deps.db.selectRows({ table: c.table, column: c.foreignKey, values: [id], columns });
    if (c.hasLegalHold && rows.some((r) => r.legal_hold === true)) return out("held", `${c.table} row under legal hold`);
    const ids = rows.map((r) => r.id as RowId);
    if (c.storage) {
      for (const r of rows) {
        const p = r[c.storage.pathColumn];
        if (typeof p === "string" && p) paths.add(`${c.storage.bucket}\u0000${p}`);
      }
      storageChildRows.push({ table: c.table, ids });
    }
    if (c.mode === "delete" && ids.length) deleteChildRows.push({ table: c.table, ids });
  }

  let objectsRemoved = 0;
  try {
    if (policy.storagePrefix) {
      for (const p of await deps.storage.list(policy.storagePrefix.bucket, policy.storagePrefix.prefix(id))) paths.add(`${policy.storagePrefix.bucket}\u0000${p}`);
    }
    const byBucket = new Map<string, string[]>();
    for (const key of paths) {
      const [bucket, path] = key.split("\u0000") as [string, string];
      byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), path]);
    }
    for (const [bucket, list] of byBucket) {
      const { error } = await deps.storage.remove(bucket, list);
      if (error) return out("storage_failed", error, objectsRemoved);
      objectsRemoved += list.length;
    }
  } catch (err) {
    return out("storage_failed", err instanceof Error ? err.message : String(err), objectsRemoved);
  }

  let childRowsDeleted = 0;
  for (const c of deleteChildRows) {
    const res = await deps.db.deleteRows(c.table, c.ids);
    childRowsDeleted += res.deleted.length;
    if (res.failed.length) return out("failed", `${c.table}: ${res.failed[0]!.error}`, objectsRemoved, childRowsDeleted);
  }

  const parent = await deps.db.deleteRows(policy.table, [id]);
  if (parent.failed.length) {
    // The files are gone; drop the rows that pointed at them so nothing references a missing object.
    for (const c of storageChildRows) {
      if (c.ids.length) childRowsDeleted += (await deps.db.deleteRows(c.table, c.ids)).deleted.length;
    }
    return out("failed", parent.failed[0]!.error, objectsRemoved, childRowsDeleted);
  }
  for (const c of storageChildRows) childRowsDeleted += c.ids.length;
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

export type DeletionRequestSummary = { processed: number; completed: number; partial: number; errors: string[] };

export type ErasureResolution = {
  kind: "deletion";
  completedAt: string;
  deleted: { table: string; id: RowId; objectsRemoved: number; childRowsDeleted: number }[];
  retained: { table: string; id: RowId; reason: string }[];
  notes: string[];
};

export const ERASURE_NOTES = [
  // VERIFY with counsel: exceptions relied on under Civ. Code §1798.105(d).
  "Consent and opt-out records are kept for five years to prove consent and honor opt-outs (legal obligation).",
  "Your privacy preferences (for example, an AI opt-out) are kept so we can keep honoring them.",
  "Copies already shared with lenders you asked us to approach are held by those lenders under their own policies.",
] as const;

/** Erases one person's leads and partner registrations, keeping what the law or a legal hold requires. */
export async function eraseSubject(email: string, deps: PurgeDeps, now: Date = new Date()): Promise<ErasureResolution> {
  const deleted: ErasureResolution["deleted"] = [];
  const retained: ErasureResolution["retained"] = [];
  for (const policy of [LEAD_POLICY, PARTNER_POLICY]) {
    const rows = await deps.db.findSubject(policy.table as "leads" | "partners", email);
    for (const row of rows) {
      if (row.legal_hold) {
        retained.push({ table: policy.table, id: row.id, reason: "legal hold" });
        continue;
      }
      const r = await purgeRow(policy, row.id, deps, { checkParentHold: true });
      if (r.status === "deleted") deleted.push({ table: policy.table, id: row.id, objectsRemoved: r.objectsRemoved, childRowsDeleted: r.childRowsDeleted });
      else retained.push({ table: policy.table, id: row.id, reason: r.status === "held" ? "legal hold" : (r.detail ?? r.status) });
    }
  }
  return { kind: "deletion", completedAt: now.toISOString(), deleted, retained, notes: [...ERASURE_NOTES] };
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
      const resolution = await eraseSubject(req.subject_email, deps, now());
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
