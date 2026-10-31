import { describe, expect, it, vi } from "vitest";
import type { BetaMessage, BetaMessageStreamParams, BetaRawMessageStreamEvent } from "@anthropic-ai/sdk/resources/beta/messages/messages";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ supabaseAdmin: () => null }));

const { streamAdvisorTurn } = await import("./advisor");
const { SAFE_REPLACEMENTS } = await import("./guardrails");
const { MemoryConversationStore } = await import("@/lib/conversations/store");
const { MemoryReviewStore } = await import("./review/memory");
const { reviewGuardrailSink } = await import("./review/sink");
const { buildTicker } = await import("@/lib/rates");
const { FALLBACK_BENCHMARKS } = await import("@/lib/sizing/assumptions");

const market = { benchmarks: FALLBACK_BENCHMARKS, items: buildTicker(FALLBACK_BENCHMARKS), asOf: "2026-10-30", live: false };

function fakeModel(chunks: string[], stopReason: BetaMessage["stop_reason"] = "end_turn") {
  return {
    stream(_params: BetaMessageStreamParams) {
      return {
        async *[Symbol.asyncIterator](): AsyncIterator<BetaRawMessageStreamEvent> {
          for (const text of chunks) yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } as BetaRawMessageStreamEvent;
        },
        finalMessage: async () => ({ stop_reason: stopReason, model: "claude-opus-5-5" }) as BetaMessage,
        abort: () => {},
      };
    },
  };
}

async function setup() {
  const store = new MemoryConversationStore();
  const conv = await store.create({ ipHash: "h", userAgent: null, page: null });
  const claimed = await store.claim(conv.id, 60_000);
  if (claimed.status !== "ok") throw new Error("claim failed");
  const review = new MemoryReviewStore(() => new Date("2026-11-04T12:00:00Z"));
  // The review store holds the same conversation the advisor writes.
  review.seed({ id: conv.id, createdAt: "2026-11-04T11:00:00Z", messages: [] });
  return { store, conv: claimed.conversation, review };
}

const run = async (chunks: string[], extra: Partial<Parameters<typeof streamAdvisorTurn>[0]> = {}) => {
  const ctx = await setup();
  const out = await new Response(
    await streamAdvisorTurn({
      conversationId: ctx.conv.id,
      history: [],
      turnCount: 0,
      message: "Can I get a HUD loan?",
      mode: "chat",
      market,
      store: ctx.store,
      model: fakeModel(chunks),
      retrieveExcerpts: async () => [],
      guardrailSink: reviewGuardrailSink(ctx.review),
      ...extra,
    }),
  ).text();
  return { ...ctx, out };
};

describe("advisor output guardrails", () => {
  it("passes a clean reply through unchanged and records nothing", async () => {
    const { out, store, conv, review } = await run(["HUD 232 refinances need about 1.45x DSCR. ", "Timing is not guaranteed."]);
    expect(out).toBe("HUD 232 refinances need about 1.45x DSCR. Timing is not guaranteed.");
    expect(store.rows.get(conv.id)!.messages[1]).not.toHaveProperty("guardrail");
    expect((await review.get(conv.id))!.guardrailEvents).toEqual([]);
    expect((await review.get(conv.id))!.flagged).toBe(false);
  });

  it("replaces a commitment sentence before the borrower sees it, stores what was shown, and flags the conversation", async () => {
    const { out, store, conv, review } = await run(["Good news. You are appr", "oved for a HUD 232 loan. ", "A lender confirms terms after underwriting."]);
    expect(out).not.toMatch(/you are approved/i);
    expect(out).toBe(`Good news. ${SAFE_REPLACEMENTS.commitment} A lender confirms terms after underwriting.`);

    // The transcript holds exactly what streamed, plus a marker for reviewers.
    const reply = store.rows.get(conv.id)!.messages[1]!;
    expect(reply).toMatchObject({ role: "assistant", content: out, guardrail: { mode: "enforce", categories: ["commitment"], count: 1 } });

    const detail = (await review.get(conv.id))!;
    expect(detail.flagged).toBe(true);
    expect(detail.flagReason).toBe("Guardrail: Commitment language");
    expect(detail.flaggedBy).toBe("guardrail");
    expect(detail.guardrailEvents).toMatchObject([{ category: "commitment", messageIndex: 1, replaced: true, excerpt: "You are approved for a HUD 232 loan." }]);
  });

  it("catches a usury claim and a guaranteed timeline in one reply", async () => {
    const { out, review, conv } = await run(["Your loan is exempt from California usury limits. We guarantee closing in 21 days."]);
    expect(out).toContain(SAFE_REPLACEMENTS.usury_exemption);
    expect(out).toContain(SAFE_REPLACEMENTS.guaranteed_timeline);
    const events = (await review.get(conv.id))!.guardrailEvents;
    // Every rule that fired is recorded ("we guarantee" also trips the general commitment rule).
    const categories = new Set(events.map((e) => e.category));
    expect(categories.has("usury_exemption") && categories.has("guaranteed_timeline")).toBe(true);
  });

  it("monitor mode leaves the reply alone but still records the hit", async () => {
    const { out, review, conv } = await run(["You are approved for this loan."], { guardrailMode: "monitor" });
    expect(out).toBe("You are approved for this loan.");
    expect((await review.get(conv.id))!.guardrailEvents).toMatchObject([{ replaced: false, mode: "monitor" }]);
  });

  it("still answers when the sink fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { out, store, conv } = await run(["You are approved."], {
      guardrailSink: {
        record: async () => {
          throw new Error("db down");
        },
      },
    });
    expect(out).toContain(SAFE_REPLACEMENTS.commitment);
    expect(store.rows.get(conv.id)!.turnCount).toBe(1);
    spy.mockRestore();
    warn.mockRestore();
  });

  it("works without a sink (no Supabase)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { out } = await run(["We guarantee approval."], { guardrailSink: null });
    expect(out).toContain(SAFE_REPLACEMENTS.commitment);
    warn.mockRestore();
  });

  it("never writes the offending sentence into the warning log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await run(["You are approved for a loan on 123 Main Street."]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("123 Main");
    warn.mockRestore();
  });
});
