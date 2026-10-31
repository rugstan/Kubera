// Shared fixtures for lib/deals tests.

import { FakeApprovalGate } from "@/lib/compliance/approval-gate";
import { createDeal } from "./service";
import { MemoryDealDeskStore } from "./store";
import type { Deal, LoanBrokerOfRecord, NewDeal, NewLender, PackageItem } from "./types";

export const T0 = new Date("2026-11-03T17:00:00.000Z");

export function clockAt(start: Date = T0) {
  let t = start.getTime();
  const now = () => new Date(t);
  return { now, advance: (ms: number) => (t += ms) };
}

export function setup(gateDefault: ConstructorParameters<typeof FakeApprovalGate>[0] = "approved") {
  const store = new MemoryDealDeskStore();
  const gate = new FakeApprovalGate(gateDefault);
  const clock = clockAt();
  return { store, gate, clock, now: clock.now };
}

export async function newDeal(store: MemoryDealDeskStore, now: () => Date, input: Partial<NewDeal> = {}): Promise<Deal> {
  return createDeal({ store, now }, { title: "Sunrise Assisted Living refi", program: "HUD_232", loanAmountCents: 1_250_000_000, collateralRealProperty: true, propertyState: "CA", borrowerName: "Sunrise Care LLC", ...input }, "broker:ana");
}

export const lenderInput = (over: Partial<NewLender> = {}): NewLender => ({
  partnerId: null,
  name: "Cambridge Realty Capital",
  category: "STATE_BANK",
  categoryEvidenceRef: "CA DFPI charter 1234",
  programs: ["HUD_232", "HUD_MULTIFAMILY", "SBA_7A", "HARD_MONEY"],
  minLoanCents: 100_000_000,
  maxLoanCents: 10_000_000_000,
  states: [],
  assetTypes: ["senior_housing"],
  appetiteNotes: null,
  brokerFriendly: true,
  feeSplitKind: "percent_of_lender_fee",
  feeSplitValue: 50,
  feeAgreementRef: "vault://agreements/cambridge-2026.pdf",
  contactName: "Dana Lee",
  contactEmail: "dana@lender.example",
  verifiedAt: "2026-10-01T00:00:00.000Z",
  verifiedBy: "broker:ana",
  active: true,
  ...over,
});

export const docs = (n: number, salt = "a"): PackageItem[] =>
  Array.from({ length: n }, (_, i) => ({
    documentId: `doc-${i + 1}`,
    label: `Document ${i + 1}`,
    kind: i === 0 ? "T12" : "OTHER",
    storagePath: `leads/x/doc-${i + 1}.pdf`,
    sha256: (salt + String(i)).padEnd(64, "0").replace(/[^0-9a-f]/g, "0"),
  }));

export function loanRecord(dealId: string, over: Partial<LoanBrokerOfRecord> = {}): LoanBrokerOfRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    dealId,
    leadId: null,
    lender: { name: "Fidelis Private Fund", category: "PRIVATE_NON_EXEMPT" },
    noteRatePct: 12.5,
    fedDiscountRatePct: 4.5,
    collateral: { realPropertyLien: true, equityPledgeOrUccOnly: false },
    elements: { negotiationLog: [], businessPurposeCertified: false },
    tableFundedInKuberaName: false,
    transactionDate: "2026-03-01",
    ...over,
  };
}

export const fullElements = {
  arrangingLicensee: { name: "Neeli Khanna", dreLicense: "01234567", activeAtTransaction: true },
  actsFor: "borrower" as const,
  engagementAgreementRef: "vault://engagement/ext-1.pdf",
  compensation: { amountUsd: 15_000, payer: "borrower" as const, expected: true },
  negotiationLog: [{ at: "2026-10-20T18:00:00.000Z", kind: "term_sheet" as const, ref: "ext-term-sheet-v2", summary: "6-month extension at 12.5%" }],
  businessPurposeCertified: true,
};
