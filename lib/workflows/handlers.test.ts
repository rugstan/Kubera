import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { createGateway } from "@/lib/ai/gateway";
import { FakeModelProvider } from "@/lib/ai/gateway/fake";
import { FakeApprovalGate } from "@/lib/compliance/approval-gate";
import { MemoryTracer } from "@/lib/langfuse";
import { MemoryAttachmentSink } from "@/lib/mail/attachments";
import { FakeMailProvider } from "@/lib/mail/fake";
import { DEAL_ID, LEAD_ID, SAMPLE_EMAILS } from "@/lib/mail/fixtures";
import { MemoryDealDirectory } from "@/lib/mail/route";
import { MemoryMailStore } from "@/lib/mail/store";
import { MailProviderError } from "@/lib/mail/types";
import type { OutboundExecutor, WorkflowDeps } from "./deps";
import { EVENTS } from "./events";
import { inboundMailHandler, mailPollHandler, outboundActionHandler } from "./handlers";
import { MemoryIdempotencyStore } from "./idempotency";
import { MemoryAgentRunStore } from "./runs";
import { FakeStep } from "./step";

const HOUR = 3_600_000;

function deps(step: FakeStep, overrides: Partial<WorkflowDeps> = {}) {
  const gate = new FakeApprovalGate("pending");
  const runs = new MemoryAgentRunStore();
  const sendEmail = vi.fn<OutboundExecutor>(async (action) => ({ providerMessageId: `re_${action.idempotencyKey}` }));
  const d: WorkflowDeps = { gate, effects: new MemoryIdempotencyStore(), runs, mail: null, executors: { email: sendEmail }, now: () => new Date(step.now()), ...overrides };
  return { d, gate, runs, sendEmail };
}

const request = (key = "email:lead-1:doc-request") => ({
  kind: "email",
  idempotencyKey: key,
  summary: "Document request to Pat Lee",
  payload: { to: "pat.lee@example.com", templateId: "doc_request_v1" },
  requestedBy: "agent:chaser",
  ttlMinutes: 120,
});

describe("outbound action workflow", () => {
  it("expires an unapproved action and never sends it", async () => {
    const step = new FakeStep();
    const { d, runs, sendEmail } = deps(step);
    const onExpired = vi.fn(async () => {});
    const res = await outboundActionHandler({ data: request(), step }, { ...d, onApprovalExpired: onExpired });
    expect(res).toMatchObject({ status: "expired" });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(runs.runs[0]).toMatchObject({ workflow: "outbound-action", status: "skipped", summary: { outcome: "expired" } });
  });

  it("sends exactly once after a broker approves, even when the request is duplicated", async () => {
    const step = new FakeStep();
    const { d, gate, runs, sendEmail } = deps(step);
    step.beforeWait((id) => {
      if (id.endsWith("wait-0")) gate.decide(request().idempotencyKey, { status: "approved", approvalId: "appr_9", decidedBy: "Dana (DRE 01234567)", decidedAt: new Date(step.now()) });
    });
    const res = await outboundActionHandler({ data: request(), step }, d);
    expect(res).toMatchObject({ status: "sent", approvalId: "appr_9", replayed: false });
    // Duplicate event → new run, same key: the effect is not repeated.
    const again = await outboundActionHandler({ data: request(), step: new FakeStep(step.clock) }, d);
    expect(again).toMatchObject({ status: "sent", replayed: true });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0]![0]).toMatchObject({ kind: "email", idempotencyKey: request().idempotencyKey });
    expect(runs.runs).toHaveLength(1);
    expect(runs.runs[0]).toMatchObject({ status: "succeeded", summary: { receipt: { providerMessageId: `re_${request().idempotencyKey}` } } });
  });

  it("does not ask for approval of a kind nothing can send", async () => {
    const step = new FakeStep();
    const { d, gate } = deps(step);
    const res = await outboundActionHandler({ data: { ...request("sms:lead-1:tier1"), kind: "sms" }, step }, d);
    expect(res).toEqual({ status: "no_executor", kind: "sms" });
    expect(gate.requests).toHaveLength(0);
  });

  it("rejects malformed requests before doing anything", async () => {
    const step = new FakeStep();
    const { d, gate } = deps(step);
    await expect(outboundActionHandler({ data: { ...request(), kind: "Send Money" }, step }, d)).rejects.toBeInstanceOf(ZodError);
    expect(gate.requests).toHaveLength(0);
  });
});

function mailDeps(step: FakeStep) {
  const provider = new FakeMailProvider(["vendors"]);
  const store = new MemoryMailStore();
  const anthropic = new FakeModelProvider("anthropic", {
    text: JSON.stringify({ category: "document_submission", summary: "Borrower sent T-12 and rent roll", dealReference: null, propertyName: null, counterparty: null, documentKinds: ["T12", "RENT_ROLL"], urgency: "normal", needsBroker: false, suspicious: false, confidence: 0.95 }),
  });
  const base = deps(step, {
    mail: {
      provider,
      store,
      directory: new MemoryDealDirectory([{ id: DEAL_ID, leadId: LEAD_ID, name: "Harbor View" }], [{ id: LEAD_ID, email: "pat.lee@example.com" }]),
      sink: new MemoryAttachmentSink(),
      gateway: createGateway({ providers: { anthropic }, tracer: new MemoryTracer() }),
      keyring: null,
      now: () => new Date(step.now()),
    },
  });
  return { ...base, provider, store, anthropic };
}

describe("mail workflows", () => {
  it("poll enqueues one deduplicated event per new message and keeps PII out of step state", async () => {
    const step = new FakeStep();
    const { d, provider } = mailDeps(step);
    const m = provider.add(SAMPLE_EMAILS.documentSubmission);
    provider.add(SAMPLE_EMAILS.termSheet);
    const res = await mailPollHandler({ data: {}, step }, d);
    expect(res.enqueued).toMatchObject({ docs: 1, lenders: 1, deals: 0 });
    expect(res.enqueued.vendors).toBeUndefined();
    expect(step.sent.find((e) => e.data.mailbox === "docs")).toEqual({
      name: EVENTS.mailReceived,
      id: `mail:docs:${m.providerMessageId}:0`,
      data: { mailbox: "docs", providerMessageId: m.providerMessageId, folderId: "inbox", receivedAt: m.receivedAt, attempt: 0, dedupeKey: `docs:${m.providerMessageId}:0` },
    });
    const stepState = JSON.stringify([...step.memo.values()]);
    expect(stepState).not.toContain("pat.lee@example.com");
    expect(stepState).not.toContain("rent roll");
  });

  it("processes a message, records the run with its model call and announces the route", async () => {
    const step = new FakeStep();
    const { d, provider, runs, store } = mailDeps(step);
    const m = provider.add(SAMPLE_EMAILS.documentSubmission);
    const res = await inboundMailHandler({ data: { mailbox: "docs", providerMessageId: m.providerMessageId, folderId: m.folderId }, step, runId: "01RUN" }, d);
    expect(res).toMatchObject({ status: "processed", category: "document_submission", dealId: DEAL_ID, leadId: LEAD_ID });
    expect(runs.runs[0]).toMatchObject({ workflow: "inbound-mail", status: "succeeded", inngestRunId: "01RUN", dealId: DEAL_ID, modelCalls: [{ provider: "anthropic", model: "claude-haiku-5-5", purpose: "classification" }] });
    expect(store.rows[0]!.agentRunId).toBe(runs.runs[0]!.id);
    expect(step.sent).toEqual([{ name: EVENTS.mailRouted, id: `mail-routed:${store.rows[0]!.id}`, data: expect.objectContaining({ mailbox: "docs", dealId: DEAL_ID, needsReview: false }) }]);
    expect(JSON.stringify([...step.memo.values()])).not.toContain("pat.lee@example.com");

    // A second delivery of the same event does nothing new.
    const again = await inboundMailHandler({ data: { mailbox: "docs", providerMessageId: m.providerMessageId, folderId: m.folderId }, step: new FakeStep(step.clock) }, d);
    expect(again).toMatchObject({ status: "skipped", reason: "already_processed" });
    expect(store.rows).toHaveLength(1);
  });

  it("records a non-retryable provider failure instead of looping", async () => {
    const step = new FakeStep();
    const { d, runs } = mailDeps(step);
    const res = await inboundMailHandler({ data: { mailbox: "docs", providerMessageId: "missing", folderId: "inbox" }, step }, d);
    expect(res).toMatchObject({ status: "failed" });
    expect(runs.runs[0]).toMatchObject({ status: "failed" });
  });

  it("stores a failed message and the poller re-enqueues it with an attempt-scoped key until it succeeds", async () => {
    const step = new FakeStep();
    const { d, provider, store, runs } = mailDeps(step);
    const m = provider.add(SAMPLE_EMAILS.documentSubmission);
    const realFetch = provider.fetchMessage.bind(provider);
    provider.fetchMessage = async () => {
      throw new MailProviderError("Zoho Mail → HTTP 503", 503, true);
    };
    const event = { mailbox: "docs", providerMessageId: m.providerMessageId, folderId: m.folderId, receivedAt: m.receivedAt, attempt: 0, dedupeKey: `docs:${m.providerMessageId}:0` };
    // Retryable: Inngest retries while attempts remain …
    await expect(inboundMailHandler({ data: event, step: new FakeStep(step.clock), attempt: 0, maxAttempts: 6 }, d)).rejects.toThrow(/503/);
    expect(store.rows).toHaveLength(0);
    // … and the last attempt stores the failure instead of dropping the message.
    const failed = await inboundMailHandler({ data: event, step: new FakeStep(step.clock), attempt: 5, maxAttempts: 6 }, d);
    expect(failed).toMatchObject({ status: "failed" });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ error: expect.stringContaining("503"), attempts: 1 });
    expect(await store.find("docs", m.providerMessageId)).toMatchObject({ status: "failed" });

    // Before the backoff has passed nothing is re-enqueued; afterwards it is, with a new event id and key.
    let poll = new FakeStep(step.clock);
    await mailPollHandler({ data: { mailbox: "docs" }, step: poll }, d);
    expect(poll.sent).toHaveLength(0);
    step.clock.now += 11 * 60_000;
    poll = new FakeStep(step.clock);
    await mailPollHandler({ data: { mailbox: "docs" }, step: poll }, d);
    expect(poll.sent).toEqual([
      { name: EVENTS.mailReceived, id: `mail:docs:${m.providerMessageId}:1`, data: expect.objectContaining({ providerMessageId: m.providerMessageId, attempt: 1, dedupeKey: `docs:${m.providerMessageId}:1` }) },
    ]);

    // The retry succeeds and replaces the failed row.
    provider.fetchMessage = realFetch;
    const ok = await inboundMailHandler({ data: poll.sent[0]!.data, step: new FakeStep(step.clock), attempt: 0, maxAttempts: 6 }, d);
    expect(ok).toMatchObject({ status: "processed", category: "document_submission" });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ error: null, route: expect.objectContaining({ status: "processed" }) });
    expect(runs.runs.map((r) => r.idempotencyKey)).toContain(`mail:docs:${m.providerMessageId}:1`);
    poll = new FakeStep(step.clock);
    await mailPollHandler({ data: { mailbox: "docs" }, step: poll }, d);
    expect(poll.sent).toHaveLength(0);
  });

  it("pages staff when a deals@ or docs@ message lands in review, with ids and counts only", async () => {
    const step = new FakeStep();
    const { d, provider } = mailDeps(step);
    const alerts: unknown[] = [];
    d.mail!.reviewAlert = async (a) => {
      alerts.push(a);
    };
    // Routed docs@ mail: no alert.
    const routed = provider.add(SAMPLE_EMAILS.documentSubmission);
    await inboundMailHandler({ data: { mailbox: "docs", providerMessageId: routed.providerMessageId, folderId: routed.folderId }, step }, d);
    expect(alerts).toHaveLength(0);

    // docs@ from a sender who matches no lead: needs review, attachments held, staff paged.
    const stranger = provider.add({ ...SAMPLE_EMAILS.documentSubmission, fromAddress: "new.owner@example.com" });
    const res = await inboundMailHandler({ data: { mailbox: "docs", providerMessageId: stranger.providerMessageId, folderId: stranger.folderId }, step: new FakeStep(step.clock) }, d);
    expect(res).toMatchObject({ status: "needs_review" });
    expect(alerts).toEqual([
      { mailMessageId: (res as { mailMessageId: string }).mailMessageId, mailbox: "docs", category: "document_submission", reviewReasons: expect.arrayContaining(["no_deal_match"]), storedAttachments: 2 },
    ]);
    expect(JSON.stringify(alerts)).not.toContain("new.owner@example.com");

    // lenders@ review items stay in the queue without paging.
    const lender = provider.add({ ...SAMPLE_EMAILS.termSheet, subject: "Indicative terms", fromAddress: "unknown@lender.test" });
    const lr = await inboundMailHandler({ data: { mailbox: "lenders", providerMessageId: lender.providerMessageId, folderId: lender.folderId }, step: new FakeStep(step.clock) }, d);
    expect(lr).toMatchObject({ status: "needs_review" });
    expect(alerts).toHaveLength(1);
  });

  it("pages staff when a docs@ message fails its last retry", async () => {
    const step = new FakeStep();
    const { d, store } = mailDeps(step);
    const alerts: { mailMessageId: string; reviewReasons: readonly string[] }[] = [];
    d.mail!.reviewAlert = async (a) => {
      alerts.push(a);
    };
    for (let i = 0; i < 6; i++) await inboundMailHandler({ data: { mailbox: "docs", providerMessageId: "missing", folderId: "inbox", attempt: i }, step: new FakeStep(step.clock) }, d);
    expect(store.rows[0]?.attempts).toBe(6);
    expect(alerts).toEqual([expect.objectContaining({ mailMessageId: store.rows[0]!.id, reviewReasons: ["processing_failed"] })]);
  });

  it("skips cleanly when mail is not configured", async () => {
    const step = new FakeStep();
    const { d } = deps(step);
    expect(await mailPollHandler({ data: {}, step }, d)).toMatchObject({ skipped: "mail_not_configured" });
    expect(await inboundMailHandler({ data: { mailbox: "docs", providerMessageId: "x", folderId: "y" }, step }, d)).toMatchObject({ status: "skipped", reason: "mail_not_configured" });
  });
});

describe("FakeStep semantics", () => {
  it("memoizes steps and advances time on timeouts", async () => {
    const step = new FakeStep();
    const fn = vi.fn(async () => 1);
    await step.run("a", fn);
    await step.run("a", fn);
    expect(fn).toHaveBeenCalledTimes(1);
    const t = step.now();
    expect(await step.waitForEvent("w", { event: "x", timeout: HOUR })).toBeNull();
    expect(step.now() - t).toBe(HOUR);
  });
});
