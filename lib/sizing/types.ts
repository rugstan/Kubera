import type { Constraint } from "./finance";

export type ProgramId =
  | "HUD_232_223F"
  | "HUD_232_NEW_CONST"
  | "SBA_504_STANDARD"
  | "SBA_504_PLUS_7A_10M_STACK"
  | "HOSPITALITY_CMBS_NON_RECOURSE"
  | "HOSPITALITY_PIP_BRIDGE"
  | "BRIDGE_TO_HUD_232"
  | "WHITE_LABEL_CRE_BRIDGE"
  | "HUD_221D4_223F_MULTIFAMILY"
  | "AGENCY_FANNIE_FREDDIE";

export type Recourse = "Non-recourse" | "Non-recourse (standard carve-outs)" | "Full recourse (personal guaranty)";

export type Tranche = {
  label: string;
  amount: number;
  ratePct: number;
  amortYears: number;
  annualDebtService: number;
};

export type FeeLine = { label: string; amount: number };

export type ProgramQuote = {
  id: ProgramId;
  name: string;
  short: string;
  eligible: boolean;
  notes: string[];
  warnings: string[];
  requested: number;
  loanAmount: number;
  binding: Constraint;
  /** Blended note rate across tranches. */
  ratePct: number;
  termLabel: string;
  amortLabel: string;
  recourse: Recourse;
  tranches: Tranche[];
  monthlyPrincipalInterest: number;
  annualPrincipalInterest: number;
  /** MIP or SBA guarantee/servicing fees, kept separate from P&I. */
  annualFee: FeeLine;
  annualAudit: number;
  closingCosts: number;
  closingBreakdown: FeeLine[];
  annualAllIn: number;
  allInRatePct: number;
  dscr: number;
  /** Loan over `value`; labelled LTC when value is a total cost basis (construction, PIP-funded). */
  ltv: number;
  leverageBasis: "LTV" | "LTC";
  debtYield: number;
  equityRequired?: number;
  closeTimeline: string;
  estimatedAdvisoryFee: number;
  accent?: "gold" | "emerald";
};

export type SizingResult = {
  quotes: ProgramQuote[];
  bestFit: ProgramId | null;
  value: number;
  valueEstimated: boolean;
  metrics: { label: string; value: string }[];
};

export type SeniorInputs = {
  facilityType: "RCFE" | "ASSISTED_LIVING" | "MEMORY_CARE" | "SNF";
  beds: number;
  occupancyPct: number;
  loanAmount: number;
  noi: number;
  /** Purchase price, as-is value, or total project cost for new construction. */
  value?: number;
  transaction: "PURCHASE" | "REFINANCE" | "NEW_CONSTRUCTION";
  nonRecourseOnly: boolean;
  green: boolean;
};

export type HospitalityInputs = {
  keys: number;
  tier: "PREMIUM_FLAG" | "ECONOMY_FLAG" | "BOUTIQUE_INDEPENDENT";
  loanAmount: number;
  noi: number;
  adr: number;
  occupancyPct: number;
  pipBudget: number;
  value?: number;
  transaction: "PURCHASE" | "REFINANCE" | "CONSTRUCTION";
  nonRecourseOnly: boolean;
  green: boolean;
};

export type MultifamilyInputs = {
  assetType: "MULTIFAMILY" | "MIXED_USE" | "COMMERCIAL";
  units: number;
  sqft: number;
  loanAmount: number;
  /** In-place NOI, or as-stabilized NOI for construction. */
  noi: number;
  /** As-is or as-stabilized value. */
  value?: number;
  /** Total project cost, used for LTC on construction. */
  totalCost?: number;
  transaction: "PURCHASE" | "REFINANCE" | "CONSTRUCTION";
  /** Affordable / LIHTC: HUD's affordable box (same as rental assistance). */
  affordable: boolean;
  /** Project-based rental assistance (e.g. Section 8 HAP): HUD's affordable box. */
  rentalAssistance?: boolean;
  /** 221(d)(4) middle-income tier; ignored unless the tier is enabled in assumptions. */
  middleIncome?: boolean;
  green: boolean;
  /** Cash-out refinance (REFINANCE only): HUD 223(f) caps it at the cash-out LTV. */
  cashOut?: boolean;
};

/** Switches for program rules that are not yet confirmed and stay off by default. */
export type SizingOptions = {
  /** Size qualifying 221(d)(4) deals on the middle-income box. Defaults to `HUD.multifamily.middleIncome221d4.enabled`. */
  middleIncomeTier?: boolean;
};
