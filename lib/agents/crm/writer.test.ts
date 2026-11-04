import { describe, expect, it } from "vitest";
import { CrmError } from "./types";
import type { CrmOperation } from "./operations";
import { harness, DEAL_ID, seedDeal } from "./testing";
import type { SubmitContext } from "./writer";

const stageOp = (over: Record<string, unknown> = {}): CrmOperation =>
  ({ type: "stage_update", opportunityId: "opp-1", toStage: "NEGOTIATION", fromStage: "QUALIFICATION", dealId: DEAL_ID, dealStage: "term_sheet", ...over }) as CrmOperation;
const noteOp = (over: Record<string, unknown> = {}): CrmOperation =>
  ({ type: "note_create", title: "Email: terms", markdown: "A lender sent terms.", targets: { opportunityId: "opp-1" }, source: { kind: "mail", id: "m1" }, ...over }) as CrmOperation;
const ctx = (over: Partial<SubmitContext> = {}): SubmitContext => ({ task: "stage_sync", idempotencyKey: "stage:event-1", dealId: DEAL_ID, ...over });

describe("approval gate (Global rule 2)", () => {
  it("a stage change waits for a broker and writes nothing until approved", async () => {
    const h = harness();
    seedDeal(h);
    const out = await h.writer.submit(stageOp(), ctx());
    expect(out).toMatchObject({ status: "pending_approval" });
    expect(h.crm.writes).toEqual([]);
    expect(h.crm.opportunities.get("opp-1")!.stage).toBe("QUALIFICATION");
    expect(h.events.phases("stage_update")).toEqual(["proposed", "approval_requested"]);

    const [approval] = await h.pending();
    expect(approval).toMatchObject({ kind: "crm_update", requestedBy: "agent:crm:stage_sync", dealId: null });
    expect(approval!.summary).toMatch(/QUALIFICATION to NEGOTIATION/);

    const ran = await h.approve(approval!.id);
    expect(ran).toEqual([expect.objectContaining({ executor: "crm_agent", status: "executed" })]);
    expect(h.crm.opportunities.get("opp-1")!.stage).toBe("NEGOTIATION");
    expect(h.events.phases("stage_update")).toEqual(["proposed", "approval_requested", "write_started", "executed"]);
    const done = h.events.events.at(-1)!;
    expect(done).toMatchObject({ approver: "Pat Broker", externalRef: "opp-1", approvalId: approval!.id, toolVersion: "crm-tools@1" });
  });

  it("a duplicate submit and a duplicate approval write once", async () => {
    const h = harness();
    seedDeal(h);
    await h.writer.submit(stageOp(), ctx());
    await h.writer.submit(stageOp(), ctx());
    expect(await h.pending()).toHaveLength(1);
    const [approval] = await h.pending();
    const first = await h.approve(approval!.id);
    const again = await h.approvals.executeOnce(approval!.id, async () => {
      throw new Error("must not run twice");
    });
    expect(first[0]!.status).toBe("executed");
    expect(again.status).toBe("already_executed");
    expect(h.crm.writes).toEqual(["updateOpportunityStage"]);
    // Asking again after it ran does not write again either.
    const third = await h.writer.submit(stageOp({ fromStage: "NEGOTIATION" }), ctx());
    expect(third).toEqual({ status: "skipped", reason: "already_in_stage" });
    expect(h.crm.writes).toEqual(["updateOpportunityStage"]);
  });

  it("a rejected approval never writes", async () => {
    const h = harness();
    seedDeal(h);
    await h.writer.submit(stageOp(), ctx());
    const [approval] = await h.pending();
    await h.reject(approval!.id);
    const again = await h.writer.submit(stageOp(), ctx());
    expect(again).toMatchObject({ status: "rejected" });
    expect(h.crm.writes).toEqual([]);
    expect(h.events.phases("stage_update")).toContain("approval_rejected");
  });

  it("an approval that times out expires and never writes", async () => {
    const h = harness();
    seedDeal(h);
    await h.writer.submit(stageOp(), ctx({ ttlMinutes: 60 }));
    h.advance(61 * 60_000);
    const again = await h.writer.submit(stageOp(), ctx({ ttlMinutes: 60 }));
    expect(again).toMatchObject({ status: "expired" });
    expect(h.crm.writes).toEqual([]);
    expect(h.events.phases("stage_update")).toContain("approval_expired");
  });

  it("an approval decided after the CRM moved on is skipped, not applied", async () => {
    const h = harness();
    seedDeal(h);
    await h.writer.submit(stageOp(), ctx());
    // A broker moves the opportunity by hand in Twenty while the approval waits.
    h.crm.opportunities.get("opp-1")!.stage = "PROPOSAL";
    const [approval] = await h.pending();
    const ran = await h.approve(approval!.id);
    expect(ran[0]).toMatchObject({ status: "executed", ref: "skipped:stale_crm_stage" });
    expect(h.crm.writes).toEqual([]);
    expect(h.events.phases("stage_update").at(-1)).toBe("skipped");
  });

  it("a stage change whose deal moved on is superseded", async () => {
    let dealStage = "term_sheet";
    const h = harness({ dealStage: async () => dealStage });
    seedDeal(h);
    await h.writer.submit(stageOp(), ctx());
    dealStage = "application";
    const [approval] = await h.pending();
    const ran = await h.approve(approval!.id);
    expect(ran[0]).toMatchObject({ ref: "skipped:superseded" });
    expect(h.crm.writes).toEqual([]);
  });

  it("never moves a closed opportunity back to an open stage", async () => {
    const h = harness();
    seedDeal(h, { crmStage: "CLOSED_WON" });
    const out = await h.writer.submit(stageOp({ fromStage: "CLOSED_WON" }), ctx());
    expect(out).toEqual({ status: "skipped", reason: "crm_terminal_stage" });
    expect(await h.pending()).toHaveLength(0);
  });

  it("skips a no-op and a missing opportunity without asking a broker", async () => {
    const h = harness();
    seedDeal(h, { crmStage: "NEGOTIATION" });
    expect(await h.writer.submit(stageOp({ fromStage: "NEGOTIATION" }), ctx())).toEqual({ status: "skipped", reason: "already_in_stage" });
    expect(await h.writer.submit(stageOp({ opportunityId: "nope" }), ctx({ idempotencyKey: "stage:event-2" }))).toEqual({ status: "skipped", reason: "opportunity_not_found" });
    expect(await h.pending()).toHaveLength(0);
  });

  it("owner changes and company merges always wait for a broker, even on automate", async () => {
    const h = harness({ autonomy: { default: "automate", tasks: {} } });
    seedDeal(h);
    h.crm.members.push({ id: "member-1", name: "Pat", email: "pat@example.com" });
    const owner = await h.writer.submit({ type: "owner_assign", opportunityId: "opp-1", memberId: "member-1", dealId: DEAL_ID }, ctx({ task: "owner_assignment", idempotencyKey: "owner:opp-1:m1" }));
    expect(owner.status).toBe("pending_approval");
    h.crm.addCompany({ id: "c1", name: "Acme LLC" });
    h.crm.addCompany({ id: "c2", name: "Acme LLC" });
    const merge = await h.writer.submit({ type: "company_merge", survivorId: "c1", duplicateId: "c2", score: 1, reasons: ["same_name", "same_domain"] }, ctx({ task: "dedupe", idempotencyKey: "merge:c1:c2" }));
    expect(merge.status).toBe("pending_approval");
    expect(h.crm.writes).toEqual([]);
  });
});

describe("autonomy levels", () => {
  it("automate writes notes directly and logs them", async () => {
    const h = harness();
    seedDeal(h);
    const out = await h.writer.submit(noteOp(), ctx({ task: "email_notes", idempotencyKey: "note:mail:m1" }));
    expect(out).toMatchObject({ status: "executed", approvalId: null });
    expect(h.crm.notes).toHaveLength(1);
    expect(await h.pending()).toHaveLength(0);
    expect(h.events.phases("note_create")).toEqual(["proposed", "write_started", "executed"]);
    // The log keeps sizes and a hash, never the note text.
    expect(JSON.stringify(h.events.events)).not.toContain("A lender sent terms");
    expect(h.events.events.at(-1)!.detail).toMatchObject({ bodyChars: 20, bodySha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });

  it("the same note is written once however often it is submitted", async () => {
    const h = harness();
    seedDeal(h);
    const c = ctx({ task: "email_notes", idempotencyKey: "note:mail:m1" });
    const a = await h.writer.submit(noteOp(), c);
    const b = await h.writer.submit(noteOp(), c);
    expect(a).toMatchObject({ status: "executed", replayed: false });
    expect(b).toMatchObject({ status: "executed", replayed: true });
    expect(h.crm.notes).toHaveLength(1);
  });

  it("assist sends notes through the approval gate", async () => {
    const h = harness({ autonomy: { default: "assist", tasks: {} } });
    seedDeal(h);
    const out = await h.writer.submit(noteOp(), ctx({ task: "email_notes", idempotencyKey: "note:mail:m1" }));
    expect(out.status).toBe("pending_approval");
    expect(h.crm.notes).toHaveLength(0);
    const [approval] = await h.pending();
    await h.approve(approval!.id);
    expect(h.crm.notes).toHaveLength(1);
  });

  it("audit logs what it would do and writes and requests nothing", async () => {
    const h = harness({ autonomy: { default: "automate", tasks: { stage_sync: "audit", email_notes: "audit" } } });
    seedDeal(h);
    expect(await h.writer.submit(stageOp(), ctx())).toEqual({ status: "logged_only" });
    expect(await h.writer.submit(noteOp(), ctx({ task: "email_notes", idempotencyKey: "note:mail:m1" }))).toEqual({ status: "logged_only" });
    expect(h.crm.writes).toEqual([]);
    expect(await h.pending()).toHaveLength(0);
    expect(h.events.phases()).toEqual(["proposed", "audit_only", "proposed", "audit_only"]);
  });

  it("an approval decided while the task is in audit is not applied", async () => {
    const h = harness();
    seedDeal(h);
    await h.writer.submit(stageOp(), ctx());
    const [approval] = await h.pending();
    const audit = harness({ autonomy: { default: "audit", tasks: {} } });
    const out = await audit.writer.executeApproval({ ...approval!, status: "approved" });
    expect(out).toEqual({ status: "logged_only" });
  });
});

describe("least privilege and validation", () => {
  it("refuses an operation outside the task's profile, before any CRM call", async () => {
    const h = harness();
    seedDeal(h);
    const out = await h.writer.submit(stageOp(), ctx({ task: "email_notes" }));
    expect(out).toEqual({ status: "blocked", reason: "operation_outside_task_scope" });
    expect(h.crm.calls).toEqual([]);
    expect(h.events.events.at(-1)).toMatchObject({ phase: "blocked", reasonCodes: ["operation_outside_task_scope"] });
  });

  it("refuses malformed operations and unsafe ids", async () => {
    const h = harness();
    seedDeal(h);
    expect(await h.writer.submit({ type: "stage_update", opportunityId: "../../people", toStage: "x" } as unknown as CrmOperation, ctx())).toEqual({ status: "blocked", reason: "invalid_operation" });
    expect(await h.writer.submit(stageOp({ opportunityId: "opp-1?x=1" }), ctx())).toEqual({ status: "blocked", reason: "invalid_operation" });
    expect(await h.writer.submit(stageOp(), ctx({ idempotencyKey: "short" }))).toEqual({ status: "blocked", reason: "invalid_idempotency_key" });
    expect(h.crm.calls).toEqual([]);
  });

  it("will not merge a company into itself", async () => {
    const h = harness();
    const out = await h.writer.submit({ type: "company_merge", survivorId: "c1", duplicateId: "c1", score: 1, reasons: [] }, ctx({ task: "dedupe", idempotencyKey: "merge:c1:c1" }));
    expect(out).toEqual({ status: "blocked", reason: "invalid_operation" });
  });

  it("executes only a valid CRM agent payload from the approvals table", async () => {
    const h = harness();
    expect(await h.writer.executeApproval({ id: "a", idempotencyKey: "crm:x:y:z:1", status: "approved", payload: { stage: "term_sheet" } })).toEqual({ status: "blocked", reason: "invalid_approval_payload" });
    const payload = { agent: "crm", v: 1, task: "email_notes", operation: stageOp(), reasonCodes: [], dealId: null, leadId: null };
    expect(await h.writer.executeApproval({ id: "a", idempotencyKey: "crm:x:y:z:1", status: "approved", payload })).toEqual({ status: "blocked", reason: "operation_outside_task_scope" });
    expect(await h.writer.executeApproval({ id: "a", idempotencyKey: "crm:x:y:z:1", status: "pending", payload: { ...payload, task: "stage_sync" } })).toEqual({ status: "blocked", reason: "approval_not_approved" });
    expect(h.crm.calls).toEqual([]);
  });
});

describe("event log", () => {
  it("does not write when the event cannot be logged", async () => {
    const h = harness();
    seedDeal(h);
    h.events.failWith = new Error("agent_events insert failed");
    const out = await h.writer.submit(noteOp(), ctx({ task: "email_notes", idempotencyKey: "note:mail:m1" }));
    expect(out).toEqual({ status: "blocked", reason: "event_log_unavailable" });
    expect(h.crm.writes).toEqual([]);
    // Once the log is back the same change goes through.
    h.events.failWith = null;
    expect(await h.writer.submit(noteOp(), ctx({ task: "email_notes", idempotencyKey: "note:mail:m1" }))).toMatchObject({ status: "executed" });
  });

  it("stops before the write when only the write_started event fails", async () => {
    const h = harness();
    seedDeal(h);
    const original = h.events.record.bind(h.events);
    h.events.record = async (e) => {
      if (e.phase === "write_started") throw new Error("down");
      return original(e);
    };
    const out = await h.writer.submit(noteOp(), ctx({ task: "email_notes", idempotencyKey: "note:mail:m1" }));
    expect(out).toEqual({ status: "blocked", reason: "event_log_unavailable" });
    expect(h.crm.notes).toHaveLength(0);
  });
});

describe("failures", () => {
  it("retries a request Twenty refused (503) but not a timeout", async () => {
    const h = harness();
    seedDeal(h);
    h.crm.failNext("createNote", new CrmError("busy", 503, true), new CrmError("busy", 503, true));
    expect(await h.writer.submit(noteOp(), ctx({ task: "email_notes", idempotencyKey: "note:mail:m1" }))).toMatchObject({ status: "executed" });
    expect(h.crm.calls.filter((c) => c === "createNote")).toHaveLength(3);

    h.crm.failNext("createNote", new CrmError("timeout", null, false));
    const out = await h.writer.submit(noteOp({ title: "Other" }), ctx({ task: "email_notes", idempotencyKey: "note:mail:m2" }));
    expect(out.status).toBe("failed");
    expect(h.crm.notes).toHaveLength(1);
    expect(h.events.events.at(-1)).toMatchObject({ phase: "failed", reasonCodes: ["crm_error_network"] });
  });

  it("a failed write can be submitted again with the same key", async () => {
    const h = harness();
    seedDeal(h);
    h.crm.failNext("createNote", new CrmError("bad gateway", 502, false));
    const c = ctx({ task: "email_notes", idempotencyKey: "note:mail:m1" });
    expect((await h.writer.submit(noteOp(), c)).status).toBe("failed");
    expect((await h.writer.submit(noteOp(), c)).status).toBe("executed");
    expect(h.crm.notes).toHaveLength(1);
  });
});

describe("text that reaches the CRM", () => {
  it("strips markup, links and restricted values from notes", async () => {
    const h = harness();
    seedDeal(h);
    await h.writer.submit(
      noteOp({ title: "<b>Hi</b>\n there", markdown: "Pay [here](https://evil.example/x) <script>alert(1)</script> http://evil.example/login SSN 123-45-6789" }),
      ctx({ task: "email_notes", idempotencyKey: "note:mail:m1" }),
    );
    const note = h.crm.notes[0]!;
    expect(note.title).toBe("Hi there");
    expect(note.markdown).not.toMatch(/<script|evil\.example\/x|123-45-6789/);
    expect(note.markdown).toContain("hxxp://evil.example/login");
    expect(note.markdown).toContain("Pay here");
  });
});

describe("company merge", () => {
  it("re-points everything, then trashes the duplicate", async () => {
    const h = harness();
    h.crm.addCompany({ id: "c1", name: "Sunrise Senior Living LLC" });
    h.crm.addCompany({ id: "c2", name: "Sunrise Senior Living, LLC" });
    h.crm.addPerson("p1", "c2");
    h.crm.addOpportunity({ id: "o1", companyId: "c2" });
    h.crm.addNoteTarget("nt1", "c2");
    h.crm.addTaskTarget("tt1", "c2");
    const c = ctx({ task: "dedupe", idempotencyKey: "merge:c1:c2" });
    const op: CrmOperation = { type: "company_merge", survivorId: "c1", duplicateId: "c2", score: 1, reasons: ["same_name", "same_domain"] };
    await h.writer.submit(op, c);
    expect(h.crm.companies.get("c2")!.deleted).toBe(false);
    const [approval] = await h.pending();
    await h.approve(approval!.id);
    expect(h.crm.people.get("p1")!.companyId).toBe("c1");
    expect(h.crm.opportunities.get("o1")!.companyId).toBe("c1");
    expect(h.crm.noteTargets.get("nt1")!.companyId).toBe("c1");
    expect(h.crm.taskTargets.get("tt1")!.companyId).toBe("c1");
    expect(h.crm.companies.get("c2")!.deleted).toBe(true);
    expect(h.events.events.at(-1)!.detail).toMatchObject({ duplicateId: "c2", moved: { people: 1, opportunities: 1, noteTargets: 1, taskTargets: 1 } });
  });

  it("does not delete the duplicate while records still point at it", async () => {
    const h = harness();
    h.crm.addCompany({ id: "c1", name: "Acme" });
    h.crm.addCompany({ id: "c2", name: "Acme" });
    h.crm.addPerson("p1", "c2");
    // The re-point "succeeds" but the person is still linked (a stuck write).
    h.crm.setPersonCompany = async () => {
      h.crm.calls.push("setPersonCompany");
    };
    await h.writer.submit({ type: "company_merge", survivorId: "c1", duplicateId: "c2", score: 1, reasons: [] }, ctx({ task: "dedupe", idempotencyKey: "merge:c1:c2" }));
    const [approval] = await h.pending();
    const ran = await h.approve(approval!.id);
    expect(ran[0]!.status).toBe("failed");
    expect(h.crm.companies.get("c2")!.deleted).toBe(false);
    expect(h.crm.calls).not.toContain("softDeleteCompany");
  });

  it("skips when the duplicate is already gone", async () => {
    const h = harness();
    h.crm.addCompany({ id: "c1", name: "Acme" });
    const out = await h.writer.submit({ type: "company_merge", survivorId: "c1", duplicateId: "c2", score: 1, reasons: [] }, ctx({ task: "dedupe", idempotencyKey: "merge:c1:c2" }));
    expect(out).toEqual({ status: "skipped", reason: "duplicate_already_gone" });
  });
});
