// Lender matching types (WS-M): credit boxes, the deal profile the matcher
// scores against, quotes parsed from lender term sheets, and the all-in cost.
//
// Broker only (Global rule 1): Kubera matches and submits; lenders underwrite,
// decide and fund as lender of record. Nothing here holds or moves money.
// Money is integer cents; rates and percentages are plain numbers (6.25 = 6.25%).

import type { DealProgram } from "@/lib/deals/types";

/** Asset classes, same vocabulary as the /partners "Appetite" verticals. */
export const assetClasses = ["SENIOR_LIVING", "HOSPITALITY", "MULTIFAMILY", "COMMERCIAL", "CONSTRUCTION"] as const;
export type AssetClass = (typeof assetClasses)[number];

export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  SENIOR_LIVING: "Senior living & care",
  HOSPITALITY: "Hospitality",
  MULTIFAMILY: "Multifamily",
  COMMERCIAL: "Commercial",
  CONSTRUCTION: "Construction",
};

export const recourseKinds = ["full", "partial", "non_recourse", "negotiable"] as const;
export type Recourse = (typeof recourseKinds)[number];

export const lienPositions = ["first", "second"] as const;
export type LienPosition = (typeof lienPositions)[number];

export const creditBoxStatuses = ["pending_review", "approved", "rejected", "retired"] as const;
export type CreditBoxStatus = (typeof creditBoxStatuses)[number];

export type CreditBoxSource = "partner_registration" | "staff";

/** The appetite fields of a credit box (what staff edit and partners register). */
export type CreditBoxTerms = {
  label: string;
  programs: DealProgram[];
  /** Empty = any asset class. */
  assetClasses: AssetClass[];
  /** Two-letter states; empty = nationwide. */
  states: string[];
  minLoanCents: number | null;
  maxLoanCents: number | null;
  maxLtvPct: number | null;
  maxLtcPct: number | null;
  minDscr: number | null;
  minDebtYieldPct: number | null;
  lienPositions: LienPosition[];
  recourse: Recourse | null;
  maxTermMonths: number | null;
  maxAmortizationMonths: number | null;
  maxIoMonths: number | null;
  rateMinPct: number | null;
  rateMaxPct: number | null;
  originationFeePct: number | null;
  /** Broker compensation the lender pays (from the registration's "broker compensation you pay"). */
  brokerCompensationPct: number | null;
  typicalCloseDays: number | null;
  franchiseRequirements: string | null;
  notes: string | null;
};

export type CreditBox = CreditBoxTerms & {
  id: string;
  lenderId: string | null;
  partnerId: string | null;
  source: CreditBoxSource;
  status: CreditBoxStatus;
  verifiedAt: string | null;
  verifiedBy: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  recordVersion: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
};

export type NewCreditBox = Omit<CreditBox, "id" | "recordVersion" | "createdAt" | "updatedAt" | "updatedBy">;

/** What the matcher knows about the deal. Unknown metrics are null and are not tested. */
export type DealProfile = {
  dealId: string | null;
  program: DealProgram;
  loanAmountCents: number | null;
  propertyState: string | null;
  assetClass: AssetClass | null;
  ltvPct: number | null;
  ltcPct: number | null;
  dscr: number | null;
  debtYieldPct: number | null;
  lienPosition: LienPosition;
  /** The borrower needs non-recourse (or only carve-out guarantees). */
  requiresNonRecourse: boolean;
  /** Days to close the borrower needs, if any. */
  targetCloseDays: number | null;
  /** Hotel flag, when the deal is hospitality. */
  franchise: string | null;
};

// ---------------------------------------------------------------------------
// Quotes

export const prepayKinds = ["none", "step_down", "yield_maintenance", "defeasance", "lockout", "minimum_interest"] as const;
export type PrepayKind = (typeof prepayKinds)[number];

export const bindingConstraints = ["ltv", "ltc", "dscr", "debt_yield", "loan_amount", "program_max"] as const;
export type BindingConstraint = (typeof bindingConstraints)[number];

export type Prepay = {
  kind: PrepayKind;
  /** step_down: premium (% of balance prepaid) for loan years 1, 2, … e.g. [5,4,3,2,1]. */
  schedule: number[];
  /** lockout / minimum_interest: months. */
  months: number | null;
};

/** Normalized terms of one lender quote / term sheet. */
export type QuoteTerms = {
  lenderName: string;
  loanAmountCents: number;
  rateType: "fixed" | "floating";
  /** All-in note rate (index + spread, or fixed coupon). */
  ratePct: number;
  indexName: string | null;
  spreadBps: number | null;
  rateFloorPct: number | null;
  termMonths: number;
  /** Amortization schedule length after any IO period; null = interest-only to maturity. */
  amortizationMonths: number | null;
  ioMonths: number;
  originationFeePct: number;
  /** Lender processing, underwriting and legal fees (borrower-paid at closing). */
  lenderFeesCents: number;
  /** Appraisal, environmental, PCA and other third-party reports. */
  thirdPartyCostsCents: number;
  /** Kubera's borrower-paid broker fee for this structure, if any (lender-paid compensation is not a borrower cost). */
  brokerFeeCents: number;
  /** Reserves the lender requires the borrower to fund at closing (released at payoff). */
  upfrontReservesCents: number;
  /** Ongoing reserve deposits per month (e.g. replacement reserves). */
  monthlyReservesCents: number;
  exitFeePct: number;
  prepay: Prepay;
  /** HUD mortgage insurance premium. */
  mipUpfrontPct: number;
  mipAnnualPct: number;
  recourse: Recourse | null;
  maxLtvPct: number | null;
  minDscr: number | null;
  minDebtYieldPct: number | null;
  bindingConstraint: BindingConstraint | null;
  /** Days to close the lender quotes. */
  timelineDays: number | null;
  expiresOn: string | null;
  notes: string | null;
};

export const quoteStatuses = ["needs_review", "active", "accepted", "declined", "withdrawn", "expired"] as const;
export type QuoteStatus = (typeof quoteStatuses)[number];

export type QuoteParser = "model" | "rules" | "staff";

export type Quote = {
  id: string;
  dealId: string;
  lenderId: string | null;
  lenderName: string;
  outreachId: string | null;
  mailMessageId: string | null;
  source: "email_parse" | "staff";
  status: QuoteStatus;
  terms: QuoteTerms;
  /** Per-field confidence 0..1 (parsed quotes only). */
  confidence: Record<string, number>;
  lowConfidenceFields: string[];
  allIn: AllInCost | null;
  allInRatePct: number | null;
  bindingConstraint: BindingConstraint | null;
  parser: QuoteParser;
  parserModel: string | null;
  receivedAt: string;
  expiresOn: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
};

export type NewQuote = Omit<Quote, "id" | "createdAt" | "updatedAt" | "updatedBy">;

/** Inputs the all-in model assumes (shown next to every comparison). */
export type AllInAssumptions = {
  /** Months the borrower expects to keep the loan (prepay is priced at this exit). */
  holdMonths: number;
  /** Reinvestment / Treasury rate used to estimate yield maintenance and defeasance. */
  reinvestmentRatePct: number;
  /** Stabilized NOI for DSCR / debt yield at the quoted structure (cents per year). */
  noiCents: number | null;
};

export type AllInCost = {
  assumptions: AllInAssumptions;
  /** Month the model prices the payoff (hold, pushed to the end of a lockout or to maturity). */
  exitMonth: number;
  upfrontCostsCents: number;
  upfrontBreakdown: { origination: number; lenderFees: number; thirdParty: number; brokerFee: number; mipUpfront: number };
  /** Loan amount minus upfront costs and reserves the borrower funds from proceeds. */
  netProceedsCents: number;
  upfrontReservesCents: number;
  ioPaymentCents: number;
  amortizingPaymentCents: number | null;
  /** First 12 months of principal and interest (IO months at the IO payment). */
  firstYearDebtServiceCents: number;
  /** Debt service in the first fully amortizing year (or IO year when no amortization). */
  stabilizedAnnualDebtServiceCents: number;
  totalInterestCents: number;
  totalMipCents: number;
  prepayCostCents: number;
  exitFeeCents: number;
  balanceAtExitCents: number;
  /** Interest + MIP + upfront costs + prepay + exit fee over the hold. */
  totalCostCents: number;
  /** Annualized internal rate of the borrower's cash flows (nominal, monthly compounding). */
  allInRatePct: number;
  /** Effective annual rate of the same cash flows. */
  effectiveAnnualRatePct: number;
  dscr: number | null;
  debtYieldPct: number | null;
  warnings: string[];
};
