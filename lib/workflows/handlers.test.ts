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
    expect(step.sent.find((e) => e.data.mailbox === "docs")).toEqual({ name: EVENTS.mailReceived, id: `mail:docs:${m.providerMessageId}`, data: { mailbox: "docs", providerMessageId: m.providerMessageId, folderId: "inbox", receivedAt: m.receivedAt } });
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
