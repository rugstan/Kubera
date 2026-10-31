// Lender underwriting conventions used to normalize NOI. These are editable
// defaults, not quotes: each lender's own guide governs the deal. Items marked
// VERIFY rest on lender summaries and should be re-checked with the lender.

export const SPREADS_ASSUMPTIONS_REVIEWED = "2026-10-31";

export const LENDER_PROFILE_IDS = ["HUD", "AGENCY", "CMBS", "BANK", "BRIDGE", "SBA"] as const;
export type LenderProfileId = (typeof LENDER_PROFILE_IDS)[number];

export type AssetClass = "multifamily" | "senior" | "hotel" | "commercial";

export type LenderProfile = {
  id: LenderProfileId;
  label: string;
  /** Minimum economic loss (vacancy + credit loss + concessions) as a share of gross potential rent. */
  vacancyFloorPct: number;
  /** Minimum management fee as a share of effective gross income. */
  managementFeeFloorPct: number;
  /** Minimum replacement reserve per unit (bed, unit or key) per year. */
  reservesPerUnit: number;
  /** Hotels: FF&E reserve as a share of total revenue. */
  ffeReservePct: number;
  /** Share of other income the lender gives no credit for. */
  otherIncomeHaircutPct: number;
  /** Operating expenses (other than taxes, management and reserves) trended forward by this share. */
  expenseTrendPct: number;
};

// VERIFY: vacancy/management/reserve floors below follow published lender summaries
//   (Fannie Mae DUS Guide Part II ch. 2 / Freddie Optigo summaries; HUD MAP Guide ch. 7;
//   CMBS rating-agency conventions); as of 2026-10-31. Confirm with the lender per deal.
export const LENDER_PROFILES: Readonly<Record<LenderProfileId, LenderProfile>> = {
  HUD: { id: "HUD", label: "HUD (MAP / LEAN)", vacancyFloorPct: 0.07, managementFeeFloorPct: 0.05, reservesPerUnit: 300, ffeReservePct: 0.04, otherIncomeHaircutPct: 0, expenseTrendPct: 0.03 },
  AGENCY: { id: "AGENCY", label: "Agency (Fannie / Freddie)", vacancyFloorPct: 0.05, managementFeeFloorPct: 0.03, reservesPerUnit: 250, ffeReservePct: 0.04, otherIncomeHaircutPct: 0, expenseTrendPct: 0.03 },
  CMBS: { id: "CMBS", label: "CMBS conduit", vacancyFloorPct: 0.05, managementFeeFloorPct: 0.03, reservesPerUnit: 250, ffeReservePct: 0.04, otherIncomeHaircutPct: 0, expenseTrendPct: 0.03 },
  BANK: { id: "BANK", label: "Bank / life company", vacancyFloorPct: 0.05, managementFeeFloorPct: 0.04, reservesPerUnit: 250, ffeReservePct: 0.04, otherIncomeHaircutPct: 0.25, expenseTrendPct: 0.03 },
  BRIDGE: { id: "BRIDGE", label: "Bridge / debt fund", vacancyFloorPct: 0, managementFeeFloorPct: 0.03, reservesPerUnit: 200, ffeReservePct: 0.04, otherIncomeHaircutPct: 0, expenseTrendPct: 0 },
  SBA: { id: "SBA", label: "SBA 7(a) / 504 lender", vacancyFloorPct: 0.05, managementFeeFloorPct: 0.03, reservesPerUnit: 0, ffeReservePct: 0.04, otherIncomeHaircutPct: 0, expenseTrendPct: 0 },
};

// VERIFY: senior housing operators are underwritten at a 5% management fee and
//   ~$350/unit reserves (HUD 232 and agency seniors summaries); hotels at 3% management
//   and 4% FF&E (CMBS/STR conventions); as of 2026-10-31.
export const ASSET_OVERRIDES: Readonly<Partial<Record<AssetClass, Partial<Pick<LenderProfile, "managementFeeFloorPct" | "reservesPerUnit">>>>> = {
  senior: { managementFeeFloorPct: 0.05, reservesPerUnit: 350 },
  hotel: { managementFeeFloorPct: 0.03 },
};

export function profileFor(id: LenderProfileId, asset: AssetClass): LenderProfile {
  const base = LENDER_PROFILES[id];
  const o = ASSET_OVERRIDES[asset] ?? {};
  return {
    ...base,
    managementFeeFloorPct: Math.max(base.managementFeeFloorPct, o.managementFeeFloorPct ?? 0),
    reservesPerUnit: Math.max(base.reservesPerUnit, o.reservesPerUnit ?? 0),
  };
}

/** SBA global cash flow: minimum DSCR and the living-expense allowance per guarantor when none is stated. */
// VERIFY: SBA SOP 50 10 8 requires 1.15x debt service coverage at minimum; most SBA lenders
//   underwrite to 1.25x global. Living-expense allowance varies by lender ($30-50k); as of 2026-10-31.
export const SBA_GLOBAL = { minDscr: 1.25, sopMinDscr: 1.15, defaultLivingExpenses: 36_000 } as const;

/** Senior census flags. */
export const SENIOR = { medicaidConcentrationPct: 0.5, privatePayMinPct: 0.3 } as const;
