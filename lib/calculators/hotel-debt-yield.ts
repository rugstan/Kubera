// Hotel debt yield calculator. Debt yield is NOI over the loan amount; hotel
// CMBS lenders set a floor by flag tier (lib/sizing/assumptions.ts), which
// often binds before loan-to-value or coverage. The calculator also shows the
// other CMBS limits so the binding one is visible.

import { ASSUMPTIONS_REVIEWED, CMBS } from "@/lib/sizing/assumptions";
import { debtConstant } from "@/lib/sizing/finance";
import { requirePositive, requireRange, type CalcOutcome, type FieldErrors } from "./format";

export const HOTEL_TIERS = ["PREMIUM_FLAG", "ECONOMY_FLAG", "BOUTIQUE_INDEPENDENT"] as const;
export type HotelTier = (typeof HOTEL_TIERS)[number];

export const HOTEL_TIER_LABELS: Record<HotelTier, string> = {
  PREMIUM_FLAG: "Premium flag (upscale or upper-upscale brand)",
  ECONOMY_FLAG: "Economy or select-service flag",
  BOUTIQUE_INDEPENDENT: "Boutique or independent",
};

export type HotelDebtYieldInputs = {
  keys: number;
  /** Average daily rate in dollars. */
  adr: number;
  /** Occupancy in percent, e.g. 72. */
  occupancyPct: number;
  /** Trailing-12 net operating income after the FF&E reserve. */
  noi: number;
  loanAmount: number;
  tier: HotelTier;
  /** Appraised or purchase value, optional; adds loan-to-value and the value limit. */
  value?: number;
  /** Rate for the coverage check, in percentage points. */
  ratePct: number;
};

export type HotelConstraint = "DEBT_YIELD" | "DSCR" | "LTV";

export type HotelDebtYieldResult = {
  revpar: number;
  roomsRevenue: number;
  noiPerKey: number;
  /** NOI as a share of rooms revenue (not total revenue). */
  noiToRoomsRevenue: number;
  debtYield: number;
  minDebtYield: number;
  meetsMinimum: boolean;
  loanPerKey: number;
  /** Largest loan that clears the debt-yield floor. */
  maxLoanAtMinDebtYield: number;
  /** Same, for the CMBS coverage minimum at the rate entered. */
  maxLoanAtMinDscr: number;
  maxLoanAtMaxLtv?: number;
  dscr: number;
  ltv?: number;
  /** The tightest of the limits above, and the loan it allows. */
  bindingConstraint: HotelConstraint;
  maxLoan: number;
  /** NOI needed to clear the floor on the loan entered. */
  noiNeededForMinDebtYield: number;
  /** Sensitivity: debt yield if NOI moves down or up 10%. */
  debtYieldNoiDown10: number;
  debtYieldNoiUp10: number;
  asOf: string;
};

export type HotelDebtYieldField = "keys" | "adr" | "occupancyPct" | "noi" | "loanAmount" | "tier" | "value" | "ratePct";

export function calcHotelDebtYield(i: HotelDebtYieldInputs): CalcOutcome<HotelDebtYieldResult, HotelDebtYieldField> {
  const errors: FieldErrors<HotelDebtYieldField> = {};
  requirePositive(errors, "keys", i.keys, "Number of keys");
  requirePositive(errors, "adr", i.adr, "Average daily rate");
  requireRange(errors, "occupancyPct", i.occupancyPct, 1, 100, "Occupancy", "%");
  requirePositive(errors, "noi", i.noi, "Net operating income");
  requirePositive(errors, "loanAmount", i.loanAmount, "Loan amount");
  requireRange(errors, "ratePct", i.ratePct, 0.1, 25, "Interest rate", "%");
  if (!HOTEL_TIERS.includes(i.tier)) errors.tier = "Choose a hotel type.";
  if (i.value !== undefined && !(i.value > 0)) errors.value = "Value must be greater than zero, or left blank.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const revpar = i.adr * (i.occupancyPct / 100);
  const roomsRevenue = revpar * i.keys * 365;
  const minDebtYield = CMBS.minDebtYield[i.tier];
  const constant = debtConstant(i.ratePct, CMBS.amortYears);

  const byDebtYield = i.noi / minDebtYield;
  const byDscr = i.noi / CMBS.minDscr / constant;
  const byLtv = i.value ? i.value * CMBS.maxLtv : undefined;
  const limits: [HotelConstraint, number][] = [
    ["DEBT_YIELD", byDebtYield],
    ["DSCR", byDscr],
  ];
  if (byLtv !== undefined) limits.push(["LTV", byLtv]);
  const [bindingConstraint, maxLoan] = limits.reduce((a, b) => (b[1] < a[1] ? b : a));

  const debtYield = i.noi / i.loanAmount;
  return {
    ok: true,
    result: {
      revpar,
      roomsRevenue,
      noiPerKey: i.noi / i.keys,
      noiToRoomsRevenue: i.noi / roomsRevenue,
      debtYield,
      minDebtYield,
      meetsMinimum: debtYield >= minDebtYield,
      loanPerKey: i.loanAmount / i.keys,
      maxLoanAtMinDebtYield: byDebtYield,
      maxLoanAtMinDscr: byDscr,
      maxLoanAtMaxLtv: byLtv,
      dscr: i.noi / (i.loanAmount * constant),
      ltv: i.value ? i.loanAmount / i.value : undefined,
      bindingConstraint,
      maxLoan,
      noiNeededForMinDebtYield: i.loanAmount * minDebtYield,
      debtYieldNoiDown10: (i.noi * 0.9) / i.loanAmount,
      debtYieldNoiUp10: (i.noi * 1.1) / i.loanAmount,
      asOf: ASSUMPTIONS_REVIEWED,
    },
  };
}
