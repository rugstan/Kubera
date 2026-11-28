// What the approval request carries (F4, F13 / S6, S5, F5, F7): the fit
// exceptions, the lender override's own reason and the fair-lending flags with
// staff's confirmation are hashed into the payload and kept in the one-line
// summary (long reasons are cut, never the tail); flagged copy needs a
// confirmation; the requester's user id reaches the queue; and a re-request
// after a withdraw, reject or expiry, or with a changed reason, asks again
// instead of returning the dead request as a success.

import { describe, expect, it } from "vitest";
import { MemoryReauthStore } from "@/lib/agents/core/reauth";
import { queueApprovalGate } from "@/lib/approvals/gate";
import { ApprovalService } from "@/lib/approvals/service";
import { MemoryApprovalStore } from "@/lib/approvals/store";
import { outreachApprovalKey, withdrawOutreach } from "../packages";
import { submitDealToLenders } from "./send";
import { TEST_ADVISOR, sendWorld } from "./send-test-world";

const STAFF_ID = "00000000-0000-4000-8000-0000000000b1";
const LONG = "The borrower's bookkeeper is closing October and the T-12 will follow next week. ".repeat(5).trim();

describe("the approval summary and payload (F4)", () => {
  it("keep the fit exceptions, the lender override and the fair-lending flags; a long reason is cut, not the tail", async () => {
    const w = await sendWorld("bridge", "pending", (ctx) => {
      ctx.vaultDocuments = ctx.vaultDocuments.filter((d) => d.kind !== "T12");
      for (const i of ctx.checklistItems) if (i.templateKey === "t12") i.status = "requested";
      ctx.profile!.risks = [{ risk: "The sponsor is a recent immigrant and his wife co-signs", mitigant: "Both guarantee" }];
    });
    const r = await submitDealToLenders(w.deps, { dealId: w.deal.id, targetStage: "term_sheet", lenderIds: [w.lenders.outOfBox.id], items: w.items, advisor: TEST_ADVISOR, actor: "analyst:bo", overrideReason: LONG, lenderOverrideReason: LONG, neutralCopyConfirmed: true });
    expect(r.outcomes[0]).toMatchObject({ ok: true });
    const req = w.gate.requests[0]!;
    expect(req.summary.length).toBeLessThanOrEqual(500);
    expect(req.summary).toMatch(/Lender fit exceptions: CA is outside your recorded states \(NV\) — lender override: The borrower's .*…\./);
    expect(req.summary).toMatch(/Fair-lending copy flags \(confirmed by staff\): .*"immigrant".*\.$/);
    expect(req.summary).toMatch(/Missing: T-12 operating statement — reason: The borrower's .*…\./);
    expect(req.payload).toMatchObject({
      fitExceptions: ["CA is outside your recorded states (NV)"],
      lenderOverrideReason: LONG,
      overrideReason: LONG,
      neutralCopy: { confirmed: true, flags: expect.arrayContaining([{ topic: "national_origin", term: "immigrant" }, { topic: "sex", term: "wife" }]) },
    });
    // The row keeps them too, so a re-check rebuilds the same payload.
    const row = (await w.store.getOutreach((r.outcomes[0] as { result: { outreach: { id: string } } }).result.outreach.id))!;
    expect(row).toMatchObject({ lenderOverrideReason: LONG, neutralCopy: req.payload.neutralCopy });
  });
});

describe("the fair-lending check at request time (F13 / S6)", () => {
  it("reads the summary's staff text (not only the email's) and needs staff's confirmation, storing nothing until then", async () => {
    const w = await sendWorld("bridge", "pending", (ctx) => {
      ctx.profile!.highlights = [...ctx.profile!.highlights, "The managing member is a recent immigrant and a widow"];
    });
    const input = { dealId: w.deal.id, targetStage: "screen" as const, lenderIds: [w.lenders.a.id], items: w.items, advisor: TEST_ADVISOR, actor: "broker:ana" };
    const refused = await submitDealToLenders(w.deps, input).catch((e) => e);
    expect(refused).toMatchObject({ reason: "not_ready" });
    expect(refused.message).toMatch(/^The fair-lending check flags staff-typed words that touch a protected characteristic: /);
    for (const term of ['"immigrant"', '"widow"']) expect(refused.message).toContain(term);
    expect(w.gate.requests).toHaveLength(0);
    expect(w.summaries.rows.size).toBe(0);
    await submitDealToLenders(w.deps, { ...input, neutralCopyConfirmed: true });
    expect(w.gate.requests[0]!.payload.neutralCopy).toEqual({ confirmed: true, flags: [{ topic: "marital_status", term: "widow" }, { topic: "national_origin", term: "immigrant" }] });
  });

  it("reads the reasons and the note too, and records an empty, unconfirmed check when nothing is flagged", async () => {
    const w = await sendWorld("bridge", "pending");
    const input = { dealId: w.deal.id, targetStage: "screen" as const, lenderIds: [w.lenders.a.id], items: w.items, advisor: TEST_ADVISOR, actor: "broker:ana" };
    await expect(submitDealToLenders(w.deps, { ...input, note: "Her husband handles the books" })).rejects.toMatchObject({ reason: "not_ready" });
    await submitDealToLenders(w.deps, input);
    expect(w.gate.requests[0]!.payload.neutralCopy).toEqual({ flags: [], confirmed: false });
  });
});

describe("who requested (S5)", () => {
  it("reaches the approval queue with the request", async () => {
    const w = await sendWorld("bridge", "pending");
    await submitDealToLenders(w.deps, { dealId: w.deal.id, targetStage: "screen", lenderIds: [w.lenders.a.id], items: w.items, advisor: TEST_ADVISOR, actor: "staff:ana@corin.test", requestedByUser: STAFF_ID });
    expect(w.gate.requests[0]).toMatchObject({ requestedBy: "staff:ana@corin.test", requestedByUser: STAFF_ID });
  });
});

describe("re-requesting (F5)", () => {
  const input = (w: Awaited<ReturnType<typeof sendWorld>>) => ({ dealId: w.deal.id, targetStage: "term_sheet" as const, lenderIds: [w.lenders.a.id], items: w.items, advisor: TEST_ADVISOR, actor: "broker:ana" });

  it("after a withdraw asks for a new approval instead of returning the withdrawn row as a success", async () => {
    const w = await sendWorld("bridge", "pending");
    const r1 = await submitDealToLenders(w.deps, input(w));
    const o1 = r1.outcomes[0]!;
    if (!o1.ok) throw new Error(o1.error);
    await withdrawOutreach(w.store, o1.result.outreach.id, "Fix the reason", "broker:ana", w.now());
    const r2 = await submitDealToLenders(w.deps, input(w));
    const o2 = r2.outcomes[0]!;
    expect(o2).toMatchObject({ ok: true });
    if (!o2.ok) throw new Error(o2.error);
    expect(o2.result.outreach).toMatchObject({ status: "pending_approval", approvalKey: outreachApprovalKey(w.deal.id, w.lenders.a.id, o1.result.pkg.version, 2) });
    expect(w.gate.requests.map((q) => q.idempotencyKey)).toEqual([o1.result.outreach.approvalKey, o2.result.outreach.approvalKey]);
  });

  it.each(["rejected", "expired"] as const)("after the waiting approval was %s asks again", async (status) => {
    const w = await sendWorld("bridge", "pending");
    const r1 = await submitDealToLenders(w.deps, input(w));
    const o1 = r1.outcomes[0]!;
    if (!o1.ok) throw new Error(o1.error);
    w.gate.decide(o1.result.outreach.approvalKey, status === "rejected" ? { status, approvalId: "appr_1", decidedBy: "broker:lee", reason: "Fix the T-12 date" } : { status, approvalId: "appr_1" });
    const r2 = await submitDealToLenders(w.deps, input(w));
    const o2 = r2.outcomes[0]!;
    expect(o2).toMatchObject({ ok: true });
    if (!o2.ok) throw new Error(o2.error);
    expect(o2.result.outreach.status).toBe("pending_approval");
    expect(o2.result.outreach.approvalKey).toBe(outreachApprovalKey(w.deal.id, w.lenders.a.id, o1.result.pkg.version, 2));
    expect((await w.store.getOutreach(o1.result.outreach.id))!.status).toBe(status);
  });

  it("with a changed reason supersedes the waiting request on the real queue", async () => {
    const w = await sendWorld("bridge", "pending", (ctx) => {
      ctx.vaultDocuments = ctx.vaultDocuments.filter((d) => d.kind !== "T12");
      for (const i of ctx.checklistItems) if (i.templateKey === "t12") i.status = "requested";
    });
    w.deps.gate = queueApprovalGate(new ApprovalService(new MemoryApprovalStore(), w.now, {}, new MemoryReauthStore()));
    const r1 = await submitDealToLenders(w.deps, { ...input(w), overrideReason: "The T-12 arrives Friday from the bookkeeper" });
    const o1 = r1.outcomes[0]!;
    if (!o1.ok) throw new Error(o1.error);
    const r2 = await submitDealToLenders(w.deps, { ...input(w), overrideReason: "The T-12 arrives Monday; the lender asked to start now" });
    const o2 = r2.outcomes[0]!;
    expect(o2).toMatchObject({ ok: true });
    if (!o2.ok) throw new Error(o2.error);
    expect(o2.result.outreach).toMatchObject({ status: "pending_approval", readinessOverrideReason: "The T-12 arrives Monday; the lender asked to start now" });
    expect((await w.store.getOutreach(o1.result.outreach.id))!).toMatchObject({ status: "withdrawn", responseNote: expect.stringMatching(/^Superseded/) });
  });

  it("never counts a rejected or expired answer as requested", async () => {
    for (const status of ["rejected", "expired"] as const) {
      const w = await sendWorld("bridge", status);
      const r = await submitDealToLenders(w.deps, input(w));
      expect(r.outcomes[0]).toMatchObject({ ok: false });
    }
  });
});

describe("the signing advisor (F14)", () => {
  it("must hold a DRE licence: an unlicensed signer's request is refused before anything is stored", async () => {
    const w = await sendWorld("bridge", "pending");
    for (const dreLicense of [null, "", "1234"]) {
      await expect(submitDealToLenders(w.deps, { dealId: w.deal.id, targetStage: "screen", lenderIds: [w.lenders.a.id], items: w.items, advisor: { ...TEST_ADVISOR, dreLicense }, actor: "admin:ops" })).rejects.toThrow(/A licensed broker must request a lender submission/);
    }
    expect(w.gate.requests).toHaveLength(0);
    expect(w.summaries.rows.size).toBe(0);
  });

  it("signs with the phone on the staff record when there is one", async () => {
    const w = await sendWorld("bridge", "pending");
    const r = await submitDealToLenders(w.deps, { dealId: w.deal.id, targetStage: "screen", lenderIds: [w.lenders.a.id], items: w.items, advisor: { ...TEST_ADVISOR, phone: "(415) 555-0123" }, actor: "broker:ana" });
    expect(r.prepared.lenders[0]!.email.text).toContain("ana@corincommercial.com · 415-555-0123");
    expect(r.prepared.lenders[0]!.email.text).toContain("Ana Ruiz, Senior Advisor · DRE 01234567");
  });
});
