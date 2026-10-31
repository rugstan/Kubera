// Inngest function definitions. Handlers live in ./handlers.ts; this file
// only binds them to triggers, retries, concurrency and idempotency.

import { NonRetriableError } from "inngest";
import { ZodError } from "zod";
import { inngest } from "./client";
import type { AgentWorkflowHooks, WorkflowDeps } from "./deps";
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
    // Restricted data that cannot be stored encrypted: retrying cannot help until the key is configured.
    if (err instanceof Error && err.name === "RestrictedExtractionError") throw new NonRetriableError(err.message);
    throw err;
  }
}

export function createWorkflowFunctions(getDeps: () => WorkflowDeps, getAgents?: () => AgentWorkflowHooks) {
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

  if (!getAgents) return [outboundAction, mailPoll, inboundMail];
  return [outboundAction, mailPoll, inboundMail, ...createAgentFunctions(client, getAgents)];
}

/** Term-sheet mail tied to a deal is parsed into lender quotes. */
export function isDealTermSheet(data: unknown): data is { category: "term_sheet"; dealId: string } {
  const d = data as { category?: unknown; dealId?: unknown } | null;
  return !!d && d.category === "term_sheet" && typeof d.dealId === "string" && d.dealId.length > 0;
}

function createAgentFunctions(client: ReturnType<typeof inngest>, getAgents: () => AgentWorkflowHooks) {
  const documentClean = client.createFunction(
    {
      id: "document-extract",
      name: "Extract a clean vault document",
      triggers: [{ event: EVENTS.documentClean }],
      idempotency: "event.data.documentId",
      concurrency: { limit: 3 },
      // Only transient model errors reach here; the handler skips documents that are not ready.
      retries: 4,
    },
    async (ctx) =>
      guard(async () => {
        const c = context(ctx as unknown as InngestCtx);
        const emit = await c.step.run("extract", () => getAgents().documentClean(c.data));
        if (!emit) return { status: "skipped" };
        await c.step.sendEvent("announce-extracted", { name: EVENTS.documentExtracted, data: emit.data });
        return { status: "extracted", ...emit.data };
      }),
  );

  // Extraction results feed spreads and Jev re-sizing (and, through the saved
  // spreads, the lenders desk and the executive summary).
  const spreadsRecalc = client.createFunction(
    {
      id: "spreads-recalculate",
      name: "Recalculate spreads and re-size with Jev",
      triggers: [{ event: EVENTS.documentExtracted }],
      idempotency: "event.data.extractionId + ':' + event.data.status",
      // One recalculation per deal at a time, so versions stay in order.
      concurrency: { limit: 1, key: "event.data.dealId" },
      retries: 3,
    },
    async (ctx) =>
      guard(async () => {
        const c = context(ctx as unknown as InngestCtx);
        return c.step.run("recalculate-spreads", () => getAgents().documentExtracted(c.data));
      }),
  );

  const crmMailRouted = client.createFunction(
    {
      id: "crm-mail-routed",
      name: "CRM note and task for routed mail",
      triggers: [{ event: EVENTS.mailRouted }],
      idempotency: "event.data.mailMessageId",
      concurrency: { limit: 3 },
      retries: 3,
    },
    async (ctx) =>
      guard(async () => {
        const c = context(ctx as unknown as InngestCtx);
        return c.step.run("crm-note", () => getAgents().crmMailRouted(c.data));
      }),
  );

  const termSheets = client.createFunction(
    {
      id: "lender-term-sheets",
      name: "Read lender term sheets into quotes",
      triggers: [{ event: EVENTS.mailRouted, if: "event.data.category == 'term_sheet' && event.data.dealId != null" }],
      idempotency: "event.data.mailMessageId",
      concurrency: { limit: 2 },
      retries: 3,
    },
    async (ctx) =>
      guard(async () => {
        const c = context(ctx as unknown as InngestCtx);
        if (!isDealTermSheet(c.data)) return { status: "skipped", reason: "not_a_deal_term_sheet" };
        const dealId = c.data.dealId;
        return c.step.run("ingest-term-sheets", () => getAgents().termSheets(dealId));
      }),
  );

  const speedToLead = client.createFunction(
    {
      id: "speed-to-lead",
      name: "Speed-to-lead reply",
      triggers: [{ event: EVENTS.leadScored }],
      idempotency: "event.data.leadId",
      retries: 2,
    },
    async (ctx) =>
      guard(async () => {
        const c = context(ctx as unknown as InngestCtx);
        return getAgents().speedToLead({ data: c.data, step: c.step });
      }),
  );

  const outreachSweep = client.createFunction(
    {
      id: "outreach-sweep",
      name: "Outreach chaser sweep",
      // The /api/outreach/sweep cron runs it on a schedule; this runs it on request.
      triggers: [{ event: EVENTS.outreachSweepRequested }],
      concurrency: { limit: 1 },
      retries: 1,
    },
    async (ctx) =>
      guard(async () => {
        const c = context(ctx as unknown as InngestCtx);
        return getAgents().outreachSweep({ step: c.step });
      }),
  );

  return [documentClean, spreadsRecalc, crmMailRouted, termSheets, speedToLead, outreachSweep];
}
