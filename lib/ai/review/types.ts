// Supervision of Ask Corin AI: what staff see when they review a conversation.
// The transcript itself lives in public.ai_conversations (lib/conversations);
// flags, review status, annotations and guardrail hits are the supervision
// layer on top of it (migration 20261104000400_o_ai_supervision.sql).

import type { GuardrailCategory, GuardrailMode } from "@/lib/ai/guardrails";
import type { StoredMessage } from "@/lib/conversations/store";

export const REVIEW_STATUSES = ["unreviewed", "in_review", "reviewed"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  unreviewed: "Not reviewed",
  in_review: "In review",
  reviewed: "Reviewed",
};

export const ANNOTATION_LABELS = ["accurate", "inaccurate", "compliance_issue", "missing_context", "tone", "good_example", "other"] as const;
export type AnnotationLabel = (typeof ANNOTATION_LABELS)[number];

export const ANNOTATION_LABEL_TEXT: Record<AnnotationLabel, string> = {
  accurate: "Accurate",
  inaccurate: "Inaccurate",
  compliance_issue: "Compliance issue",
  missing_context: "Missing context",
  tone: "Tone",
  good_example: "Good example",
  other: "Other",
};

/** Queue views. "needs_review" is flagged and not yet marked reviewed. */
export const REVIEW_VIEWS = ["needs_review", "flagged", "guardrail", "reviewed", "all"] as const;
export type ReviewView = (typeof REVIEW_VIEWS)[number];

export const REVIEW_VIEW_LABELS: Record<ReviewView, string> = {
  needs_review: "Needs review",
  flagged: "Flagged",
  guardrail: "Guardrail hits",
  reviewed: "Reviewed",
  all: "All conversations",
};

export type ConversationSummary = {
  id: string;
  createdAt: string;
  lastMessageAt: string | null;
  page: string | null;
  turnCount: number;
  flagged: boolean;
  flagReason: string | null;
  flaggedBy: string | null;
  flaggedAt: string | null;
  reviewStatus: ReviewStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  /** True when the conversation is tied to a lead (the lead itself is not shown here). */
  leadLinked: boolean;
  /** First user message, trimmed, for the queue. */
  preview: string;
  guardrailCount: number;
  annotationCount: number;
};

export type Annotation = {
  id: string;
  conversationId: string;
  /** Index into the conversation's messages array, or null for a note on the whole conversation. */
  messageIndex: number | null;
  label: AnnotationLabel;
  note: string;
  authorId: string | null;
  authorLabel: string;
  createdAt: string;
};

export type NewAnnotation = Omit<Annotation, "id" | "createdAt">;

export type GuardrailEventRecord = {
  id: string;
  conversationId: string;
  /** Index of the assistant message the hit was in. */
  messageIndex: number;
  ruleId: string;
  category: GuardrailCategory;
  /** The offending sentence as the model wrote it (internal; the borrower saw the replacement). */
  excerpt: string;
  replaced: boolean;
  mode: GuardrailMode;
  createdAt: string;
};

export type NewGuardrailEvent = Omit<GuardrailEventRecord, "id" | "createdAt">;

export type ReviewConversation = ConversationSummary & {
  messages: StoredMessage[];
  annotations: Annotation[];
  guardrailEvents: GuardrailEventRecord[];
};

export type ReviewStats = {
  total: number;
  flagged: number;
  needsReview: number;
  reviewed: number;
  /** Guardrail hits recorded in the last 30 days. */
  guardrailHits30d: number;
};

export type FlagInput = { flagged: boolean; reason?: string | null; by: string };

export interface ReviewStore {
  list(view: ReviewView, limit?: number): Promise<ConversationSummary[]>;
  get(id: string): Promise<ReviewConversation | null>;
  stats(now?: Date): Promise<ReviewStats>;
  /** Staff flag or unflag. Unflagging clears the reason. */
  setFlag(id: string, input: FlagInput, now?: Date): Promise<boolean>;
  setReviewStatus(id: string, status: ReviewStatus, by: string, now?: Date): Promise<boolean>;
  addAnnotation(input: NewAnnotation, now?: Date): Promise<Annotation | null>;
  /** Flags a conversation on a guardrail hit unless it is already flagged; a reviewed one goes back to unreviewed. */
  autoFlag(id: string, reason: string, now?: Date): Promise<void>;
  recordGuardrailEvents(events: NewGuardrailEvent[], now?: Date): Promise<void>;
}

export const ANNOTATION_NOTE_MAX = 2_000;
export const FLAG_REASON_MAX = 300;

/** First user message as a one-line preview for the queue. */
export function previewOf(messages: readonly StoredMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  const text = (first?.content ?? "").replace(/\s+/g, " ").trim();
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}
