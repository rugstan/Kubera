import { describe, expect, it } from "vitest";
import type { MailClassification } from "./classify";
import { MemoryDealDirectory, routeMail } from "./route";
import type { MailMessage } from "./types";

const DEAL = "11111111-2222-4333-8444-555555555555";
const LEAD = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function msg(over: Partial<MailMessage> = {}): MailMessage {
  return {
    providerMessageId: "m1",
    folderId: "inbox",
    mailbox: "docs",
    subject: "Rent roll attached",
    fromAddress: "attacker@evil-but-dmarc.test",
    fromName: null,
    toAddresses: ["docs@corincommercial.com"],
    ccAddresses: [],
    receivedAt: "2026-11-03T16:00:00Z",
    hasAttachments: true,
    snippet: "",
    internetMessageId: "m1@mail.test",
    inReplyTo: null,
    references: [],
    bodyText: "See attached.",
    attachments: [],
    automated: false,
    bulk: false,
    dmarc: "pass",
    ...over,
  };
}

const classification: MailClassification = {
  category: "document_submission",
  summary: "docs",
  dealReference: null,
  propertyName: null,
  counterparty: null,
  documentKinds: [],
  urgency: "normal",
  needsBroker: false,
  suspicious: false,
  confidence: 0.95,
  source: "model",
  model: "m",
  flags: [],
};

const directory = () =>
  new MemoryDealDirectory(
    [{ id: DEAL, leadId: LEAD, name: "Harbor View refi" }],
    [{ id: LEAD, email: "pat.lee@example.com" }],
    [{ messageId: "cc-outbound-77@corincommercial.com", dealId: DEAL, leadId: LEAD }],
  );

describe("routeMail participant step", () => {
  it("auto-routes when the From address matches and DMARC passed", async () => {
    const r = await routeMail(msg({ fromAddress: "Pat.Lee@example.com" }), classification, directory());
    expect(r).toMatchObject({ dealId: DEAL, method: "participant", status: "processed", reviewReasons: [] });
  });

  it("sends a CC-only match (an outsider CCs a known borrower) to review", async () => {
    const r = await routeMail(msg({ ccAddresses: ["pat.lee@example.com"] }), classification, directory());
    expect(r.dealId).toBe(DEAL);
    expect(r.status).toBe("needs_review");
    expect(r.reviewReasons).toContain("matched_by_cc");
    expect(r.confidence).toBeLessThan(0.8);
  });

  it("reviews a From match without a DMARC pass", async () => {
    const r = await routeMail(msg({ fromAddress: "pat.lee@example.com", dmarc: "none" }), classification, directory());
    expect(r.status).toBe("needs_review");
    expect(r.reviewReasons).toContain("sender_not_verified");
  });

  it("never matches by address when DMARC failed", async () => {
    const r = await routeMail(msg({ fromAddress: "pat.lee@example.com", dmarc: "fail" }), classification, directory());
    expect(r).toMatchObject({ dealId: null, method: "none", status: "needs_review" });
    expect(r.reviewReasons).toContain("sender_not_authenticated");
  });
});

describe("routeMail thread step", () => {
  it("auto-routes a thread reply from an authenticated sender", async () => {
    const r = await routeMail(msg({ fromAddress: "pat.lee@example.com", inReplyTo: "cc-outbound-77@corincommercial.com" }), classification, directory());
    expect(r).toMatchObject({ dealId: DEAL, method: "thread", status: "processed" });
  });

  it("sends a spoofed reply that copied References to review", async () => {
    const r = await routeMail(
      msg({ fromAddress: "pat.lee@example.com", dmarc: "fail", references: ["cc-outbound-77@corincommercial.com"] }),
      classification,
      directory(),
    );
    expect(r.method).toBe("thread");
    expect(r.status).toBe("needs_review");
    expect(r.reviewReasons).toContain("thread_match_sender_not_authenticated");
  });
});
