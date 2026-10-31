// Persistence contract for screenings and deal holds, with in-memory
// implementations. Screening results are immutable once written; only the
// review fields change, and only from the disposition the reviewer saw.
// The Postgres trigger in the WS-U migration opens a hold on insert of a
// possible match even if a caller forgets to; the service does it explicitly too.

import { randomUUID } from "node:crypto";
import type { ScreeningDisposition, ScreeningRecord } from "./types";

export class DispositionConflictError extends Error {
  constructor() {
    super("This screening was reviewed by someone else; reload and try again");
    this.name = "DispositionConflictError";
  }
}

export type DispositionPatch = { disposition: ScreeningDisposition; reviewer: string; reviewedAt: string; reviewNote: string };

export interface ScreeningStore {
  insert(record: Omit<ScreeningRecord, "id" | "createdAt">, now: Date): Promise<ScreeningRecord>;
  get(id: string): Promise<ScreeningRecord | null>;
  forDeal(dealId: string): Promise<ScreeningRecord[]>;
  /** Applies the review only when the stored disposition still equals `from`. */
  setDisposition(id: string, from: ScreeningDisposition, patch: DispositionPatch): Promise<ScreeningRecord>;
}

export class MemoryScreeningStore implements ScreeningStore {
  readonly rows = new Map<string, ScreeningRecord>();

  async insert(record: Omit<ScreeningRecord, "id" | "createdAt">, now: Date) {
    const row: ScreeningRecord = { ...structuredClone(record), id: randomUUID(), createdAt: now.toISOString() };
    this.rows.set(row.id, row);
    return structuredClone(row);
  }

  async get(id: string) {
    const r = this.rows.get(id);
    return r ? structuredClone(r) : null;
  }

  async forDeal(dealId: string) {
    return [...this.rows.values()].filter((r) => r.dealId === dealId).sort((a, b) => a.screenedAt.localeCompare(b.screenedAt)).map((r) => structuredClone(r));
  }

  async setDisposition(id: string, from: ScreeningDisposition, patch: DispositionPatch) {
    const cur = this.rows.get(id);
    if (!cur) throw new Error(`Screening ${id} not found`);
    if (cur.disposition !== from) throw new DispositionConflictError();
    const next = { ...cur, ...patch };
    this.rows.set(id, next);
    return structuredClone(next);
  }
}

// --- Deal holds ------------------------------------------------------------------------------------

export const HOLD_REASONS = ["sanctions_potential_match", "sanctions_confirmed_match", "counsel_review"] as const;
export type HoldReason = (typeof HOLD_REASONS)[number];

export type DealHold = {
  id: string;
  dealId: string;
  reason: HoldReason;
  sourceKind: "screening";
  sourceId: string;
  detail: string;
  createdAt: string;
  createdBy: string;
  releasedAt: string | null;
  releasedBy: string | null;
  releaseNote: string | null;
};

export interface DealHoldStore {
  /** Opens a hold for a source, or returns the open one (idempotent per source and reason). */
  open(hold: Omit<DealHold, "id" | "createdAt" | "releasedAt" | "releasedBy" | "releaseNote">, now: Date): Promise<DealHold>;
  /** Releases the open possible-match hold for the source. A confirmed-match hold is released only by counsel. */
  release(sourceKind: DealHold["sourceKind"], sourceId: string, by: string, note: string, now: Date): Promise<number>;
  active(dealId: string): Promise<DealHold[]>;
  all(dealId: string): Promise<DealHold[]>;
}

export class MemoryDealHoldStore implements DealHoldStore {
  readonly rows = new Map<string, DealHold>();

  async open(hold: Omit<DealHold, "id" | "createdAt" | "releasedAt" | "releasedBy" | "releaseNote">, now: Date) {
    const existing = [...this.rows.values()].find((h) => h.sourceKind === hold.sourceKind && h.sourceId === hold.sourceId && h.reason === hold.reason && !h.releasedAt);
    if (existing) return { ...existing };
    const row: DealHold = { ...hold, id: randomUUID(), createdAt: now.toISOString(), releasedAt: null, releasedBy: null, releaseNote: null };
    this.rows.set(row.id, row);
    return { ...row };
  }

  async release(sourceKind: DealHold["sourceKind"], sourceId: string, by: string, note: string, now: Date) {
    let n = 0;
    for (const h of this.rows.values()) {
      if (h.sourceKind === sourceKind && h.sourceId === sourceId && h.reason === "sanctions_potential_match" && !h.releasedAt) {
        this.rows.set(h.id, { ...h, releasedAt: now.toISOString(), releasedBy: by, releaseNote: note });
        n++;
      }
    }
    return n;
  }

  async active(dealId: string) {
    return [...this.rows.values()].filter((h) => h.dealId === dealId && !h.releasedAt).map((h) => ({ ...h }));
  }

  async all(dealId: string) {
    return [...this.rows.values()].filter((h) => h.dealId === dealId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((h) => ({ ...h }));
  }
}
