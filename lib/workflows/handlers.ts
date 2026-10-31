// Workflow handler bodies, written against WorkflowStep so they run the same
// under Inngest (lib/workflows/functions.ts) and FakeStep (tests).
//
// Privacy: step results are persisted by Inngest, so steps return ids,
// statuses and counts only, never email bodies, addresses or prompts.

import type { OutboundAction } from "@/lib/compliance/approval-gate";
import { INBOUND_MAILBOXES, type InboundMailbox } from "@/lib/mail/mailboxes";
import { isRetryable, pollMailbox, processInboundMessage, recordInboundFailure, retryableFailures } from "@/lib/mail/inbound";
import { runApprovedAction } from "./approval";
import type { WorkflowDeps } from "./deps";
import { EVENTS, mailPollRequestedSchema, mailReceivedSchema, outboundRequestedSchema } from "./events";
import { modelCallFrom } from "./runs";
import type { WorkflowStep } from "./step";

export type HandlerContext = {
  data: unknown;
  step: WorkflowStep;
  runId?: string;
  eventId?: string;
  /** Inngest's zero-based attempt and its cap (the last attempt records a failure instead of throwing). */
  attempt?: number;
  maxAttempts?: number;
};

/** Event id and idempotency key for one processing attempt of a message. */
export function mailAttemptKey(mailbox: InboundMailbox, providerMessageId: string, attempt: number): string {
  return `${mailbox}:${providerMessageId}:${attempt}`;
}

// --- Outbound actions ---------------------------------------------------------------------

export type OutboundResult =
  | { status: "sent"; approvalId: string; replayed: boolean }
  | { status: "rejected" | "expired"; approvalId: string | null }
  | { status: "no_executor"; kind: string };

export async function outboundActionHandler(ctx: HandlerContext, deps: WorkflowDeps): Promise<OutboundResult> {
  const data = outboundRequestedSchema.parse(ctx.data);
  const action: OutboundAction = {
    kind: data.kind as OutboundAction["kind"],
    idempotencyKey: data.idempotencyKey,
    summary: data.summary,
    payload: data.payload,
    requestedBy: data.requestedBy,
    ...(data.templateId ? { templateId: data.templateId } : {}),
  };
  const nowMs = () => deps.now().getTime();
  const runId = await ctx.step.run("start-run", () =>
    deps.runs.start(
      { workflow: "outbound-action", idempotencyKey: `outbound:${data.idempotencyKey}`, triggerEvent: EVENTS.outboundRequested, ...(ctx.eventId ? { triggerEventId: ctx.eventId } : {}), ...(ctx.runId ? { inngestRunId: ctx.runId } : {}), subjectType: "outbound_action", subjectId: data.idempotencyKey },
      deps.now(),
    ),
  );

  const executor = deps.executors[data.kind];
  if (!executor) {
    // Nothing can send this kind: do not even ask a broker to approve it.
    await ctx.step.run("finish-run", () => deps.runs.finish(runId, { status: "skipped", summary: { reason: "no_executor", kind: data.kind } }, deps.now()));
    return { status: "no_executor", kind: data.kind };
  }

  const result = await runApprovedAction({
    step: ctx.step,
    gate: deps.gate,
    action,
    effects: deps.effects,
    workflow: "outbound-action",
    runId,
    now: nowMs,
    timeoutMs: (data.ttlMinutes ?? 24 * 60) * 60_000,
    onExpire: async (approvalId) => deps.onApprovalExpired?.(approvalId, action),
    execute: (approval) => executor(action, approval),
  });

  await ctx.step.run("finish-run", () =>
    deps.runs.finish(
      runId,
      result.sent
        ? { status: "succeeded", summary: { approvalId: result.approvalId, replayed: result.replayed, receipt: result.result } }
        : { status: "skipped", summary: { outcome: result.status, approvalId: result.approvalId } },
      deps.now(),
    ),
  );
  return result.sent ? { status: "sent", approvalId: result.approvalId, replayed: result.replayed } : { status: result.status, approvalId: result.approvalId };
}

// --- Mail polling -----------------------------------------------------------------------------

export type PollResult = { skipped?: "mail_not_configured"; enqueued: Partial<Record<InboundMailbox, number>>; errors: Partial<Record<InboundMailbox, string>> };

export async function mailPollHandler(ctx: HandlerContext, deps: WorkflowDeps): Promise<PollResult> {
  const { mailbox } = mailPollRequestedSchema.parse(ctx.data ?? {});
  if (!deps.mail) return { skipped: "mail_not_configured", enqueued: {}, errors: {} };
  const mail = deps.mail;
  const out: PollResult = { enqueued: {}, errors: {} };
  for (const mb of mailbox ? [mailbox] : INBOUND_MAILBOXES) {
    if (!mail.provider.configured(mb)) continue;
    // One mailbox failing (expired token, outage) must not stop the others.
    const listed = await ctx.step.run(`list-${mb}`, async () => {
      try {
        const fresh = await pollMailbox(mb, mail);
        // Failed messages are retried with their attempt number in the event id and idempotency key.
        const retries = await retryableFailures(mb, mail, { now: deps.now() });
        return {
          refs: [
            ...fresh.map((m) => ({ providerMessageId: m.providerMessageId, folderId: m.folderId, receivedAt: m.receivedAt, attempt: 0 })),
            ...retries.filter((r) => !fresh.some((m) => m.providerMessageId === r.providerMessageId)),
          ],
          error: null,
        };
      } catch (err) {
        return { refs: [], error: err instanceof Error ? err.message.slice(0, 300) : String(err) };
      }
    });
    if (listed.error) {
      out.errors[mb] = listed.error;
      console.warn(`[mail] polling ${mb}@ failed: ${listed.error}`);
      continue;
    }
    if (listed.refs.length) {
      await ctx.step.sendEvent(
        `enqueue-${mb}`,
        listed.refs.map((r) => {
          const dedupeKey = mailAttemptKey(mb, r.providerMessageId, r.attempt);
          return { name: EVENTS.mailReceived, id: `mail:${dedupeKey}`, data: { mailbox: mb, ...r, dedupeKey } };
        }),
      );
    }
    out.enqueued[mb] = listed.refs.length;
  }
  return out;
}

// --- Inbound message -----------------------------------------------------------------------------

export type InboundResult =
  | { status: "skipped"; reason: "mail_not_configured" | "already_processed"; mailMessageId: string | null }
  | { status: "failed"; error: string }
  | { status: "processed" | "needs_review" | "ignored"; mailMessageId: string; category: string; dealId: string | null; leadId: string | null };

export async function inboundMailHandler(ctx: HandlerContext, deps: WorkflowDeps): Promise<InboundResult> {
  const data = mailReceivedSchema.parse(ctx.data);
  if (!deps.mail) return { status: "skipped", reason: "mail_not_configured", mailMessageId: null };
  const mail = deps.mail;
  // One agent_runs row per attempt (the first keeps the original key).
  const key = data.attempt ? `mail:${mailAttemptKey(data.mailbox, data.providerMessageId, data.attempt)}` : `mail:${data.mailbox}:${data.providerMessageId}`;
  const lastAttempt = typeof ctx.attempt === "number" && typeof ctx.maxAttempts === "number" ? ctx.attempt >= ctx.maxAttempts - 1 : false;

  const runId = await ctx.step.run("start-run", () =>
    deps.runs.start(
      { workflow: "inbound-mail", idempotencyKey: key, triggerEvent: EVENTS.mailReceived, ...(ctx.eventId ? { triggerEventId: ctx.eventId } : {}), ...(ctx.runId ? { inngestRunId: ctx.runId } : {}), subjectType: "mail_message", subjectId: key, traceId: key },
      deps.now(),
    ),
  );

  type Processed = Exclude<InboundResult, { status: "skipped"; reason: "mail_not_configured" }> & { modelCalls?: ReturnType<typeof modelCallFrom>[]; fallbackReason?: string | null; routingRefused?: boolean; reviewReasons?: string[] };
  const processed = await ctx.step.run("process", async (): Promise<Processed> => {
    try {
      const r = await processInboundMessage(data, mail, { agentRunId: runId, traceId: runId });
      if (r.skipped || !r.classification || !r.route || !r.mailMessageId) return { status: "skipped", reason: "already_processed", mailMessageId: r.mailMessageId };
      return {
        status: r.route.status,
        mailMessageId: r.mailMessageId,
        category: r.classification.category,
        dealId: r.route.dealId,
        leadId: r.route.leadId,
        modelCalls: r.modelCalls.map((c) => modelCallFrom(c, "classification")),
        fallbackReason: r.fallbackReason,
        routingRefused: r.fallbackReason === "routing_refused",
        reviewReasons: r.route.reviewReasons,
      };
    } catch (err) {
      if (isRetryable(err) && !lastAttempt) throw err;
      const error = err instanceof Error ? err.message.slice(0, 500) : String(err);
      // Store the failure so the poller re-enqueues it (with backoff and a fresh key) instead of losing it.
      await recordInboundFailure(data, mail, error, { agentRunId: runId });
      return { status: "failed", error };
    }
  });

  await ctx.step.run("finish-run", () =>
    deps.runs.finish(
      runId,
      processed.status === "failed"
        ? { status: "failed", error: processed.error }
        : processed.status === "skipped"
          ? { status: "skipped", summary: { reason: processed.reason } }
          : {
              status: processed.status === "needs_review" ? "needs_review" : "succeeded",
              summary: { mailMessageId: processed.mailMessageId, category: processed.category, outcome: processed.status, fallbackReason: processed.fallbackReason ?? null, reviewReasons: processed.reviewReasons ?? [] },
              modelCalls: processed.modelCalls ?? [],
              routingRefusals: processed.routingRefused ? 1 : 0,
              dealId: processed.dealId,
              leadId: processed.leadId,
            },
      deps.now(),
    ),
  );

  if (processed.status === "processed" || processed.status === "needs_review" || processed.status === "ignored") {
    if (processed.status !== "ignored") {
      await ctx.step.sendEvent("announce-routed", {
        name: EVENTS.mailRouted,
        id: `mail-routed:${processed.mailMessageId}`,
        data: { mailMessageId: processed.mailMessageId, mailbox: data.mailbox, category: processed.category, dealId: processed.dealId, leadId: processed.leadId, needsReview: processed.status === "needs_review" },
      });
    }
    return { status: processed.status, mailMessageId: processed.mailMessageId, category: processed.category, dealId: processed.dealId, leadId: processed.leadId };
  }
  return processed.status === "failed" ? { status: "failed", error: processed.error } : { status: "skipped", reason: "already_processed", mailMessageId: processed.mailMessageId };
}
