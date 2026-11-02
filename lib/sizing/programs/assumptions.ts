// Underwriting assumptions for the program boxes in lib/sizing/programs/*.
//
// Like lib/sizing/assumptions.ts, every number here is an editable default
// drawn from market research, not a quote or a lender commitment. Items
// marked VERIFY rest on lender summaries or program guides that change without
// notice; re-check them with the lender panel before relying on them. Content
// pages should import these values rather than retyping them.

export const PROGRAM_ASSUMPTIONS_REVIEWED = "2026-10-31";

/** Corin's modeled advisory fee for the new boxes, as a share of the loan arranged. */
export const BROKER_FEE = {
  hardMoney: 0.01,
  construction: 0.01,
  dscr: 0.01,
  hud223a7: 0.005,
} as const;

// ---------------------------------------------------------------------------
// Hard money (private lender of record; Corin arranges, never funds)

export type ExperienceTier = "NEW" | "EMERGING" | "EXPERIENCED";

export type HardMoneyGridRow = {
  ratePct: number;
  /** Lender origination points, percent of the total commitment. */
  points: number;
  /** Initial advance as a share of the lesser of purchase price and as-is value (as-is value on a refinance). */
  maxInitialPct: number;
  /** Share of the rehab budget the lender holds back and releases as work is completed. */
  rehabFundedPct: number;
  /** Total commitment over purchase price (or as-is value) plus rehab. */
  maxLtc: number;
  /** Total commitment over after-repair (or as-stabilized) value. */
  maxLtarv: number;
  minInterestMonths: number;
  exitFeePct: number;
  extensionFeePct: number;
};

// VERIFY: hard money 9.5–12.5% rates, 1–4 points, 65–75% LTV/LTARV for fix-and-flip,
//   up to 80–85% on a stabilized bridge, 6–36 month interest-only terms, extensions 0.5–2%,
//   minimum interest 3–6 months, exit fee 0.5–1%, default rate up to 24%.
//   Source: Corin program research (lender summaries); as of 2026-10-31. The tier split by
//   completed projects in the last 36 months is Corin's grid, not a single lender's.
export const HARD_MONEY = {
  /** Completed projects in the last 36 months at or above which a sponsor is in the tier. */
  tierThresholds: { EMERGING: 1, EXPERIENCED: 5 },
  grid: {
    FIX_AND_FLIP: {
      NEW: { ratePct: 12.5, points: 3, maxInitialPct: 0.8, rehabFundedPct: 0.9, maxLtc: 0.8, maxLtarv: 0.65, minInterestMonths: 6, exitFeePct: 0.01, extensionFeePct: 0.015 },
      EMERGING: { ratePct: 11, points: 2, maxInitialPct: 0.85, rehabFundedPct: 1, maxLtc: 0.85, maxLtarv: 0.7, minInterestMonths: 4, exitFeePct: 0.0075, extensionFeePct: 0.01 },
      EXPERIENCED: { ratePct: 9.5, points: 1, maxInitialPct: 0.9, rehabFundedPct: 1, maxLtc: 0.9, maxLtarv: 0.75, minInterestMonths: 3, exitFeePct: 0.005, extensionFeePct: 0.005 },
    },
    BRIDGE: {
      NEW: { ratePct: 12.5, points: 3, maxInitialPct: 0.75, rehabFundedPct: 0.9, maxLtc: 0.8, maxLtarv: 0.75, minInterestMonths: 6, exitFeePct: 0.01, extensionFeePct: 0.015 },
      EMERGING: { ratePct: 11, points: 2, maxInitialPct: 0.8, rehabFundedPct: 1, maxLtc: 0.85, maxLtarv: 0.8, minInterestMonths: 4, exitFeePct: 0.0075, extensionFeePct: 0.01 },
      EXPERIENCED: { ratePct: 9.5, points: 1, maxInitialPct: 0.85, rehabFundedPct: 1, maxLtc: 0.9, maxLtarv: 0.85, minInterestMonths: 3, exitFeePct: 0.005, extensionFeePct: 0.005 },
    },
  } satisfies Record<"FIX_AND_FLIP" | "BRIDGE", Record<ExperienceTier, HardMoneyGridRow>>,
  minTermMonths: 6,
  maxTermMonths: 36,
  extensionMonths: 6,
  maxExtensions: 2,
  /** Contract default rate the lender of record's note typically carries (shown, never applied). */
  defaultRatePct: 24,
  minLoan: 150_000,
  maxLoan: 15_000_000,
  // VERIFY: lender underwriting/processing/doc fees and third-party costs (appraisal, title,
  //   escrow, recording) for a single-asset investor loan. Source: lender fee sheets; as of 2026-10-31.
  lenderFixedFees: 2_500,
  thirdPartyCosts: 7_500,
  // VERIFY: commissions, transfer tax and escrow on resale, share of ARV. Source: market estimate; as of 2026-10-31.
  sellingCostPct: 0.06,
  // VERIFY: net profit margin on ARV a fix-and-flip lender wants to see (10%+ passes the sale exit). Corin default.
  minFlipMarginPct: 0.1,
  /**
   * B&P §10232.3 loan-to-value limits apply only when a broker arranges a loan
   * funded by private investors. Corin has no investor desk and does not
   * place investor funds, so the sizer never applies them; kept for reference.
   */
  // VERIFY: §10232.3(a) limits — owner-occupied single-family 80%, non-owner-occupied
  //   single-family 75%, commercial and income-producing 65%, residentially zoned lot 60%,
  //   land zoned commercial or unimproved 50%. Source: Cal. B&P Code §10232.3; as of 2026-10-31.
  investorFundedLtvLimits: {
    applies: false,
    singleFamilyOwnerOccupied: 0.8,
    singleFamilyNonOwnerOccupied: 0.75,
    commercialIncomeProducing: 0.65,
    residentialLot: 0.6,
    land: 0.5,
  },
} as const;

// ---------------------------------------------------------------------------
// Ground-up construction

export type ConstructionLender = "BANK" | "DEBT_FUND" | "PRIVATE";

export type ConstructionBox = {
  maxLtc: number;
  /** Cap on the commitment as a share of as-completed (as-stabilized) value. */
  maxAsCompletedLtv: number;
  /** Stabilized NOI over the commitment; null when the lender sizes on collateral only. */
  minDebtYield: number | null;
  /** Coverage at stabilization on a 30-year amortizing constant; null when not tested. */
  minDscrAtStabilization: number | null;
  /** Floating spread over 30-day SOFR, or null for a fixed-rate lender. */
  spread: number | null;
  /** Fixed note rate when `spread` is null. */
  fixedRatePct: number | null;
  points: number;
  fixedFees: number;
  maxLoan: number;
};

// VERIFY: bank 60–65% LTC (SOFR + 275–350), debt fund 65–75% LTC (SOFR + 425–525),
//   private 85–90% LTC capped at 70–75% of as-completed value, interest reserve inside the loan.
//   Source: Corin program research; as of 2026-10-31. Debt-yield, DSCR, points and private
//   fixed-rate (within the 9.5–12.5% private range) are Corin defaults pending lender-panel review.
export const CONSTRUCTION = {
  boxes: {
    BANK: { maxLtc: 0.65, maxAsCompletedLtv: 0.65, minDebtYield: 0.09, minDscrAtStabilization: 1.25, spread: 3.125, fixedRatePct: null, points: 0.75, fixedFees: 35_000, maxLoan: 60_000_000 },
    DEBT_FUND: { maxLtc: 0.7, maxAsCompletedLtv: 0.7, minDebtYield: 0.075, minDscrAtStabilization: 1.15, spread: 4.75, fixedRatePct: null, points: 1.25, fixedFees: 50_000, maxLoan: 150_000_000 },
    PRIVATE: { maxLtc: 0.875, maxAsCompletedLtv: 0.725, minDebtYield: null, minDscrAtStabilization: null, spread: null, fixedRatePct: 11.5, points: 2.5, fixedFees: 15_000, maxLoan: 25_000_000 },
  } satisfies Record<ConstructionLender, ConstructionBox>,
  /** Leverage cut and spread add-on by sponsor experience (comparable projects completed). */
  experience: {
    tierThresholds: { EMERGING: 1, EXPERIENCED: 4 },
    NEW: { leverageCut: 0.05, spreadAdd: 0.5 },
    EMERGING: { leverageCut: 0.025, spreadAdd: 0.25 },
    EXPERIENCED: { leverageCut: 0, spreadAdd: 0 },
  },
  // VERIFY: lenders typically require a 5% hard-cost contingency with a GMP contract and 10%
  //   without; developer fee 3–4% of hard + soft costs. Source: lender term sheets; as of 2026-10-31.
  minContingencyGmp: 0.05,
  minContingencyNoGmp: 0.1,
  defaultDeveloperFeePct: 0.03,
  maxDeveloperFeePct: 0.05,
  // VERIFY: average outstanding share of the commitment during construction (S-curve funding)
  //   used to size the interest reserve; fully outstanding during lease-up. Corin estimate.
  avgOutstandingDuringConstruction: 0.55,
  /** Months added to construction + lease-up when setting the initial term. */
  termCushionMonths: 6,
  /** Sponsor common equity the stack must keep, share of total cost. */
  minCommonEquityPct: 0.1,
  // VERIFY: mezzanine 12–14% to ~80–85% combined LTC; preferred equity 13–16% to ~90%.
  //   Source: market summaries; as of 2026-10-31.
  mezz: { ratePct: 13, maxCombinedLtc: 0.85 },
  pref: { returnPct: 14.5, maxCombinedLtc: 0.9 },
  // VERIFY: California C-PACE (commercial, industrial, multifamily 5+ units, hotels) — typically
  //   up to ~25% of project cost, fixed rate, 20–30 year assessment term, senior lender consent
  //   required. Source: CA C-PACE administrator summaries; as of 2026-10-31.
  cpace: { maxPctOfCost: 0.25, ratePct: 7.5, termYears: 25 },
  /** Cap rate used to estimate as-completed value when none is entered. */
  capRate: { MULTIFAMILY: 0.0575, MIXED_USE: 0.065, COMMERCIAL: 0.0725, HOTEL: 0.095 },
} as const;

// VERIFY: permanent take-out boxes for the construction take-out test. Agency and HUD come
//   from lib/sizing/assumptions.ts; the bank mini-perm (70% LTV, 1.25x, 25-yr amortization,
//   5-yr Treasury + 2.25) is a Corin default; as of 2026-10-31.
export const BANK_PERM = { maxLtv: 0.7, minDscr: 1.25, amortYears: 25, spread: 2.25 } as const;

// ---------------------------------------------------------------------------
// Agency multifamily (Fannie Mae / Freddie Mac)

export type AgencyTier = "TIER_2" | "TIER_3" | "TIER_4";

// VERIFY: Fannie Mae Small Loan (≤ $9M) 80% LTV / 1.25x / 30-yr amortization, terms 5–30 yrs;
//   Freddie Mac Conventional Small $2–10M 80% / 1.25x (Freddie SBL reportedly retired
//   2026-04-15). Real deals average ~63% LTV / 1.43x, so DSCR usually binds. Tier 3 (65% / 1.35x)
//   and Tier 4 (55% / 1.55x) pricing grids and the spread steps are lender summaries.
//   Source: Corin program research; Fannie Mae DUS tier structure; as of 2026-10-31.
export const AGENCY_GRID = {
  tiers: {
    TIER_2: { maxLtv: 0.8, minDscr: 1.25, spreadAdj: 0 },
    TIER_3: { maxLtv: 0.65, minDscr: 1.35, spreadAdj: -0.15 },
    TIER_4: { maxLtv: 0.55, minDscr: 1.55, spreadAdj: -0.3 },
  } satisfies Record<AgencyTier, { maxLtv: number; minDscr: number; spreadAdj: number }>,
  /** Full-term interest-only only at Tier 3 leverage or lower. */
  fullIoTiers: ["TIER_3", "TIER_4"] as readonly AgencyTier[],
  amortYears: 30,
  fannie: {
    smallLoanMax: 9_000_000,
    minLoan: 750_000,
    terms: [5, 7, 10, 12, 15, 30] as readonly number[],
    spreadAdj: 0,
    smallFixedCosts: 25_000,
  },
  freddie: {
    smallMin: 2_000_000,
    smallMax: 10_000_000,
    terms: [5, 7, 10] as readonly number[],
    spreadAdj: 0.05,
    smallFixedCosts: 27_500,
  },
  /** Spread step by term over the matched Treasury (5- and 7-year terms price off the 5-year). */
  termSpreadAdj: { 5: -0.05, 7: 0, 10: 0, 12: 0.1, 15: 0.2, 30: 0.45 } as Record<number, number>,
  minOccupancyPct: 90,
  minUnits: 5,
} as const;

// ---------------------------------------------------------------------------
// Bridge exit test

// VERIFY: bridge exit test — stabilized debt yield 9.5–10.5% and 1.25x DSCR on the take-out
//   constant. Source: Corin program research; as of 2026-10-31.
export const BRIDGE_EXIT = { minDebtYield: 0.095, strongDebtYield: 0.105, minDscr: 1.25, amortYears: 30 } as const;

// ---------------------------------------------------------------------------
// DSCR investor rental loans (non-QM business-purpose)

export type CreditTier = "A" | "B" | "C";
export type DscrPurpose = "PURCHASE" | "RATE_TERM" | "CASH_OUT";

// VERIFY: DSCR investor boxes. 2–4 units: DSCR = gross rent / PITIA ≥ 1.00; LTV 80/75/70%
//   (purchase), 75/75/70% (rate-term), 75/70/65% (cash-out) for FICO ≥740 / 700–739 / 660–699.
//   5+ units: DSCR = NOI / debt service ≥ 1.20; LTV 75/75/70, 75/70/65, 70/65/60. 30-year
//   amortization, 5-4-3-2-1 prepayment step-down. Spreads over the 10-year Treasury are Corin
//   estimates. Source: non-QM investor lender matrices; as of 2026-10-31.
export const DSCR_INVESTOR = {
  creditTiers: { A: 740, B: 700, C: 660 } as Record<CreditTier, number>,
  amortYears: 30,
  prepay: "5-4-3-2-1 step-down",
  originationPct: 0.01,
  units2to4: {
    minUnits: 2,
    maxUnits: 4,
    minDscr: 1.0,
    minLoan: 100_000,
    maxLoan: 3_000_000,
    fixedCosts: 4_500,
    spread: { A: 2.75, B: 3.125, C: 3.75 } as Record<CreditTier, number>,
    maxLtv: {
      PURCHASE: { A: 0.8, B: 0.75, C: 0.7 },
      RATE_TERM: { A: 0.75, B: 0.75, C: 0.7 },
      CASH_OUT: { A: 0.75, B: 0.7, C: 0.65 },
    } as Record<DscrPurpose, Record<CreditTier, number>>,
  },
  units5plus: {
    minUnits: 5,
    minDscr: 1.2,
    minLoan: 500_000,
    maxLoan: 7_500_000,
    fixedCosts: 12_500,
    spread: { A: 2.5, B: 2.875, C: 3.5 } as Record<CreditTier, number>,
    maxLtv: {
      PURCHASE: { A: 0.75, B: 0.75, C: 0.7 },
      RATE_TERM: { A: 0.75, B: 0.7, C: 0.65 },
      CASH_OUT: { A: 0.7, B: 0.65, C: 0.6 },
    } as Record<DscrPurpose, Record<CreditTier, number>>,
  },
} as const;

// ---------------------------------------------------------------------------
// HUD 223(a)(7) streamlined refinance of an FHA-insured multifamily loan

// VERIFY: 223(a)(7) — new principal ≤ lesser of the original insured principal and the unpaid
//   balance plus eligible costs (incl. critical repairs); new P&I + MIP may not exceed existing
//   P&I + MIP; term up to 12 years beyond the remaining term, capped at the original program's
//   maximum term. Flat 0.25% MIP assumed to reach 223(a)(7) under Federal Register 2025-18379;
//   application fee and cost lines are estimates. Source: HUD MAP Guide (2024) refinance chapter;
//   as of 2026-10-31. Behind a flag until a HUD lender confirms the box.
export const HUD_223A7 = {
  enabled: false,
  maxTermExtensionYears: 12,
  maxTermYears: { "223F": 35, "221D4": 40 } as Record<"223F" | "221D4", number>,
  annualMip: 0.0025,
  upfrontMip: 0.0025,
  applicationFeePct: 0.0015,
  lenderFinancingFeePct: 0.01,
  legalAndTitle: 40_000,
  thirdPartyReports: 10_000,
  /** Rate discount to the 223(f) spread for a streamlined refinance. */
  spreadAdj: -0.05,
} as const;
