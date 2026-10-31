import { randomUUID } from "node:crypto";
import type { StoredMessage } from "@/lib/conversations/store";
import {
  ANNOTATION_NOTE_MAX,
  FLAG_REASON_MAX,
  previewOf,
  type Annotation,
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

/** A transcript as the memory store holds it (mirrors the ai_conversations columns the queue uses). */
export type SeedConversation = {
  id?: string;
  createdAt: string;
  lastMessageAt?: string | null;
  page?: string | null;
  messages: StoredMessage[];
  leadLinked?: boolean;
  flagged?: boolean;
  flagReason?: string | null;
  flaggedBy?: string | null;
  flaggedAt?: string | null;
  reviewStatus?: ReviewStatus;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
};

type Row = Required<Omit<SeedConversation, "leadLinked">> & { leadLinked: boolean };

const DAY_MS = 86_400_000;

/**
 * In-memory review store: the test fake, and the demo data behind fake-auth
 * mode. Mirrors the Supabase store's behavior, including the guarded updates.
 */
export class MemoryReviewStore implements ReviewStore {
  private readonly rows = new Map<string, Row>();
  private readonly annotations: Annotation[] = [];
  private readonly events: GuardrailEventRecord[] = [];

  constructor(private readonly clock: () => Date = () => new Date()) {}

  seed(c: SeedConversation): string {
    const id = c.id ?? randomUUID();
    this.rows.set(id, {
      id,
      createdAt: c.createdAt,
      lastMessageAt: c.lastMessageAt ?? c.messages.at(-1)?.at ?? c.createdAt,
      page: c.page ?? null,
      messages: structuredClone(c.messages),
      leadLinked: c.leadLinked ?? false,
      flagged: c.flagged ?? false,
      flagReason: c.flagReason ?? null,
      flaggedBy: c.flaggedBy ?? null,
      flaggedAt: c.flaggedAt ?? null,
      reviewStatus: c.reviewStatus ?? "unreviewed",
      reviewedBy: c.reviewedBy ?? null,
      reviewedAt: c.reviewedAt ?? null,
    });
    return id;
  }

  private summary(r: Row): ConversationSummary {
    return {
      id: r.id,
      createdAt: r.createdAt,
      lastMessageAt: r.lastMessageAt,
      page: r.page,
      turnCount: Math.floor(r.messages.length / 2),
      flagged: r.flagged,
      flagReason: r.flagReason,
      flaggedBy: r.flaggedBy,
      flaggedAt: r.flaggedAt,
      reviewStatus: r.reviewStatus,
      reviewedBy: r.reviewedBy,
      reviewedAt: r.reviewedAt,
      leadLinked: r.leadLinked,
      preview: previewOf(r.messages),
      guardrailCount: this.events.filter((e) => e.conversationId === r.id).length,
      annotationCount: this.annotations.filter((a) => a.conversationId === r.id).length,
    };
  }

  async list(view: ReviewView, limit = 100): Promise<ConversationSummary[]> {
    const keep = (s: ConversationSummary) => {
      switch (view) {
        case "needs_review":
          return s.flagged && s.reviewStatus !== "reviewed";
        case "flagged":
          return s.flagged;
        case "guardrail":
          return s.guardrailCount > 0;
        case "reviewed":
          return s.reviewStatus === "reviewed";
        case "all":
          return true;
      }
    };
    return [...this.rows.values()]
      .map((r) => this.summary(r))
      .filter(keep)
      .sort((a, b) => (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt))
      .slice(0, limit);
  }

  async get(id: string): Promise<ReviewConversation | null> {
    const r = this.rows.get(id);
    if (!r) return null;
    return {
      ...this.summary(r),
      messages: structuredClone(r.messages),
      annotations: this.annotations.filter((a) => a.conversationId === id).map((a) => ({ ...a })),
      guardrailEvents: this.events.filter((e) => e.conversationId === id).map((e) => ({ ...e })),
    };
  }

  async stats(now: Date = this.clock()): Promise<ReviewStats> {
    const rows = [...this.rows.values()];
    const since = now.getTime() - 30 * DAY_MS;
    return {
      total: rows.length,
      flagged: rows.filter((r) => r.flagged).length,
      needsReview: rows.filter((r) => r.flagged && r.reviewStatus !== "reviewed").length,
      reviewed: rows.filter((r) => r.reviewStatus === "reviewed").length,
      guardrailHits30d: this.events.filter((e) => Date.parse(e.createdAt) >= since).length,
    };
  }

  async setFlag(id: string, input: FlagInput, now: Date = this.clock()): Promise<boolean> {
    const r = this.rows.get(id);
    if (!r) return false;
    if (input.flagged) {
      r.flagged = true;
      r.flagReason = input.reason?.trim().slice(0, FLAG_REASON_MAX) || null;
      r.flaggedBy = input.by;
      r.flaggedAt = now.toISOString();
      // A fresh flag puts the conversation back in the queue.
      if (r.reviewStatus === "reviewed") {
        r.reviewStatus = "unreviewed";
        r.reviewedBy = null;
        r.reviewedAt = null;
      }
    } else {
      r.flagged = false;
      r.flagReason = null;
      r.flaggedBy = null;
      r.flaggedAt = null;
    }
    return true;
  }

  async setReviewStatus(id: string, status: ReviewStatus, by: string, now: Date = this.clock()): Promise<boolean> {
    const r = this.rows.get(id);
    if (!r) return false;
    r.reviewStatus = status;
    r.reviewedBy = status === "unreviewed" ? null : by;
    r.reviewedAt = status === "unreviewed" ? null : now.toISOString();
    return true;
  }

  async addAnnotation(input: NewAnnotation, now: Date = this.clock()): Promise<Annotation | null> {
    const r = this.rows.get(input.conversationId);
    if (!r) return null;
    if (input.messageIndex !== null && (input.messageIndex < 0 || input.messageIndex >= r.messages.length)) return null;
    const note = input.note.trim().slice(0, ANNOTATION_NOTE_MAX);
    if (!note) return null;
    const a: Annotation = { ...input, note, id: randomUUID(), createdAt: now.toISOString() };
    this.annotations.push(a);
    return { ...a };
  }

  async autoFlag(id: string, reason: string, now: Date = this.clock()): Promise<void> {
    const r = this.rows.get(id);
    if (!r) return;
    if (!r.flagged) {
      r.flagged = true;
      r.flagReason = reason.slice(0, FLAG_REASON_MAX);
      r.flaggedBy = "guardrail";
      r.flaggedAt = now.toISOString();
    }
    if (r.reviewStatus === "reviewed") {
      r.reviewStatus = "unreviewed";
      r.reviewedBy = null;
      r.reviewedAt = null;
    }
  }

  async recordGuardrailEvents(events: NewGuardrailEvent[], now: Date = this.clock()): Promise<void> {
    for (const e of events) {
      if (!this.rows.has(e.conversationId)) continue;
      this.events.push({ ...e, id: randomUUID(), createdAt: now.toISOString() });
    }
  }
}
