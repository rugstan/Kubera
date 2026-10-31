// Market ranges that are not (yet) in `lib/sizing/assumptions.ts`: private-lender
// and construction pricing, the agency small-balance grids and the bridge exit
// test. They come from Kubera's market research notes, vary by lender and cycle,
// and are shown as "typical ranges" with a re-check flag. When the new-program
// sizing workstream moves any of them into `assumptions.ts`, import from there
// and delete the copy here.
//
// This is the one content file allowed to hold literal percentages.

export const MARKET_AS_OF = "2026-10-31";

export const HARD_MONEY = {
  rate: "9.5%–12.5%",
  points: "1–4 points",
  fixFlipLeverage: "65%–75% of as-is value or after-repair value (LTARV)",
  stabilizedBridgeLeverage: "up to 80%–85% of value on a stabilized property",
  term: "6–36 months, interest-only",
  extensionFee: "0.5%–2% per extension",
  minimumInterest: "3–6 months of interest",
  exitFee: "0.5%–1%",
  defaultRate: "up to 24%",
} as const;

export const CONSTRUCTION_MARKET = {
  bank: { ltc: "60%–65% of cost", pricing: "SOFR + 2.75%–3.50%" },
  debtFund: { ltc: "65%–75% of cost", pricing: "SOFR + 4.25%–5.25%" },
  privateLender: { ltc: "85%–90% of cost", cap: "capped at 70%–75% of as-completed value" },
} as const;

export const AGENCY_MARKET = {
  fannieSmall: "Fannie Mae Small Loans: up to $9M, 80% LTV, 1.25x DSCR, 30-year amortization, terms of 5–30 years",
  freddieSmall: "Freddie Mac Conventional Small Balance: roughly $2M–$10M, 80% LTV, 1.25x DSCR",
  freddieSblRetired: "Freddie Mac's SBL program was reportedly retired on 2026-04-15",
  realDeals: "Closed agency deals have averaged about 63% LTV and 1.43x DSCR, so DSCR usually binds before LTV",
} as const;

export const BRIDGE_EXIT_TEST = {
  debtYield: "9.5%–10.5%",
  dscr: "1.25x",
} as const;

export const HUD_TIMING = {
  processing: "120–180 days",
} as const;

export const CA_RENT_RULES = {
  ab1482: "California's AB 1482 caps annual rent increases at 5% plus regional CPI, up to 10%, with a rolling 15-year exemption for new construction",
  la: "City of Los Angeles RSO units follow a separate 3% cap for July 2026 through June 2027",
} as const;
