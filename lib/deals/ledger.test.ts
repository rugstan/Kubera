import { describe, expect, it } from "vitest";
import { agencySplit, brokerFee, canTransitionFee, changeFee, hardMoneyPoints, LedgerError, partnerSplit, summarizeLedger, validateFeeEntry } from "./ledger";
import { dollarsToCents, formatCents, MoneyError, percentOf } from "./money";
import { createInvoice, issueInvoice, settleInvoice, voidInvoice, INVOICE_TERMS } from "./invoices";
import { lenderStaleness, panelForDeal, parseLender } from "./lenders";
import { lenderInput, newDeal, setup } from "./test-fixtures";
import type { FeeEntry } from "./types";

describe("money", () => {
  it("parses dollars and rounds percentages half-up to the cent", () => {
    expect(dollarsToCents("12,500.5")).toBe(1_250_050);
    expect(dollarsToCents(99.99)).toBe(9_999);
    expect(() => dollarsToCents("-1")).toThrow(MoneyError);
    expect(() => dollarsToCents("1.234")).toThrow(MoneyError);
    expect(percentOf(1_000_000_000, 0.75)).toBe(7_500_000);
    expect(percentOf(333, 50)).toBe(167);
    expect(percentOf(1, 0.1)).toBe(0);
    expect(formatCents(123_456_789)).toBe("$1,234,567.89");
  });
});

describe("fee calculators", () => {
  const dealId = "d1";

  it("agency split: Kubera's share of the seller/servicer's origination fee", () => {
    const e = agencySplit({ dealId, loanAmountCents: 1_200_000_000, lenderOriginationPct: 1, kuberaSharePct: 50, lenderName: "Greystone" });
    expect(e).toMatchObject({ entryKind: "agency_split", payer: "lender", payee: "kubera", basis: "percent_of_lender_fee", baseCents: 12_000_000, amountCents: 6_000_000, counterparty: "Greystone" });
  });

  it("hard money: broker points plus a lender-paid share of the lender's points", () => {
    const [broker, lender] = hardMoneyPoints({ dealId, loanAmountCents: 250_000_000, brokerPoints: 1.5, lenderPoints: 2, kuberaShareOfLenderPointsPct: 25, lenderName: "ROC" });
    expect(broker).toMatchObject({ entryKind: "hard_money_points", payer: "borrower", amountCents: 3_750_000, idempotencyKey: "d1:hard_money_points:broker" });
    expect(lender).toMatchObject({ entryKind: "lender_paid_compensation", payer: "lender", baseCents: 5_000_000, amountCents: 1_250_000 });
    expect(hardMoneyPoints({ dealId, loanAmountCents: 1, brokerPoints: 0 })).toEqual([]);
  });

  it("extension fee is keyed to its modification", () => {
    const e = changeFee({ dealId, kind: "extension", modificationId: "m1", principalCents: 400_000_000, pct: 0.5, payer: "borrower" });
    expect(e).toMatchObject({ entryKind: "extension_fee", amountCents: 2_000_000, modificationId: "m1", idempotencyKey: "d1:extension_fee:m1" });
    expect(changeFee({ dealId, kind: "modification", modificationId: "m2", principalCents: 1, flatCents: 250_000, payer: "lender" })).toMatchObject({ entryKind: "modification_fee", basis: "flat", amountCents: 250_000 });
  });

  it("validates party shape and arithmetic", () => {
    const ok = brokerFee({ dealId, loanAmountCents: 100_000_000, pct: 1 });
    expect(() => validateFeeEntry({ ...ok, amountCents: ok.amountCents + 1 })).toThrow(/rate × base/);
    expect(() => validateFeeEntry({ ...ok, payer: "kubera" })).toThrow(LedgerError);
    expect(() => validateFeeEntry({ ...ok, payee: "co_broker" })).toThrow(LedgerError);
    expect(partnerSplit({ dealId, payee: "co_broker", ofCents: 1_000_000, pct: 30, partnerName: "Pacific Brokers" })).toMatchObject({ payer: "kubera", payee: "co_broker", amountCents: 300_000 });
  });

  it("only allows forward status transitions; settled and void are final", () => {
    expect(canTransitionFee("projected", "earned")).toBe(true);
    expect(canTransitionFee("invoiced", "earned")).toBe(true);
    expect(canTransitionFee("settled", "void")).toBe(false);
    expect(canTransitionFee("void", "earned")).toBe(false);
  });

  it("summarizes gross, partner shares and Form 159 buckets, excluding void", () => {
    const mk = (over: Partial<FeeEntry>) => ({ dealId, payee: "kubera", payer: "borrower", status: "earned", amountCents: 0, entryKind: "broker_fee", sba159Category: null, ...over }) as FeeEntry;
    const s = summarizeLedger([
      mk({ amountCents: 1_000_000 }),
      mk({ amountCents: 500_000, payer: "lender" }),
      mk({ amountCents: 200_000, entryKind: "sba_packaging_fee" }),
      mk({ amountCents: 300_000, payee: "co_broker", payer: "kubera" }),
      mk({ amountCents: 999_999, status: "void" }),
    ]);
    expect(s).toMatchObject({ grossCents: 1_700_000, owedToPartnersCents: 300_000, netCents: 1_400_000, byPayer: { borrower: 1_200_000, lender: 500_000 }, bySba159: { packaging: 200_000, other_services: 1_000_000, referral: 500_000 } });
    expect(s.byStatus.void).toBe(999_999);
  });
});

describe("fee ledger store guards", () => {
  it("is idempotent by key and never reinstates void or reopens settled entries", async () => {
    const { store, now } = setup();
    const deal = await newDeal(store, now);
    const a = await store.insertFeeEntry(brokerFee({ dealId: deal.id, loanAmountCents: 100_000_000, pct: 1 }), "a", now());
    const b = await store.insertFeeEntry(brokerFee({ dealId: deal.id, loanAmountCents: 100_000_000, pct: 1 }), "a", now());
    expect(b.id).toBe(a.id);
    await expect(store.updateFeeEntry(a.id, { status: "void" }, "a", now())).rejects.toThrow(/reason/);
    await store.updateFeeEntry(a.id, { status: "void", voidReason: "dup" }, "a", now());
    await expect(store.updateFeeEntry(a.id, { status: "earned" }, "a", now())).rejects.toThrow(/reinstated/);
  });
});

describe("invoices", () => {
  async function earned() {
    const ctx = setup();
    const deal = await newDeal(ctx.store, ctx.now);
    const fee = await ctx.store.insertFeeEntry(brokerFee({ dealId: deal.id, loanAmountCents: 1_250_000_000, pct: 1 }), "a", ctx.now());
    const lenderPaid = await ctx.store.insertFeeEntry(brokerFee({ dealId: deal.id, loanAmountCents: 1_250_000_000, pct: 0.5, payer: "lender" }), "a", ctx.now());
    await ctx.store.updateFeeEntry(fee.id, { status: "earned" }, "a", ctx.now());
    return { ...ctx, deal, fee, lenderPaid };
  }

  it("bills only earned entries paid by the bill-to party, and marks them invoiced", async () => {
    const { store, now, deal, fee, lenderPaid } = await earned();
    await expect(createInvoice({ store, now }, { dealId: deal.id, feeEntryIds: [lenderPaid.id], billTo: { kind: "lender", name: "Cambridge" }, actor: "a" })).rejects.toThrow(/only earned/);
    await expect(createInvoice({ store, now }, { dealId: deal.id, feeEntryIds: [fee.id], billTo: { kind: "lender", name: "Cambridge" }, actor: "a" })).rejects.toThrow(/paid by the borrower/);
    const inv = await createInvoice({ store, now }, { dealId: deal.id, feeEntryIds: [fee.id], billTo: { kind: "borrower", name: "Sunrise Care LLC", email: "cfo@sunrise.example" }, actor: "a" });
    expect(inv).toMatchObject({ number: "KC-2026-0001", status: "draft", totalCents: 12_500_000 });
    expect((await store.listFeeEntries(deal.id)).find((e) => e.id === fee.id)).toMatchObject({ status: "invoiced", invoiceId: inv.id });
    await expect(store.updateInvoice(inv.id, { status: "issued", issuedAt: now().toISOString() }, "a", now())).resolves.toBeTruthy();
    await expect(store.updateInvoice(inv.id, { totalCents: 1 }, "a", now())).rejects.toThrow(/cannot change/);
  });

  it("emails only after approval, settles against the closing statement, and voids back to earned", async () => {
    const { store, gate, now, deal, fee } = await earned();
    const inv = await createInvoice({ store, now }, { dealId: deal.id, feeEntryIds: [fee.id], billTo: { kind: "borrower", name: "Sunrise", email: "cfo@sunrise.example" }, actor: "a" });
    const sent: string[] = [];
    const mailer = { async send(m: { text: string }) { sent.push(m.text); return { messageId: "1" }; } };
    gate.decide(`email:invoice:${inv.id}:${inv.documentSha256}`, { status: "pending" });
    expect((await issueInvoice({ store, gate, now, mailer }, inv.id, "a")).invoice.status).toBe("pending_approval");
    expect(sent).toHaveLength(0);
    gate.decide(`email:invoice:${inv.id}:${inv.documentSha256}`, { status: "approved", approvalId: "x", decidedBy: "b", decidedAt: now() });
    const issued = await issueInvoice({ store, gate, now, mailer }, inv.id, "a");
    expect(issued.invoice.status).toBe("issued");
    expect(sent[0]).toContain(INVOICE_TERMS);
    expect(sent[0]).toContain("$125,000.00");

    await expect(settleInvoice({ store, now }, inv.id, { settledOn: "2026-11-20", closingStatementRef: " " }, "a")).rejects.toThrow(/closing statement/);
    const settled = await settleInvoice({ store, now }, inv.id, { settledOn: "2026-11-20", closingStatementRef: "vault://closing-statement.pdf" }, "a");
    expect(settled.status).toBe("settled");
    expect((await store.listFeeEntries(deal.id)).find((e) => e.id === fee.id)!.status).toBe("settled");
    await expect(voidInvoice({ store, now }, inv.id, "oops", "a")).rejects.toThrow(/settled/);
  });

  it("voiding returns entries to earned for re-invoicing", async () => {
    const { store, now, deal, fee } = await earned();
    const inv = await createInvoice({ store, now }, { dealId: deal.id, feeEntryIds: [fee.id], billTo: { kind: "borrower", name: "Sunrise" }, actor: "a" });
    await voidInvoice({ store, now }, inv.id, "Wrong entity", "a");
    expect((await store.listFeeEntries(deal.id)).find((e) => e.id === fee.id)).toMatchObject({ status: "earned", invoiceId: null });
    const again = await createInvoice({ store, now }, { dealId: deal.id, feeEntryIds: [fee.id], billTo: { kind: "borrower", name: "Sunrise Care LLC" }, actor: "a" });
    expect(again.number).toBe("KC-2026-0002");
  });
});

describe("lender panel", () => {
  const now = new Date("2026-11-03T00:00:00Z");

  it("flags never-verified and stale lenders", () => {
    expect(lenderStaleness({ verifiedAt: null }, now)).toMatchObject({ stale: true, ageDays: null });
    expect(lenderStaleness({ verifiedAt: "2026-06-01T00:00:00Z" }, now)).toMatchObject({ stale: false, ageDays: 155 });
    expect(lenderStaleness({ verifiedAt: "2026-04-01T00:00:00Z" }, now).stale).toBe(true);
  });

  it("validates fee splits need an agreement on file", () => {
    expect(() => parseLender({ ...lenderInput(), feeAgreementRef: null })).toThrow(/agreement/);
    expect(() => parseLender({ ...lenderInput(), minLoanCents: 10, maxLoanCents: 5 })).toThrow(/below the minimum/);
    expect(parseLender({ ...lenderInput(), states: ["ca"] }).states).toEqual(["CA"]);
  });

  it("filters the panel by program, size and state, broker-friendly and fresh first", () => {
    const mk = (over: object, i: number) => ({ ...lenderInput(), id: `l${i}`, createdAt: "", updatedAt: "", updatedBy: null, ...over });
    const lenders = [
      mk({ name: "Zeta", brokerFriendly: false }, 1),
      mk({ name: "Alpha", verifiedAt: "2025-01-01T00:00:00Z" }, 2),
      mk({ name: "Beta" }, 3),
      mk({ name: "Too small", maxLoanCents: 100 }, 4),
      mk({ name: "Texas only", states: ["TX"] }, 5),
      mk({ name: "Inactive", active: false }, 6),
      mk({ name: "Private", category: "PRIVATE_NON_EXEMPT", categoryEvidenceRef: null }, 7),
    ];
    const r = panelForDeal(lenders, { program: "HUD_232", loanAmountCents: 1_250_000_000, propertyState: "CA" }, now);
    expect(r.map((m) => m.lender.name)).toEqual(["Beta", "Private", "Alpha", "Zeta"]);
    expect(r.find((m) => m.lender.name === "Alpha")!.warnings[0]).toMatch(/Last verified/);
    expect(r.find((m) => m.lender.name === "Private")!.warnings.join()).toMatch(/usury gate/);
  });
});
