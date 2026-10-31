import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GuardrailCategory, GuardrailMode } from "@/lib/ai/guardrails";
import type { StoredMessage } from "@/lib/conversations/store";
import {
  ANNOTATION_NOTE_MAX,
  FLAG_REASON_MAX,
  previewOf,
  type Annotation,
  type AnnotationLabel,
  type ConversationSummary,
  type FlagInput,
  type GuardrailEventRecord,
  type NewAnnotation,
  type NewGuardrailEvent,
  type ReviewConversation,
  type ReviewStats,
  type ReviewStatus,
  type ReviewStore,
  type ReviewView,
} from "./types";

// Supabase-backed review store (service role; RLS denies the API roles).

const DAY_MS = 86_400_000;

type ConversationRow = {
  id: string;
  created_at: string;
  last_message_at: string | null;
  page: string | null;
  turn_count: number;
  lead_id: string | null;
  flagged: boolean;
  flag_reason: string | null;
  flagged_at: string | null;
  flagged_by: string | null;
  review_status: ReviewStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  first_message?: string | null;
  messages?: StoredMessage[] | null;
};

type AnnotationRow = {
  id: string;
  conversation_id: string;
  message_index: number | null;
  label: AnnotationLabel;
  note: string;
  author_id: string | null;
  author_label: string;
  created_at: string;
};

type EventRow = {
  id: string;
  conversation_id: string;
  message_index: number;
  rule_id: string;
  category: GuardrailCategory;
  excerpt: string;
  replaced: boolean;
  mode: GuardrailMode;
  created_at: string;
};

const SUMMARY_COLUMNS = "id, created_at, last_message_at, page, turn_count, lead_id, flagged, flag_reason, flagged_at, flagged_by, review_status, reviewed_by, reviewed_at";

function fail(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

export function toSummary(r: ConversationRow, guardrailCount: number, annotationCount: number): ConversationSummary {
  const preview = r.messages ? previewOf(r.messages) : previewOf(r.first_message ? [{ role: "user", content: r.first_message, mode: "chat", at: r.created_at }] : []);
  return {
    id: r.id,
    createdAt: r.created_at,
    lastMessageAt: r.last_message_at,
    page: r.page,
    turnCount: r.turn_count,
    flagged: r.flagged,
    flagReason: r.flag_reason,
    flaggedBy: r.flagged_by,
    flaggedAt: r.flagged_at,
    reviewStatus: r.review_status,
    reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at,
    leadLinked: r.lead_id !== null,
    preview,
    guardrailCount,
    annotationCount,
  };
}

export const toAnnotation = (r: AnnotationRow): Annotation => ({
  id: r.id,
  conversationId: r.conversation_id,
  messageIndex: r.message_index,
  label: r.label,
  note: r.note,
  authorId: r.author_id,
  authorLabel: r.author_label,
  createdAt: r.created_at,
});

export const toEvent = (r: EventRow): GuardrailEventRecord => ({
  id: r.id,
  conversationId: r.conversation_id,
  messageIndex: r.message_index,
  ruleId: r.rule_id,
  category: r.category,
  excerpt: r.excerpt,
  replaced: r.replaced,
  mode: r.mode,
  createdAt: r.created_at,
});

export class SupabaseReviewStore implements ReviewStore {
  constructor(
    private readonly db: SupabaseClient,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private async counts(table: "ai_guardrail_events" | "ai_review_annotations", ids: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!ids.length) return out;
    const { data, error } = await this.db.from(table).select("conversation_id").in("conversation_id", ids).limit(10_000);
    fail(error, `count ${table}`);
    for (const r of (data ?? []) as { conversation_id: string }[]) out.set(r.conversation_id, (out.get(r.conversation_id) ?? 0) + 1);
    return out;
  }

  async list(view: ReviewView, limit = 100): Promise<ConversationSummary[]> {
    // `messages->0->>content` is the first message; the full transcript stays in the row.
    let q = this.db.from("ai_conversations").select(`${SUMMARY_COLUMNS}, first_message:messages->0->>content`);
    if (view === "needs_review") q = q.eq("flagged", true).neq("review_status", "reviewed");
    else if (view === "flagged") q = q.eq("flagged", true);
    else if (view === "reviewed") q = q.eq("review_status", "reviewed");
    else if (view === "guardrail") {
      const { data, error } = await this.db.from("ai_guardrail_events").select("conversation_id").order("created_at", { ascending: false }).limit(1_000);
      fail(error, "list guardrail conversations");
      const ids = [...new Set(((data ?? []) as { conversation_id: string }[]).map((r) => r.conversation_id))].slice(0, limit);
      if (!ids.length) return [];
      q = q.in("id", ids);
    }
    const { data, error } = await q
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(limit);
    fail(error, "list conversations");
    const rows = (data ?? []) as unknown as ConversationRow[];
    const ids = rows.map((r) => r.id);
    const [events, notes] = await Promise.all([this.counts("ai_guardrail_events", ids), this.counts("ai_review_annotations", ids)]);
    return rows.map((r) => toSummary(r, events.get(r.id) ?? 0, notes.get(r.id) ?? 0));
  }

  async get(id: string): Promise<ReviewConversation | null> {
    const { data, error } = await this.db.from("ai_conversations").select(`${SUMMARY_COLUMNS}, messages`).eq("id", id).maybeSingle();
    fail(error, "read conversation");
    if (!data) return null;
    const row = data as unknown as ConversationRow;
    const [ann, ev] = await Promise.all([
      this.db.from("ai_review_annotations").select("*").eq("conversation_id", id).order("created_at"),
      this.db.from("ai_guardrail_events").select("*").eq("conversation_id", id).order("created_at"),
    ]);
    fail(ann.error, "read annotations");
    fail(ev.error, "read guardrail events");
    const annotations = ((ann.data ?? []) as AnnotationRow[]).map(toAnnotation);
    const guardrailEvents = ((ev.data ?? []) as EventRow[]).map(toEvent);
    return { ...toSummary(row, guardrailEvents.length, annotations.length), messages: row.messages ?? [], annotations, guardrailEvents };
  }

  async stats(now: Date = this.clock()): Promise<ReviewStats> {
    const conv = () => this.db.from("ai_conversations").select("id", { count: "exact", head: true });
    const [total, flagged, needs, reviewed, hits] = await Promise.all([
      conv(),
      conv().eq("flagged", true),
      conv().eq("flagged", true).neq("review_status", "reviewed"),
      conv().eq("review_status", "reviewed"),
      this.db.from("ai_guardrail_events").select("id", { count: "exact", head: true }).gte("created_at", new Date(now.getTime() - 30 * DAY_MS).toISOString()),
    ]);
    for (const r of [total, flagged, needs, reviewed, hits]) fail(r.error, "review stats");
    return { total: total.count ?? 0, flagged: flagged.count ?? 0, needsReview: needs.count ?? 0, reviewed: reviewed.count ?? 0, guardrailHits30d: hits.count ?? 0 };
  }

  async setFlag(id: string, input: FlagInput, now: Date = this.clock()): Promise<boolean> {
    const patch = input.flagged
      ? { flagged: true, flag_reason: input.reason?.trim().slice(0, FLAG_REASON_MAX) || null, flagged_by: input.by, flagged_at: now.toISOString(), review_status: "unreviewed", reviewed_by: null, reviewed_at: null }
      : { flagged: false, flag_reason: null, flagged_by: null, flagged_at: null };
    const { data, error } = await this.db.from("ai_conversations").update(patch).eq("id", id).select("id").maybeSingle();
    fail(error, "flag conversation");
    return data !== null;
  }

  async setReviewStatus(id: string, status: ReviewStatus, by: string, now: Date = this.clock()): Promise<boolean> {
    const patch = { review_status: status, reviewed_by: status === "unreviewed" ? null : by, reviewed_at: status === "unreviewed" ? null : now.toISOString() };
    const { data, error } = await this.db.from("ai_conversations").update(patch).eq("id", id).select("id").maybeSingle();
    fail(error, "set review status");
    return data !== null;
  }

  async addAnnotation(input: NewAnnotation, now: Date = this.clock()): Promise<Annotation | null> {
    const note = input.note.trim().slice(0, ANNOTATION_NOTE_MAX);
    if (!note) return null;
    if (input.messageIndex !== null) {
      // The index has to point at a real message of this conversation.
      const { data, error } = await this.db.from("ai_conversations").select("turn_count").eq("id", input.conversationId).maybeSingle();
      fail(error, "read conversation");
      if (!data || input.messageIndex < 0 || input.messageIndex >= (data as { turn_count: number }).turn_count * 2) return null;
    }
    const { data, error } = await this.db
      .from("ai_review_annotations")
      .insert({
        conversation_id: input.conversationId,
        message_index: input.messageIndex,
        label: input.label,
        note,
        author_id: input.authorId,
        author_label: input.authorLabel.slice(0, 200),
        created_at: now.toISOString(),
      })
      .select("*")
      .maybeSingle();
    // 23503 = the conversation was deleted (retention) while the form was open.
    if (error && (error as { code?: string }).code === "23503") return null;
    fail(error, "add annotation");
    return data ? toAnnotation(data as AnnotationRow) : null;
  }

  async autoFlag(id: string, reason: string, now: Date = this.clock()): Promise<void> {
    const { error } = await this.db
      .from("ai_conversations")
      .update({ flagged: true, flag_reason: reason.slice(0, FLAG_REASON_MAX), flagged_by: "guardrail", flagged_at: now.toISOString() })
      .eq("id", id)
      .eq("flagged", false);
    fail(error, "auto-flag conversation");
    // New activity on a reviewed conversation puts it back in the queue.
    const { error: reopen } = await this.db.from("ai_conversations").update({ review_status: "unreviewed", reviewed_by: null, reviewed_at: null }).eq("id", id).eq("review_status", "reviewed");
    fail(reopen, "reopen conversation");
  }

  async recordGuardrailEvents(events: NewGuardrailEvent[], now: Date = this.clock()): Promise<void> {
    if (!events.length) return;
    const { error } = await this.db.from("ai_guardrail_events").insert(
      events.map((e) => ({
        conversation_id: e.conversationId,
        message_index: e.messageIndex,
        rule_id: e.ruleId,
        category: e.category,
        excerpt: e.excerpt.slice(0, 600),
        replaced: e.replaced,
        mode: e.mode,
        created_at: now.toISOString(),
      })),
    );
    fail(error, "record guardrail events");
  }
}
