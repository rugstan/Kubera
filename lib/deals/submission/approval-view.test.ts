// S1 / F3 / S7: the broker approves exactly what is sent. The approvals card
// shows the stored email and the locked summary (never a live rebuild), both
// checked against the request's hashes; the subject is hashed with the text;
// and a stored email that no longer matches is refused before a link exists
// and before it is shown or mailed.

import { describe, expect, it } from "vitest";
import { MemoryReauthStore, ReauthService } from "@/lib/agents/core/reauth";
import { queueApprovalGate } from "@/lib/approvals/gate";
import { ApprovalService } from "@/lib/approvals/service";
import { MemoryApprovalStore } from "@/lib/approvals/store";
import { approvedEmailForShare, checkOutreachApproval, PackageError } from "../packages";
import { testSummaries } from "../test-fixtures";
import { EMAIL_HASH_MISMATCH, loadApprovalSubmissionContent } from "./approval-view";
import { emailSha256 } from "./email";
import { computeSubmissionMetrics } from "./metrics";
import { defaultPackageDocumentIds } from "./readiness";
import { previewSubmission, submitDealToLenders } from "./send";
import { TEST_ADVISOR, sendWorld } from "./send-test-world";

const BROKER = { userId: "00000000-0000-4000-8000-0000000000b9", label: "Lee Broker", dreLicense: "01234568" };

async function requested(mutate?: Parameters<typeof sendWorld>[2]) {
  const w = await sendWorld("bridge", "pending", mutate);
  const r = await submitDealToLenders(w.deps, { dealId: w.deal.id, targetStage: "term_sheet", lenderIds: [w.lenders.a.id], items: w.items, advisor: TEST_ADVISOR, actor: "broker:ana" });
  const o = r.outcomes[0]!;
  if (!o.ok) throw new Error(o.error);
  const req = w.gate.requests.at(-1)!;
  const record = { kind: req.kind, idempotencyKey: req.idempotencyKey, payload: req.payload };
  const outreachDeps = { store: w.store, gate: w.gate, now: w.now, baseUrl: w.deps.baseUrl, mailer: null, holds: w.deps.holds, summaries: w.summaries };
  return { w, r, o, record, outreachDeps };
}

describe("what the approving broker sees", () => {
  it("is the stored email and the locked summary, each matching the hash in the request", async () => {
    const { w, o, record } = await requested();
    const c = (await loadApprovalSubmissionContent({ store: w.store, summaries: w.summaries }, record))!;
    const row = o.result.outreach;
    expect(c.email).toEqual({ subject: row.emailSubject, text: row.emailText });
    expect(c.emailVerified).toBe(true);
    expect(c.emailProblem).toBeNull();
    // The payload names the locked summary by id; the card loads that row.
    expect(record.payload.summaryId).toBe(row.summaryId);
    expect(c.summary).toEqual(w.summaries.rows.get(row.summaryId!)!.spec);
    expect(c.summaryVerified).toBe(true);
    expect(c.outreachStatus).toBe("pending_approval");
  });

  it("an edit after the request changes the current draft, never the content being approved", async () => {
    const { w, o, record } = await requested();
    w.ctx.profile!.businessPlan = "Plan rewritten after the request: the sponsor now intends to sell in month three.";
    const draft = previewSubmission({ ctx: w.ctx, metrics: computeSubmissionMetrics(w.ctx), stage: "term_sheet", lenders: [(await w.store.getLender(w.lenders.a.id))!], boxes: [], documents: w.items, advisor: TEST_ADVISOR }).lenders[0]!;
    if (!draft.ok) throw new Error(draft.error);
    expect(draft.email.text).not.toBe(o.result.outreach.emailText);
    const c = (await loadApprovalSubmissionContent({ store: w.store, summaries: w.summaries }, record))!;
    expect(c.email!.text).toBe(o.result.outreach.emailText);
    expect(c.email!.text).not.toContain("sell in month three");
    expect(c.emailVerified).toBe(true);
  });

  it("flags a stored email that no longer matches the request, even with a self-consistent row hash", async () => {
    const { w, o, record } = await requested();
    const row = o.result.outreach;
    const tampered = row.emailText!.replace("Harborline Capital", "Harborline Capital (amended)");
    await w.store.updateOutreach(row.id, { emailText: tampered, emailSha256: emailSha256(row.emailSubject!, tampered) }, "x", w.now());
    const c = (await loadApprovalSubmissionContent({ store: w.store, summaries: w.summaries }, record))!;
    expect(c.emailVerified).toBe(false);
    expect(c.emailProblem).toBe(EMAIL_HASH_MISMATCH);
  });

  it("hashes the subject with the text: a changed subject alone does not verify", async () => {
    const { w, o, record } = await requested();
    const row = o.result.outreach;
    expect(row.emailSha256).toBe(emailSha256(row.emailSubject!, row.emailText!));
    expect(row.emailSha256).not.toBe(emailSha256("Another subject", row.emailText!));
    await w.store.updateOutreach(row.id, { emailSubject: "Loan request: $9,900,000 bridge | Corin Commercial", emailSha256: emailSha256("Loan request: $9,900,000 bridge | Corin Commercial", row.emailText!) }, "x", w.now());
    expect((await loadApprovalSubmissionContent({ store: w.store, summaries: w.summaries }, record))!.emailVerified).toBe(false);
  });

  it("flags a locked summary whose spec no longer hashes to the request's summary hash", async () => {
    const { w, o, record } = await requested();
    const rec = w.summaries.rows.get(o.result.outreach.summaryId!)!;
    w.summaries.rows.set(rec.id, { ...rec, spec: { ...rec.spec, title: "Edited title" } });
    const c = (await loadApprovalSubmissionContent({ store: w.store, summaries: w.summaries }, record))!;
    expect(c.summaryVerified).toBe(false);
    expect(c.summary!.title).toBe("Edited title");
  });

  it("ignores other approval kinds", async () => {
    expect(await loadApprovalSubmissionContent({ store: { getOutreachByKey: async () => null }, summaries: testSummaries }, { kind: "email", idempotencyKey: "k-000001", payload: {} })).toBeNull();
  });
});

describe("the send re-verifies the stored email before a link exists, and before it is shown", () => {
  it("refuses an approved submission whose stored text no longer matches the approved hash, and mints no link", async () => {
    // The real queue: the approval's payload hash is the anchor a rewritten row cannot match.
    const w = await sendWorld("bridge", "pending");
    const proofs = new MemoryReauthStore();
    const service = new ApprovalService(new MemoryApprovalStore(), w.now, {}, proofs);
    w.deps.gate = queueApprovalGate(service);
    const r = await submitDealToLenders(w.deps, { dealId: w.deal.id, targetStage: "term_sheet", lenderIds: [w.lenders.a.id], items: w.items, advisor: TEST_ADVISOR, actor: "broker:ana" });
    const o = r.outcomes[0]!;
    if (!o.ok) throw new Error(o.error);
    const row = o.result.outreach;
    const approval = (await service.getByKey(row.approvalKey))!;
    await new ReauthService(proofs, w.now).record({ approval, user: { userId: BROKER.userId, dreLicense: BROKER.dreLicense }, factor: { method: "totp", verifiedAt: w.now() } });
    expect(await service.approve(approval.id, BROKER)).toMatchObject({ ok: true });
    // Rewritten after the request, with a hash that matches the rewritten row (as the database check would demand).
    const tampered = `${row.emailText!}\nP.S. a line added after approval.`;
    await w.store.updateOutreach(row.id, { emailText: tampered, emailSha256: emailSha256(row.emailSubject!, tampered) }, "x", w.now());
    const deps = { store: w.store, gate: w.deps.gate, now: w.now, baseUrl: w.deps.baseUrl, mailer: null, holds: w.deps.holds, summaries: w.summaries };
    await expect(checkOutreachApproval(deps, row.id, "broker:ana")).rejects.toThrow(/changed after approval was requested/);
    expect(await w.store.listShareLinks(w.deal.id)).toEqual([]);
    const card = (await loadApprovalSubmissionContent({ store: w.store, summaries: w.summaries }, approval))!;
    expect(card.emailVerified).toBe(false);
  });

  it("refuses a stored row whose own hash does not match its text", async () => {
    const { w, o, outreachDeps } = await requested();
    const row = o.result.outreach;
    await w.store.updateOutreach(row.id, { emailText: `${row.emailText!} ` }, "x", w.now());
    w.gate.decide(row.approvalKey, { status: "approved", approvalId: "appr_1", decidedBy: "broker:lee", decidedAt: w.now() });
    const err = await checkOutreachApproval(outreachDeps, row.id, "broker:ana").catch((e) => e);
    expect(err).toBeInstanceOf(PackageError);
    expect(err.message).toMatch(/no longer matches the text the broker approved/);
  });

  it("shows the approved email once only while it verifies", async () => {
    const { w, o, outreachDeps } = await requested();
    const row = o.result.outreach;
    w.gate.decide(row.approvalKey, { status: "approved", approvalId: "appr_1", decidedBy: "broker:lee", decidedAt: w.now() });
    const approved = await checkOutreachApproval(outreachDeps, row.id, "broker:ana");
    expect(approved.shareUrl).toBeTruthy();
    expect(await approvedEmailForShare(w.store, w.deal.id, row.id, approved.shareUrl!)).toMatchObject({ subject: row.emailSubject });
    await w.store.updateOutreach(row.id, { emailText: row.emailText!.replace("a term sheet", "a commitment") }, "x", w.now());
    expect(await approvedEmailForShare(w.store, w.deal.id, row.id, approved.shareUrl!)).toBeNull();
  });
});

describe("the preview takes the documents staff pick", () => {
  it("builds the same bytes the request approves for the same documents (and different ones for others)", async () => {
    const w = await sendWorld("bridge", "pending");
    const picked = w.items.slice(1);
    const lender = (await w.store.getLender(w.lenders.a.id))!;
    const preview = (docs: typeof w.items) => {
      const l = previewSubmission({ ctx: w.ctx, metrics: computeSubmissionMetrics(w.ctx), stage: "term_sheet", lenders: [lender], boxes: [], documents: docs, advisor: TEST_ADVISOR }).lenders[0]!;
      if (!l.ok) throw new Error(l.error);
      return l.email;
    };
    const r = await submitDealToLenders(w.deps, { dealId: w.deal.id, targetStage: "term_sheet", lenderIds: [w.lenders.a.id], items: picked, advisor: TEST_ADVISOR, actor: "broker:ana" });
    const o = r.outcomes[0]!;
    if (!o.ok) throw new Error(o.error);
    expect(preview(picked).sha256).toBe(o.result.outreach.emailSha256);
    expect(preview(w.items).sha256).not.toBe(o.result.outreach.emailSha256);
  });

  it("ticks every clean document by default, but no PFS or tax return at Screen", () => {
    const docs = [
      { id: "t12", kind: "T12" },
      { id: "pfs", kind: "PFS" },
      { id: "tax", kind: "TAX_RETURN" },
      { id: "rr", kind: "RENT_ROLL" },
    ];
    expect(defaultPackageDocumentIds(docs, "screen")).toEqual(["t12", "rr"]);
    expect(defaultPackageDocumentIds(docs, "term_sheet")).toEqual(["t12", "pfs", "tax", "rr"]);
    expect(defaultPackageDocumentIds(docs, "underwrite")).toEqual(["t12", "pfs", "tax", "rr"]);
  });
});
