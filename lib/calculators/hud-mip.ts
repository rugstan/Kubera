// HUD mortgage insurance premium (MIP) calculator. Rates come from
// lib/sizing/assumptions.ts (the same figures the sizer uses), so a change
// there moves the calculator, the sizer and the program pages together.
//
// HUD charges the annual premium on the average outstanding principal balance
// for the year, so the premium falls as the loan amortizes. Year one is the
// highest. The calculator follows that convention; a lender's closing
// statement is the final word.

import { ASSUMPTIONS_REVIEWED, HUD } from "@/lib/sizing/assumptions";
import { monthlyPayment } from "@/lib/sizing/finance";
import { requirePositive, requireRange, type CalcOutcome, type FieldErrors } from "./format";

export const HUD_MIP_PROGRAM_IDS = ["223f", "221d4", "232-refinance", "232-new-construction"] as const;
export type HudMipProgramId = (typeof HUD_MIP_PROGRAM_IDS)[number];

export type HudMipProgram = {
  id: HudMipProgramId;
  label: string;
  family: "multifamily" | "senior-living";
  /** Longest amortization the program allows. */
  termYears: number;
  annualMip: number;
  upfrontMip: number;
  source: string;
  /** Rates that rest on a notice or handbook the capital markets desk should re-check. */
  verify: boolean;
};

const MF = HUD.multifamily;
const MF_SOURCE = "Federal Register 2025-18379 (Sept 23, 2025): flat annual MIP for FHA multifamily applications on or after 2025-10-01";
const S232_SOURCE = "HUD Handbook 4232.1 and prior MIP schedule; the 0.25% notice has not been confirmed for Section 232";

export const HUD_MIP_PROGRAMS: readonly HudMipProgram[] = [
  { id: "223f", label: "223(f) multifamily purchase or refinance", family: "multifamily", termYears: MF.s223f.termYears, annualMip: MF.mip.annual, upfrontMip: MF.mip.upfront, source: MF_SOURCE, verify: true },
  { id: "221d4", label: "221(d)(4) multifamily new construction or substantial rehab", family: "multifamily", termYears: MF.s221d4.termYears, annualMip: MF.mip.annual, upfrontMip: MF.mip.upfront, source: MF_SOURCE, verify: true },
  { id: "232-refinance", label: "Section 232 senior housing refinance or purchase", family: "senior-living", termYears: HUD.section232.refi.termYears, annualMip: HUD.section232.refi.annualMip, upfrontMip: HUD.section232.refi.upfrontMip, source: S232_SOURCE, verify: true },
  { id: "232-new-construction", label: "Section 232 senior housing new construction", family: "senior-living", termYears: HUD.section232.newConstruction.termYears, annualMip: HUD.section232.newConstruction.annualMip, upfrontMip: HUD.section232.newConstruction.upfrontMip, source: S232_SOURCE, verify: true },
];

export function hudMipProgram(id: HudMipProgramId): HudMipProgram {
  const program = HUD_MIP_PROGRAMS.find((p) => p.id === id);
  if (!program) throw new RangeError(`unknown HUD MIP program: ${id}`);
  return program;
}

export type HudMipInputs = {
  loanAmount: number;
  program: HudMipProgramId;
  /** Note rate in percentage points. */
  ratePct: number;
  /** Amortization in years; defaults to the program's term. */
  termYears?: number;
  /** Net operating income, optional; adds coverage with and without the premium. */
  noi?: number;
};

export type MipYear = { year: number; averageBalance: number; mip: number };

export type HudMipResult = {
  program: HudMipProgram;
  termYears: number;
  annualMipRate: number;
  upfrontMip: number;
  /** Premium in the first year, charged on the average balance that year. */
  yearOneMip: number;
  yearOneMonthlyMip: number;
  monthlyPrincipalInterest: number;
  /** Principal, interest and the year-one premium, per month. */
  monthlyPaymentWithMip: number;
  schedule: MipYear[];
  /** Premiums over the first ten years (or the full term if shorter). */
  tenYearMip: number;
  totalMip: number;
  /** MIP as extra percentage points on the note rate, in year one. */
  mipAsRatePoints: number;
  allInRatePct: number;
  dscrBeforeMip?: number;
  dscrWithMip?: number;
  asOf: string;
  /** Green certification no longer lowers HUD MIP. */
  greenLowersMip: boolean;
};

export type HudMipField = "loanAmount" | "program" | "ratePct" | "termYears" | "noi";

export function calcHudMip(i: HudMipInputs): CalcOutcome<HudMipResult, HudMipField> {
  const errors: FieldErrors<HudMipField> = {};
  const program = HUD_MIP_PROGRAMS.find((p) => p.id === i.program);
  if (!program) errors.program = "Choose a HUD program.";
  requirePositive(errors, "loanAmount", i.loanAmount, "Loan amount");
  requireRange(errors, "ratePct", i.ratePct, 0.1, 25, "Interest rate", "%");
  if (program && i.termYears !== undefined) requireRange(errors, "termYears", i.termYears, 1, program.termYears, "Term", " years");
  if (i.noi !== undefined && !(i.noi > 0)) errors.noi = "Net operating income must be greater than zero, or left blank.";
  if (!program || Object.keys(errors).length > 0) return { ok: false, errors };

  const termYears = i.termYears ?? program.termYears;
  const months = termYears * 12;
  const monthlyRate = i.ratePct / 100 / 12;
  const payment = monthlyPayment(i.loanAmount, i.ratePct, termYears);

  const schedule: MipYear[] = [];
  let balance = i.loanAmount;
  for (let year = 1; year <= termYears; year++) {
    let balanceSum = 0;
    for (let m = 0; m < 12 && (year - 1) * 12 + m < months; m++) {
      balanceSum += balance;
      balance = Math.max(0, balance * (1 + monthlyRate) - payment);
    }
    const averageBalance = balanceSum / 12;
    schedule.push({ year, averageBalance, mip: averageBalance * program.annualMip });
  }

  const yearOneMip = schedule[0]!.mip;
  const annualPi = payment * 12;
  const tenYearMip = schedule.slice(0, 10).reduce((s, y) => s + y.mip, 0);
  return {
    ok: true,
    result: {
      program,
      termYears,
      annualMipRate: program.annualMip,
      upfrontMip: i.loanAmount * program.upfrontMip,
      yearOneMip,
      yearOneMonthlyMip: yearOneMip / 12,
      monthlyPrincipalInterest: payment,
      monthlyPaymentWithMip: payment + yearOneMip / 12,
      schedule,
      tenYearMip,
      totalMip: schedule.reduce((s, y) => s + y.mip, 0),
      mipAsRatePoints: (yearOneMip / i.loanAmount) * 100,
      allInRatePct: i.ratePct + (yearOneMip / i.loanAmount) * 100,
      dscrBeforeMip: i.noi ? i.noi / annualPi : undefined,
      dscrWithMip: i.noi ? i.noi / (annualPi + yearOneMip) : undefined,
      asOf: ASSUMPTIONS_REVIEWED,
      greenLowersMip: HUD.greenLowersMip,
    },
  };
}
