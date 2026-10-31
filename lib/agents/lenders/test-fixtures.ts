// Shared fixtures for lib/agents/lenders tests.

import type { LenderPanelEntry } from "@/lib/deals/types";
import type { CreditBox, DealProfile, QuoteTerms } from "./types";

export const NOW = new Date("2026-11-04T17:00:00.000Z");

export function terms(over: Partial<QuoteTerms> = {}): QuoteTerms {
  return {
    lenderName: "Test Bank",
    loanAmountCents: 100_000_000, // $1,000,000
    rateType: "fixed",
    ratePct: 6,
    indexName: null,
    spreadBps: null,
    rateFloorPct: null,
    termMonths: 120,
    amortizationMonths: 360,
    ioMonths: 0,
    originationFeePct: 0,
    lenderFeesCents: 0,
    thirdPartyCostsCents: 0,
    brokerFeeCents: 0,
    upfrontReservesCents: 0,
    monthlyReservesCents: 0,
    exitFeePct: 0,
    prepay: { kind: "none", schedule: [], months: null },
    mipUpfrontPct: 0,
    mipAnnualPct: 0,
    recourse: null,
    maxLtvPct: null,
    minDscr: null,
    minDebtYieldPct: null,
    bindingConstraint: null,
    timelineDays: null,
    expiresOn: null,
    notes: null,
    ...over,
  };
}

export function panelLender(over: Partial<LenderPanelEntry> = {}): LenderPanelEntry {
  return {
    id: "lender-1",
    partnerId: null,
    name: "Cambridge Realty Capital",
    category: "STATE_BANK",
    categoryEvidenceRef: "CA DFPI charter 1234",
    programs: ["HUD_232", "HUD_MULTIFAMILY"],
    minLoanCents: null,
    maxLoanCents: null,
    states: [],
    assetTypes: [],
    appetiteNotes: null,
    brokerFriendly: true,
    feeSplitKind: "percent_of_lender_fee",
    feeSplitValue: 50,
    feeAgreementRef: "vault://agreements/cambridge.pdf",
    contactName: "Dana Lee",
    contactEmail: "dana@cambridgerealty.example",
    verifiedAt: "2026-10-15T00:00:00.000Z",
    verifiedBy: "broker:ana",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    updatedBy: null,
    ...over,
  };
}

export function creditBox(over: Partial<CreditBox> = {}): CreditBox {
  return {
    id: "box-1",
    lenderId: "lender-1",
    partnerId: null,
    source: "staff",
    status: "approved",
    label: "HUD 232 box",
    programs: ["HUD_232"],
    assetClasses: ["SENIOR_LIVING"],
    states: [],
    minLoanCents: 200_000_000,
    maxLoanCents: 10_000_000_000,
    maxLtvPct: 80,
    maxLtcPct: null,
    minDscr: 1.45,
    minDebtYieldPct: null,
    lienPositions: ["first"],
    recourse: "non_recourse",
    maxTermMonths: 420,
    maxAmortizationMonths: 420,
    maxIoMonths: 0,
    rateMinPct: null,
    rateMaxPct: null,
    originationFeePct: 1,
    brokerCompensationPct: 0.5,
    typicalCloseDays: 150,
    franchiseRequirements: null,
    notes: null,
    verifiedAt: "2026-10-20T00:00:00.000Z",
    verifiedBy: "broker:ana",
    reviewedAt: "2026-10-20T00:00:00.000Z",
    reviewedBy: "broker:ana",
    reviewNote: null,
    recordVersion: 1,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    updatedBy: null,
    ...over,
  };
}

export function profile(over: Partial<DealProfile> = {}): DealProfile {
  return {
    dealId: "deal-1",
    program: "HUD_232",
    loanAmountCents: 1_250_000_000,
    propertyState: "CA",
    assetClass: "SENIOR_LIVING",
    ltvPct: 72,
    ltcPct: null,
    dscr: 1.6,
    debtYieldPct: null,
    lienPosition: "first",
    requiresNonRecourse: false,
    targetCloseDays: null,
    franchise: null,
    ...over,
  };
}

/** A realistic lender term sheet as it arrives in the lenders@ mailbox. */
export const TERM_SHEET_EMAIL = `Dana,

Thank you for the opportunity. Ready Capital is pleased to provide the following indicative terms for Sunrise Assisted Living:

Loan Amount: $12,500,000
Interest Rate: 6.85% fixed
Term: 10-year term, 30-year amortization, 24 months interest-only
Origination: 1.00% origination fee
Processing and legal fees: $35,000
Prepayment: 5-4-3-2-1 step-down
Max 70% LTV, minimum 1.30x DSCR
Recourse: non-recourse with standard carve-outs
We expect to close within 60 days of a complete application.
This quote expires 2026-12-15.

Regards,
Chris Moreno
Ready Capital`;
