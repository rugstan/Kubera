// Inbound mail pipeline for deals@, docs@, lenders@, vendors@ and closing@:
//
//   poll    list messages newer than the cursor (minus a lookback window, so a
//           message that failed earlier is picked up again), skip stored ones
//   process fetch → classify (Haiku via the gateway, rules fallback) → route to
//           a deal/lead → attachments to quarantine (+ vault row) → mail_messages
//
// The pipeline only reads mail and writes Kubera's own tables. It sends no
// email and makes no CRM or other third-party write; downstream agents act on
// the `kubera/mail.routed` event through the approval gate.

import type { ModelGateway } from "@/lib/ai/gateway";
import { classifyPayload, redactText } from "@/lib/privacy/classification";
import { encryptField, piiKeyring, type PiiKeyring } from "@/lib/privacy/crypto";
import { processAttachments, type AttachmentSink } from "./attachments";
import { classifyMail, type MailClassification } from "./classify";
import type { InboundMailbox } from "./mailboxes";
import { routeMail, type DealDirectory, type MailRoute } from "./route";
import type { MailRow, MailStore } from "./store";
import { stripQuotedReply } from "./text";
import { MailProviderError, type MailMessage, type MailProvider, type MailRef, type MailSummary } from "./types";
import type { GatewayResponse } from "@/lib/ai/gateway";

export const MAX_BODY_CHARS = 200_000;
export const POLL_LOOKBACK_MS = 24 * 60 * 60_000;
export const POLL_LIMIT = 100;

export type InboundDeps = {
  provider: MailProvider;
  store: MailStore;
  directory: DealDirectory;
  sink: AttachmentSink;
  gateway: ModelGateway | null;
  /** The sender's privacy preferences (lib/privacy/requests.ts routingSubject). */
  subjectFor?: (email: string) => Promise<{ aiProcessingOptOut: boolean; humanReviewOnly: boolean }>;
  keyring?: PiiKeyring | null;
  now?: () => Date;
};

/** Messages in `mailbox` not yet stored, oldest first. */
export async function pollMailbox(mailbox: InboundMailbox, deps: Pick<InboundDeps, "provider" | "store">, opts: { limit?: number; lookbackMs?: number } = {}): Promise<MailSummary[]> {
  if (!deps.provider.configured(mailbox)) return [];
  const cursor = await deps.store.latestReceivedAt(mailbox);
  const since = cursor ? new Date(cursor.getTime() - (opts.lookbackMs ?? POLL_LOOKBACK_MS)) : null;
  const listed = await deps.provider.listNew(mailbox, since, opts.limit ?? POLL_LIMIT);
  const fresh: MailSummary[] = [];
  for (const m of listed) if (!(await deps.store.find(mailbox, m.providerMessageId))) fresh.push(m);
  return fresh;
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
};

/**
 * Processes one message end to end. Safe to retry: the row is keyed by
 * (mailbox, provider message id), storage paths are content-addressed and vault
 * rows are keyed by storage path.
 */
export async function processInboundMessage(input: { mailbox: InboundMailbox } & MailRef, deps: InboundDeps, ctx: { agentRunId?: string | null; traceId?: string } = {}): Promise<ProcessResult> {
  const now = deps.now ?? (() => new Date());
  const existing = await deps.store.find(input.mailbox, input.providerMessageId);
  if (existing) return { mailMessageId: existing.id, created: false, skipped: "already_processed", classification: null, route: null, modelCalls: [], fallbackReason: null };

  const msg = await deps.provider.fetchMessage(input.mailbox, input);
  // Classify the newest reply only; quoted history belongs to earlier messages.
  const forModel: MailMessage = { ...msg, bodyText: stripQuotedReply(msg.bodyText) || msg.bodyText };
  const subject = deps.subjectFor ? await deps.subjectFor(msg.fromAddress).catch(() => ({ aiProcessingOptOut: true, humanReviewOnly: true })) : undefined;

  const { classification, response, fallbackReason } = await classifyMail(forModel, {
    gateway: deps.gateway,
    ...(subject ? { subject: { aiProcessingOptOut: subject.aiProcessingOptOut } } : {}),
    ...(ctx.traceId ? { traceId: ctx.traceId } : {}),
  });
  if (fallbackReason) classification.flags.push(`classifier_fallback:${fallbackReason}`);

  const route = await routeMail(msg, classification, deps.directory);
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
  return { mailMessageId: saved.id, created: saved.created, classification, route, modelCalls: response ? [response] : [], fallbackReason };
}

/** True when a failure should be retried by the workflow engine. */
export function isRetryable(err: unknown): boolean {
  if (err instanceof MailProviderError) return err.retryable;
  return true;
}
