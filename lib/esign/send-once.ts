// Creates an e-sign request at most once per approved send.
//
// The provider call is claimed in workflow_effects (lib/workflows/idempotency.ts)
// under the send's approval idempotency key BEFORE it runs, so:
//   - two concurrent sends (double click, two staff) cannot both create an
//     envelope: the second sees the claim and is told a send is in progress;
//   - a retry after the provider accepted the request but our DB update failed
//     replays the stored request instead of creating a second one;
//   - a retry after an ambiguous failure (timeout after the provider accepted)
//     first looks the request up by our reference and reuses it; any extra
//     live requests for the same reference are recalled.

import { EffectInProgressError, EffectOutcomeUnknownError, idempotentEffect, type IdempotencyStore } from "@/lib/workflows/idempotency";
import type { CreateFromTemplateInput, CreatedRequest, EsignProvider } from "./types";

export type SendOnceResult = { created: CreatedRequest; replayed: boolean; reconciled: boolean };

export class EsignSendInProgressError extends Error {
  constructor(
    readonly key: string,
    readonly outcomeUnknown: boolean,
  ) {
    super(
      outcomeUnknown
        ? "An earlier send of this document was interrupted and its outcome is unknown. Check the e-sign provider for the request before sending again."
        : "This document is already being sent; refresh in a moment.",
    );
    this.name = "EsignSendInProgressError";
  }
}

const LIVE = new Set(["draft", "in_progress", "completed"]);

export async function createRequestOnce(
  deps: { provider: EsignProvider; effects: IdempotencyStore; now: () => Date; workflow: string },
  key: string,
  input: CreateFromTemplateInput,
): Promise<SendOnceResult> {
  try {
    const { result, replayed } = await idempotentEffect(
      deps.effects,
      key,
      { workflow: deps.workflow },
      async (): Promise<{ created: CreatedRequest; reconciled: boolean }> => {
        // Reconcile before creating: an earlier attempt may have reached the provider.
        const found = deps.provider.findByReference ? (await deps.provider.findByReference(input.reference)).filter((r) => LIVE.has(r.status)) : [];
        if (found.length) {
          const [keep, ...orphans] = found;
          for (const o of orphans) {
            await deps.provider.recall(o.requestId, `Duplicate request for reference ${input.reference}`).catch((err: unknown) => {
              console.error(`[esign] could not recall duplicate request ${o.requestId}:`, err instanceof Error ? err.message : err);
            });
          }
          return { created: keep!, reconciled: true };
        }
        return { created: await deps.provider.createFromTemplate(input), reconciled: false };
      },
      { now: deps.now },
    );
    return { ...result, replayed };
  } catch (err) {
    if (err instanceof EffectInProgressError) throw new EsignSendInProgressError(key, false);
    if (err instanceof EffectOutcomeUnknownError) throw new EsignSendInProgressError(key, true);
    throw err;
  }
}

/** Recalls a request we created but could not record (another send won the race). */
export async function recallOrphan(provider: EsignProvider, requestId: string, reason: string): Promise<void> {
  await provider.recall(requestId, reason).catch((err: unknown) => {
    console.error(`[esign] could not recall orphaned request ${requestId}:`, err instanceof Error ? err.message : err);
  });
}
