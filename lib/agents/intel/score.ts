// Refinance-maturity prospect scoring (WS-S).
//
// Pure and explainable: six factors, each with its own points, a ceiling and
// a one-line reason a broker can read. The total is 0 to 100. The score ranks
// who to look at first; it says nothing about whether a lender would approve
// anything, and no copy that reaches a property owner mentions it.
//
//   Maturity timing   35  the sweet spot is 6 to 12 months out: enough time
//                         for HUD or agency execution, not so far that the
//                         owner is not thinking about it
//   Loan size         15  broker-sized deals; very large loans go to an
//                         institutional channel
//   Property fit      20  property types Kubera's programs are built for
//   Geography         10  Kubera is a California DRE broker
//   Rate pressure     12  distance between the recorded note rate and today's
//                         market (payment shock or savings both create motion)
//   Loan vintage       8  5 to 10 year balloons and bridge terms are the
//                         typical refinance candidates
//
// Thresholds are starting points (VERIFY with the desk after the first
// scans). The recommended program is a heuristic starting point for the
// advisor, not an eligibility finding.

import type { MaturityRecord, ProspectProgram, PropertyType, ScoreFactor, WindowBucket } from "./types";

export type ScoreContext = {
  now: Date;
  /** Current market note rate for stabilized commercial debt, in percent (VERIFY: configurable, PROSPECT_MARKET_RATE_PCT). */
  marketRatePct: number;
};

export const DEFAULT_MARKET_RATE_PCT = 6.25;

export type ScoreResult = { score: number; factors: ScoreFactor[]; program: ProspectProgram; windowBucket: WindowBucket; monthsToMaturity: number };

const DAY_MS = 86_400_000;

/** Months from `now` to an ISO date (negative when past). */
export function monthsUntil(isoDate: string, now: Date): number {
  const t = Date.parse(`${isoDate.slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(t)) return Number.NaN;
  return (t - now.getTime()) / (DAY_MS * 30.4375);
}

export function windowBucket(months: number): WindowBucket {
  if (months < 0) return "matured";
  if (months < 3) return "under_3_months";
  if (months < 6) return "months_3_6";
  if (months < 12) return "months_6_12";
  if (months < 18) return "months_12_18";
  return "later";
}

const fmtMonths = (m: number) => `${Math.abs(m).toFixed(1)} months`;

function timingFactor(months: number): ScoreFactor {
  const max = 35;
  let points: number;
  let detail: string;
  if (months < -12) {
    points = 6;
    detail = `Stated maturity passed ${fmtMonths(months)} ago; the record may be stale or the loan already refinanced`;
  } else if (months < 0) {
    points = 22;
    detail = `Stated maturity passed ${fmtMonths(months)} ago; the loan may be extended or in forbearance`;
  } else if (months < 3) {
    points = 24;
    detail = `Matures in ${fmtMonths(months)}; options are limited by time`;
  } else if (months < 6) {
    points = 32;
    detail = `Matures in ${fmtMonths(months)}; enough time for most programs`;
  } else if (months < 12) {
    points = 35;
    detail = `Matures in ${fmtMonths(months)}; the best window to plan a refinance`;
  } else if (months < 18) {
    points = 26;
    detail = `Matures in ${fmtMonths(months)}; early, but owners start planning here`;
  } else if (months < 24) {
    points = 12;
    detail = `Matures in ${fmtMonths(months)}; still early`;
  } else {
    points = 4;
    detail = `Matures in ${fmtMonths(months)}; too far out to prioritize`;
  }
  return { factor: "Maturity timing", points, max, detail };
}

function sizeFactor(amount: number | null): ScoreFactor {
  const max = 15;
  const m = (n: number) => `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (amount === null) return { factor: "Loan size", points: 4, max, detail: "Original loan amount not in the record" };
  if (amount < 1_000_000) return { factor: "Loan size", points: 2, max, detail: `Original loan ${m(amount)} is below the usual broker minimum` };
  if (amount < 2_000_000) return { factor: "Loan size", points: 6, max, detail: `Original loan ${m(amount)}; small, most programs have minimums` };
  if (amount < 5_000_000) return { factor: "Loan size", points: 11, max, detail: `Original loan ${m(amount)}` };
  if (amount <= 25_000_000) return { factor: "Loan size", points: 15, max, detail: `Original loan ${m(amount)}; the core range` };
  if (amount <= 75_000_000) return { factor: "Loan size", points: 12, max, detail: `Original loan ${m(amount)}; large, fewer lenders` };
  return { factor: "Loan size", points: 7, max, detail: `Original loan ${m(amount)}; institutional size` };
}

function typeFactor(r: Pick<MaturityRecord, "propertyType" | "units">): ScoreFactor {
  const max = 20;
  const t = r.propertyType;
  if (t === "multifamily") {
    if (r.units !== null && r.units < 5) return { factor: "Property fit", points: 3, max, detail: `${r.units}-unit residential income property; commercial programs start at 5 units` };
    return { factor: "Property fit", points: 20, max, detail: `Multifamily${r.units ? `, ${r.units} units` : ""}: HUD 223(f) and agency programs` };
  }
  if (t === "senior_housing") return { factor: "Property fit", points: 20, max, detail: "Senior housing or healthcare: HUD 232 programs" };
  if (t === "hotel") return { factor: "Property fit", points: 18, max, detail: "Hotel: SBA 504 or CMBS execution" };
  if (t === "industrial" || t === "special_purpose" || t === "self_storage") return { factor: "Property fit", points: 14, max, detail: `${t.replace("_", " ")}: SBA 504 or bank execution` };
  if (t === "retail" || t === "office" || t === "mixed_use") return { factor: "Property fit", points: 11, max, detail: `${t.replace("_", " ")}: bank, life company or SBA 504 if owner-occupied` };
  return { factor: "Property fit", points: 5, max, detail: "Property type unclear from the record" };
}

function geographyFactor(state: string | null): ScoreFactor {
  const max = 10;
  if (state === "CA") return { factor: "Geography", points: 10, max, detail: "California property" };
  if (!state) return { factor: "Geography", points: 4, max, detail: "State not in the record" };
  return { factor: "Geography", points: 0, max, detail: `${state}: outside California, licensing review needed before any outreach` };
}

function rateFactor(ratePct: number | null, marketPct: number): ScoreFactor {
  const max = 12;
  if (ratePct === null) return { factor: "Rate pressure", points: 4, max, detail: "Note rate not in the record" };
  const gap = marketPct - ratePct;
  if (gap >= 2) return { factor: "Rate pressure", points: 12, max, detail: `Recorded rate ${ratePct.toFixed(2)}% is ${gap.toFixed(1)} points under the ${marketPct.toFixed(2)}% market assumption; a refinance means a payment step-up` };
  if (gap >= 1) return { factor: "Rate pressure", points: 9, max, detail: `Recorded rate ${ratePct.toFixed(2)}% is ${gap.toFixed(1)} points under the ${marketPct.toFixed(2)}% market assumption` };
  if (gap > -1) return { factor: "Rate pressure", points: 5, max, detail: `Recorded rate ${ratePct.toFixed(2)}% is close to the ${marketPct.toFixed(2)}% market assumption` };
  return { factor: "Rate pressure", points: 10, max, detail: `Recorded rate ${ratePct.toFixed(2)}% is ${Math.abs(gap).toFixed(1)} points over the ${marketPct.toFixed(2)}% market assumption; a refinance could lower the rate` };
}

function vintageFactor(origination: string | null, maturity: string): ScoreFactor {
  const max = 8;
  if (!origination) return { factor: "Loan vintage", points: 3, max, detail: "Origination date not in the record" };
  const years = (Date.parse(maturity) - Date.parse(origination)) / (DAY_MS * 365.25);
  if (!Number.isFinite(years) || years <= 0) return { factor: "Loan vintage", points: 3, max, detail: "Origination and maturity dates do not make a term" };
  if (years < 4) return { factor: "Loan vintage", points: 7, max, detail: `${years.toFixed(1)}-year term: short bridge-style loan that needs a take-out` };
  if (years <= 10.5) return { factor: "Loan vintage", points: 8, max, detail: `${years.toFixed(1)}-year term: a typical balloon refinance candidate` };
  return { factor: "Loan vintage", points: 4, max, detail: `${years.toFixed(1)}-year term: long-dated loan` };
}

/** A starting point for the advisor's conversation, not an eligibility finding (VERIFY thresholds with the desk). */
export function recommendProgram(r: Pick<MaturityRecord, "propertyType" | "units" | "loan" | "address">, months: number): ProspectProgram {
  const amount = r.loan.originalAmount;
  if (r.address.state && r.address.state !== "CA") return "other";
  if (months < 3) return "bridge";
  const t: PropertyType = r.propertyType;
  if (t === "multifamily") {
    if (r.units !== null && r.units < 5) return "bank_life_co";
    if (amount !== null && amount < 1_000_000) return "bank_life_co";
    return months >= 6 ? "hud_223f" : "agency";
  }
  if (t === "senior_housing") return months >= 6 ? "hud_232" : "bridge";
  if (t === "hotel") return amount !== null && amount >= 15_000_000 ? "hotel_cmbs" : "sba_504";
  if (t === "industrial" || t === "special_purpose" || t === "self_storage") return "sba_504";
  if (t === "retail" || t === "office" || t === "mixed_use") return "bank_life_co";
  return "other";
}

export function scoreProspect(r: MaturityRecord, ctx: ScoreContext): ScoreResult {
  const months = monthsUntil(r.loan.maturityDate, ctx.now);
  if (Number.isNaN(months)) throw new Error(`Unreadable maturity date: ${r.loan.maturityDate}`);
  const factors = [
    timingFactor(months),
    sizeFactor(r.loan.originalAmount),
    typeFactor(r),
    geographyFactor(r.address.state),
    rateFactor(r.loan.ratePct, ctx.marketRatePct),
    vintageFactor(r.loan.originationDate, r.loan.maturityDate),
  ];
  const total = factors.reduce((s, f) => s + f.points, 0);
  return {
    score: Math.max(0, Math.min(100, Math.round(total))),
    factors,
    program: recommendProgram(r, months),
    windowBucket: windowBucket(months),
    monthsToMaturity: Math.round(months * 10) / 10,
  };
}
