import { describe, expect, it } from "vitest";
import { BROKER_OF_RECORD_FILE_MISSING } from "@/lib/compliance/gates";
import { MemoryDisclosureStore } from "@/lib/disclosures/store";
import { approveLoanBrokerOfRecord, recordLoanBrokerOfRecord, type LoanFileInput } from "./broker-of-record";
import { submitModification } from "./modifications";
import { DealError, editDeal, loadDealCompliance } from "./service";
import { openDealMlds } from "./mlds";
import { newDeal, setup } from "./test-fixtures";

const licensee = { name: "Ana Broker", dreLicense: "01234567", activeAtTransaction: true };

const file = (over: Partial<LoanFileInput> = {}): LoanFileInput => ({
  lender: { name: "Example Community Bank", category: "STATE_BANK", evidenceRef: "DFPI charter 1234" },
  noteRatePct: 6.4,
  fedDiscountRatePct: 4.5,
  collateral: { realPropertyLien: true, equityPledgeOrUccOnly: false, apn: "001-002-003", lienPosition: 1 },
  transactionDate: "2026-11-20",
  actsFor: "borrower",
  engagementAgreementRef: "vault://engagement/sunrise.pdf",
  compensation: { amountUsd: 62_500, payer: "borrower" },
  businessPurposeCertified: true,
  arrangingLicensee: licensee,
  negotiationEntry: { at: "2026-11-02T18:00:00.000Z", kind: "term_sheet", ref: "ts-v2", summary: "Negotiated rate and IO period" },
  ...over,
});

function world() {
  const ctx = setup();
  const disclosures = new MemoryDisclosureStore();
  return { ...ctx, disclosures, deps: { store: ctx.store, now: ctx.now, disclosures } };
}

describe("loan-level broker-of-record file (gate H)", () => {
  it("records the file from the deal desk, and the gate-H closing reason clears", async () => {
    const w = world();
    const deal = await newDeal(w.store, w.now);
    const before = await loadDealCompliance(w.deps, deal);
    expect(before.compliance!.gates.closing.reasons).toContain(BROKER_OF_RECORD_FILE_MISSING);
    // Stated once: the "missing" list repeats the gate's own wording, not a second phrasing.
    expect(before.missing).toEqual([BROKER_OF_RECORD_FILE_MISSING]);

    const r = await recordLoanBrokerOfRecord(w.deps, { dealId: deal.id, file: file(), actor: "staff:ana" });
    expect(r.created).toBe(true);
    expect(r.file).toMatchObject({ lender: { name: "Example Community Bank", category: "STATE_BANK" }, noteRatePct: 6.4, transactionDate: "2026-11-20" });
    expect(r.file.elements.negotiationLog).toHaveLength(1);
    const row = [...w.store.brokerOfRecord.values()][0]!;
    expect(row).toMatchObject({ record_kind: "loan", deal_id: deal.id, arranged_by: "corin", gate_status: "lender_exempt", gate_blocking: false, arranging_licensee_dre: "01234567" });

    const after = await loadDealCompliance(w.deps, deal);
    expect(after.missing).toEqual([]);
    expect(after.compliance!.usury).toMatchObject({ status: "lender_exempt" });
    expect(after.compliance!.gates.closing.reasons).not.toContain(BROKER_OF_RECORD_FILE_MISSING);

    // Updating appends to the negotiation log and keeps one loan row.
    await recordLoanBrokerOfRecord(w.deps, { dealId: deal.id, file: file({ negotiationEntry: { at: "2026-11-05T18:00:00.000Z", kind: "counteroffer", ref: "ts-v3" } }), actor: "staff:ana" });
    expect([...w.store.brokerOfRecord.values()].filter((x) => x.record_kind === "loan")).toHaveLength(1);
    expect((await w.store.getLoanBrokerOfRecord(deal.id))!.elements.negotiationLog?.map((n) => n.ref)).toEqual(["ts-v2", "ts-v3"]);
  });

  it("blocks a non-exempt lender above the cap until the officer approves, and a changed loan clears that approval", async () => {
    const w = world();
    const deal = await newDeal(w.store, w.now, { program: "HARD_MONEY" });
    // 9.5% looks within the 10% cap, but 1 point on a 6-month loan makes the effective rate 11.5%.
    const hard = file({ lender: { name: "Pacific Bridge Partners LLC", category: "PRIVATE_NON_EXEMPT" }, noteRatePct: 9.5, lenderCharges: { lenderPointsPct: 1, termMonths: 6 } });
    await recordLoanBrokerOfRecord(w.deps, { dealId: deal.id, file: hard, actor: "staff:ana" });
    let c = (await loadDealCompliance(w.deps, deal)).compliance!;
    expect(c.usury).toMatchObject({ status: "blocked", effectiveRatePct: 11.5, missing: ["officer_approval"] });
    expect(c.gates.closing.reasons).toContain("Missing: Designated-officer approval");

    await expect(approveLoanBrokerOfRecord(w.deps, deal.id, { name: "Neeli Khanna", dreLicense: "123" }, "a")).rejects.toMatchObject({ reason: "officer_license" });
    const approved = await approveLoanBrokerOfRecord(w.deps, deal.id, { name: "Neeli Khanna", dreLicense: "02123456" }, "staff:neeli");
    expect(approved.elements.officerApproval).toMatchObject({ name: "Neeli Khanna", dreLicense: "02123456" });
    c = (await loadDealCompliance(w.deps, deal)).compliance!;
    expect(c.usury!.status).toBe("cleared");
    expect(c.gates.closing.reasons.some((r) => r.startsWith("Missing:"))).toBe(false);

    // A new negotiation entry keeps the approval; a new rate does not.
    expect((await recordLoanBrokerOfRecord(w.deps, { dealId: deal.id, file: { ...hard, negotiationEntry: { at: "2026-11-06T18:00:00.000Z", kind: "communication", ref: "mail-1" } }, actor: "a" })).officerApprovalCleared).toBe(false);
    const changed = await recordLoanBrokerOfRecord(w.deps, { dealId: deal.id, file: { ...hard, noteRatePct: 10.5 }, actor: "a" });
    expect(changed.officerApprovalCleared).toBe(true);
    expect((await loadDealCompliance(w.deps, deal)).compliance!.usury!.status).toBe("blocked");
  });

  it("unblocks modifications: a change can be submitted once the loan file exists", async () => {
    const w = world();
    const deal = await newDeal(w.store, w.now, { program: "PRIVATE_BRIDGE" });
    const ext = { kind: "extension" as const, effectiveDate: "2026-12-01", arrangedBy: "corin" as const, noteRatePct: 6.4, agreementRecitesBrokerArrangement: true };
    await expect(submitModification({ ...w.deps, gate: w.gate }, { dealId: deal.id, facts: ext, actor: "a" })).rejects.toMatchObject({ reason: "no_loan_record" });
    const loan = await recordLoanBrokerOfRecord(w.deps, { dealId: deal.id, file: file(), actor: "a" });
    const m = await submitModification({ ...w.deps, gate: w.gate }, { dealId: deal.id, facts: ext, actor: "a" });
    expect(m.parentBrokerOfRecordId).toBe(loan.file.id);
    // The loan file changing (bank → non-exempt private lender) re-runs gate H on the open change.
    await recordLoanBrokerOfRecord(w.deps, { dealId: deal.id, file: file({ lender: { name: "Pacific Bridge Partners LLC", category: "PRIVATE_NON_EXEMPT" }, noteRatePct: 6.4 }), actor: "a" });
    expect((await w.store.getModification(m.id))!.evaluation.status).toBe("incomplete");
  });

  it("rejects Corin as the lender, and holds the deal for counsel when the documents name Corin as beneficiary or originator", async () => {
    const w = world();
    const deal = await newDeal(w.store, w.now);
    await expect(recordLoanBrokerOfRecord(w.deps, { dealId: deal.id, file: file({ lender: { name: "Corin Commercial, Inc.", category: "PRIVATE_NON_EXEMPT" } }), actor: "a" })).rejects.toThrow(/never the lender/);

    const { record } = await openDealMlds({ ...w.deps, storage: { put: async () => {} } }, { dealId: deal.id, applicationCompletedAt: new Date(w.now().getTime() - 3_600_000), actor: "a" });
    expect(record!.status).toBe("required");
    const r = await recordLoanBrokerOfRecord(w.deps, { dealId: deal.id, file: file({ deedBeneficiaryName: "Corin Commercial, Inc.", originatorName: "Example Community Bank" }), actor: "a" });
    expect(r.heldForCounsel).toBe(true);
    expect(w.store.brokerOfRecord.get(r.file.id)).toMatchObject({ deed_beneficiary_name: "Corin Commercial, Inc.", originator_name: "Example Community Bank" });
    expect((await w.disclosures.get(record!.id))!.status).toBe("held_for_counsel");
    const { compliance } = await loadDealCompliance(w.deps, deal);
    expect(compliance!.heldForCounsel).toBe(true);
    expect(compliance!.flags.some((f) => f.code === "held_for_counsel" && /trust-deed beneficiary/.test(f.reason))).toBe(true);

    const deal2 = await newDeal(w.store, w.now, { title: "Originator deal" });
    await recordLoanBrokerOfRecord(w.deps, { dealId: deal2.id, file: file({ originatorName: "Corin Commercial" }), actor: "a" });
    expect((await loadDealCompliance(w.deps, deal2)).compliance!.flags.some((f) => /originator or lender of record/.test(f.reason))).toBe(true);
  });

  it("keeps the gate-H rate in step with the locked term-sheet rate", async () => {
    const w = world();
    let deal = await newDeal(w.store, w.now);
    deal = await w.store.updateDeal(deal.id, deal.recordVersion, { lockedTerms: { lenderName: "Example Community Bank", noteRatePct: 6.4, termMonths: 120 } }, "a", w.now());
    await expect(recordLoanBrokerOfRecord(w.deps, { dealId: deal.id, file: file({ noteRatePct: 6.1 }), actor: "a" })).rejects.toMatchObject({ reason: "rate_mismatch" });
    await recordLoanBrokerOfRecord(w.deps, { dealId: deal.id, file: file(), actor: "a" });
    expect((await loadDealCompliance(w.deps, deal)).compliance!.gates.closing.reasons.some((r) => /locked note rate/.test(r))).toBe(false);
  });
});

describe("collateral edits after an MLDS case opened", () => {
  it("refuses to drop the MLDS requirement by editing the collateral, unless the designated officer overrides with a reason", async () => {
    const w = world();
    const deal = await newDeal(w.store, w.now);
    await openDealMlds({ ...w.deps, storage: { put: async () => {} } }, { dealId: deal.id, applicationCompletedAt: new Date(w.now().getTime() - 3_600_000), actor: "a" });
    await expect(editDeal(w.deps, deal.id, deal.recordVersion, { collateralRealProperty: false }, "staff:ana")).rejects.toBeInstanceOf(DealError);
    await expect(editDeal(w.deps, deal.id, deal.recordVersion, { collateralRealProperty: false }, "staff:ana", { collateralOverride: { officer: false, reason: "Business assets only per title report" } })).rejects.toThrow(/officer/);
    // Without the disclosure store the edit fails closed.
    await expect(editDeal({ store: w.store, now: w.now }, deal.id, deal.recordVersion, { collateralRealProperty: false }, "a")).rejects.toThrow(/cannot be checked/);
    // Other fields still edit.
    const renamed = await editDeal(w.deps, deal.id, deal.recordVersion, { title: "Renamed", collateralRealProperty: true }, "a");
    expect(renamed.title).toBe("Renamed");

    const flipped = await editDeal(w.deps, deal.id, renamed.recordVersion, { collateralRealProperty: false }, "staff:neeli", { collateralOverride: { officer: true, reason: "Title report shows business assets only" } });
    expect(flipped.collateralRealProperty).toBe(false);
    // The open MLDS still has to be signed before closing.
    const { compliance } = await loadDealCompliance(w.deps, flipped);
    expect(compliance!.mlds.required).toBe(true);
    expect(compliance!.gates.closing.reasons).toContain("No deal moves to closing without a signed MLDS (RE 882) on file.");
  });
});

describe("MLDS delivery clock on the deal", () => {
  it("reports warning, overdue and late from the current MLDS record", async () => {
    const w = world();
    const deal = await newDeal(w.store, w.now);
    // Opened on Monday 2026-11-02 at 10:00 Pacific; T0 is Tuesday 2026-11-03 09:00 Pacific.
    const { record } = await openDealMlds({ ...w.deps, storage: { put: async () => {} } }, { dealId: deal.id, applicationCompletedAt: new Date("2026-11-02T18:00:00.000Z"), actor: "a" });
    const at = (iso: string) => ({ ...w.deps, now: () => new Date(iso) });
    const flagsAt = async (iso: string) => (await loadDealCompliance(at(iso), deal)).compliance!.flags.map((f) => f.code);
    expect(await flagsAt("2026-11-03T17:00:00.000Z")).not.toContain("mlds_warning");
    expect(await flagsAt("2026-11-04T17:00:00.000Z")).toContain("mlds_warning");
    expect(await flagsAt("2026-11-06T17:00:00.000Z")).toContain("mlds_overdue");

    // Delivered (sent for signature) after the due time: recorded as late.
    const cur = (await w.disclosures.get(record!.id))!;
    await w.disclosures.update(cur.id, cur.version, { status: "sent", sentAt: "2026-11-06T17:00:00.000Z", provider: "fake", providerRequestId: "r1" }, w.now());
    const late = await flagsAt("2026-11-07T17:00:00.000Z");
    expect(late).toContain("mlds_late");
    expect(late).not.toContain("mlds_overdue");
  });
});
