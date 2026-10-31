// Market ranges shown on the program pages as "typical ranges" with a re-check
// flag. Where the sizer's program boxes (`lib/sizing/programs/assumptions.ts`)
// hold the same figure, the range is derived from there so the pages and the
// sizer cannot drift. The rest (points, extension fees and stabilized-bridge
// leverage, where the market range is wider than Kubera's sizing grid; bank,
// debt-fund and private construction ranges; HUD timing and California rent
// rules) come from Kubera's market research notes and vary by lender and cycle.
//
// This is the one content file allowed to hold literal percentages.

import { AGENCY_GRID, BRIDGE_EXIT, HARD_MONEY as HM, PROGRAM_ASSUMPTIONS_REVIEWED } from "@/lib/sizing/programs/assumptions";

export const MARKET_AS_OF = PROGRAM_ASSUMPTIONS_REVIEWED;

/** Trims trailing zeros: num(9.50) -> "9.5". */
const num = (n: number) => String(Number(n.toFixed(2)));
/** Percent from a fraction: pctOf(0.095) -> "9.5%". */
const pctOf = (n: number) => `${num(n * 100)}%`;
const span = (values: readonly number[]) => [Math.min(...values), Math.max(...values)] as const;
const percentRange = (values: readonly number[], fraction = true) => {
  const [lo, hi] = span(values).map((v) => (fraction ? v * 100 : v));
  return lo === hi ? `${num(lo!)}%` : `${num(lo!)}%–${num(hi!)}%`;
};
const millions = (n: number) => `$${num(n / 1_000_000)}M`;

const hmRows = [...Object.values(HM.grid.FIX_AND_FLIP), ...Object.values(HM.grid.BRIDGE)];
const flipRows = Object.values(HM.grid.FIX_AND_FLIP);
const [minInterestLo, minInterestHi] = span(hmRows.map((r) => r.minInterestMonths));
const [fannieTermLo, fannieTermHi] = span(AGENCY_GRID.fannie.terms);
const agencyTop = AGENCY_GRID.tiers.TIER_2;

export const HARD_MONEY = {
  rate: percentRange(hmRows.map((r) => r.ratePct), false),
  points: "1–4 points",
  fixFlipLeverage: `${percentRange(flipRows.map((r) => r.maxLtarv))} of as-is value or after-repair value (LTARV)`,
  stabilizedBridgeLeverage: "up to 80%–85% of value on a stabilized property",
  term: `${HM.minTermMonths}–${HM.maxTermMonths} months, interest-only`,
  extensionFee: "0.5%–2% per extension",
  minimumInterest: `${minInterestLo}–${minInterestHi} months of interest`,
  exitFee: percentRange(hmRows.map((r) => r.exitFeePct)),
  defaultRate: `up to ${num(HM.defaultRatePct)}%`,
} as const;

export const CONSTRUCTION_MARKET = {
  bank: { ltc: "60%–65% of cost", pricing: "SOFR + 2.75%–3.50%" },
  debtFund: { ltc: "65%–75% of cost", pricing: "SOFR + 4.25%–5.25%" },
  privateLender: { ltc: "85%–90% of cost", cap: "capped at 70%–75% of as-completed value" },
} as const;

export const AGENCY_MARKET = {
  fannieSmall: `Fannie Mae Small Loans: up to ${millions(AGENCY_GRID.fannie.smallLoanMax)}, ${pctOf(agencyTop.maxLtv)} LTV, ${agencyTop.minDscr.toFixed(2)}x DSCR, ${AGENCY_GRID.amortYears}-year amortization, terms of ${fannieTermLo}–${fannieTermHi} years`,
  freddieSmall: `Freddie Mac Conventional Small Balance: roughly ${millions(AGENCY_GRID.freddie.smallMin)}–${millions(AGENCY_GRID.freddie.smallMax)}, ${pctOf(agencyTop.maxLtv)} LTV, ${agencyTop.minDscr.toFixed(2)}x DSCR`,
  freddieSblRetired: "Freddie Mac's SBL program was reportedly retired on 2026-04-15",
  realDeals: "Closed agency deals have averaged about 63% LTV and 1.43x DSCR, so DSCR usually binds before LTV",
} as const;

export const BRIDGE_EXIT_TEST = {
  debtYield: `${pctOf(BRIDGE_EXIT.minDebtYield)}–${pctOf(BRIDGE_EXIT.strongDebtYield)}`,
  dscr: `${BRIDGE_EXIT.minDscr.toFixed(2)}x`,
} as const;

export const HUD_TIMING = {
  processing: "120–180 days",
} as const;

export const CA_RENT_RULES = {
  ab1482: "California's AB 1482 caps annual rent increases at 5% plus regional CPI, up to 10%, with a rolling 15-year exemption for new construction",
  la: "City of Los Angeles RSO units follow a separate 3% cap for July 2026 through June 2027",
} as const;
