import { monthOf, round2, toIsoDate, yearOf, type DateInput } from "./dates";

// Prop 13 reassessment estimator for acquisitions and refinancings in
// California. A sale (change in ownership) resets the assessed value to the
// purchase price; afterwards the assessed value may grow by at most 2% a
// year. Property tax is about 1% of assessed value plus voter-approved
// local debt and direct charges, which vary by tax rate area.
//
// Underwriting guidance, not a tax bill. VERIFY the county's total levy rate
// (the Auditor-Controller publishes rates by tax rate area) before relying on it.

export const PROP13 = {
  /** Cal. Const. art. XIII A: the 1% base rate. */
  baseRatePct: 1,
  /** Default voter-approved debt levy added to the base rate when the tax rate area is unknown. VERIFY by county. */
  defaultVoterApprovedRatePct: 0.2,
  /** Maximum annual increase in the base-year value (inflation factor is the lesser of CPI and this). */
  maxAnnualIncreasePct: 2,
  /** Fiscal year runs July 1 to June 30; the lien date is January 1. */
  fiscalYearStartMonth: 7,
} as const;

export type ChangeOfOwnership = "sale" | "legal_entity_transfer" | "new_construction" | "none";

export type Prop13Input = {
  /** Price paid for real property. Exclude personal property, FF&E and business value (R&T §110). */
  purchasePrice: number;
  /** Personal property and other non-real-property value inside the price; excluded from the new base. */
  nonRealPropertyValue?: number;
  /** Current factored base-year assessed value (what the seller's roll shows). */
  currentAssessedValue: number;
  /** Close of escrow or transfer date. */
  eventDate: DateInput;
  changeOfOwnership?: ChangeOfOwnership;
  /** Total ad valorem rate, percent, when known (base + voter-approved debt). Overrides the default. */
  totalLevyRatePct?: number;
  /** Fixed-charge special assessments and Mello-Roos taxes per year; these are not reassessed. */
  specialAssessmentsAnnual?: number;
  /** Annual growth of the assessed value after the event, percent; capped at 2. Default 2. */
  annualIncreasePct?: number;
  projectionYears?: number;
  /** For a legal-entity transfer, the percentage of ownership that changed hands (0 to 100). */
  percentTransferred?: number;
};

export type Prop13Flag =
  | "no_reassessment"
  | "assessed_above_price"
  | "default_levy_rate_used"
  | "legal_entity_transfer_review"
  | "two_supplemental_bills"
  | "parent_child_exclusion_not_applicable";

export type SupplementalBill = { fiscalYear: string; months: number; amount: number };

export type Prop13Projection = { fiscalYear: string; assessedValue: number; annualTax: number };

export type Prop13Result = {
  reassessed: boolean;
  assessedValueBefore: number;
  assessedValueAfter: number;
  assessedValueIncrease: number;
  totalLevyRatePct: number;
  annualTaxBefore: number;
  /** Year-one tax on the new assessed value, special assessments included. */
  annualTaxAfter: number;
  annualTaxIncrease: number;
  /** One-time supplemental bills for the months between the event and the next regular roll. */
  supplementalBills: SupplementalBill[];
  supplementalTotal: number;
  projection: Prop13Projection[];
  flags: { code: Prop13Flag; message: string }[];
  assumptions: string[];
};

/** Fiscal year label ("2026-27") containing an ISO date. */
export function fiscalYearOf(iso: string): string {
  const y = yearOf(iso);
  const start = monthOf(iso) >= PROP13.fiscalYearStartMonth ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

function nextFiscalYear(label: string): string {
  const start = Number(label.slice(0, 4)) + 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/**
 * Whole months from the month after the event through June 30 of its fiscal
 * year (R&T §75.11: the supplemental assessment runs from the first day of
 * the month following the change in ownership).
 */
export function monthsRemainingInFiscalYear(iso: string): number {
  const m = monthOf(iso);
  // Months after the event month through June.
  return m >= PROP13.fiscalYearStartMonth ? 12 - m + 6 : 6 - m;
}

const toDollars = (n: number) => Math.round(n);

export function estimateReassessment(input: Prop13Input): Prop13Result {
  if (!(input.purchasePrice > 0)) throw new RangeError("purchasePrice must be positive");
  if (!(input.currentAssessedValue >= 0)) throw new RangeError("currentAssessedValue must not be negative");
  const eventDate = toIsoDate(input.eventDate);
  const change = input.changeOfOwnership ?? "sale";
  const flags: Prop13Result["flags"] = [];
  const assumptions: string[] = [];

  let levy = input.totalLevyRatePct;
  if (levy === undefined) {
    levy = PROP13.baseRatePct + PROP13.defaultVoterApprovedRatePct;
    flags.push({ code: "default_levy_rate_used", message: `Levy rate defaulted to ${round2(levy)}% (1% base + ${PROP13.defaultVoterApprovedRatePct}% voter-approved debt). Replace it with the tax rate area's total rate (VERIFY).` });
  }
  if (!(levy > 0 && levy < 5)) throw new RangeError("totalLevyRatePct must be between 0 and 5");
  const rate = levy / 100;
  const special = Math.max(input.specialAssessmentsAnnual ?? 0, 0);
  const growth = Math.min(Math.max(input.annualIncreasePct ?? PROP13.maxAnnualIncreasePct, 0), PROP13.maxAnnualIncreasePct) / 100;
  const years = Math.min(Math.max(Math.floor(input.projectionYears ?? 5), 1), 30);

  const before = input.currentAssessedValue;
  const newBase = Math.max(input.purchasePrice - (input.nonRealPropertyValue ?? 0), 0);

  let reassessedShare = 0;
  if (change === "sale" || change === "new_construction") reassessedShare = 1;
  else if (change === "legal_entity_transfer") {
    // A transfer of more than 50% of an entity's interests is a change in ownership of the whole (R&T §64(c)/(d)); smaller transfers can still reassess a proportional share.
    const pct = Math.min(Math.max(input.percentTransferred ?? 0, 0), 100);
    reassessedShare = pct > 50 ? 1 : pct / 100;
    flags.push({
      code: "legal_entity_transfer_review",
      message: "Legal-entity ownership transfers are tracked by the State Board of Equalization (BOE-100-B); cumulative and original-co-owner rules can change the result. Confirm with counsel or a tax advisor.",
    });
  } else {
    flags.push({ code: "no_reassessment", message: "No change in ownership: the assessed value grows only by the annual inflation factor." });
  }

  // New base = purchase price on the reassessed share; the rest keeps its old base.
  const after = reassessedShare === 0 ? before : Math.round(newBase * reassessedShare + before * (1 - reassessedShare));
  if (reassessedShare > 0 && before > newBase) {
    flags.push({ code: "assessed_above_price", message: "The current assessed value exceeds the purchase price; the new base is the (lower) price. Confirm there is no Prop 8 decline-in-value or appraisal dispute." });
  }
  flags.push({
    code: "parent_child_exclusion_not_applicable",
    message: "The parent-child and grandparent-grandchild exclusions (Prop 19) cover a family home and farms only, not commercial or multifamily investment property.",
  });

  const taxBefore = before * rate + special;
  const taxAfter = after * rate + special;

  // Supplemental assessment: the increase in assessed value, prorated from the month after the event to June 30.
  const supplementalBills: SupplementalBill[] = [];
  const delta = after - before;
  if (reassessedShare > 0 && delta > 0) {
    const fy = fiscalYearOf(eventDate);
    const month = monthOf(eventDate);
    const months = monthsRemainingInFiscalYear(eventDate);
    if (months > 0) supplementalBills.push({ fiscalYear: fy, months, amount: toDollars((delta * rate * months) / 12) });
    // The next roll's lien date is January 1. An event from January 1 through May 31 falls after it, so the next
    // fiscal year is still on the old value and a second supplemental covers it in full (R&T §75.11(b)). An event
    // in June starts its supplemental on July 1, which is already the next fiscal year.
    if (month <= 6) supplementalBills.push({ fiscalYear: nextFiscalYear(fy), months: 12, amount: toDollars(delta * rate) });
    if (month <= 5) flags.push({ code: "two_supplemental_bills", message: "An event between January 1 and May 31 produces two supplemental bills (current and following fiscal year)." });
  }
  const supplementalTotal = supplementalBills.reduce((s, b) => s + b.amount, 0);

  // Projection starts with the first full fiscal year after the event, taxed on the new value (regular or supplemental bill).
  const firstFy = nextFiscalYear(fiscalYearOf(eventDate));
  const projection: Prop13Projection[] = [];
  let fy = firstFy;
  let value = after;
  for (let i = 0; i < years; i++) {
    projection.push({ fiscalYear: fy, assessedValue: toDollars(value), annualTax: toDollars(value * rate + special) });
    value *= 1 + growth;
    fy = nextFiscalYear(fy);
  }

  assumptions.push(
    `Total ad valorem rate ${round2(levy)}% of assessed value`,
    `Assessed value grows ${round2(growth * 100)}% a year after reassessment (the Prop 13 maximum is ${PROP13.maxAnnualIncreasePct}%)`,
    "Special assessments and Mello-Roos taxes are added as flat annual charges and are not reassessed",
    "Supplemental bills are estimated from the assessed-value increase and are due in addition to the regular bill",
  );

  return {
    reassessed: reassessedShare > 0,
    assessedValueBefore: toDollars(before),
    assessedValueAfter: toDollars(after),
    assessedValueIncrease: toDollars(delta),
    totalLevyRatePct: round2(levy),
    annualTaxBefore: toDollars(taxBefore),
    annualTaxAfter: toDollars(taxAfter),
    annualTaxIncrease: toDollars(taxAfter - taxBefore),
    supplementalBills,
    supplementalTotal,
    projection,
    flags,
    assumptions,
  };
}
