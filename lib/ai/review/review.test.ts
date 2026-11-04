import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { StoredMessage } from "@/lib/conversations/store";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ supabaseAdmin: () => null }));

const { MemoryReviewStore } = await import("./memory");
const { reviewGuardrailSink } = await import("./sink");
const { SupabaseReviewStore, toSummary } = await import("./supabase");
const { guardrailSink, reviewStore, setReviewStore } = await import("./server");
const { previewOf } = await import("./types");

const NOW = new Date("2026-11-04T18:00:00Z");
const msgs = (...pairs: [string, string][]): StoredMessage[] =>
  pairs.flatMap(([q, a], i) => [
    { role: "user" as const, content: q, mode: "chat" as const, at: `2026-11-04T1${i}:00:00Z` },
    { role: "assistant" as const, content: a, stopReason: "end_turn", at: `2026-11-04T1${i}:00:30Z` },
  ]);

function seeded() {
  const store = new MemoryReviewStore(() => NOW);
  const a = store.seed({ createdAt: "2026-11-04T10:00:00Z", lastMessageAt: "2026-11-04T10:05:00Z", messages: msgs(["What DSCR does HUD 232 need?", "About 1.45x."]) });
  const b = store.seed({ createdAt: "2026-11-04T11:00:00Z", lastMessageAt: "2026-11-04T11:05:00Z", messages: msgs(["Am I approved?", "I can't say."], ["And my rate?", "Indicative only."]), flagged: true, flagReason: "Customer asked about approval", flaggedBy: "ana" });
  const c = store.seed({ createdAt: "2026-11-04T12:00:00Z", lastMessageAt: "2026-11-04T12:05:00Z", messages: msgs(["Hotel PIP?", "Reserved."]), flagged: true, reviewStatus: "reviewed", reviewedBy: "lee", reviewedAt: "2026-11-04T13:00:00Z" });
  return { store, a, b, c };
}

describe("MemoryReviewStore", () => {
  it("lists by view, newest activity first", async () => {
    const { store, a, b, c } = seeded();
    expect((await store.list("all")).map((s) => s.id)).toEqual([c, b, a]);
    expect((await store.list("flagged")).map((s) => s.id)).toEqual([c, b]);
    expect((await store.list("needs_review")).map((s) => s.id)).toEqual([b]);
    expect((await store.list("reviewed")).map((s) => s.id)).toEqual([c]);
    expect(await store.list("guardrail")).toEqual([]);
    expect((await store.list("all", 2)).length).toBe(2);
  });

  it("summarizes a conversation", async () => {
    const { store, b } = seeded();
    expect((await store.list("flagged")).find((s) => s.id === b)).toMatchObject({ preview: "Am I approved?", turnCount: 2, flagged: true, flagReason: "Customer asked about approval", reviewStatus: "unreviewed", guardrailCount: 0, annotationCount: 0 });
  });

  it("flags with a reason, unflags, and puts a reviewed conversation back in the queue", async () => {
    const { store, a, c } = seeded();
    expect(await store.setFlag(a, { flagged: true, reason: "  Quoted a rate as final  ", by: "ana" }, NOW)).toBe(true);
    expect(await store.get(a)).toMatchObject({ flagged: true, flagReason: "Quoted a rate as final", flaggedBy: "ana", flaggedAt: NOW.toISOString() });
    expect(await store.setFlag(a, { flagged: false, by: "ana" })).toBe(true);
    expect(await store.get(a)).toMatchObject({ flagged: false, flagReason: null, flaggedBy: null });

    await store.setFlag(c, { flagged: true, reason: "Look again", by: "ana" });
    expect(await store.get(c)).toMatchObject({ flagged: true, reviewStatus: "unreviewed", reviewedBy: null });
    expect(await store.setFlag("00000000-0000-4000-8000-000000000000", { flagged: true, by: "x" })).toBe(false);
  });

  it("sets the review status and who did it", async () => {
    const { store, b } = seeded();
    await store.setReviewStatus(b, "reviewed", "lee", NOW);
    expect(await store.get(b)).toMatchObject({ reviewStatus: "reviewed", reviewedBy: "lee", reviewedAt: NOW.toISOString() });
    await store.setReviewStatus(b, "unreviewed", "lee");
    expect(await store.get(b)).toMatchObject({ reviewStatus: "unreviewed", reviewedBy: null, reviewedAt: null });
  });

  it("adds annotations to messages that exist and rejects the rest", async () => {
    const { store, b } = seeded();
    const ok = await store.addAnnotation({ conversationId: b, messageIndex: 1, label: "accurate", note: "  Correct deferral.  ", authorId: null, authorLabel: "Ana" }, NOW);
    expect(ok).toMatchObject({ note: "Correct deferral.", messageIndex: 1, label: "accurate", createdAt: NOW.toISOString() });
    expect(await store.addAnnotation({ conversationId: b, messageIndex: null, label: "other", note: "Whole thread", authorId: "u1", authorLabel: "Ana" })).not.toBeNull();
    expect(await store.addAnnotation({ conversationId: b, messageIndex: 9, label: "other", note: "x", authorId: null, authorLabel: "Ana" })).toBeNull();
    expect(await store.addAnnotation({ conversationId: b, messageIndex: 0, label: "other", note: "   ", authorId: null, authorLabel: "Ana" })).toBeNull();
    expect(await store.addAnnotation({ conversationId: "nope", messageIndex: null, label: "other", note: "x", authorId: null, authorLabel: "Ana" })).toBeNull();
    const detail = (await store.get(b))!;
    expect(detail.annotations).toHaveLength(2);
    expect(detail.annotationCount).toBe(2);
  });

  it("computes stats", async () => {
    const { store, a } = seeded();
    await store.recordGuardrailEvents([{ conversationId: a, messageIndex: 1, ruleId: "r", category: "commitment", excerpt: "e", replaced: true, mode: "enforce" }], new Date("2026-10-30T00:00:00Z"));
    await store.recordGuardrailEvents([{ conversationId: a, messageIndex: 1, ruleId: "r", category: "commitment", excerpt: "e", replaced: true, mode: "enforce" }], new Date("2026-08-01T00:00:00Z"));
    expect(await store.stats(NOW)).toEqual({ total: 3, flagged: 2, needsReview: 1, reviewed: 1, guardrailHits30d: 1 });
  });
});

describe("guardrail sink", () => {
  const violations = [
    { ruleId: "commitment.you-are-approved", category: "commitment" as const, excerpt: "You are approved.", replaced: true },
    { ruleId: "timeline.guarantee", category: "guaranteed_timeline" as const, excerpt: "We guarantee closing in 21 days.", replaced: true },
  ];

  it("records events and flags the conversation once", async () => {
    const { store, a } = seeded();
    const sink = reviewGuardrailSink(store);
    await sink.record({ conversationId: a, messageIndex: 1, mode: "enforce", violations });
    const detail = (await store.get(a))!;
    expect(detail.guardrailEvents.map((e) => e.ruleId)).toEqual(["commitment.you-are-approved", "timeline.guarantee"]);
    expect(detail).toMatchObject({ flagged: true, flagReason: "Guardrail: Commitment language, Guaranteed timeline", flaggedBy: "guardrail", guardrailCount: 2 });
    expect((await store.list("guardrail")).map((s) => s.id)).toEqual([a]);
  });

  it("keeps a staff flag's reason and reopens a reviewed conversation", async () => {
    const { store, b, c } = seeded();
    const sink = reviewGuardrailSink(store);
    await sink.record({ conversationId: b, messageIndex: 1, mode: "enforce", violations: violations.slice(0, 1) });
    expect(await store.get(b)).toMatchObject({ flagReason: "Customer asked about approval", flaggedBy: "ana" });
    await sink.record({ conversationId: c, messageIndex: 1, mode: "monitor", violations: violations.slice(0, 1) });
    expect(await store.get(c)).toMatchObject({ reviewStatus: "unreviewed", reviewedBy: null });
  });

  it("ignores an empty hit", async () => {
    const { store, a } = seeded();
    await reviewGuardrailSink(store).record({ conversationId: a, messageIndex: 1, mode: "enforce", violations: [] });
    expect((await store.get(a))!.flagged).toBe(false);
  });
});

describe("server wiring", () => {
  it("has no store or sink without Supabase, and honors the test override", () => {
    setReviewStore(undefined);
    expect(reviewStore()).toBeNull();
    expect(guardrailSink()).toBeNull();
    const store = new MemoryReviewStore();
    setReviewStore(store);
    expect(reviewStore()).toBe(store);
    expect(guardrailSink()).not.toBeNull();
    setReviewStore(undefined);
  });
});

describe("previewOf", () => {
  it("uses the first user message, collapses whitespace and truncates", () => {
    expect(previewOf([])).toBe("");
    expect(previewOf(msgs(["  What\n is   HUD? ", "x"]))).toBe("What is HUD?");
    const long = previewOf(msgs(["a".repeat(300), "x"]));
    expect(long.length).toBe(140);
    expect(long.endsWith("...")).toBe(true);
  });
});

// --- SupabaseReviewStore against a recording fake ---------------------------------

type Call = { table: string; ops: [string, unknown[]][] };

function fakeDb(responses: Record<string, unknown | ((call: Call) => unknown)>) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const builder: Record<string, unknown> = new Proxy(
        {},
        {
          get(_t, prop: string) {
            if (prop === "then") {
              const r = responses[`${table}`];
              const out = typeof r === "function" ? (r as (c: Call) => unknown)(call) : r;
              return (resolve: (v: unknown) => void) => resolve(out ?? { data: [], error: null });
            }
            return (...args: unknown[]) => {
              call.ops.push([prop, args]);
              return builder;
            };
          },
        },
      );
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

const convRow = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  created_at: "2026-11-04T10:00:00Z",
  last_message_at: "2026-11-04T10:05:00Z",
  page: "/financing/hud-232",
  turn_count: 1,
  lead_id: null,
  flagged: true,
  flag_reason: "Guardrail: Commitment language",
  flagged_at: "2026-11-04T10:06:00Z",
  flagged_by: "guardrail",
  review_status: "unreviewed",
  reviewed_by: null,
  reviewed_at: null,
  first_message: "What DSCR does HUD 232 need?",
  ...over,
});

describe("SupabaseReviewStore", () => {
  it("maps rows to summaries", () => {
    expect(toSummary(convRow() as never, 2, 1)).toMatchObject({ id: "c1", preview: "What DSCR does HUD 232 need?", leadLinked: false, guardrailCount: 2, annotationCount: 1, reviewStatus: "unreviewed" });
    expect(toSummary(convRow({ lead_id: "l1" }) as never, 0, 0).leadLinked).toBe(true);
  });

  it("applies the view filters and counts events and notes per conversation", async () => {
    const { db, calls } = fakeDb({
      ai_conversations: { data: [convRow()], error: null },
      ai_guardrail_events: { data: [{ conversation_id: "c1" }, { conversation_id: "c1" }], error: null },
      ai_review_annotations: { data: [{ conversation_id: "c1" }], error: null },
    });
    const store = new SupabaseReviewStore(db, () => NOW);
    const [row] = await store.list("needs_review");
    expect(row).toMatchObject({ id: "c1", guardrailCount: 2, annotationCount: 1 });
    const q = calls.find((c) => c.table === "ai_conversations")!;
    expect(q.ops).toContainEqual(["eq", ["flagged", true]]);
    expect(q.ops).toContainEqual(["neq", ["review_status", "reviewed"]]);

    calls.length = 0;
    await store.list("reviewed");
    expect(calls.find((c) => c.table === "ai_conversations")!.ops).toContainEqual(["eq", ["review_status", "reviewed"]]);
  });

  it("finds guardrail conversations through the events table", async () => {
    const { db, calls } = fakeDb({
      ai_guardrail_events: { data: [{ conversation_id: "c1" }, { conversation_id: "c1" }, { conversation_id: "c2" }], error: null },
      ai_conversations: { data: [convRow()], error: null },
    });
    await new SupabaseReviewStore(db, () => NOW).list("guardrail");
    expect(calls.find((c) => c.table === "ai_conversations")!.ops).toContainEqual(["in", ["id", ["c1", "c2"]]]);
    const empty = fakeDb({ ai_guardrail_events: { data: [], error: null } });
    expect(await new SupabaseReviewStore(empty.db).list("guardrail")).toEqual([]);
  });

  it("reads a conversation with its notes and events", async () => {
    const { db } = fakeDb({
      ai_conversations: { data: convRow({ messages: msgs(["Hi", "Hello"]) }), error: null },
      ai_review_annotations: { data: [{ id: "a1", conversation_id: "c1", message_index: 1, label: "tone", note: "Friendly", author_id: null, author_label: "Ana", created_at: "t" }], error: null },
      ai_guardrail_events: { data: [{ id: "e1", conversation_id: "c1", message_index: 1, rule_id: "r", category: "commitment", excerpt: "x", replaced: true, mode: "enforce", created_at: "t" }], error: null },
    });
    const c = await new SupabaseReviewStore(db).get("c1");
    expect(c).toMatchObject({ id: "c1", messages: expect.any(Array), annotations: [{ id: "a1", label: "tone", messageIndex: 1 }], guardrailEvents: [{ id: "e1", ruleId: "r", category: "commitment" }], guardrailCount: 1, annotationCount: 1 });
    const missing = fakeDb({ ai_conversations: { data: null, error: null } });
    expect(await new SupabaseReviewStore(missing.db).get("nope")).toBeNull();
  });

  it("surfaces database errors", async () => {
    const { db } = fakeDb({ ai_conversations: { data: null, error: { message: "boom" } } });
    await expect(new SupabaseReviewStore(db).list("all")).rejects.toThrow(/list conversations: boom/);
  });

  it("flags with a reason and clears it on unflag", async () => {
    const { db, calls } = fakeDb({ ai_conversations: { data: { id: "c1" }, error: null } });
    const store = new SupabaseReviewStore(db);
    expect(await store.setFlag("c1", { flagged: true, reason: " Wrong DSCR ", by: "ana" }, NOW)).toBe(true);
    expect(calls[0]!.ops[0]).toEqual(["update", [{ flagged: true, flag_reason: "Wrong DSCR", flagged_by: "ana", flagged_at: NOW.toISOString(), review_status: "unreviewed", reviewed_by: null, reviewed_at: null }]]);
    await store.setFlag("c1", { flagged: false, by: "ana" });
    expect(calls[1]!.ops[0]).toEqual(["update", [{ flagged: false, flag_reason: null, flagged_by: null, flagged_at: null }]]);
  });

  it("checks the message index against the stored turn count before annotating", async () => {
    const { db, calls } = fakeDb({ ai_conversations: { data: { turn_count: 1 }, error: null }, ai_review_annotations: { data: { id: "a1", conversation_id: "c1", message_index: 1, label: "tone", note: "ok", author_id: null, author_label: "Ana", created_at: "t" }, error: null } });
    const store = new SupabaseReviewStore(db);
    expect(await store.addAnnotation({ conversationId: "c1", messageIndex: 2, label: "tone", note: "x", authorId: null, authorLabel: "Ana" })).toBeNull();
    expect(calls.some((c) => c.table === "ai_review_annotations")).toBe(false);
    expect(await store.addAnnotation({ conversationId: "c1", messageIndex: 1, label: "tone", note: "ok", authorId: null, authorLabel: "Ana" })).toMatchObject({ id: "a1" });
    expect(await store.addAnnotation({ conversationId: "c1", messageIndex: null, label: "tone", note: "  ", authorId: null, authorLabel: "Ana" })).toBeNull();
  });

  it("only auto-flags a conversation that is not flagged yet", async () => {
    const { db, calls } = fakeDb({});
    await new SupabaseReviewStore(db).autoFlag("c1", "Guardrail: Commitment language", NOW);
    expect(calls[0]!.ops).toContainEqual(["eq", ["flagged", false]]);
    expect(calls[0]!.ops[0]).toEqual(["update", [expect.objectContaining({ flagged: true, flagged_by: "guardrail" })]]);
    expect(calls[1]!.ops).toContainEqual(["eq", ["review_status", "reviewed"]]);
  });

  it("inserts guardrail events with the capped excerpt", async () => {
    const { db, calls } = fakeDb({});
    await new SupabaseReviewStore(db).recordGuardrailEvents(
      [{ conversationId: "c1", messageIndex: 1, ruleId: "r", category: "commitment", excerpt: "x".repeat(900), replaced: true, mode: "enforce" }],
      NOW,
    );
    const rows = calls[0]!.ops[0]![1][0] as { excerpt: string; conversation_id: string }[];
    expect(rows[0]!.excerpt).toHaveLength(600);
    expect(rows[0]!.conversation_id).toBe("c1");
  });
});
