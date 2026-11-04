// Persistence contract for deal checklists, their items and uploaded files,
// the conditions tracker and the hard money underwriting file, with an
// in-memory implementation for tests. Supabase lives in ./supabase.ts.

import { randomUUID } from "node:crypto";
import type { Condition } from "./conditions";
import type { NewChecklistItem } from "./engine";
import type { HmMetrics, HmUnderwriting, HmUnderwritingData } from "./hm-underwriting";
import type { ChecklistItemFile, ChecklistProgram, DealChecklist, DealChecklistItem } from "./types";

export class ConcurrentUpdateError extends Error {
  constructor(what: string) {
    super(`${what} was changed by someone else; reload and try again`);
    this.name = "ConcurrentUpdateError";
  }
}

export class DuplicateChecklistError extends Error {
  constructor(program: string) {
    super(`This deal already has a ${program} checklist`);
    this.name = "DuplicateChecklistError";
  }
}

export type NewDealChecklist = { dealId: string; leadId?: string | null; program: ChecklistProgram; templateVersion: string; title: string; createdBy: string };
export type NewFile = Omit<ChecklistItemFile, "id" | "createdAt" | "uploadedAt" | "rejectReason"> & { id?: string };
export type NewConditionRow = Omit<Condition, "id" | "version" | "createdAt" | "updatedAt" | "clearedBy" | "clearedAt" | "waiverReason" | "waiverEvidence" | "status"> & { status?: Condition["status"] };

export type ItemUpdate = Partial<Omit<DealChecklistItem, "id" | "checklistId" | "dealId" | "itemKey" | "version" | "createdAt" | "updatedAt">>;

export interface ChecklistStore {
  createChecklist(checklist: NewDealChecklist, items: NewChecklistItem[], now: Date): Promise<{ checklist: DealChecklist; items: DealChecklistItem[] }>;
  getChecklist(id: string): Promise<DealChecklist | null>;
  listChecklists(opts?: { limit?: number }): Promise<DealChecklist[]>;
  checklistsForDeal(dealId: string): Promise<DealChecklist[]>;
  itemsForDeal(dealId: string): Promise<DealChecklistItem[]>;
  getItem(id: string): Promise<DealChecklistItem | null>;
  insertItems(checklistId: string, items: NewChecklistItem[], now: Date): Promise<DealChecklistItem[]>;
  /** Optimistic update: applies only when the stored version matches; bumps the version. */
  updateItem(id: string, expectedVersion: number, patch: ItemUpdate, now: Date): Promise<DealChecklistItem>;

  insertFile(file: NewFile, now: Date): Promise<ChecklistItemFile>;
  getFile(id: string): Promise<ChecklistItemFile | null>;
  /** The checklist file backed by a vault document, if any. */
  fileByDocumentId(documentId: string): Promise<ChecklistItemFile | null>;
  updateFile(id: string, patch: Partial<Pick<ChecklistItemFile, "status" | "rejectReason" | "uploadedAt" | "sizeBytes" | "contentType">>): Promise<ChecklistItemFile>;
  filesForDeal(dealId: string): Promise<ChecklistItemFile[]>;
  /** Uploads started (pending_upload) by this uploader for an item, for quotas. */
  countFiles(itemId: string): Promise<number>;

  insertCondition(row: NewConditionRow, now: Date): Promise<Condition>;
  getCondition(id: string): Promise<Condition | null>;
  conditionsForDeal(dealId: string): Promise<Condition[]>;
  updateCondition(id: string, expectedVersion: number, patch: Partial<Omit<Condition, "id" | "dealId" | "version" | "createdAt" | "updatedAt">>, now: Date): Promise<Condition>;

  getHmUnderwriting(dealId: string): Promise<HmUnderwriting | null>;
  /** Insert (expectedVersion null) or optimistic update of the deal's hard money file. */
  saveHmUnderwriting(data: HmUnderwritingData, metrics: HmMetrics, preparedBy: string, expectedVersion: number | null, now: Date): Promise<HmUnderwriting>;
}

const clone = <T>(v: T): T => structuredClone(v);

export class MemoryChecklistStore implements ChecklistStore {
  readonly checklists = new Map<string, DealChecklist>();
  readonly items = new Map<string, DealChecklistItem>();
  readonly files = new Map<string, ChecklistItemFile>();
  readonly conditions = new Map<string, Condition>();
  readonly hm = new Map<string, HmUnderwriting>();

  async createChecklist(c: NewDealChecklist, items: NewChecklistItem[], now: Date) {
    if ([...this.checklists.values()].some((x) => x.dealId === c.dealId && x.program === c.program)) throw new DuplicateChecklistError(c.program);
    const checklist: DealChecklist = { id: randomUUID(), dealId: c.dealId, leadId: c.leadId ?? null, program: c.program, templateVersion: c.templateVersion, title: c.title, createdAt: now.toISOString(), createdBy: c.createdBy, closedAt: null };
    this.checklists.set(checklist.id, checklist);
    const rows = await this.insertItems(checklist.id, items, now);
    return { checklist: clone(checklist), items: rows };
  }

  async getChecklist(id: string) {
    const c = this.checklists.get(id);
    return c ? clone(c) : null;
  }

  async listChecklists(opts: { limit?: number } = {}) {
    return [...this.checklists.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, opts.limit ?? 100).map(clone);
  }

  async checklistsForDeal(dealId: string) {
    return [...this.checklists.values()].filter((c) => c.dealId === dealId).map(clone);
  }

  async itemsForDeal(dealId: string) {
    return [...this.items.values()].filter((i) => i.dealId === dealId).sort((a, b) => a.sortOrder - b.sortOrder).map(clone);
  }

  async getItem(id: string) {
    const i = this.items.get(id);
    return i ? clone(i) : null;
  }

  async insertItems(checklistId: string, items: NewChecklistItem[], now: Date) {
    const ts = now.toISOString();
    const out: DealChecklistItem[] = [];
    for (const n of items) {
      if ([...this.items.values()].some((i) => i.checklistId === checklistId && i.itemKey === n.itemKey)) continue;
      const row: DealChecklistItem = { ...clone(n), id: randomUUID(), checklistId, version: 1, createdAt: ts, updatedAt: ts };
      this.items.set(row.id, row);
      out.push(clone(row));
    }
    return out;
  }

  async updateItem(id: string, expectedVersion: number, patch: ItemUpdate, now: Date) {
    const cur = this.items.get(id);
    if (!cur) throw new Error(`Checklist item ${id} not found`);
    if (cur.version !== expectedVersion) throw new ConcurrentUpdateError("This checklist item");
    const next: DealChecklistItem = { ...cur, ...clone(patch), version: cur.version + 1, updatedAt: now.toISOString() };
    this.items.set(id, next);
    return clone(next);
  }

  async insertFile(f: NewFile, now: Date) {
    if ([...this.files.values()].some((x) => x.storagePath === f.storagePath)) throw new Error("storage path already used");
    const row: ChecklistItemFile = { ...f, id: f.id ?? randomUUID(), createdAt: now.toISOString(), uploadedAt: null, rejectReason: null };
    this.files.set(row.id, row);
    return clone(row);
  }

  async fileByDocumentId(documentId: string) {
    const f = [...this.files.values()].find((x) => x.documentId === documentId);
    return f ? clone(f) : null;
  }

  async getFile(id: string) {
    const f = this.files.get(id);
    return f ? clone(f) : null;
  }

  async updateFile(id: string, patch: Partial<Pick<ChecklistItemFile, "status" | "rejectReason" | "uploadedAt" | "sizeBytes" | "contentType">>) {
    const cur = this.files.get(id);
    if (!cur) throw new Error(`File ${id} not found`);
    const next = { ...cur, ...patch };
    this.files.set(id, next);
    return clone(next);
  }

  async filesForDeal(dealId: string) {
    return [...this.files.values()].filter((f) => f.dealId === dealId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(clone);
  }

  async countFiles(itemId: string) {
    return [...this.files.values()].filter((f) => f.itemId === itemId && f.status !== "rejected").length;
  }

  async insertCondition(row: NewConditionRow, now: Date) {
    const ts = now.toISOString();
    const c: Condition = { ...clone(row), status: row.status ?? "open", id: randomUUID(), clearedBy: null, clearedAt: null, waiverReason: null, waiverEvidence: null, version: 1, createdAt: ts, updatedAt: ts };
    this.conditions.set(c.id, c);
    return clone(c);
  }

  async getCondition(id: string) {
    const c = this.conditions.get(id);
    return c ? clone(c) : null;
  }

  async conditionsForDeal(dealId: string) {
    return [...this.conditions.values()].filter((c) => c.dealId === dealId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(clone);
  }

  async updateCondition(id: string, expectedVersion: number, patch: Partial<Omit<Condition, "id" | "dealId" | "version" | "createdAt" | "updatedAt">>, now: Date) {
    const cur = this.conditions.get(id);
    if (!cur) throw new Error(`Condition ${id} not found`);
    if (cur.version !== expectedVersion) throw new ConcurrentUpdateError("This condition");
    const next: Condition = { ...cur, ...clone(patch), version: cur.version + 1, updatedAt: now.toISOString() };
    this.conditions.set(id, next);
    return clone(next);
  }

  async getHmUnderwriting(dealId: string) {
    const h = this.hm.get(dealId);
    return h ? clone(h) : null;
  }

  async saveHmUnderwriting(data: HmUnderwritingData, metrics: HmMetrics, preparedBy: string, expectedVersion: number | null, now: Date) {
    const cur = this.hm.get(data.dealId);
    const ts = now.toISOString();
    if (expectedVersion === null && cur) throw new ConcurrentUpdateError("The hard money file");
    if (expectedVersion !== null && (!cur || cur.version !== expectedVersion)) throw new ConcurrentUpdateError("The hard money file");
    const next: HmUnderwriting = { ...clone(data), metrics: clone(metrics), preparedBy, id: cur?.id ?? randomUUID(), version: (cur?.version ?? 0) + 1, createdAt: cur?.createdAt ?? ts, updatedAt: ts };
    this.hm.set(data.dealId, next);
    return clone(next);
  }
}
