import { describe, expect, it } from "vitest";
import { cleanLine, cleanMarkdown } from "./sanitize";
import type { RoutedMail } from "./notes";
import { noteFromMail } from "./notes";
import { routedMailFromRow } from "./mail-source";
import { STAGE_TASKS, dueAtFor, mailTaskDraft, stageTaskDraft, targetsFrom, taskOp } from "./tasks";

describe("due dates", () => {
  it("counts business days in the office time zone, skipping weekends and holidays", () => {
    // Wed 2026-11-04 10:00 PT + 1 business day = Thu Nov 5, end of day PT.
    expect(dueAtFor(new Date("2026-11-04T18:00:00Z"), 1)).toBe("2026-11-06T07:59:59.999Z");
    // Fri Nov 6 + 1 = Mon Nov 9.
    expect(dueAtFor(new Date("2026-11-06T18:00:00Z"), 1)).toBe("2026-11-10T07:59:59.999Z");
    // Tue Nov 10 + 1 skips Veterans Day (Wed Nov 11) to Thu Nov 12.
    expect(dueAtFor(new Date("2026-11-10T18:00:00Z"), 1)).toBe("2026-11-13T07:59:59.999Z");
    // Same day when zero.
    expect(dueAtFor(new Date("2026-11-04T18:00:00Z"), 0)).toBe("2026-11-05T07:59:59.999Z");
  });
});

describe("stage tasks", () => {
  it("carries compliance steps without promising outcomes", () => {
    expect(stageTaskDraft("engaged")!.title).toMatch(/MLDS/);
    expect(stageTaskDraft("closing")!.markdown).toMatch(/not guaranteed/);
    for (const t of Object.values(STAGE_TASKS)) {
      expect(`${t.title} ${t.markdown}`).not.toMatch(/\b(approved|pre-?approved|qualified for|will call you)\b|(?<!not )\bguarantee[sd]?\b/i);
    }
    expect(stageTaskDraft("hud_review")).toBeNull();
  });

  it("builds a valid task operation", () => {
    const op = taskOp(stageTaskDraft("term_sheet")!, { targets: { opportunityId: "opp-1" }, source: { kind: "stage", id: "e1" }, assigneeId: null, now: new Date("2026-11-04T18:00:00Z") });
    expect(op).toMatchObject({ type: "task_create", assigneeId: null, dueAt: "2026-11-06T07:59:59.999Z" });
    expect(targetsFrom(null)).toBeNull();
    expect(targetsFrom({ opportunityId: null, personId: null })).toBeNull();
    expect(targetsFrom({ opportunityId: "o", personId: "p" })).toEqual({ opportunityId: "o", personId: "p" });
  });
});

const base: RoutedMail = {
  id: "m1",
  mailbox: "deals",
  subject: "Hello",
  fromAddress: "a@b.example",
  fromName: null,
  receivedAt: "2026-11-04T16:00:00.000Z",
  status: "processed",
  dealId: "d1",
  leadId: null,
  category: "borrower_update",
  summary: "s",
  confidence: 0.8,
  source: "rules",
  suspicious: false,
  needsBroker: false,
  urgency: "normal",
  documentKinds: [],
  attachmentCount: 0,
  automated: false,
  bulk: false,
};

describe("mail tasks", () => {
  it("creates tasks only where an advisor must act", () => {
    expect(mailTaskDraft(base)).toBeNull();
    expect(mailTaskDraft({ ...base, category: "document_submission", needsBroker: true })).toBeNull();
    expect(mailTaskDraft({ ...base, needsBroker: true })).toMatchObject({ key: "read", businessDays: 1 });
    expect(mailTaskDraft({ ...base, needsBroker: true, urgency: "high" })).toMatchObject({ businessDays: 0 });
    expect(mailTaskDraft({ ...base, category: "term_sheet" })).toMatchObject({ key: "terms" });
    expect(mailTaskDraft({ ...base, suspicious: true, needsBroker: true })).toMatchObject({ key: "suspicious", businessDays: 0 });
    expect(mailTaskDraft({ ...base, automated: true, needsBroker: true })).toBeNull();
    expect(mailTaskDraft({ ...base, status: "needs_review", needsBroker: true })).toBeNull();
  });
});

describe("mail notes", () => {
  it("holds the classification and a pointer to the mail row, never the body", () => {
    const d = noteFromMail({ ...base, source: "model", attachmentCount: 2, documentKinds: ["T12", "RENT_ROLL"], subject: "T-12 <b>attached</b>" }, { opportunityId: "o1", personId: null });
    expect("op" in d).toBe(true);
    if (!("op" in d)) return;
    expect(d.op.title).toBe("Borrower update: T-12 attached");
    expect(d.op.markdown).toContain("Attachments: 2 (T12, RENT_ROLL); stored in the document vault");
    expect(d.op.markdown).toContain("machine-generated");
    expect(d.op.targets).toEqual({ opportunityId: "o1" });
  });

  it("needs a CRM record to write to", () => {
    expect(noteFromMail(base, null)).toEqual({ skip: "no_crm_record" });
    expect(noteFromMail(base, { opportunityId: null, personId: null })).toEqual({ skip: "no_crm_record" });
  });

  it("reads the mail_messages row", () => {
    const m = routedMailFromRow({
      id: "m1",
      mailbox: "lenders",
      subject: "Terms",
      from_address: "x@lender.example",
      from_name: "X",
      received_at: "2026-11-04T16:00:00Z",
      status: "processed",
      deal_id: "d1",
      lead_id: null,
      category: "term_sheet",
      confidence: "0.910",
      classifier_source: "model",
      suspicious: false,
      classification: { summary: "Terms", needsBroker: true, urgency: "high", documentKinds: ["OTHER", 3] },
      attachments: [{}, {}],
      automated: false,
      bulk: false,
    });
    expect(m).toMatchObject({ confidence: 0.91, summary: "Terms", needsBroker: true, urgency: "high", documentKinds: ["OTHER"], attachmentCount: 2 });
    expect(routedMailFromRow({ id: "m2", mailbox: "deals", subject: "", from_address: "", from_name: null, received_at: "", status: "processed", deal_id: null, lead_id: null, category: "other", confidence: 0, classifier_source: "rules", suspicious: false, classification: null, attachments: null, automated: false, bulk: false }).urgency).toBe("normal");
  });
});

describe("sanitize", () => {
  it("cleans one-line text", () => {
    expect(cleanLine(["  a", String.fromCharCode(0), "b", String.fromCharCode(0x202e), "  <i>c</i>\n\td "].join(""), 50)).toBe("ab c d");
    expect(cleanLine("x".repeat(500), 10)).toHaveLength(10);
  });

  it("neutralizes links, images, html and restricted numbers in markdown", () => {
    const out = cleanMarkdown("![x](http://a.example/p.png) [click](javascript:alert(1)) <img src=x onerror=1> https://phish.example/a?b=1\n\n\n\nacct 1234567890123456", 1000);
    expect(out).not.toMatch(/\]\(|<img|https?:\/\//);
    expect(out).toContain("hxxps://phish.example/a?b=1");
    expect(out).not.toContain("1234567890123456");
  });
});
