import { describe, expect, it } from "vitest";
import { evaluateDealCompliance } from "@/lib/compliance/gates";
import type { ModificationFacts } from "@/lib/compliance/schemas";
import { applyStageEvent } from "./stages";
import { queueApprovalGate } from "@/lib/approvals/gate";
import { ApprovalService } from "@/lib/approvals/service";
import { MemoryApprovalStore } from "@/lib/approvals/store";
import { ModificationError, applyModificationTerms, lenderNoticeKey, lenderNoticeMessage, recordLenderNoticeSent, recordOfficerApproval, retryLenderNotice, submitModification, updateModificationFacts, withdrawModification } from "./modifications";
import type { LenderMailer } from "./packages";
import { fullElements, lenderInput, loanRecord, newDeal, setup } from "./test-fixtures";

function mailer(): LenderMailer & { sent: { to: string; text: string }[] } {
  const sent: { to: string; text: string }[] = [];
  return { sent, async send(m) { sent.push(m); return { messageId: `m${sent.length}` }; } };
}

async function world(gateDefault: "approved" | "pending" = "approved", loanOver = {}) {
  const ctx = setup(gateDefault);
  const deal = await newDeal(ctx.store, ctx.now, { program: "PRIVATE_BRIDGE", title: "Oakland bridge", loanAmountCents: 400_000_000 });
  ctx.store.seedLoanBrokerOfRecord(loanRecord(deal.id, loanOver));
  await ctx.store.insertLender(lenderInput({ name: "Fidelis Private Fund", category: "PRIVATE_NON_EXEMPT", categoryEvidenceRef: null, contactEmail: "servicing@fidelis.example", programs: ["PRIVATE_BRIDGE"] }), "a", ctx.now());
  return { ...ctx, deal, m: mailer() };
}

/** Gate A clear: the deal's MLDS is signed, so a commitment may go to the borrower. */
const mldsSignedCompliance = evaluateDealCompliance({
  mlds: { facts: { corinRole: "broker", program: "PRIVATE_BRIDGE", collateral: { realPropertyLien: true, equityPledgeOrUccOnly: false } }, status: "signed" },
  now: new Date("2026-11-03T17:00:00.000Z"),
});

const ext = (over: Partial<ModificationFacts> = {}): ModificationFacts => ({ kind: "extension", effectiveDate: "2026-11-15", arrangedBy: "corin", noteRatePct: 12.5, agreementRecitesBrokerArrangement: true, elements: fullElements, ...over });

describe("modification gate (SB 1146)", () => {
  it("holds pre-2025 changes for counsel", async () => {
    const { store, gate, now, deal } = await world();
    const m = await submitModification({ store, gate, now }, { dealId: deal.id, facts: ext({ effectiveDate: "2024-12-31" }), actor: "broker:ana" });
    expect(m.status).toBe("held_for_counsel");
    expect(m.flags).toContain("held_for_counsel");
    await expect(applyModificationTerms({ store, gate, now }, m.id, { lockedTerms: { noteRatePct: 13 } }, "a")).rejects.toMatchObject({ reason: "terms_not_allowed" });
  });

  it("blocks a Corin-arranged change above the cap with a non-exempt lender until the designated officer approves", async () => {
    const { store, gate, now, deal } = await world();
    const m = await submitModification({ store, gate, now }, { dealId: deal.id, facts: ext(), actor: "broker:ana", fee: { principalCents: 400_000_000, pct: 0.5, payer: "borrower" } });
    expect(m.status).toBe("blocked");
    expect(m.evaluation.missing).toEqual(["officer_approval"]);
    expect(m.flags).toEqual(expect.arrayContaining(["officer_approval_required", "broker_of_record_incomplete"]));

    // Its own broker_of_record row, child of the loan file.
    const bor = store.brokerOfRecord.get(m.brokerOfRecordId!)!;
    expect(bor).toMatchObject({ record_kind: "extension", parent_id: "11111111-1111-4111-8111-111111111111", deal_id: deal.id, gate_status: "incomplete", gate_blocking: true });

    // Corin's arranging fee is projected on the ledger, linked to the change.
    const fee = (await store.listFeeEntries(deal.id))[0]!;
    expect(fee).toMatchObject({ entryKind: "extension_fee", amountCents: 2_000_000, status: "projected", modificationId: m.id });
    expect(m.feeEntryId).toBe(fee.id);

    await expect(recordOfficerApproval({ store, gate, now }, m.id, { name: "Neeli Khanna", dreLicense: "123" }, "a")).rejects.toMatchObject({ reason: "officer_license" });
    const approved = await recordOfficerApproval({ store, gate, now }, m.id, { name: "Neeli Khanna", dreLicense: "01234567" }, "officer:neeli");
    expect(approved.status).toBe("documented");
    expect(approved.officerApprovedBy).toBe("Neeli Khanna");
    expect(store.brokerOfRecord.get(m.brokerOfRecordId!)).toMatchObject({ gate_status: "documented", gate_blocking: false, officer_approved_dre: "01234567" });
  });

  it("marks missing elements incomplete (not blocking) when the lender is an evidenced exempt category", async () => {
    const { store, gate, now, deal } = await world("approved", { lender: { name: "First Bank", category: "STATE_BANK", evidenceRef: "DFPI 77" } });
    const m = await submitModification({ store, gate, now }, { dealId: deal.id, facts: ext({ elements: { negotiationLog: [], businessPurposeCertified: false }, agreementRecitesBrokerArrangement: false }), actor: "a" });
    expect(m.status).toBe("incomplete");
    expect(m.evaluation.blocking).toBe(false);
    const fixed = await updateModificationFacts({ store, gate, now }, m.id, ext(), "a");
    expect(fixed.status).toBe("documented");
  });

  it("lender-only negotiation: no exemption representation, and the written notice goes through the approval gate", async () => {
    const { store, gate, now, deal, m: mail } = await world("pending");
    const facts = ext({ arrangedBy: "lender_or_servicer_only", elements: { negotiationLog: [], businessPurposeCertified: false } });
    const m = await submitModification({ store, gate, now, mailer: mail }, { dealId: deal.id, facts, actor: "broker:ana", fee: { principalCents: 1, flatCents: 100, payer: "borrower" } });
    expect(m.status).toBe("pending_lender_notice");
    expect(m.flags).toEqual(expect.arrayContaining(["no_exemption_representation", "lender_written_notice_required"]));
    // Pending: the approval is only looked up (never claimed) until the notice can go out.
    expect(gate.requests).toHaveLength(0);
    expect(gate.peeks).toHaveLength(1);
    expect(gate.peeks[0]).toMatchObject({ kind: "lender_notice", templateId: "lender_no_exemption_notice_v1", idempotencyKey: `lender_notice:no_exemption:${m.id}` });
    expect(mail.sent).toHaveLength(0);
    // Corin did not arrange it, so no arranging fee is recorded.
    expect(await store.listFeeEntries(deal.id)).toHaveLength(0);

    gate.decide(`lender_notice:no_exemption:${m.id}`, { status: "expired", approvalId: "appr_1" });
    const expired = await retryLenderNotice({ store, gate, now, mailer: mail }, m.id, "a");
    expect(expired).toMatchObject({ notice: "expired", modification: { status: "pending_lender_notice" } });
    expect(mail.sent).toHaveLength(0);

    gate.decide(`lender_notice:no_exemption:${m.id}`, { status: "approved", approvalId: "appr_2", decidedBy: "broker:lee", decidedAt: now() });
    const result = await retryLenderNotice({ store, gate, now, mailer: mail }, m.id, "a");
    expect(result.notice).toBe("sent");
    const done = result.modification;
    expect(done.status).toBe("no_exemption_representation");
    expect(done.lenderNoticeSentAt).not.toBeNull();
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.to).toBe("servicing@fidelis.example");
    expect(mail.sent[0]!.text).toMatch(/makes no representation that any exemption/);
    expect(mail.sent[0]!.text).not.toMatch(/\bis exempt\b/);
  });

  it("records a notice the broker sent manually", async () => {
    const { store, gate, now, deal } = await world("pending");
    const m = await submitModification({ store, gate, now }, { dealId: deal.id, facts: ext({ arrangedBy: "lender_or_servicer_only" }), actor: "a" });
    const done = await recordLenderNoticeSent({ store, gate, now }, m.id, now(), "broker:ana");
    expect(done.status).toBe("no_exemption_representation");
    await expect(recordLenderNoticeSent({ store, gate, now }, m.id, now(), "a")).rejects.toMatchObject({ reason: "invalid_status" });
  });

  it("requires the loan-level broker-of-record file first", async () => {
    const ctx = setup();
    const deal = await newDeal(ctx.store, ctx.now);
    await expect(submitModification({ store: ctx.store, gate: ctx.gate, now: ctx.now }, { dealId: deal.id, facts: ext(), actor: "a" })).rejects.toMatchObject({ reason: "no_loan_record" });
  });
});

describe("lender notice on the real approval queue", () => {
  const broker = { userId: "00000000-0000-4000-8000-0000000000b1", label: "Pat Broker", dreLicense: "01234567" };

  async function queued() {
    const ctx = await world();
    const service = new ApprovalService(new MemoryApprovalStore(), ctx.now);
    const gate = queueApprovalGate(service);
    const lenderOnly = ext({ arrangedBy: "lender_or_servicer_only", elements: { negotiationLog: [], businessPurposeCertified: false } });
    return { ...ctx, service, gate, lenderOnly };
  }

  it("without a mailer, an approved notice is recorded for staff and the approval is not used up", async () => {
    const { store, gate, service, now, deal, lenderOnly } = await queued();
    const m = await submitModification({ store, gate, now, mailer: null }, { dealId: deal.id, facts: lenderOnly, actor: "broker:ana" });
    expect(m.status).toBe("pending_lender_notice");
    const approval = (await service.getByKey(lenderNoticeKey(m.id)))!;
    expect(approval.status).toBe("pending");

    expect((await retryLenderNotice({ store, gate, now, mailer: null }, m.id, "a")).notice).toBe("pending");
    expect((await service.approve(approval.id, broker)).ok).toBe(true);

    const first = await retryLenderNotice({ store, gate, now, mailer: null }, m.id, "a");
    expect(first).toMatchObject({ notice: "approved_send_manually", why: "no_mailer" });
    expect(first.notice === "approved_send_manually" && first.text).toMatch(/makes no representation that any exemption/);
    expect(first.modification).toMatchObject({ status: "pending_lender_notice", lenderNoticeApprovalId: approval.id });
    expect(first.modification.lenderNoticeApprovedAt).not.toBeNull();
    expect(lenderNoticeMessage(first)).toMatch(/approved the lender notice/);
    // Not claimed: the queue does not claim a notice that never went out.
    expect((await service.get(approval.id))!.executedAt).toBeNull();

    // Checking again gives the same answer (no silent already_executed).
    expect((await retryLenderNotice({ store, gate, now, mailer: null }, m.id, "a")).notice).toBe("approved_send_manually");

    // Staff send it and record it: the approval is executed now.
    const done = await recordLenderNoticeSent({ store, gate, now, mailer: null }, m.id, now(), "broker:ana");
    expect(done.status).toBe("no_exemption_representation");
    expect((await service.get(approval.id))!.executedAt).not.toBeNull();
  });

  it("with a mailer, the approval is claimed only by the send, once", async () => {
    const { store, gate, service, now, deal, lenderOnly, m: mail } = await queued();
    const m = await submitModification({ store, gate, now, mailer: mail }, { dealId: deal.id, facts: lenderOnly, actor: "broker:ana" });
    const approval = (await service.getByKey(lenderNoticeKey(m.id)))!;
    await service.approve(approval.id, broker);
    const sent = await retryLenderNotice({ store, gate, now, mailer: mail }, m.id, "a");
    expect(sent.notice).toBe("sent");
    expect(sent.modification.status).toBe("no_exemption_representation");
    expect(mail.sent).toHaveLength(1);
    expect((await service.get(approval.id))!.executedAt).not.toBeNull();
    expect((await retryLenderNotice({ store, gate, now, mailer: mail }, m.id, "a")).notice).toBe("not_required");
    expect(mail.sent).toHaveLength(1);
  });

  it("reports a rejected notice", async () => {
    const { store, gate, service, now, deal, lenderOnly } = await queued();
    const m = await submitModification({ store, gate, now }, { dealId: deal.id, facts: lenderOnly, actor: "broker:ana" });
    await service.reject((await service.getByKey(lenderNoticeKey(m.id)))!.id, broker, "Wrong lender");
    const r = await retryLenderNotice({ store, gate, now }, m.id, "a");
    expect(r).toMatchObject({ notice: "rejected", reason: "Wrong lender" });
    expect(lenderNoticeMessage(r)).toMatch(/rejected/);
  });
});

describe("locked terms change only through a documented modification", () => {
  it("applies the documented change once under its override reference", async () => {
    const { store, gate, now, deal } = await world();
    // Lock the deal's terms at term-sheet acceptance.
    const accepted = applyStageEvent({
      deal: { ...deal, stage: "term_sheet" },
      event: "term_sheet_accepted",
      context: { termSheetRef: "vault://ts.pdf", compliance: mldsSignedCompliance },
      terms: { lenderName: "Fidelis", noteRatePct: 12.5, termMonths: 12 },
      now: now(),
    });
    if (!accepted.ok) throw new Error(accepted.reasons.join());
    const locked = await store.updateDeal(deal.id, deal.recordVersion, accepted.patch, "a", now());
    await expect(store.updateDeal(deal.id, locked.recordVersion, { lockedTerms: { noteRatePct: 13 } }, "a", now())).rejects.toThrow(/locked/);

    const m = await submitModification({ store, gate, now }, { dealId: deal.id, facts: ext({ elements: { ...fullElements, officerApproval: { name: "Neeli Khanna", dreLicense: "01234567", approvedAt: now().toISOString() } } }), actor: "a" });
    expect(m.status).toBe("documented");
    const { deal: changed, modification } = await applyModificationTerms({ store, gate, now }, m.id, { lockedTerms: { termMonths: 18 } }, "broker:ana");
    expect(changed.lockedTerms).toEqual({ lenderName: "Fidelis", noteRatePct: 12.5, termMonths: 18 });
    expect(changed.lockOverrideRef).toBe(m.id);
    expect(modification.termsAppliedAt).not.toBeNull();
    await expect(applyModificationTerms({ store, gate, now }, m.id, { lockedTerms: { termMonths: 24 } }, "a")).rejects.toMatchObject({ reason: "invalid_status" });
    await expect(withdrawModification({ store, gate, now }, m.id, "a")).rejects.toThrow(/cannot be withdrawn/);
  });
});

describe("applying terms never bypasses gate H", () => {
  it("refuses a note rate gate H never evaluated: documented at 9.5% with a non-exempt lender, apply 14%", async () => {
    const { store, gate, now, deal } = await world();
    // 9.5% is within the 10% art. XV cap (discount rate 4.5%), so no officer approval is needed and it documents.
    const m = await submitModification({ store, gate, now }, { dealId: deal.id, facts: ext({ noteRatePct: 9.5 }), actor: "a" });
    expect(m.status).toBe("documented");
    expect(m.evaluation.missing).toEqual([]);
    const refused = applyModificationTerms({ store, gate, now }, m.id, { lockedTerms: { noteRatePct: 14 } }, "a");
    await expect(refused).rejects.toBeInstanceOf(ModificationError);
    await expect(refused).rejects.toMatchObject({ reason: "terms_not_allowed" });
    expect((await store.getModification(m.id))!.termsAppliedAt).toBeNull();
    expect((await store.getDeal(deal.id))!.lockOverrideRef).toBeNull();

    // Raising the rate goes through gate H again: above the cap it blocks until the officer approves.
    const raised = await updateModificationFacts({ store, gate, now }, m.id, ext({ noteRatePct: 14 }), "a");
    expect(raised.status).toBe("blocked");
    await expect(applyModificationTerms({ store, gate, now }, m.id, {}, "a")).rejects.toMatchObject({ reason: "terms_not_allowed" });
    expect(store.brokerOfRecord.get(m.brokerOfRecordId!)).toMatchObject({ note_rate_pct: 14, gate_status: "incomplete", gate_blocking: true });
  });

  it("applies the evaluated rate when no rate is entered", async () => {
    const { store, gate, now, deal } = await world();
    const m = await submitModification({ store, gate, now }, { dealId: deal.id, facts: ext({ noteRatePct: 9.5 }), actor: "a" });
    const { deal: changed } = await applyModificationTerms({ store, gate, now }, m.id, { lockedTerms: { termMonths: 18 } }, "a");
    expect(changed.lockedTerms).toMatchObject({ noteRatePct: 9.5, termMonths: 18 });
  });
});
