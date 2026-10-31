// Inbound mail pipeline for deals@, docs@, lenders@, vendors@ and closing@:
//
//   poll    list every message newer than the cursor minus a lookback window
//           (longer than Inngest's 24 h event dedupe, so a message whose event
//           was dropped is enqueued again), skip stored ones, take the oldest
//   retry   failed rows (status 'failed', stored by the workflow when processing
//           fails) are re-enqueued with an attempt-scoped event id, with backoff
//   process fetch → classify (bulk tier via the gateway, rules fallback) → route to
//           a deal/lead → attachments to quarantine (+ vault row) → mail_messages
//
// The pipeline only reads mail and writes Kubera's own tables. It sends no
// email and makes no CRM or other third-party write; downstream agents act on
// the `kubera/mail.routed` event through the approval gate.

import { recordInjection } from "@/lib/agents/core/inbound";
import type { AgentEventStore } from "@/lib/agents/core/events";
import type { ModelGateway } from "@/lib/ai/gateway";
import { classifyPayload, redactText } from "@/lib/privacy/classification";
import { encryptField, piiKeyring, type PiiKeyring } from "@/lib/privacy/crypto";
import { processAttachments, type AttachmentSink } from "./attachments";
import { classifyMail, MAIL_TRIAGE_AGENT, type MailClassification } from "./classify";
import { MAX_MAIL_ATTEMPTS, type InboundMailbox } from "./mailboxes";
import { routeMail, type DealDirectory, type MailRoute } from "./route";
import type { ReviewAlertInput } from "./review";
import type { MailRow, MailStore } from "./store";
import { stripQuotedReply } from "./text";
import { MailProviderError, type MailMessage, type MailProvider, type MailRef, type MailSummary } from "./types";
import type { GatewayResponse } from "@/lib/ai/gateway";

export const MAX_BODY_CHARS = 200_000;
/** Longer than Inngest's 24 h event-id / idempotency dedupe window. */
export const POLL_LOOKBACK_MS = 72 * 60 * 60_000;
/** Unstored messages enqueued per mailbox per poll (oldest first; the rest wait for the next poll). */
export const POLL_LIMIT = 100;
/** Messages the provider may list per poll while paging back to the lookback start. */
export const POLL_SCAN_LIMIT = 5_000;
/** Failed processing attempts before a message is left for staff (lib/mail/mailboxes.ts). */
export { MAX_MAIL_ATTEMPTS };
const RETRY_BASE_MS = 10 * 60_000;
const RETRY_MAX_MS = 6 * 60 * 60_000;

export type InboundDeps = {
  provider: MailProvider;
  store: MailStore;
  directory: DealDirectory;
  sink: AttachmentSink;
  gateway: ModelGateway | null;
  /** The sender's privacy preferences (lib/privacy/requests.ts routingSubject). */
  subjectFor?: (email: string) => Promise<{ aiProcessingOptOut: boolean; humanReviewOnly: boolean }>;
  keyring?: PiiKeyring | null;
  /** agent_events (lib/agents/core): injection findings in inbound mail are recorded here. */
  events?: Pick<AgentEventStore, "append"> | null;
  /**
   * Pages staff (pre-approved staff_alert) when a deals@ / docs@ message lands
   * in the review queue (lib/mail/review.ts). Must not throw.
   */
  reviewAlert?: ((alert: ReviewAlertInput) => Promise<void>) | null;
  now?: () => Date;
};

/**
 * Messages in `mailbox` not yet stored, oldest first. The provider pages back
 * to the lookback start; already-stored ids are dropped before `limit` applies,
 * so a burst larger than `limit` drains over the next polls.
 */
export async function pollMailbox(
  mailbox: InboundMailbox,
  deps: Pick<InboundDeps, "provider" | "store">,
  opts: { limit?: number; lookbackMs?: number; scanLimit?: number } = {},
): Promise<MailSummary[]> {
  if (!deps.provider.configured(mailbox)) return [];
  const limit = opts.limit ?? POLL_LIMIT;
  const cursor = await deps.store.latestReceivedAt(mailbox);
  const since = cursor ? new Date(cursor.getTime() - (opts.lookbackMs ?? POLL_LOOKBACK_MS)) : null;
  // First poll of a mailbox: only the newest `limit` messages (no backfill of history).
  const scan = since ? (opts.scanLimit ?? POLL_SCAN_LIMIT) : limit;
  const listed = await deps.provider.listNew(mailbox, since, scan);
  if (since && listed.length >= scan) console.warn(`[mail] ${mailbox}@ listed ${scan} messages in the lookback window; older ones wait for the next poll`);
  const known = listed.length ? await deps.store.knownIds(mailbox, listed.map((m) => m.providerMessageId)) : new Set<string>();
  return listed
    .filter((m) => !known.has(m.providerMessageId))
    .sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt))
    .slice(0, limit);
}

/** Wait after the n-th failed attempt before the next one. */
export function retryBackoffMs(attempts: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

/** Failed messages due for another attempt (attempt = failures so far, so ids stay unique per try). */
export async function retryableFailures(
  mailbox: InboundMailbox,
  deps: Pick<InboundDeps, "provider" | "store">,
  opts: { now: Date; limit?: number; maxAttempts?: number },
): Promise<{ providerMessageId: string; folderId: string; receivedAt: string; attempt: number }[]> {
  if (!deps.provider.configured(mailbox)) return [];
  const rows = await deps.store.listFailed(mailbox, { maxAttempts: opts.maxAttempts ?? MAX_MAIL_ATTEMPTS, limit: opts.limit ?? POLL_LIMIT });
  return rows
    .filter((r) => Date.parse(r.lastAttemptAt) + retryBackoffMs(r.attempts) <= opts.now.getTime())
    .map((r) => ({ providerMessageId: r.providerMessageId, folderId: r.folderId, receivedAt: r.receivedAt, attempt: r.attempts }));
}

/** Stores the failure so the poller retries the message (never throws away the error). */
export async function recordInboundFailure(
  input: { mailbox: InboundMailbox; receivedAt?: string | null } & MailRef,
  deps: Pick<InboundDeps, "provider" | "store" | "now">,
  error: string,
  ctx: { agentRunId?: string | null } = {},
): Promise<{ id: string; attempts: number } | null> {
  const now = deps.now ?? (() => new Date());
  return deps.store.recordFailure({
    mailbox: input.mailbox,
    provider: deps.provider.name,
    providerMessageId: input.providerMessageId,
    folderId: input.folderId,
    receivedAt: input.receivedAt ?? null,
    error: error.slice(0, 2000) || "unknown error",
    agentRunId: ctx.agentRunId ?? null,
    at: now().toISOString(),
  });
}

/** Seals the body when it contains restricted values; the stored text is always masked. */
export function protectBody(msg: Pick<MailMessage, "mailbox" | "providerMessageId" | "bodyText">, keyring: PiiKeyring | null | undefined): { bodyText: string; bodyEncrypted: string | null; bodyRestricted: boolean; flags: string[] } {
  const body = msg.bodyText.slice(0, MAX_BODY_CHARS);
  const flags = body.length < msg.bodyText.length ? ["body_truncated_for_storage"] : [];
  const restricted = classifyPayload(body, { defaultLevel: "confidential" }).level === "restricted";
  if (!restricted) return { bodyText: body, bodyEncrypted: null, bodyRestricted: false, flags };
  const masked = redactText(body, "confidential");
  if (!keyring) return { bodyText: masked, bodyEncrypted: null, bodyRestricted: true, flags: [...flags, "restricted_body_not_retained"] };
  return { bodyText: masked, bodyEncrypted: encryptField(body, { context: mailBodyContext(msg.mailbox, msg.providerMessageId), keyring }), bodyRestricted: true, flags };
}

export function mailBodyContext(mailbox: InboundMailbox, providerMessageId: string): string {
  return `mail_messages.body:${mailbox}:${providerMessageId}`.slice(0, 256);
}

export type ProcessResult = {
  mailMessageId: string | null;
  created: boolean;
  skipped?: "already_processed";
  classification: MailClassification | null;
  route: MailRoute | null;
  modelCalls: GatewayResponse[];
  fallbackReason: string | null;
  /** Attachments stored in quarantine but not registered as vault documents. */
  storedAttachments?: number;
};

/**
 * Processes one message end to end. Safe to retry: the row is keyed by
 * (mailbox, provider message id), storage paths are content-addressed and vault
 * rows are keyed by storage path.
 */
export async function processInboundMessage(input: { mailbox: InboundMailbox } & MailRef, deps: InboundDeps, ctx: { agentRunId?: string | null; traceId?: string } = {}): Promise<ProcessResult> {
  const now = deps.now ?? (() => new Date());
  const existing = await deps.store.find(input.mailbox, input.providerMessageId);
  // A failed row is processed again (the poller re-enqueued it); anything else is done.
  if (existing && existing.status !== "failed") return { mailMessageId: existing.id, created: false, skipped: "already_processed", classification: null, route: null, modelCalls: [], fallbackReason: null };

  const msg = await deps.provider.fetchMessage(input.mailbox, input);
  // Classify the newest reply only; quoted history belongs to earlier messages.
  const forModel: MailMessage = { ...msg, bodyText: stripQuotedReply(msg.bodyText) || msg.bodyText };
  const subject = deps.subjectFor ? await deps.subjectFor(msg.fromAddress).catch(() => ({ aiProcessingOptOut: true, humanReviewOnly: true })) : undefined;

  const { classification, response, fallbackReason, guard, prompt } = await classifyMail(forModel, {
    gateway: deps.gateway,
    ...(subject ? { subject: { aiProcessingOptOut: subject.aiProcessingOptOut } } : {}),
    ...(ctx.traceId ? { traceId: ctx.traceId } : {}),
  });
  if (fallbackReason) classification.flags.push(`classifier_fallback:${fallbackReason}`);

  const route = await routeMail(msg, classification, deps.directory);
  // Injection findings go to agent_events with their reason codes (the codes also stay in the
  // stored flags, so the CRM agents acting on this message later carry the taint).
  await recordInjection(
    deps.events,
    {
      agent: MAIL_TRIAGE_AGENT.id,
      agentVersion: MAIL_TRIAGE_AGENT.version,
      task: MAIL_TRIAGE_AGENT.task,
      prompt,
      runId: ctx.agentRunId ?? null,
      dealId: route.dealId ?? null,
      leadId: route.leadId ?? null,
      label: `${msg.mailbox}@`,
    },
    guard,
  );
  if (subject?.humanReviewOnly && route.status === "processed") {
    route.status = "needs_review";
    route.reviewReasons.push("human_review_requested");
  }

  const attachments = msg.attachments.length ? await processAttachments(msg, classification, route, { provider: deps.provider, sink: deps.sink }) : [];
  const body = protectBody(msg, deps.keyring === undefined ? piiKeyring() : deps.keyring);
  classification.flags.push(...body.flags);

  const row: MailRow = {
    mailbox: msg.mailbox,
    provider: deps.provider.name,
    providerMessageId: msg.providerMessageId,
    folderId: msg.folderId,
    internetMessageId: msg.internetMessageId,
    inReplyTo: msg.inReplyTo,
    references: msg.references.slice(0, 50),
    fromAddress: msg.fromAddress,
    fromName: msg.fromName,
    toAddresses: msg.toAddresses.slice(0, 50),
    ccAddresses: msg.ccAddresses.slice(0, 50),
    subject: msg.subject.slice(0, 998),
    receivedAt: msg.receivedAt,
    snippet: redactText(msg.snippet, "confidential").slice(0, 500),
    bodyText: body.bodyText,
    bodyEncrypted: body.bodyEncrypted,
    bodyRestricted: body.bodyRestricted,
    attachments,
    automated: msg.automated,
    bulk: msg.bulk,
    dmarc: msg.dmarc,
    classification,
    route,
    agentRunId: ctx.agentRunId ?? null,
    processedAt: now().toISOString(),
    error: null,
  };
  const saved = await deps.store.save(row);
  return {
    mailMessageId: saved.id,
    created: saved.created,
    classification,
    route,
    modelCalls: response ? [response] : [],
    fallbackReason,
    storedAttachments: attachments.filter((a) => a.status === "stored").length,
  };
}

/** True when a failure should be retried by the workflow engine. */
export function isRetryable(err: unknown): boolean {
  if (err instanceof MailProviderError) return err.retryable;
  return true;
}
