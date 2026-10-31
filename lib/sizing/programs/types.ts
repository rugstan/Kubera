// Types for the program boxes added on top of the original three-tab sizer:
// hard money, ground-up construction, tiered agency, DSCR investor rentals,
// HUD 223(a)(7) and the bridge exit test.
//
// A SizerQuote is a ProgramQuote with a wider id and optional term-sheet
// detail, so every original quote is also a SizerQuote and the two can sit in
// one result list.

import type { FlagCode } from "@/lib/compliance/gates";
import type { Constraint } from "../finance";
import type { ProgramId, ProgramQuote, SizingResult } from "../types";

export type NewProgramId =
  | "HARD_MONEY"
  | "CONSTRUCTION_BANK"
  | "CONSTRUCTION_DEBT_FUND"
  | "CONSTRUCTION_PRIVATE"
  | "AGENCY_FANNIE_MAE"
  | "AGENCY_FREDDIE_MAC"
  | "DSCR_INVESTOR_2_4"
  | "DSCR_INVESTOR_5_PLUS"
  | "HUD_223A7";

export type SizerProgramId = ProgramId | NewProgramId;

export const NEW_PROGRAM_IDS = [
  "HARD_MONEY",
  "CONSTRUCTION_BANK",
  "CONSTRUCTION_DEBT_FUND",
  "CONSTRUCTION_PRIVATE",
  "AGENCY_FANNIE_MAE",
  "AGENCY_FREDDIE_MAC",
  "DSCR_INVESTOR_2_4",
  "DSCR_INVESTOR_5_PLUS",
  "HUD_223A7",
] as const satisfies readonly NewProgramId[];

/** Constraints the new boxes can bind on, beyond the original set. */
export type SizerConstraint =
  | Constraint
  /** Loan to after-repair value (hard money). */
  | "LTARV"
  /** As-completed / as-stabilized value (construction). */
  | "AS_COMPLETED_LTV"
  /** Initial advance and rehab holdback limits (hard money). */
  | "ADVANCE"
  /** HUD 223(a)(7): original principal amount of the insured loan. */
  | "ORIGINAL_PRINCIPAL"
  /** HUD 223(a)(7): unpaid balance plus eligible transaction costs. */
  | "REFINANCE_BASIS"
  /** HUD 223(a)(7): new debt service may not exceed the existing debt service. */
  | "DEBT_SERVICE_TEST";

/** One labelled line of an indicative term sheet. */
export type TermLine = { label: string; value: string };

export type StackLayerKind = "SENIOR" | "C_PACE" | "MEZZANINE" | "PREFERRED_EQUITY" | "COMMON_EQUITY";

export type StackLayer = {
  kind: StackLayerKind;
  label: string;
  amount: number;
  /** Share of total project cost. */
  pctOfCost: number;
  /** Cumulative share of cost through this layer (senior first). */
  cumulativePct: number;
  /** Indicative annual cost of the layer (interest, assessment rate or preferred return), percent. */
  costPct: number | null;
  /** Compliance flags the layer raises (e.g. an equity-pledge mezzanine loan). */
  flags: FlagCode[];
};

export type CapitalStack = { totalCost: number; layers: StackLayer[] };

export type ExitResult = "PASS" | "MARGINAL" | "FAIL";

/** Whether a short-term loan can be refinanced or sold out of at the end of its term. */
export type ExitTest = {
  kind: "BRIDGE_REFINANCE" | "CONSTRUCTION_TAKEOUT" | "DSCR_REFINANCE" | "SALE";
  label: string;
  result: ExitResult;
  /** Balance the exit must retire. */
  payoff: number;
  /** Proceeds the exit produces (refinance loan or net sale proceeds). */
  proceeds: number;
  /** Payoff minus proceeds when positive: cash the sponsor must bring to exit. */
  shortfall: number;
  lines: TermLine[];
};

export type SizerQuote = Omit<ProgramQuote, "id" | "binding"> & {
  id: SizerProgramId;
  binding: SizerConstraint;
  /** Short-term loans spread closing costs over their own term when ranking cost of funds (default 10 years). */
  horizonYears?: number;
  /** Interim structures are chosen only when no permanent program covers the request. */
  interim?: boolean;
  terms?: TermLine[];
  stack?: CapitalStack;
  exit?: ExitTest;
};

export type SizerResult = Omit<SizingResult, "quotes" | "bestFit"> & {
  quotes: SizerQuote[];
  bestFit: SizerProgramId | null;
};
