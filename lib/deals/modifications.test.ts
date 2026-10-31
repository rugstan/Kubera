import { describe, expect, it } from "vitest";
import type { ModificationFacts } from "@/lib/compliance/schemas";
import { applyStageEvent } from "./stages";
import { applyModificationTerms, recordLenderNoticeSent, recordOfficerApproval, retryLenderNotice, submitModification, updateModificationFacts, withdrawModification } from "./modifications";
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

const ext = (over: Partial<ModificationFacts> = {}): ModificationFacts => ({ kind: "extension", effectiveDate: "2026-11-15", arrangedBy: "kubera", noteRatePct: 12.5, agreementRecitesBrokerArrangement: true, elements: fullElements, ...over });

describe("modification gate (SB 1146)", () => {
  it("holds pre-2025 changes for counsel", async () => {
    const { store, gate, now, deal } = await world();
    const m = await submitModification({ store, gate, now }, { dealId: deal.id, facts: ext({ effectiveDate: "2024-12-31" }), actor: "broker:ana" });
    expect(m.status).toBe("held_for_counsel");
    expect(m.flags).toContain("held_for_counsel");
    await expect(applyModificationTerms({ store, gate, now }, m.id, { lockedTerms: { noteRatePct: 13 } }, "a")).rejects.toMatchObject({ reason: "terms_not_allowed" });
  });

  it("blocks a Kubera-arranged change above the cap with a non-exempt lender until the designated officer approves", async () => {
    const { store, gate, now, deal } = await world();
    const m = await submitModification({ store, gate, now }, { dealId: deal.id, facts: ext(), actor: "broker:ana", fee: { principalCents: 400_000_000, pct: 0.5, payer: "borrower" } });
    expect(m.status).toBe("blocked");
    expect(m.evaluation.missing).toEqual(["officer_approval"]);
    expect(m.flags).toEqual(expect.arrayContaining(["officer_approval_required", "broker_of_record_incomplete"]));

    // Its own broker_of_record row, child of the loan file.
    const bor = store.brokerOfRecord.get(m.brokerOfRecordId!)!;
    expect(bor).toMatchObject({ record_kind: "extension", parent_id: "11111111-1111-4111-8111-111111111111", deal_id: deal.id, gate_status: "incomplete", gate_blocking: true });

    // Kubera's arranging fee is projected on the ledger, linked to the change.
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
    expect(gate.requests).toHaveLength(1);
    expect(gate.requests[0]).toMatchObject({ kind: "lender_notice", templateId: "lender_no_exemption_notice_v1", idempotencyKey: `lender_notice:no_exemption:${m.id}` });
    expect(mail.sent).toHaveLength(0);
    // Kubera did not arrange it, so no arranging fee is recorded.
    expect(await store.listFeeEntries(deal.id)).toHaveLength(0);

    gate.decide(`lender_notice:no_exemption:${m.id}`, { status: "expired", approvalId: "appr_1" });
    expect((await retryLenderNotice({ store, gate, now, mailer: mail }, m.id, "a")).status).toBe("pending_lender_notice");
    expect(mail.sent).toHaveLength(0);

    gate.decide(`lender_notice:no_exemption:${m.id}`, { status: "approved", approvalId: "appr_2", decidedBy: "broker:lee", decidedAt: now() });
    const done = await retryLenderNotice({ store, gate, now, mailer: mail }, m.id, "a");
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

describe("locked terms change only through a documented modification", () => {
  it("applies the documented change once under its override reference", async () => {
    const { store, gate, now, deal } = await world();
    // Lock the deal's terms at term-sheet acceptance.
    const accepted = applyStageEvent({
      deal: { ...deal, stage: "term_sheet" },
      event: "term_sheet_accepted",
      context: { termSheetRef: "vault://ts.pdf" },
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
