// Demo mail review queue for fake-auth mode (AUTH_PROVIDER=fake: local
// development and the e2e suite). In-memory and per server process; the deal
// ids match the demo pipeline (lib/approvals/demo.ts DEMO_DEAL_IDS).

import type { MailClassification } from "./classify";
import { MAILBOXES, type InboundMailbox } from "./mailboxes";
import { MemoryAttachmentSink, QUARANTINE_BUCKET } from "./attachments";
import { memoryReviewTargets, type ReviewDeps } from "./review";
import { MemoryDealDirectory } from "./route";
import { MemoryMailStore, type MailRow } from "./store";

export const DEMO_MAIL_LEAD_ID = "20000000-0000-4000-8000-000000000002";
const HOTEL_DEAL_ID = "10000000-0000-4000-8000-000000000002";

function classification(over: Partial<MailClassification>): MailClassification {
  return {
    category: "document_submission",
    summary: "",
    dealReference: null,
    propertyName: null,
    counterparty: null,
    documentKinds: [],
    urgency: "normal",
    needsBroker: true,
    suspicious: false,
    confidence: 0.9,
    source: "model",
    model: null,
    flags: [],
    ...over,
  };
}

function row(mailbox: InboundMailbox, id: string, over: Partial<MailRow> & { reasons: string[] }): MailRow {
  const { reasons, ...rest } = over;
  return {
    mailbox,
    provider: "fake",
    providerMessageId: id,
    folderId: "inbox",
    internetMessageId: `${id}@mail.example`,
    inReplyTo: null,
    references: [],
    fromAddress: "owner@example.com",
    fromName: "Demo Borrower",
    toAddresses: [`${mailbox}@kuberacommercial.com`],
    ccAddresses: [],
    subject: "",
    receivedAt: "2026-10-31T16:00:00.000Z",
    snippet: "",
    bodyText: "",
    bodyEncrypted: null,
    bodyRestricted: false,
    attachments: [],
    automated: false,
    bulk: false,
    dmarc: "pass",
    classification: classification({}),
    route: { dealId: null, leadId: null, method: "none", confidence: 0, queue: MAILBOXES[mailbox].queue, status: "needs_review", reviewReasons: reasons },
    agentRunId: null,
    processedAt: "2026-10-31T16:00:05.000Z",
    error: null,
    ...rest,
  };
}

let cached: ReviewDeps | undefined;

export function demoReviewDeps(): ReviewDeps {
  if (cached) return cached;
  const store = new MemoryMailStore();
  const seed = (r: MailRow) => store.save(r);
  void seed(
    row("docs", "demo-docs-1", {
      subject: "T-12 and rent roll for the Harbor Inn",
      snippet: "Attached are the trailing twelve and the current rent roll.",
      fromAddress: "harbor.owner@example.com",
      fromName: "Harbor Inn owner (demo)",
      receivedAt: "2026-10-31T17:20:00.000Z",
      classification: classification({ documentKinds: ["T12", "RENT_ROLL"], propertyName: "Harbor Inn" }),
      attachments: [
        { attachmentId: "a1", fileName: "Harbor Inn T12.pdf", size: 182_000, contentType: "application/pdf", sha256: "a".repeat(64), status: "stored", bucket: QUARANTINE_BUCKET, storagePath: "inbound-mail/docs/2026/10/demo-docs-1/aaaaaaaaaaaaaaaa-Harbor_Inn_T12.pdf", documentId: null, kind: null, error: null },
        { attachmentId: "a2", fileName: "rent roll.xlsx", size: 41_000, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sha256: "b".repeat(64), status: "stored", bucket: QUARANTINE_BUCKET, storagePath: "inbound-mail/docs/2026/10/demo-docs-1/bbbbbbbbbbbbbbbb-rent_roll.xlsx", documentId: null, kind: null, error: null },
      ],
      reasons: ["no_deal_match"],
    }),
  );
  void seed(
    row("deals", "demo-deals-1", {
      subject: "Re: refinance question",
      snippet: "Following up on our call about the refinance timeline.",
      fromAddress: "partner@example.com",
      fromName: null,
      receivedAt: "2026-10-31T15:05:00.000Z",
      ccAddresses: ["harbor.owner@example.com"],
      classification: classification({ category: "borrower_update", confidence: 0.82 }),
      route: { dealId: HOTEL_DEAL_ID, leadId: DEMO_MAIL_LEAD_ID, method: "participant", confidence: 0.5, queue: MAILBOXES.deals.queue, status: "needs_review", reviewReasons: ["matched_by_cc"] },
      reasons: ["matched_by_cc"],
    }),
  );
  const directory = new MemoryDealDirectory([{ id: HOTEL_DEAL_ID, leadId: DEMO_MAIL_LEAD_ID, name: "Harbor Inn (demo)", propertyName: "Harbor Inn" }], [{ id: DEMO_MAIL_LEAD_ID, email: "harbor.owner@example.com" }]);
  cached = { store, sink: new MemoryAttachmentSink(), targets: memoryReviewTargets(directory) };
  return cached;
}
