import type { SupabaseClient } from "@supabase/supabase-js";
import { IntelStoreError, validateEdit, validateReview, type IntelReview, type IntelStore } from "./intel-store";
import type { IntelDraft, IntelEdit, IntelSection, IntelSignalRef, IntelStatus, NewIntelDraft } from "./types";

// Supabase-backed intel draft store (service role; RLS denies the API roles).

type Row = {
  id: string;
  created_at: string;
  updated_at: string;
  week_start: string;
  version: number;
  status: IntelStatus;
  generated_by: "model" | "rules";
  model: string | null;
  served_model: string | null;
  prompt_id: string | null;
  prompt_version: string | null;
  prompt_sha256: string | null;
  headline: string;
  summary: string;
  sections: IntelSection[];
  signals: IntelSignalRef[];
  guardrail_hits: string[];
  injection_codes: string[];
  note: string | null;
  created_by: string;
  edited_by: string | null;
  edited_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
};

function fail(error: { message: string } | null, what: string): void {
  if (error) throw new IntelStoreError(`${what}: ${error.message}`);
}

export function draftFromRow(r: Row): IntelDraft {
  return {
    id: r.id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    weekStart: r.week_start,
    version: r.version,
    status: r.status,
    generatedBy: r.generated_by,
    model: r.model,
    servedModel: r.served_model,
    promptId: r.prompt_id,
    promptVersion: r.prompt_version,
    promptSha256: r.prompt_sha256,
    headline: r.headline,
    summary: r.summary,
    sections: r.sections ?? [],
    signals: r.signals ?? [],
    guardrailHits: r.guardrail_hits ?? [],
    injectionCodes: r.injection_codes ?? [],
    note: r.note,
    createdBy: r.created_by,
    editedBy: r.edited_by,
    editedAt: r.edited_at,
    reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at,
    reviewNote: r.review_note,
  };
}

export class SupabaseIntelStore implements IntelStore {
  constructor(private readonly db: SupabaseClient) {}

  async insertDraft(draft: NewIntelDraft, now: Date): Promise<IntelDraft> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const latest = await this.latestForWeek(draft.weekStart);
      const version = (latest?.version ?? 0) + 1;
      const { data, error } = await this.db
        .from("intel_drafts")
        .insert({
          week_start: draft.weekStart,
          version,
          status: "pending_review",
          generated_by: draft.generatedBy,
          model: draft.model,
          served_model: draft.servedModel,
          prompt_id: draft.promptId,
          prompt_version: draft.promptVersion,
          prompt_sha256: draft.promptSha256,
          headline: draft.headline,
          summary: draft.summary,
          sections: draft.sections,
          signals: draft.signals,
          guardrail_hits: draft.guardrailHits,
          injection_codes: draft.injectionCodes,
          note: draft.note,
          created_by: draft.createdBy,
        })
        .select("*")
        .single();
      if (error) {
        // Two runs raced for the same version: try the next one.
        if (error.code === "23505" && attempt < 3) continue;
        fail(error, "intel draft insert");
      }
      const row = draftFromRow(data as Row);
      const { error: supersedeError } = await this.db
        .from("intel_drafts")
        .update({ status: "superseded", updated_at: now.toISOString() })
        .eq("week_start", draft.weekStart)
        .eq("status", "pending_review")
        .neq("id", row.id);
      fail(supersedeError, "intel draft supersede");
      return row;
    }
    throw new IntelStoreError("intel draft insert: could not allocate a version");
  }

  async getDraft(id: string): Promise<IntelDraft | null> {
    const { data, error } = await this.db.from("intel_drafts").select("*").eq("id", id).maybeSingle();
    fail(error, "intel draft read");
    return data ? draftFromRow(data as Row) : null;
  }

  async listDrafts(opts: { status?: IntelStatus; limit?: number } = {}): Promise<IntelDraft[]> {
    let q = this.db.from("intel_drafts").select("*").order("week_start", { ascending: false }).order("version", { ascending: false }).limit(opts.limit ?? 50);
    if (opts.status) q = q.eq("status", opts.status);
    const { data, error } = await q;
    fail(error, "intel draft list");
    return ((data ?? []) as Row[]).map(draftFromRow);
  }

  async latestForWeek(weekStart: string): Promise<IntelDraft | null> {
    const { data, error } = await this.db.from("intel_drafts").select("*").eq("week_start", weekStart).order("version", { ascending: false }).limit(1);
    fail(error, "intel draft latest");
    const row = ((data ?? []) as Row[])[0];
    return row ? draftFromRow(row) : null;
  }

  async editDraft(id: string, edit: IntelEdit, by: string, now: Date): Promise<IntelDraft | null> {
    const v = validateEdit(edit);
    const { data, error } = await this.db
      .from("intel_drafts")
      .update({ headline: v.headline, summary: v.summary, sections: v.sections, edited_by: by.slice(0, 200), edited_at: now.toISOString() })
      .eq("id", id)
      .eq("status", "pending_review")
      .select("*")
      .maybeSingle();
    fail(error, "intel draft edit");
    return data ? draftFromRow(data as Row) : null;
  }

  async reviewDraft(id: string, review: IntelReview, now: Date): Promise<IntelDraft | null> {
    const v = validateReview(review);
    const { data, error } = await this.db
      .from("intel_drafts")
      .update({ status: v.decision, reviewed_by: v.by.slice(0, 200), reviewed_at: now.toISOString(), review_note: v.note ?? null })
      .eq("id", id)
      .eq("status", "pending_review")
      .select("*")
      .maybeSingle();
    fail(error, "intel draft review");
    return data ? draftFromRow(data as Row) : null;
  }
}
