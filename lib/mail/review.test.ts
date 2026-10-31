import { describe, expect, it } from "vitest";
import { MemoryAttachmentSink, QUARANTINE_BUCKET } from "./attachments";
import { dealReferenceToken } from "./classify";
import { FakeMailProvider } from "./fake";
import { DEAL_ID, LEAD_ID, SAMPLE_EMAILS } from "./fixtures";
import { processInboundMessage, recordInboundFailure, type InboundDeps } from "./inbound";
import { MAX_MAIL_ATTEMPTS } from "./mailboxes";
import { assignReviewedMail, dismissReviewedMail, listReviewQueue, memoryReviewTargets, reviewAlertContent, shouldAlertReview, type ReviewDeps } from "./review";
import { MemoryDealDirectory } from "./route";
import { MemoryMailStore } from "./store";

const STRANGER = "new.owner@example.com";

function setup() {
  const provider = new FakeMailProvider();
  const store = new MemoryMailStore();
  const sink = new MemoryAttachmentSink();
  const directory = new MemoryDealDirectory([{ id: DEAL_ID, leadId: LEAD_ID, name: "Harbor View Apartments refi" }], [{ id: LEAD_ID, email: "pat.lee@example.com" }]);
  const inbound: InboundDeps = { provider, store, directory, sink, gateway: null, keyring: null, now: () => new Date("2026-11-03T17:00:00Z") };
  const review: ReviewDeps = { store, sink, targets: memoryReviewTargets(directory), now: () => new Date("2026-11-03T18:00:00Z") };
  /** docs@ submission from a sender who matches no lead: attachments land in quarantine only. */
  const unrouted = async () => {
    const m = provider.add({ ...SAMPLE_EMAILS.documentSubmission, fromAddress: STRANGER });
    const res = await processInboundMessage({ mailbox: m.mailbox, providerMessageId: m.providerMessageId, folderId: m.folderId }, inbound);
    return res;
  };
  return { provider, store, sink, inbound, review, unrouted };
}

describe("mail review queue", () => {
  it("lists a docs@ submission nobody could match, with its attachments held in quarantine", async () => {
    const { store, sink, unrouted } = setup();
    const res = await unrouted();
    expect(res.route?.status).toBe("needs_review");
    expect(res.storedAttachments).toBe(2);
    expect(sink.documents).toHaveLength(0);
    expect([...sink.objects.keys()].every((k) => k.startsWith(`${QUARANTINE_BUCKET}/`))).toBe(true);

    const queue = await listReviewQueue(store);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ id: res.mailMessageId, mailbox: "docs", queue: "documents", status: "needs_review", fromAddress: STRANGER });
    expect(queue[0]!.reviewReasons.length).toBeGreaterThan(0);
    expect(await listReviewQueue(store, { queue: "deal-desk" })).toHaveLength(0);
  });

  it("filing to a lead registers the held attachments as quarantined vault documents for the scanner", async () => {
    const { store, sink, review, unrouted } = setup();
    const res = await unrouted();
    const out = await assignReviewedMail(review, res.mailMessageId!, "analyst@kuberacommercial.com", LEAD_ID);
    expect(out).toMatchObject({ ok: true, leadId: LEAD_ID, dealId: null, registered: 2, failed: 0, heldBack: 0 });
    expect(sink.documents).toHaveLength(2);
    expect(sink.documents.every((d) => d.leadId === LEAD_ID && d.status === "quarantined")).toBe(true);
    expect(sink.documents.map((d) => d.kind).sort()).toEqual(["RENT_ROLL", "T12"]);

    const row = store.rows.find((r) => r.id === res.mailMessageId)!;
    expect(row).toMatchObject({ reviewedBy: "analyst@kuberacommercial.com", reviewOutcome: "assigned", reviewedAt: "2026-11-03T18:00:00.000Z" });
    expect(row.route).toMatchObject({ status: "processed", leadId: LEAD_ID });
    expect(row.attachments.filter((a) => a.status === "registered").map((a) => a.documentId)).toEqual(sink.documents.map((d) => d.id));
    expect(await listReviewQueue(store)).toHaveLength(0);

    // A second resolution loses the compare-and-set.
    expect(await assignReviewedMail(review, res.mailMessageId!, "broker@kuberacommercial.com", LEAD_ID)).toMatchObject({ ok: false, code: "not_in_queue" });
    expect(sink.documents).toHaveLength(2);
  });

  it("accepts a KC deal reference and files under the deal's lead", async () => {
    const { review, unrouted, sink } = setup();
    const res = await unrouted();
    const out = await assignReviewedMail(review, res.mailMessageId!, "analyst@kuberacommercial.com", dealReferenceToken(DEAL_ID));
    expect(out).toMatchObject({ ok: true, dealId: DEAL_ID, leadId: LEAD_ID, registered: 2 });
    expect(sink.documents.every((d) => d.leadId === LEAD_ID)).toBe(true);
  });

  it("refuses a target that matches nothing and leaves the message in the queue", async () => {
    const { store, review, unrouted, sink } = setup();
    const res = await unrouted();
    expect(await assignReviewedMail(review, res.mailMessageId!, "a@kuberacommercial.com", "KC-00000000")).toMatchObject({ ok: false, code: "unknown_target" });
    expect(await assignReviewedMail(review, res.mailMessageId!, "a@kuberacommercial.com", "11111111-1111-4111-8111-111111111111")).toMatchObject({ ok: false, code: "unknown_target" });
    expect(await assignReviewedMail(review, res.mailMessageId!, "a@kuberacommercial.com", "drop table")).toMatchObject({ ok: false, code: "unknown_target" });
    expect(sink.documents).toHaveLength(0);
    expect(await listReviewQueue(store)).toHaveLength(1);
  });

  it("dismissing closes the review without filing anything", async () => {
    const { store, review, unrouted, sink } = setup();
    const res = await unrouted();
    expect(await dismissReviewedMail(review, res.mailMessageId!, "a@kuberacommercial.com")).toEqual({ ok: true });
    expect(store.rows[0]).toMatchObject({ reviewOutcome: "dismissed" });
    expect(store.rows[0]!.route.status).toBe("ignored");
    expect(sink.documents).toHaveLength(0);
    expect(await listReviewQueue(store)).toHaveLength(0);
  });

  it("lists a message that failed every retry; it can be dismissed but not filed", async () => {
    const { store, review, inbound } = setup();
    let failed: { id: string; attempts: number } | null = null;
    for (let i = 0; i < MAX_MAIL_ATTEMPTS; i++) failed = await recordInboundFailure({ mailbox: "docs", providerMessageId: "zoho-9", folderId: "inbox" }, inbound, "Zoho 500");
    expect(failed?.attempts).toBe(MAX_MAIL_ATTEMPTS);
    const [item] = await listReviewQueue(store);
    expect(item).toMatchObject({ id: failed!.id, status: "failed", error: "Zoho 500" });
    expect(await assignReviewedMail(review, failed!.id, "a@kuberacommercial.com", LEAD_ID)).toMatchObject({ ok: false, code: "not_assignable" });
    expect(await dismissReviewedMail(review, failed!.id, "a@kuberacommercial.com")).toEqual({ ok: true });
    expect(await listReviewQueue(store)).toHaveLength(0);
  });

  it("does not list a message that still has retries left", async () => {
    const { store, inbound } = setup();
    await recordInboundFailure({ mailbox: "docs", providerMessageId: "zoho-10", folderId: "inbox" }, inbound, "Zoho 500");
    expect(await listReviewQueue(store)).toHaveLength(0);
  });
});

describe("review alert", () => {
  it("pages staff for deals@ and docs@ only", () => {
    expect(shouldAlertReview("docs")).toBe(true);
    expect(shouldAlertReview("deals")).toBe(true);
    expect(shouldAlertReview("lenders")).toBe(false);
  });

  it("carries reasons and counts, never the sender or subject", () => {
    const c = reviewAlertContent({ mailMessageId: "m1", mailbox: "docs", category: "document_submission", reviewReasons: ["no_deal_match", "sender_not_verified"], storedAttachments: 2 });
    expect(c.title).toBe("Mail needs review: docs@");
    expect(c.lines.join(" ")).toMatch(/No matching deal or lead/);
    expect(c.lines.join(" ")).toMatch(/2 attachments are held in quarantine/);
    expect(c.lines.join(" ")).not.toContain("@example.com");
  });
});
