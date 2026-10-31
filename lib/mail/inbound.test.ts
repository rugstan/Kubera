import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createGateway } from "@/lib/ai/gateway";
import { FakeModelProvider } from "@/lib/ai/gateway/fake";
import { MemoryTracer } from "@/lib/langfuse";
import { createKeyring, decryptField } from "@/lib/privacy/crypto";
import { MemoryAttachmentSink, QUARANTINE_BUCKET, sniffContentType } from "./attachments";
import type { MailCategory } from "./classify";
import { FakeMailProvider } from "./fake";
import { DEAL_ID, LEAD_ID, OTHER_DEAL_ID, SAMPLE_EMAILS } from "./fixtures";
import { mailBodyContext, pollMailbox, processInboundMessage, type InboundDeps } from "./inbound";
import { MemoryDealDirectory } from "./route";
import { MemoryMailStore } from "./store";

const keyring = createKeyring({ version: 1, key: randomBytes(32) });

/** A model that answers like Haiku would for each sample (keyed by subject). */
const MODEL_ANSWERS: Record<string, { category: MailCategory; propertyName?: string; documentKinds?: string[] }> = {
  [SAMPLE_EMAILS.newInquiry.subject]: { category: "new_inquiry", propertyName: "Sun Valley Gardens" },
  [SAMPLE_EMAILS.termSheet.subject]: { category: "term_sheet", propertyName: "Harbor View Apartments" },
  [SAMPLE_EMAILS.documentSubmission.subject]: { category: "document_submission", documentKinds: ["T12", "RENT_ROLL"] },
  [SAMPLE_EMAILS.appraisal.subject]: { category: "third_party_report", propertyName: "1200 Ocean Ave" },
  [SAMPLE_EMAILS.outOfOffice.subject]: { category: "auto_reply" },
  [SAMPLE_EMAILS.wireFraud.subject]: { category: "closing_coordination" },
  [SAMPLE_EMAILS.promptInjection.subject]: { category: "new_inquiry" },
  [SAMPLE_EMAILS.borrowerReplyWithSsn.subject]: { category: "borrower_update" },
};

function setup(opts: { model?: boolean; keyring?: typeof keyring | null; subject?: InboundDeps["subjectFor"] } = {}) {
  const provider = new FakeMailProvider();
  const store = new MemoryMailStore();
  const sink = new MemoryAttachmentSink();
  const directory = new MemoryDealDirectory(
    [
      { id: DEAL_ID, leadId: LEAD_ID, name: "Harbor View Apartments refi", propertyName: "Harbor View Apartments" },
      { id: OTHER_DEAL_ID, leadId: null, name: "Seaside Inn PIP bridge" },
    ],
    [{ id: LEAD_ID, email: "pat.lee@example.com" }],
    [{ messageId: "kc-outbound-77@kuberacommercial.com", dealId: DEAL_ID, leadId: LEAD_ID }],
  );
  const anthropic = new FakeModelProvider("anthropic", (req) => {
    const subject = /<subject>([\s\S]*?)<\/subject>/.exec(req.messages[0]!.content)?.[1]?.replace(/&amp;/g, "&") ?? "";
    const a = MODEL_ANSWERS[subject] ?? { category: "other" };
    return { text: JSON.stringify({ summary: "summary", dealReference: null, propertyName: a.propertyName ?? null, counterparty: null, documentKinds: a.documentKinds ?? [], urgency: "normal", needsBroker: true, suspicious: false, confidence: 0.92, category: a.category }) };
  });
  const gateway = opts.model === false ? null : createGateway({ providers: { anthropic }, tracer: new MemoryTracer() });
  const deps: InboundDeps = {
    provider,
    store,
    directory,
    sink,
    gateway,
    keyring: opts.keyring === undefined ? keyring : opts.keyring,
    ...(opts.subject ? { subjectFor: opts.subject } : {}),
    now: () => new Date("2026-11-03T17:00:00Z"),
  };
  const run = async (k: keyof typeof SAMPLE_EMAILS) => {
    const m = provider.add(SAMPLE_EMAILS[k]);
    const res = await processInboundMessage({ mailbox: m.mailbox, providerMessageId: m.providerMessageId, folderId: m.folderId }, deps);
    return { res, row: store.rows.find((r) => r.id === res.mailMessageId)! };
  };
  return { provider, store, sink, directory, anthropic, deps, run };
}

describe("inbound mail routing on sample emails", () => {
  it("routes a lender term sheet by its subject reference; keeps the PDF in quarantine only", async () => {
    const { run, sink } = setup();
    const { row } = await run("termSheet");
    expect(row.classification.category).toBe("term_sheet");
    expect(row.route).toMatchObject({ dealId: DEAL_ID, method: "reference", status: "processed", queue: "capital-markets" });
    expect(row.attachments[0]).toMatchObject({ status: "stored", bucket: QUARANTINE_BUCKET, contentType: "application/pdf", documentId: null });
    expect(sink.documents).toHaveLength(0);
  });

  it("routes docs@ submissions to the lead's deal and registers quarantined vault documents", async () => {
    const { run, sink } = setup();
    const { row } = await run("documentSubmission");
    expect(row.route).toMatchObject({ dealId: DEAL_ID, leadId: LEAD_ID, method: "participant", status: "processed", queue: "documents" });
    expect(row.attachments.map((a) => [a.fileName, a.status, a.kind])).toEqual([
      ["T12 Operating Statement 2026.pdf", "registered", "T12"],
      ["Rent_Roll_Oct.pdf", "registered", "RENT_ROLL"],
      ["invoice.exe", "skipped_type", null],
    ]);
    expect(sink.documents.every((d) => d.status === "quarantined" && d.leadId === LEAD_ID)).toBe(true);
    expect([...sink.objects.keys()].every((k) => k.startsWith(`${QUARANTINE_BUCKET}/inbound-mail/docs/`))).toBe(true);
  });

  it("files a new inquiry from an unknown sender for the deal desk", async () => {
    const { run } = setup();
    const { row } = await run("newInquiry");
    expect(row.classification).toMatchObject({ category: "new_inquiry", source: "model", propertyName: "Sun Valley Gardens" });
    expect(row.route).toMatchObject({ dealId: null, leadId: null, method: "none", status: "processed", queue: "deal-desk" });
  });

  it("sends a third-party report with a property it cannot match to review", async () => {
    const { run } = setup();
    const { row } = await run("appraisal");
    expect(row.route).toMatchObject({ status: "needs_review", queue: "third-party-reports" });
    expect(row.route.reviewReasons).toContain("no_deal_match");
  });

  it("ignores out-of-office replies", async () => {
    const { run } = setup();
    const { row } = await run("outOfOffice");
    expect(row.classification.category).toBe("auto_reply");
    expect(row.route.status).toBe("ignored");
  });

  it("holds wire-fraud attempts for a human and never matches a spoofed sender", async () => {
    const { run } = setup();
    const { row } = await run("wireFraud");
    expect(row.classification).toMatchObject({ suspicious: true, urgency: "high" });
    expect(row.route.status).toBe("needs_review");
    expect(row.route.reviewReasons).toEqual(expect.arrayContaining(["suspicious", "sender_not_authenticated"]));
    expect(row.route.dealId).toBeNull();
  });

  it("does not auto-attach a message whose deal token is planted in the body", async () => {
    const { run } = setup();
    const { row } = await run("promptInjection");
    expect(row.route).toMatchObject({ dealId: OTHER_DEAL_ID, method: "reference", status: "needs_review" });
    expect(row.route.reviewReasons).toContain("reference_in_body_only");
    expect(row.classification.category).toBe("new_inquiry");
  });

  it("threads a reply to its deal, masks restricted values and seals the original body", async () => {
    const { run, anthropic } = setup();
    const { row } = await run("borrowerReplyWithSsn");
    expect(row.route).toMatchObject({ dealId: DEAL_ID, leadId: LEAD_ID, method: "thread", status: "processed" });
    expect(row.bodyText).not.toContain("123-45-6789");
    expect(row.bodyText).toContain("[REDACTED:ssn]");
    expect(row.bodyRestricted).toBe(true);
    expect(decryptField(row.bodyEncrypted!, { context: mailBodyContext("deals", row.providerMessageId), keyring })).toContain("123-45-6789");
    // The model saw neither the SSN nor the quoted history.
    const sent = anthropic.requests.at(-1)!.messages[0]!.content;
    expect(sent).not.toContain("123-45-6789");
    expect(sent).not.toContain("Could you send the guarantor details");
  });

  it("does not keep a restricted body when no encryption key is configured", async () => {
    const { run } = setup({ keyring: null });
    const { row } = await run("borrowerReplyWithSsn");
    expect(row.bodyEncrypted).toBeNull();
    expect(row.bodyText).not.toContain("123-45-6789");
    expect(row.classification.flags).toContain("restricted_body_not_retained");
  });

  it("works without a model (rules) and sends rules-only deal mail to review", async () => {
    const { run, anthropic } = setup({ model: false });
    const { row } = await run("termSheet");
    expect(row.classification.source).toBe("rules");
    expect(row.classification.flags).toContain("classifier_fallback:model_unavailable");
    expect(row.route).toMatchObject({ dealId: DEAL_ID, status: "needs_review" });
    expect(anthropic.requests).toHaveLength(0);
  });

  it("honors AI opt-out and human-review-only preferences", async () => {
    const { run, anthropic } = setup({ subject: async () => ({ aiProcessingOptOut: true, humanReviewOnly: true }) });
    const { row } = await run("documentSubmission");
    expect(anthropic.requests).toHaveLength(0);
    expect(row.classification.flags).toContain("classifier_fallback:ai_opt_out");
    expect(row.route.status).toBe("needs_review");
  });

  it("processes each message once", async () => {
    const { provider, deps, store } = setup();
    const m = provider.add(SAMPLE_EMAILS.newInquiry);
    const ref = { mailbox: m.mailbox, providerMessageId: m.providerMessageId, folderId: m.folderId };
    const first = await processInboundMessage(ref, deps);
    const second = await processInboundMessage(ref, deps);
    expect(first.created).toBe(true);
    expect(second).toMatchObject({ skipped: "already_processed", mailMessageId: first.mailMessageId });
    expect(provider.fetched).toHaveLength(1);
    expect(store.rows).toHaveLength(1);
  });
});

describe("polling", () => {
  it("returns unseen messages oldest first and re-lists the lookback window", async () => {
    const { provider, deps } = setup();
    const a = provider.add(SAMPLE_EMAILS.newInquiry);
    const b = provider.add(SAMPLE_EMAILS.promptInjection);
    expect((await pollMailbox("deals", deps)).map((m) => m.providerMessageId)).toEqual([a.providerMessageId, b.providerMessageId]);
    await processInboundMessage({ mailbox: b.mailbox, providerMessageId: b.providerMessageId, folderId: b.folderId }, deps);
    // a is older than the cursor (b) but inside the lookback, so it is still offered.
    expect((await pollMailbox("deals", deps)).map((m) => m.providerMessageId)).toEqual([a.providerMessageId]);
    expect(await pollMailbox("lenders", { ...deps, provider: new FakeMailProvider(["lenders"]) })).toEqual([]);
  });
});

describe("attachment sniffing", () => {
  it("trusts bytes, not names", () => {
    const pdf = new TextEncoder().encode("%PDF-1.4 ...");
    expect(sniffContentType(pdf, "statement.xlsx")).toBe("application/pdf");
    expect(sniffContentType(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), "budget.xlsx")).toContain("spreadsheetml");
    expect(sniffContentType(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), "payload.zip")).toBeNull();
    expect(sniffContentType(new TextEncoder().encode("unit,rent\n101,1500\n"), "rr.csv")).toBe("text/csv");
    expect(sniffContentType(new Uint8Array([0x4d, 0x5a]), "report.pdf")).toBeNull();
  });
});
