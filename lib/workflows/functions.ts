// Inngest function definitions. Handlers live in ./handlers.ts; this file
// only binds them to triggers, retries, concurrency and idempotency.

import { NonRetriableError } from "inngest";
import { ZodError } from "zod";
import { inngest } from "./client";
import type { WorkflowDeps } from "./deps";
import { EVENTS } from "./events";
import { inboundMailHandler, mailPollHandler, outboundActionHandler, type HandlerContext } from "./handlers";
import { EffectOutcomeUnknownError } from "./idempotency";
import { fromInngestStep, type InngestStepLike } from "./step";

/** Every 5 minutes. */
export const MAIL_POLL_CRON = "*/5 * * * *";

type InngestCtx = { event: { data: unknown; id?: string }; step: unknown; runId: string };

function context(ctx: InngestCtx): HandlerContext {
  return { data: ctx.event.data, step: fromInngestStep(ctx.step as InngestStepLike), runId: ctx.runId, ...(ctx.event.id ? { eventId: ctx.event.id } : {}) };
}

/** Bad payloads and unknown-outcome effects must not be retried. */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ZodError) throw new NonRetriableError(`Invalid event payload: ${err.issues.map((i) => i.path.join(".")).join(", ")}`);
    if (err instanceof EffectOutcomeUnknownError) throw new NonRetriableError(err.message);
    throw err;
  }
}

export function createWorkflowFunctions(getDeps: () => WorkflowDeps) {
  const client = inngest();

  const outboundAction = client.createFunction(
    {
      id: "outbound-action",
      name: "Outbound action (approval gate)",
      triggers: [{ event: EVENTS.outboundRequested }],
      // One run per logical action, however many times it is requested.
      idempotency: "event.data.idempotencyKey",
      retries: 4,
    },
    async (ctx) => guard(() => outboundActionHandler(context(ctx as unknown as InngestCtx), getDeps())),
  );

  const mailPoll = client.createFunction(
    {
      id: "mail-poll",
      name: "Poll inbound mailboxes",
      triggers: [{ cron: MAIL_POLL_CRON }, { event: EVENTS.mailPollRequested }],
      concurrency: { limit: 1 },
      retries: 1,
    },
    async (ctx) => guard(() => mailPollHandler(context(ctx as unknown as InngestCtx), getDeps())),
  );

  const inboundMail = client.createFunction(
    {
      id: "inbound-mail",
      name: "Process inbound mail",
      triggers: [{ event: EVENTS.mailReceived }],
      idempotency: "event.data.mailbox + ':' + event.data.providerMessageId",
      concurrency: { limit: 5 },
      // Haiku classification is cheap; Zoho rate limits are the usual cause of retries.
      throttle: { limit: 60, period: "1m" },
      retries: 5,
    },
    async (ctx) => guard(() => inboundMailHandler(context(ctx as unknown as InngestCtx), getDeps())),
  );

  return [outboundAction, mailPoll, inboundMail];
}
