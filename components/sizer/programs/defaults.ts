// Illustrative starting inputs for the sizer tabs added in this directory.
// They show how each box behaves; they are not a real deal.

import type { ConstructionInputs } from "@/lib/sizing/programs/construction";
import type { HardMoneyInputs } from "@/lib/sizing/programs/hardMoney";
import type { MultifamilyPlusInputs } from "@/lib/sizing/programs/multifamily";

/** Self-reported credit bands the sizer offers: the band floor and the score each band sizes on. */
export const CREDIT_BANDS = [
  { value: "760", label: "740 or higher", floor: 740, fico: 760 },
  { value: "720", label: "700–739", floor: 700, fico: 720 },
  { value: "680", label: "660–699", floor: 660, fico: 680 },
  { value: "640", label: "Below 660", floor: 0, fico: 640 },
] as const;

export type CreditBandValue = (typeof CREDIT_BANDS)[number]["value"];

export const bandFor = (fico: number): CreditBandValue => CREDIT_BANDS.find((b) => fico >= b.floor)?.value ?? "640";

export const HARD_MONEY_DEFAULT: HardMoneyInputs = {
  strategy: "FIX_AND_FLIP",
  purpose: "PURCHASE",
  propertyType: "RESIDENTIAL_1_4",
  units: 1,
  purchasePrice: 400_000,
  asIsValue: undefined,
  rehabBudget: 100_000,
  arv: 650_000,
  loanAmount: 450_000,
  completedProjects: 3,
  termMonths: 12,
  holdMonths: 9,
  interestReserveMonths: 0,
  interestBasis: "OUTSTANDING",
  existingPayoff: undefined,
  stabilizedNoi: undefined,
  monthlyRent: undefined,
  monthlyTaxesInsuranceHoa: undefined,
  fico: 720,
};

export const CONSTRUCTION_DEFAULT: ConstructionInputs = {
  assetType: "MULTIFAMILY",
  units: 80,
  landCost: 3_000_000,
  hardCosts: 14_000_000,
  softCosts: 2_500_000,
  contingencyPct: 0.05,
  developerFeePct: 0.03,
  gmpContract: true,
  constructionMonths: 18,
  leaseUpMonths: 6,
  stabilizedNoi: 1_650_000,
  asCompletedValue: 27_500_000,
  loanAmount: 15_000_000,
  completedProjects: 4,
  mezzTargetLtc: 0,
  prefTargetLtc: 0,
  cpaceAmount: 0,
  takeout: undefined,
};

export const MULTIFAMILY_DEFAULT: MultifamilyPlusInputs = {
  assetType: "MULTIFAMILY",
  units: 120,
  sqft: 110_000,
  loanAmount: 20_000_000,
  noi: 1_750_000,
  value: 29_000_000,
  totalCost: undefined,
  transaction: "REFINANCE",
  affordable: false,
  green: false,
  occupancyPct: 95,
  agencyTermYears: 10,
  agencyIoYears: 0,
  stabilizedNoi: undefined,
  fico: 760,
  cashOut: false,
  monthlyRent: undefined,
  monthlyTaxesInsuranceHoa: undefined,
  existingHud: undefined,
};

export const EXISTING_HUD_DEFAULT: NonNullable<MultifamilyPlusInputs["existingHud"]> = {
  unpaidBalance: 14_000_000,
  originalPrincipal: 17_000_000,
  existingRatePct: 5.25,
  existingAnnualMip: 0.0045,
  remainingTermYears: 28,
  originalProgram: "223F",
  repairs: 0,
};
