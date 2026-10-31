import { describe, expect, it } from "vitest";
import { FakeApprovalGate } from "@/lib/compliance/approval-gate";
import type { ItemStatus } from "@/lib/checklists/types";
import { nudgeClosing, remindDocuments, type ReminderDeps } from "./reminders";
import { DAY, DAYTIME, HOUR, LEAD_EMAIL, LEAD_PHONE, makeCondition, makeDealCtx, makeHarness, makeItem, makeLead, type Harness } from "./testing";

function setup(opts: Parameters<typeof makeHarness>[0] = { preApproved: ["document_reminder_email@1", "document_reminder_sms@1", "closing_nudge_email@1", "closing_nudge_sms@1"] }) {
  const h = makeHarness(opts);
  const lead = makeLead({}, 20 * DAY);
  h.sources.leads = [lead];
  h.grant({ phone: LEAD_PHONE, email: LEAD_EMAIL, leadId: lead.id });
  const deps = (): ReminderDeps => ({ sender: h.sender, store: h.store, escalation: h.escalation, audit: h.audit, sources: h.sources, now: h.now });
  return { h, lead, deps };
}

const dealWith = (lead: { id: string }, items: ReturnType<typeof makeItem>[], over: Parameters<typeof makeDealCtx>[0] = {}) =>
  makeDealCtx({ ...over, deal: { leadId: lead.id, ...over.deal }, items });

describe("document reminders follow the checklist", () => {
  it("emails once a required borrower item has been outstanding for a day", async () => {
    const { h, lead, deps } = setup();
    const r = await remindDocuments(dealWith(lead, [makeItem({ title: "Current rent roll" }), makeItem({ title: "T-12" })]), deps());
    expect(r).toMatchObject({ action: "sent", outstanding: 2, round: 1 });
    expect(h.email.sent).toHaveLength(1);
    expect(h.email.sent[0]?.to).toBe(LEAD_EMAIL);
    expect(h.email.sent[0]?.text).toContain("Current rent roll");
    expect(h.email.sent[0]?.text).toContain("T-12");
    // Round 1 is email only.
    expect(h.sms.sent).toHaveLength(0);
  });

  it("waits until the item has been outstanding long enough", async () => {
    const { h, lead, deps } = setup();
    const fresh = makeItem({}, new Date(DAYTIME.getTime() - 2 * HOUR));
    expect(await remindDocuments(dealWith(lead, [fresh]), deps())).toMatchObject({ action: "none", reason: "not_due" });
    expect(h.email.sent).toHaveLength(0);
  });

  it.each(["submitted", "under_review", "accepted", "waived", "not_applicable"] as ItemStatus[])("does not chase an item that is %s", async (status) => {
    const { h, lead, deps } = setup();
    const r = await remindDocuments(dealWith(lead, [makeItem({ status })]), deps());
    expect(r).toMatchObject({ action: "done", outstanding: 0 });
    expect(h.email.sent).toHaveLength(0);
    expect(h.store.rows).toHaveLength(0);
  });

  it("asks for a corrected copy of a rejected item, counting from the review", async () => {
    const { h, lead, deps } = setup();
    const rejected = makeItem({ status: "rejected", reviewNote: "Statement is missing page 2", reviewedAt: new Date(DAYTIME.getTime() - 2 * DAY).toISOString() }, new Date(DAYTIME.getTime() - 30 * DAY));
    await remindDocuments(dealWith(lead, [rejected]), deps());
    expect(h.email.sent[0]?.text).toContain("needs a corrected copy: Statement is missing page 2");
  });

  it("ignores optional items, items owned by someone else, and pre-closing items", async () => {
    const { h, lead, deps } = setup();
    const items = [
      makeItem({ required: false }),
      makeItem({ responsible: "vendor" }),
      makeItem({ responsible: "title_escrow" }),
      makeItem({ responsible: "lender" }),
      makeItem({ stage: "pre_closing" }),
    ];
    expect((await remindDocuments(dealWith(lead, items), deps())).outstanding).toBe(0);
    expect(h.email.sent).toHaveLength(0);
  });

  it("does not nag about a file that is being uploaded or scanned", async () => {
    const { h, lead, deps } = setup();
    const uploading = makeItem({ title: "Uploading now" });
    const missing = makeItem({ title: "Still missing" });
    await remindDocuments(dealWith(lead, [uploading, missing], { uploadsInFlight: [uploading.id] }), deps());
    expect(h.email.sent[0]?.text).toContain("Still missing");
    expect(h.email.sent[0]?.text).not.toContain("Uploading now");
  });

  it.each(["on_hold", "held_for_counsel", "won", "lost", "withdrawn"] as const)("never chases a %s deal", async (status) => {
    const { h, lead, deps } = setup();
    const r = await remindDocuments(dealWith(lead, [makeItem()], { deal: { status } }), deps());
    expect(r.outstanding).toBe(0);
    expect(h.email.sent).toHaveLength(0);
  });

  it("never chases a closed deal", async () => {
    const { h, lead, deps } = setup();
    await remindDocuments(dealWith(lead, [makeItem()], { deal: { closedOn: "2026-10-01", stage: "closed" } }), deps());
    expect(h.email.sent).toHaveLength(0);
  });

  it("is idempotent within a round", async () => {
    const { h, lead, deps } = setup();
    const ctx = dealWith(lead, [makeItem()]);
    await remindDocuments(ctx, deps());
    expect((await remindDocuments(ctx, deps())).action).toBe("none");
    expect(h.email.sent).toHaveLength(1);
  });

  it("repeats every three days and adds a text from the second round", async () => {
    const { h, lead, deps } = setup();
    const ctx = dealWith(lead, [makeItem()]);
    await remindDocuments(ctx, deps());
    h.clock.now = new Date(DAYTIME.getTime() + 3 * DAY + HOUR);
    const r2 = await remindDocuments(ctx, deps());
    expect(r2).toMatchObject({ action: "sent", round: 2 });
    expect(h.email.sent).toHaveLength(2);
    expect(h.sms.sent).toHaveLength(1);
    expect(h.sms.sent[0]?.text).toMatch(/still waiting on 1 document /);
    expect(h.email.sent[1]?.subject).toMatch(/reminder/i);
  });

  it("stops as soon as the checklist is satisfied", async () => {
    const { h, lead, deps } = setup();
    const item = makeItem();
    await remindDocuments(dealWith(lead, [item]), deps());
    h.clock.now = new Date(DAYTIME.getTime() + 4 * DAY);
    const r = await remindDocuments(dealWith(lead, [{ ...item, status: "accepted" }]), deps());
    expect(r.action).toBe("done");
    expect(h.email.sent).toHaveLength(1);
  });

  it("a reminder still waiting for approval is closed, not released, when the item is accepted", async () => {
    const gate = new FakeApprovalGate("pending");
    const { h, lead, deps } = setup({ gate });
    const item = makeItem();
    expect((await remindDocuments(dealWith(lead, [item]), deps())).outcomes[0]?.status).toBe("pending_approval");

    // The borrower sends the document and staff accept it before any broker looked.
    await remindDocuments(dealWith(lead, [{ ...item, status: "accepted" }]), deps());
    expect(h.store.rows[0]?.status).toBe("expired");

    // Even if the broker approves the old request now, nothing goes out.
    gate.decide("outreach:docrem:deal-1:r1:email", { status: "approved", approvalId: "appr_1", decidedBy: "b", decidedAt: DAYTIME });
    await remindDocuments(dealWith(lead, [{ ...item, status: "accepted" }]), deps());
    expect(h.email.sent).toHaveLength(0);
  });

  it("holds each round for the broker and resumes it without duplicating the request", async () => {
    const gate = new FakeApprovalGate("pending");
    const { h, lead, deps } = setup({ gate });
    const ctx = dealWith(lead, [makeItem()]);
    expect((await remindDocuments(ctx, deps())).outcomes[0]?.status).toBe("pending_approval");
    expect((await remindDocuments(ctx, deps())).action).toBe("resumed");
    expect(h.store.rows).toHaveLength(1);
    expect(h.email.sent).toHaveLength(0);

    gate.decide("outreach:docrem:deal-1:r1:email", { status: "approved", approvalId: "appr_1", decidedBy: "broker@test", decidedAt: DAYTIME });
    const resumed = await remindDocuments(ctx, deps());
    expect(resumed.action).toBe("resumed");
    expect(h.email.sent).toHaveLength(1);
    expect((await remindDocuments(ctx, deps())).action).toBe("none");
    expect(h.email.sent).toHaveLength(1);
  });

  it("sends nothing to a person who has not consented to that channel", async () => {
    const h = makeHarness({ preApproved: ["document_reminder_email@1", "document_reminder_sms@1"] });
    const lead = makeLead({}, 20 * DAY);
    h.sources.leads = [lead];
    // Phone consent only for calls: no text consent.
    h.grant({ phone: LEAD_PHONE, channels: ["phone"] });
    h.stop(LEAD_PHONE);
    h.grant({ email: LEAD_EMAIL, channels: ["email"], eventType: "revoked" });
    const deps: ReminderDeps = { sender: h.sender, store: h.store, escalation: h.escalation, sources: h.sources, now: h.now };
    const ctx = dealWith(lead, [makeItem()]);
    await remindDocuments(ctx, deps);
    h.clock.now = new Date(DAYTIME.getTime() + 4 * DAY);
    await remindDocuments(ctx, deps);
    expect(h.email.sent).toHaveLength(0);
    expect(h.sms.sent).toHaveLength(0);
    expect(h.store.rows.every((r) => r.status === "skipped_no_consent")).toBe(true);
  });

  it("stops after four rounds and tells a broker once", async () => {
    const { h, lead, deps } = setup();
    const ctx = dealWith(lead, [makeItem()]);
    for (let i = 0; i < 4; i++) {
      await remindDocuments(ctx, deps());
      h.clock.now = new Date(h.clock.now.getTime() + 3 * DAY + HOUR);
    }
    expect(h.email.sent).toHaveLength(4);
    const capped = await remindDocuments(ctx, deps());
    expect(capped.action).toBe("capped");
    await remindDocuments(ctx, deps());
    expect(h.email.sent).toHaveLength(4);
    expect(h.escalation.items.filter((e) => e.kind === "documents_overdue")).toHaveLength(1);
  });

  it("tells a broker when the deal has no contact to remind", async () => {
    const { h, deps } = setup();
    const r = await remindDocuments(makeDealCtx({ items: [makeItem()] }), deps());
    expect(r.action).toBe("no_contact");
    expect(h.escalation.items.map((e) => e.kind)).toEqual(["documents_overdue"]);
    expect(h.email.sent).toHaveLength(0);
  });

  it("texts a lead who gave only a phone number, in round 1", async () => {
    const h = makeHarness({ preApproved: ["document_reminder_sms@1"] });
    const lead = makeLead({ contact: { firstName: "Pat", email: null, phone: LEAD_PHONE, consent: true } }, 20 * DAY);
    h.sources.leads = [lead];
    h.grant({ phone: LEAD_PHONE });
    await remindDocuments(dealWith(lead, [makeItem()]), { sender: h.sender, store: h.store, sources: h.sources, now: h.now });
    expect(h.sms.sent).toHaveLength(1);
  });

  it("does not text in the middle of the night; the text waits for the window", async () => {
    const h = makeHarness({ preApproved: ["document_reminder_sms@1"], now: new Date("2026-11-04T05:00:00Z") });
    const lead = makeLead({ contact: { firstName: "Pat", email: null, phone: LEAD_PHONE, consent: true } }, 20 * DAY, h.clock.now);
    h.sources.leads = [lead];
    h.grant({ phone: LEAD_PHONE });
    const deps: ReminderDeps = { sender: h.sender, store: h.store, sources: h.sources, now: h.now };
    const ctx = dealWith(lead, [makeItem({}, new Date(h.clock.now.getTime() - 3 * DAY))]);
    await remindDocuments(ctx, deps);
    expect(h.sms.sent).toHaveLength(0);
    h.clock.now = new Date(h.clock.now.getTime() + 15 * HOUR);
    expect((await remindDocuments(ctx, deps)).action).toBe("resumed");
    expect(h.sms.sent).toHaveLength(1);
  });
});

describe("closing nudges (pre-closing only)", () => {
  const closingCtx = (lead: { id: string }, over: Parameters<typeof makeDealCtx>[0] = {}) =>
    makeDealCtx({
      ...over,
      deal: { leadId: lead.id, stage: "closing", stageEnteredAt: new Date(DAYTIME.getTime() - 2 * DAY).toISOString(), ...over.deal },
      items: over.items ?? [makeItem({ stage: "pre_closing", title: "Evidence of property insurance" })],
      conditions: over.conditions ?? [makeCondition()],
    });

  it("nudges for open pre-closing items and the lender's conditions once the deal is at closing", async () => {
    const { h, lead, deps } = setup();
    const r = await nudgeClosing(closingCtx(lead), deps());
    expect(r).toMatchObject({ action: "sent", outstanding: 2 });
    const text = h.email.sent[0]?.text ?? "";
    expect(text).toContain("Evidence of property insurance");
    expect(text).toContain("Lender condition: Evidence of property insurance naming the lender");
    expect(text).toContain("not guaranteed");
  });

  it("does nothing before commitment or closing", async () => {
    const { h, lead, deps } = setup();
    for (const stage of ["intake", "engaged", "packaging", "lender_outreach", "term_sheet", "application", "underwriting"]) {
      expect((await nudgeClosing(closingCtx(lead, { deal: { stage } }), deps())).outstanding).toBe(0);
    }
    expect(h.email.sent).toHaveLength(0);
  });

  it("does nothing after the deal has closed or ended", async () => {
    const { h, lead, deps } = setup();
    expect((await nudgeClosing(closingCtx(lead, { deal: { stage: "closed", closedOn: "2026-11-01", status: "won" } }), deps())).outstanding).toBe(0);
    expect((await nudgeClosing(closingCtx(lead, { deal: { status: "lost" } }), deps())).outstanding).toBe(0);
    expect(h.email.sent).toHaveLength(0);
  });

  it("only chases conditions the borrower owes and that fall before the closing table", async () => {
    const { lead, deps } = setup();
    const conditions = [
      makeCondition({ responsible: "lender" }),
      makeCondition({ responsible: "title_escrow" }),
      makeCondition({ timing: "at_closing" }),
      makeCondition({ timing: "post_closing" }),
      makeCondition({ status: "cleared" }),
      makeCondition({ status: "waived" }),
      makeCondition({ timing: "prior_to_docs", description: "Signed entity resolution" }),
    ];
    const r = await nudgeClosing(closingCtx(lead, { items: [], conditions }), deps());
    expect(r.outstanding).toBe(1);
  });

  it("chases a satisfied checklist never, and does not double up with document reminders", async () => {
    const { h, lead, deps } = setup();
    const ctx = closingCtx(lead, { items: [makeItem({ stage: "pre_closing", status: "accepted" }), makeItem({ stage: "application" })], conditions: [] });
    expect((await nudgeClosing(ctx, deps())).outstanding).toBe(0);
    expect(h.email.sent).toHaveLength(0);
    // The application-stage item belongs to the document reminders.
    expect((await remindDocuments(ctx, deps())).outstanding).toBe(1);
  });

  it("repeats every two days and caps at five nudges with one broker alert", async () => {
    const { h, lead, deps } = setup();
    const ctx = closingCtx(lead);
    for (let i = 0; i < 5; i++) {
      await nudgeClosing(ctx, deps());
      h.clock.now = new Date(h.clock.now.getTime() + 2 * DAY + HOUR);
    }
    expect(h.email.sent).toHaveLength(5);
    expect((await nudgeClosing(ctx, deps())).action).toBe("capped");
    await nudgeClosing(ctx, deps());
    expect(h.escalation.items.filter((e) => e.kind === "closing_items_overdue")).toHaveLength(1);
  });

  it("messages carry no money or draw language", async () => {
    const { h, lead, deps } = setup();
    await nudgeClosing(closingCtx(lead), deps());
    h.clock.now = new Date(DAYTIME.getTime() + 3 * DAY);
    await nudgeClosing(closingCtx(lead), deps());
    const all = [...h.email.sent.map((e) => e.text), ...h.sms.sent.map((s) => s.text)].join("\n");
    expect(all).not.toMatch(/\bdraw|wire|disburse|escrow balance|trust account|lien waiver/i);
  });
});

export type { Harness };
