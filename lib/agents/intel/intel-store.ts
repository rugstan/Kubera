// Persistence for the weekly market-intel drafts (public.intel_drafts).
// Contract + in-memory implementation that mirrors the migration's
// constraints; the Supabase one is intel-store-supabase.ts.

import { randomUUID } from "node:crypto";
import { INTEL_LIMITS, type IntelDraft, type IntelEdit, type IntelStatus, type NewIntelDraft } from "./types";

export class IntelStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntelStoreError";
  }
}

export type IntelReview = { decision: "approved" | "rejected"; by: string; note?: string | null };

export interface IntelStore {
  /**
   * Stores a new draft as the next version for its week; earlier drafts of
   * that week that are still waiting for review become `superseded`.
   */
  insertDraft(draft: NewIntelDraft, now: Date): Promise<IntelDraft>;
  getDraft(id: string): Promise<IntelDraft | null>;
  listDrafts(opts?: { status?: IntelStatus; limit?: number }): Promise<IntelDraft[]>;
  latestForWeek(weekStart: string): Promise<IntelDraft | null>;
  /** Staff edit while the draft is waiting for review; null when it is no longer pending. */
  editDraft(id: string, edit: IntelEdit, by: string, now: Date): Promise<IntelDraft | null>;
  /** Approve or reject a pending draft; null when it is no longer pending. */
  reviewDraft(id: string, review: IntelReview, now: Date): Promise<IntelDraft | null>;
}

export function validateEdit(edit: IntelEdit): IntelEdit {
  const headline = edit.headline.trim();
  const summary = edit.summary.trim();
  if (!headline || headline.length > INTEL_LIMITS.headline) throw new IntelStoreError(`The headline must be 1 to ${INTEL_LIMITS.headline} characters`);
  if (!summary || summary.length > INTEL_LIMITS.summary) throw new IntelStoreError(`The summary must be 1 to ${INTEL_LIMITS.summary} characters`);
  if (edit.sections.length > INTEL_LIMITS.maxSections) throw new IntelStoreError(`At most ${INTEL_LIMITS.maxSections} sections`);
  const sections = edit.sections.map((s) => {
    const title = s.title.trim();
    if (!title || title.length > INTEL_LIMITS.sectionTitle) throw new IntelStoreError(`Section titles must be 1 to ${INTEL_LIMITS.sectionTitle} characters`);
    if (s.bullets.length > INTEL_LIMITS.maxBullets) throw new IntelStoreError(`At most ${INTEL_LIMITS.maxBullets} bullets per section`);
    return {
      title,
      bullets: s.bullets.map((b) => {
        const text = b.text.trim();
        if (!text || text.length > INTEL_LIMITS.bulletText) throw new IntelStoreError(`Each bullet must be 1 to ${INTEL_LIMITS.bulletText} characters`);
        return { text, signalIds: [...new Set(b.signalIds)] };
      }),
    };
  });
  return { headline, summary, sections };
}

export function validateReview(review: IntelReview): IntelReview {
  const note = review.note?.trim() || null;
  if (note && note.length > INTEL_LIMITS.reviewNote) throw new IntelStoreError(`The review note is limited to ${INTEL_LIMITS.reviewNote} characters`);
  if (review.decision === "rejected" && !note) throw new IntelStoreError("Say why the draft is rejected");
  return { ...review, note };
}

export class MemoryIntelStore implements IntelStore {
  readonly rows = new Map<string, IntelDraft>();

  async insertDraft(draft: NewIntelDraft, now: Date): Promise<IntelDraft> {
    const ts = now.toISOString();
    const sameWeek = [...this.rows.values()].filter((r) => r.weekStart === draft.weekStart);
    const version = sameWeek.reduce((v, r) => Math.max(v, r.version), 0) + 1;
    for (const r of sameWeek) if (r.status === "pending_review") this.rows.set(r.id, { ...r, status: "superseded", updatedAt: ts });
    const row: IntelDraft = {
      ...structuredClone(draft),
      id: randomUUID(),
      createdAt: ts,
      updatedAt: ts,
      version,
      status: "pending_review",
      editedBy: null,
      editedAt: null,
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
    };
    this.rows.set(row.id, row);
    return structuredClone(row);
  }

  async getDraft(id: string): Promise<IntelDraft | null> {
    const r = this.rows.get(id);
    return r ? structuredClone(r) : null;
  }

  async listDrafts(opts: { status?: IntelStatus; limit?: number } = {}): Promise<IntelDraft[]> {
    return [...this.rows.values()]
      .filter((r) => !opts.status || r.status === opts.status)
      .sort((a, b) => b.weekStart.localeCompare(a.weekStart) || b.version - a.version)
      .slice(0, opts.limit ?? 50)
      .map((r) => structuredClone(r));
  }

  async latestForWeek(weekStart: string): Promise<IntelDraft | null> {
    const rows = [...this.rows.values()].filter((r) => r.weekStart === weekStart).sort((a, b) => b.version - a.version);
    return rows[0] ? structuredClone(rows[0]) : null;
  }

  async editDraft(id: string, edit: IntelEdit, by: string, now: Date): Promise<IntelDraft | null> {
    const r = this.rows.get(id);
    if (!r || r.status !== "pending_review") return null;
    const v = validateEdit(edit);
    const next: IntelDraft = { ...r, ...v, editedBy: by, editedAt: now.toISOString(), updatedAt: now.toISOString() };
    this.rows.set(id, next);
    return structuredClone(next);
  }

  async reviewDraft(id: string, review: IntelReview, now: Date): Promise<IntelDraft | null> {
    const r = this.rows.get(id);
    if (!r || r.status !== "pending_review") return null;
    const v = validateReview(review);
    const next: IntelDraft = { ...r, status: v.decision, reviewedBy: v.by, reviewedAt: now.toISOString(), reviewNote: v.note ?? null, updatedAt: now.toISOString() };
    this.rows.set(id, next);
    return structuredClone(next);
  }
}
