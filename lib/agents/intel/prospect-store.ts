// Persistence for prospecting: scans, prospects, outreach drafts and the
// do-not-contact list. Contract + in-memory implementation that mirrors the
// migration's constraints (so service tests exercise the same rules the
// database enforces); Supabase: prospect-store-supabase.ts.

import { randomUUID } from "node:crypto";
import type { SuppressionKey, SuppressionLookup } from "./suppression";
import type {
  NewProspectOutreach,
  OutreachPatch,
  OutreachStatus,
  Prospect,
  ProspectOutreach,
  ProspectProgram,
  ProspectScan,
  ProspectStatus,
  ScannedProspect,
  StaffProspectEdit,
  Suppression,
  SuppressionKind,
  SuppressionReason,
  WindowBucket,
} from "./types";

export class ProspectStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProspectStoreError";
  }
}

export type ProspectFilter = {
  status?: ProspectStatus | "active";
  program?: ProspectProgram;
  window?: WindowBucket;
  minScore?: number;
  /** Matches address, city, owner or APN (case-insensitive). */
  q?: string;
  limit?: number;
  offset?: number;
};

export type ScanStart = { provider: ProspectScan["provider"]; params: Record<string, unknown>; startedBy: string };
export type ScanFinish = { status: "completed" | "failed"; found: number; createdCount: number; updatedCount: number; skippedCount: number; error?: string | null };

export type UpsertResult = { prospect: Prospect; created: boolean };

export interface ProspectStore extends SuppressionLookup {
  startScan(input: ScanStart, now: Date): Promise<ProspectScan>;
  finishScan(id: string, finish: ScanFinish, now: Date): Promise<ProspectScan>;
  listScans(limit?: number): Promise<ProspectScan[]>;

  /**
   * Inserts the scanned prospect or refreshes the machine-owned columns of the
   * existing row with the same dedupe key. Contact, status, notes and
   * assignee are staff-owned and never touched here.
   */
  upsertScanned(p: ScannedProspect, initialStatus: ProspectStatus, now: Date): Promise<UpsertResult>;
  getProspect(id: string): Promise<Prospect | null>;
  listProspects(filter?: ProspectFilter): Promise<Prospect[]>;
  countByStatus(): Promise<Record<ProspectStatus, number>>;
  updateStaff(id: string, edit: StaffProspectEdit, actor: string, now: Date): Promise<Prospect | null>;

  /** Idempotent on idempotencyKey (returns the existing row). The version is assigned here. */
  insertOutreach(row: NewProspectOutreach, now: Date): Promise<ProspectOutreach>;
  getOutreach(id: string): Promise<ProspectOutreach | null>;
  listOutreach(prospectId: string): Promise<ProspectOutreach[]>;
  listOutreachByStatus(status: OutreachStatus, limit?: number): Promise<ProspectOutreach[]>;
  /** Compare-and-set: applies the patch only while the row is in one of `from`. Null when it is not. */
  updateOutreach(id: string, from: readonly OutreachStatus[], patch: OutreachPatch, now: Date): Promise<ProspectOutreach | null>;

  addSuppression(s: { kind: SuppressionKind; valueHash: string; label: string; reason: SuppressionReason; createdBy: string }, now: Date): Promise<Suppression>;
  listSuppressions(limit?: number): Promise<Suppression[]>;
}

export const STATUS_ORDER: readonly ProspectStatus[] = ["new", "reviewing", "drafted", "contacted", "engaged", "not_a_fit", "do_not_contact"];

export function emptyStatusCounts(): Record<ProspectStatus, number> {
  return Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<ProspectStatus, number>;
}

/** Fields of a staff edit, validated the way the table's constraints do. */
export function validateStaffEdit(edit: StaffProspectEdit): StaffProspectEdit {
  const out: StaffProspectEdit = {};
  if (edit.contactName !== undefined) {
    const v = edit.contactName?.trim() || null;
    if (v && v.length > 200) throw new ProspectStoreError("The contact name is limited to 200 characters");
    out.contactName = v;
  }
  if (edit.contactEmail !== undefined) {
    const v = edit.contactEmail?.trim().toLowerCase() || null;
    if (v && (v.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))) throw new ProspectStoreError("That email address does not look right");
    out.contactEmail = v;
  }
  if (edit.status !== undefined) out.status = edit.status;
  if (edit.assignedTo !== undefined) {
    const v = edit.assignedTo?.trim() || null;
    if (v && v.length > 200) throw new ProspectStoreError("The assignee is limited to 200 characters");
    out.assignedTo = v;
  }
  if (edit.notes !== undefined) {
    const v = edit.notes?.trim() || null;
    if (v && v.length > 4000) throw new ProspectStoreError("Notes are limited to 4000 characters");
    out.notes = v;
  }
  return out;
}

export class MemoryProspectStore implements ProspectStore {
  readonly scans = new Map<string, ProspectScan>();
  readonly prospects = new Map<string, Prospect>();
  readonly outreach = new Map<string, ProspectOutreach>();
  readonly suppressions = new Map<string, Suppression>();

  async startScan(input: ScanStart, now: Date): Promise<ProspectScan> {
    const scan: ProspectScan = {
      id: randomUUID(),
      createdAt: now.toISOString(),
      finishedAt: null,
      provider: input.provider,
      status: "running",
      params: structuredClone(input.params),
      found: 0,
      createdCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      error: null,
      startedBy: input.startedBy,
    };
    this.scans.set(scan.id, scan);
    return structuredClone(scan);
  }

  async finishScan(id: string, finish: ScanFinish, now: Date): Promise<ProspectScan> {
    const cur = this.scans.get(id);
    if (!cur) throw new ProspectStoreError(`Scan ${id} not found`);
    const next: ProspectScan = { ...cur, ...finish, error: finish.error ?? null, finishedAt: now.toISOString() };
    this.scans.set(id, next);
    return structuredClone(next);
  }

  async listScans(limit = 20): Promise<ProspectScan[]> {
    return [...this.scans.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map((s) => structuredClone(s));
  }

  async upsertScanned(p: ScannedProspect, initialStatus: ProspectStatus, now: Date): Promise<UpsertResult> {
    const ts = now.toISOString();
    const existing = [...this.prospects.values()].find((x) => x.dedupeKey === p.dedupeKey);
    if (existing) {
      const next: Prospect = { ...existing, ...structuredClone(p), updatedAt: ts, lastScannedAt: ts };
      this.prospects.set(existing.id, next);
      return { prospect: structuredClone(next), created: false };
    }
    const row: Prospect = {
      ...structuredClone(p),
      id: randomUUID(),
      createdAt: ts,
      updatedAt: ts,
      lastScannedAt: ts,
      contactName: null,
      contactEmail: null,
      status: initialStatus,
      assignedTo: null,
      notes: null,
      updatedBy: null,
    };
    this.prospects.set(row.id, row);
    return { prospect: structuredClone(row), created: true };
  }

  async getProspect(id: string): Promise<Prospect | null> {
    const p = this.prospects.get(id);
    return p ? structuredClone(p) : null;
  }

  async listProspects(f: ProspectFilter = {}): Promise<Prospect[]> {
    const q = f.q?.trim().toLowerCase();
    return [...this.prospects.values()]
      .filter((p) => {
        if (f.status === "active" ? p.status === "not_a_fit" || p.status === "do_not_contact" : f.status && p.status !== f.status) return false;
        if (f.program && p.recommendedProgram !== f.program) return false;
        if (f.window && p.windowBucket !== f.window) return false;
        if (f.minScore !== undefined && p.score < f.minScore) return false;
        if (q && ![p.addressLine1, p.city, p.ownerName, p.apn, p.zip].some((v) => v?.toLowerCase().includes(q))) return false;
        return true;
      })
      .sort((a, b) => b.score - a.score || a.loanMaturityDate.localeCompare(b.loanMaturityDate) || a.id.localeCompare(b.id))
      .slice(f.offset ?? 0, (f.offset ?? 0) + (f.limit ?? 100))
      .map((p) => structuredClone(p));
  }

  async countByStatus(): Promise<Record<ProspectStatus, number>> {
    const counts = emptyStatusCounts();
    for (const p of this.prospects.values()) counts[p.status] += 1;
    return counts;
  }

  async updateStaff(id: string, edit: StaffProspectEdit, actor: string, now: Date): Promise<Prospect | null> {
    const cur = this.prospects.get(id);
    if (!cur) return null;
    const v = validateStaffEdit(edit);
    const next: Prospect = { ...cur, ...v, updatedAt: now.toISOString(), updatedBy: actor };
    this.prospects.set(id, next);
    return structuredClone(next);
  }

  async insertOutreach(row: NewProspectOutreach, now: Date): Promise<ProspectOutreach> {
    const dup = [...this.outreach.values()].find((o) => o.idempotencyKey === row.idempotencyKey);
    if (dup) return structuredClone(dup);
    if (!this.prospects.has(row.prospectId)) throw new ProspectStoreError("prospect_outreach_prospect_fk: prospect not found");
    const version = [...this.outreach.values()].filter((o) => o.prospectId === row.prospectId).reduce((v, o) => Math.max(v, o.version), 0) + 1;
    const ts = now.toISOString();
    const created: ProspectOutreach = {
      ...structuredClone(row),
      reasonCode: row.reasonCode ?? null,
      id: randomUUID(),
      createdAt: ts,
      updatedAt: ts,
      version,
      approvalId: null,
      providerMessageId: null,
      error: null,
      sentAt: null,
      mailedAt: null,
      mailedBy: null,
    };
    this.outreach.set(created.id, created);
    return structuredClone(created);
  }

  async getOutreach(id: string): Promise<ProspectOutreach | null> {
    const o = this.outreach.get(id);
    return o ? structuredClone(o) : null;
  }

  async listOutreach(prospectId: string): Promise<ProspectOutreach[]> {
    return [...this.outreach.values()]
      .filter((o) => o.prospectId === prospectId)
      .sort((a, b) => b.version - a.version)
      .map((o) => structuredClone(o));
  }

  async listOutreachByStatus(status: OutreachStatus, limit = 50): Promise<ProspectOutreach[]> {
    return [...this.outreach.values()]
      .filter((o) => o.status === status)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit)
      .map((o) => structuredClone(o));
  }

  async updateOutreach(id: string, from: readonly OutreachStatus[], patch: OutreachPatch, now: Date): Promise<ProspectOutreach | null> {
    const cur = this.outreach.get(id);
    if (!cur || !from.includes(cur.status)) return null;
    const next: ProspectOutreach = { ...cur, ...patch, updatedAt: now.toISOString() };
    // The migration's shape checks.
    if (next.status === "sent" && !(next.sentAt && next.channel === "email" && next.approvalId)) throw new ProspectStoreError("prospect_outreach_sent_shape");
    if (next.status === "mailed" && !(next.mailedAt && next.mailedBy && next.channel === "letter")) throw new ProspectStoreError("prospect_outreach_mailed_shape");
    if ((next.status === "sent" || next.status === "ready_to_mail" || next.status === "mailed") && !next.approvalId) throw new ProspectStoreError("prospect_outreach_released_needs_approval");
    this.outreach.set(id, next);
    return structuredClone(next);
  }

  async addSuppression(s: { kind: SuppressionKind; valueHash: string; label: string; reason: SuppressionReason; createdBy: string }, now: Date): Promise<Suppression> {
    const key = `${s.kind}:${s.valueHash}`;
    const existing = this.suppressions.get(key);
    if (existing) return structuredClone(existing);
    const row: Suppression = { id: randomUUID(), createdAt: now.toISOString(), ...s };
    this.suppressions.set(key, row);
    return structuredClone(row);
  }

  async listSuppressions(limit = 200): Promise<Suppression[]> {
    return [...this.suppressions.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map((s) => structuredClone(s));
  }

  async find(keys: readonly SuppressionKey[]): Promise<{ kind: SuppressionKind; label: string }[]> {
    const out: { kind: SuppressionKind; label: string }[] = [];
    for (const k of keys) {
      const hit = this.suppressions.get(`${k.kind}:${k.hash}`);
      if (hit) out.push({ kind: hit.kind, label: hit.label });
    }
    return out;
  }
}
