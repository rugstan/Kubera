// Illustrative conversations for fake-auth mode (local development and e2e).
// No real borrowers: every conversation is invented.

import { SAFE_REPLACEMENTS } from "@/lib/ai/guardrails";
import type { StoredMessage } from "@/lib/conversations/store";
import { MemoryReviewStore } from "./memory";

export const DEMO_CONVERSATION_IDS = {
  clean: "11111111-1111-4111-8111-000000000001",
  guardrail: "11111111-1111-4111-8111-000000000002",
  inaccurate: "11111111-1111-4111-8111-000000000003",
  reviewed: "11111111-1111-4111-8111-000000000004",
} as const;

const user = (content: string, at: string): StoredMessage => ({ role: "user", content, mode: "chat", at });
const assistant = (content: string, at: string, extra: { guardrail?: { mode: "enforce" | "monitor"; categories: string[]; count: number } } = {}): StoredMessage => ({
  role: "assistant",
  content,
  stopReason: "end_turn",
  model: "claude-opus-5-5",
  ...extra,
  at,
});

export function seedDemoReviewStore(store: MemoryReviewStore = new MemoryReviewStore()): MemoryReviewStore {
  store.seed({
    id: DEMO_CONVERSATION_IDS.clean,
    createdAt: "2026-11-02T16:00:00.000Z",
    page: "/financing/hud-232",
    messages: [
      user("What DSCR does a HUD 232 refinance need?", "2026-11-02T16:00:05.000Z"),
      assistant("Plan on about 1.45x for a Section 232 refinance of an existing facility, with up to 35 years fixed. Your advisor confirms the figure for your facility type. Everything here is indicative and subject to underwriting.", "2026-11-02T16:00:20.000Z"),
    ],
  });

  store.seed({
    id: DEMO_CONVERSATION_IDS.guardrail,
    createdAt: "2026-11-03T18:30:00.000Z",
    page: "/express",
    messages: [
      user("I own a 58-bed assisted living facility. Am I approved for a HUD loan?", "2026-11-03T18:30:10.000Z"),
      assistant(`Thanks for the details. A 58-bed assisted living facility with strong occupancy is the kind of property HUD 232 is built for. ${SAFE_REPLACEMENTS.commitment} Next, submit the 60-second qualifier or book a call with a Kubera advisor.`, "2026-11-03T18:30:40.000Z", {
        guardrail: { mode: "enforce", categories: ["commitment"], count: 1 },
      }),
    ],
    flagged: true,
    flagReason: "Guardrail: Commitment language",
    flaggedBy: "guardrail",
    flaggedAt: "2026-11-03T18:30:41.000Z",
  });
  void store.recordGuardrailEvents(
    [{ conversationId: DEMO_CONVERSATION_IDS.guardrail, messageIndex: 1, ruleId: "commitment.you-are-approved", category: "commitment", excerpt: "Based on what you've told me, you're approved for a HUD 232 loan.", replaced: true, mode: "enforce" }],
    new Date("2026-11-03T18:30:41.000Z"),
  );

  store.seed({
    id: DEMO_CONVERSATION_IDS.inaccurate,
    createdAt: "2026-11-01T20:10:00.000Z",
    page: "/financing/sba-504-hotel",
    messages: [
      user("How much equity does an SBA 504 hotel loan need?", "2026-11-01T20:10:10.000Z"),
      assistant("SBA 504 generally needs 10% borrower equity for most projects.", "2026-11-01T20:10:30.000Z"),
    ],
    flagged: true,
    flagReason: "Equity figure is for standard properties, not hotels",
    flaggedBy: "staff:demo-analyst@kubera.test",
    flaggedAt: "2026-11-02T09:00:00.000Z",
    reviewStatus: "in_review",
  });
  void store.addAnnotation(
    { conversationId: DEMO_CONVERSATION_IDS.inaccurate, messageIndex: 1, label: "inaccurate", note: "Hotels are special-purpose properties: 15% equity, 20% for a start-up or new construction. The reply quoted the standard-property figure.", authorId: null, authorLabel: "Demo Analyst" },
    new Date("2026-11-02T09:05:00.000Z"),
  );

  store.seed({
    id: DEMO_CONVERSATION_IDS.reviewed,
    createdAt: "2026-10-30T15:00:00.000Z",
    page: "/",
    messages: [
      user("Can you guarantee my loan will close in two weeks?", "2026-10-30T15:00:05.000Z"),
      assistant("I can't guarantee a closing date. Many close in 10 to 21 days after a complete file, subject to lender approval, appraisal, title and diligence. HUD financing takes much longer.", "2026-10-30T15:00:25.000Z"),
    ],
    flagged: true,
    flagReason: "Check the timeline answer",
    flaggedBy: "staff:demo-broker@kubera.test",
    flaggedAt: "2026-10-30T17:00:00.000Z",
    reviewStatus: "reviewed",
    reviewedBy: "staff:demo-broker@kubera.test",
    reviewedAt: "2026-10-30T17:10:00.000Z",
  });
  void store.addAnnotation(
    { conversationId: DEMO_CONVERSATION_IDS.reviewed, messageIndex: 1, label: "good_example", note: "Declines the guarantee, gives the conditional range, and does not oversell.", authorId: null, authorLabel: "Demo Broker" },
    new Date("2026-10-30T17:09:00.000Z"),
  );
  return store;
}

const DEMO_KEY = Symbol.for("kubera.ai-review.demo");

/** One demo store per server process, shared across route bundles (like the fake auth store). */
export function demoReviewStore(): MemoryReviewStore {
  const g = globalThis as unknown as Record<symbol, MemoryReviewStore | undefined>;
  return (g[DEMO_KEY] ??= seedDemoReviewStore());
}
