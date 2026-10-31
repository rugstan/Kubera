// Program parameters used by the sizer and the Jev decision engine.
//
// Every number here is an editable underwriting assumption, not a quote. Keep
// them in one place so the capital markets desk can retune spreads and program
// limits without touching sizing logic. Items marked VERIFY rest on program
// rules that change by notice or SOP revision and should be re-checked against
// the current HUD handbook / SBA SOP before relying on them.

import type { Benchmarks } from "@/lib/rates";

export const ASSUMPTIONS_REVIEWED = "2026-10-31";

/** Used only when the live benchmark feed is unreachable; the UI labels them "indicative". */
export const FALLBACK_BENCHMARKS: Benchmarks = {
  fiveYear: 3.85,
  tenYear: 4.15,
  sofr30: 3.7,
  prime: 6.75,
};

/** Spreads in percentage points over the named benchmark. */
export const SPREADS = {
  hud232: { lo: 1.4, hi: 1.8, base: "tenYear" },
  hudMultifamily: { lo: 1.3, hi: 1.7, base: "tenYear" },
  sba504Debenture: { lo: 0.75, hi: 1.05, base: "tenYear" },
  /** Debenture rate plus ongoing SBA, CDC servicing, and CSA fees. */
  sba504Effective: { lo: 1.8, hi: 2.25, base: "tenYear" },
  sbaBankFirst: { lo: 2.25, hi: 2.75, base: "fiveYear" },
  sba7a: { lo: 2.0, hi: 2.75, base: "prime" },
  agency: { lo: 1.45, hi: 1.85, base: "tenYear" },
  hotelCmbs: { lo: 2.5, hi: 3.25, base: "tenYear" },
  bridge: { lo: 3.75, hi: 5.5, base: "sofr30" },
} as const;

export const mid = (s: { lo: number; hi: number }) => (s.lo + s.hi) / 2;

export const HUD = {
  /** Annual CPA audit HUD requires of Section 232 and multifamily borrowers. */
  annualAuditCost: 20_000,
  /** Below this, HUD's fixed costs usually outweigh its rate/term advantage. */
  smallLoanThreshold: 3_500_000,
  thirdPartyReports: 65_000,
  legalAndTitle: 95_000,
  applicationFeePct: 0.003,
  lenderFinancingFeePct: 0.01,
  section232: {
    // 232/223(f): 35-yr term, 80% LTV for-profit, 1.45x DSCR.
    refi: { termYears: 35, maxLtv: 0.8, minDscr: 1.45, annualMip: 0.0065, upfrontMip: 0.01 },
    // 232 new construction: 40 yrs after construction, 75% for-profit, 1.45x.
    newConstruction: { termYears: 40, maxLtc: 0.75, minDscr: 1.45, annualMip: 0.0077, upfrontMip: 0.01 },
    minYearsSinceCompletion: 3,
    stabilizedOccupancy: 0.85,
    practicalMinBeds: 25,
    // VERIFY: HUD's green MIP reduction has applied to multifamily (223(f),
    // 221(d)(4)), not to Section 232 healthcare. Flip only on written HUD guidance.
    greenMipEligible: false,
  },
  multifamily: {
    s223f: { termYears: 35, maxLtv: 0.85, maxLtvAffordable: 0.87, minDscr: 1.176, minDscrAffordable: 1.15 },
    s221d4: { termYears: 40, maxLtc: 0.85, maxLtcAffordable: 0.87, minDscr: 1.176, minDscrAffordable: 1.15 },
    mip: { market223f: 0.006, market221d4: 0.0065, affordable: 0.0035, green: 0.0025 },
  },
} as const;

export const SBA = {
  bankFirstPct: 0.5,
  /** Standard CDC debenture cap; energy-efficient / manufacturing projects get the higher cap. */
  cdcCap: 5_000_000,
  cdcCapGreen: 5_500_000,
  sevenACap: 5_000_000,
  // VERIFY: combined 7(a) + 504 exposure Kubera models for the 2026 stacking
  // structure. Confirm against the SOP 50 10 revision in effect at application.
  combinedExposureCap: 10_000_000,
  /** Equity injection: 10% base, +5% special-purpose property (hotels, care facilities), +5% start-up / new construction. */
  equity: { base: 0.1, specialPurpose: 0.05, newBusiness: 0.05 },
  cdcAmortYears: 25,
  bankAmortYears: 25,
  sevenAAmortYears: 25,
  minDscr: 1.25,
  /** Ongoing fees on the CDC debenture, bundled into the effective rate. */
  annualDebentureFees: 0.0109,
  /** Upfront 504 debenture fees (SBA, CDC processing, closing, underwriter), financed into the debenture. */
  upfrontDebentureFees: 0.0215,
  sevenAGuaranteedShare: 0.75,
  sevenAUpfrontGuaranteeFee: 0.035,
  sevenAAnnualServiceFee: 0.0055,
  bankParticipationFee: 0.005,
  thirdPartyReports: 28_000,
  typicalCloseDays: "45–75 days",
} as const;

export const CMBS = {
  termYears: 10,
  amortYears: 30,
  maxLtv: 0.65,
  minDscr: 1.4,
  minDebtYield: { PREMIUM_FLAG: 0.11, ECONOMY_FLAG: 0.12, BOUTIQUE_INDEPENDENT: 0.125 },
  minLoan: 5_000_000,
  originationPct: 0.01,
  fixedCosts: 95_000,
} as const;

export const AGENCY = {
  termYears: 10,
  amortYears: 30,
  maxLtv: 0.8,
  minDscr: 1.25,
  originationPct: 0.01,
  fixedCosts: 45_000,
} as const;

export const BRIDGE = {
  senior: { maxLtv: 0.75, minDebtYield: 0.08, termMonths: 36, spread: 4.25 },
  hotelPip: { maxLtc: 0.7, minDebtYield: 0.08, termMonths: 30, spread: 4.75 },
  cre: { maxLtv: 0.75, minDebtYield: 0.07, termMonths: 24, spread: 3.85 },
  construction: { maxLtc: 0.8, minDebtYieldOnCost: 0.065, termMonths: 30, spread: 4.5 },
  lenderFeePct: 0.01,
  exitFeePct: 0.005,
  fixedCosts: 22_000,
  closeDays: "10–21 days",
} as const;

/** Advisory fee Kubera models per program, as a share of the loan arranged. */
export const BROKER_FEE_PCT = {
  HUD: 0.01,
  SBA: 0.01,
  CMBS: 0.01,
  AGENCY: 0.0075,
  BRIDGE: 0.015,
} as const;

/** Going-in cap rates used to estimate value when the borrower leaves it blank. */
export const CAP_RATES = {
  senior: 0.085,
  hotel: { PREMIUM_FLAG: 0.0925, ECONOMY_FLAG: 0.1, BOUTIQUE_INDEPENDENT: 0.095 },
  multifamily: 0.0575,
  mixedUse: 0.065,
  commercial: 0.0725,
} as const;
