import { flagReason, summarizeViolations, type GuardrailMode, type GuardrailViolation } from "@/lib/ai/guardrails";
import type { ReviewStore } from "./types";

// Where guardrail hits go. The advisor calls the sink after a turn is stored;
// a failing sink never affects the reply (the filter already ran).

export type GuardrailHit = {
  conversationId: string;
  /** Index of the assistant message in the stored conversation. */
  messageIndex: number;
  mode: GuardrailMode;
  violations: readonly GuardrailViolation[];
};

export interface GuardrailSink {
  record(hit: GuardrailHit): Promise<void>;
}

/** Records the hits as events and flags the conversation for staff review. */
export function reviewGuardrailSink(store: ReviewStore): GuardrailSink {
  return {
    async record(hit) {
      if (!hit.violations.length) return;
      await store.recordGuardrailEvents(
        hit.violations.map((v) => ({
          conversationId: hit.conversationId,
          messageIndex: hit.messageIndex,
          ruleId: v.ruleId,
          category: v.category,
          excerpt: v.excerpt,
          replaced: v.replaced,
          mode: hit.mode,
        })),
      );
      await store.autoFlag(hit.conversationId, flagReason(summarizeViolations(hit.violations, hit.mode).categories));
    },
  };
}
