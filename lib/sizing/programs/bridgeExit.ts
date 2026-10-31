// Bridge exit test: can a bridge (or hard money bridge) loan be refinanced
// out of at stabilization? Lenders size the exit on stabilized debt yield
// (9.5–10.5%) and 1.25x coverage on the take-out loan's constant.

import { debtConstant } from "../finance";
import { BRIDGE_EXIT } from "./assumptions";
import { fmt } from "./quote";
import type { ExitTest } from "./types";

export type BridgeExitInputs = {
  /** Balance the take-out must retire (the bridge commitment). */
  payoff: number;
  stabilizedNoi: number;
  /** Take-out (permanent) note rate, percent. */
  takeoutRatePct: number;
  takeoutAmortYears?: number;
};

export type BridgeExitResult = ExitTest & {
  debtYield: number;
  dscr: number;
  /** Largest payoff that still passes the strong (10.5%) debt-yield and DSCR tests. */
  maxPayoffPass: number;
  /** Largest payoff that clears the minimum (9.5%) debt yield and DSCR. */
  maxPayoffMarginal: number;
};

export function bridgeExitTest(i: BridgeExitInputs): BridgeExitResult {
  const amort = i.takeoutAmortYears ?? BRIDGE_EXIT.amortYears;
  const constant = debtConstant(i.takeoutRatePct, amort);
  const debtYield = i.payoff > 0 ? i.stabilizedNoi / i.payoff : 0;
  const dscr = i.payoff > 0 ? i.stabilizedNoi / (i.payoff * constant) : 0;
  const dscrMax = i.stabilizedNoi / BRIDGE_EXIT.minDscr / constant;
  const maxPayoffPass = Math.max(0, Math.min(i.stabilizedNoi / BRIDGE_EXIT.strongDebtYield, dscrMax));
  const maxPayoffMarginal = Math.max(0, Math.min(i.stabilizedNoi / BRIDGE_EXIT.minDebtYield, dscrMax));
  // Compare with a cent of tolerance so a payoff sized exactly at a limit passes it.
  const result =
    i.payoff <= maxPayoffPass + 0.01 ? "PASS" : i.payoff <= maxPayoffMarginal + 0.01 ? "MARGINAL" : "FAIL";
  const proceeds = result === "FAIL" ? maxPayoffMarginal : i.payoff;
  return {
    kind: "BRIDGE_REFINANCE",
    label: "Bridge exit test",
    result,
    payoff: i.payoff,
    proceeds,
    shortfall: Math.max(0, i.payoff - maxPayoffMarginal),
    debtYield,
    dscr,
    maxPayoffPass,
    maxPayoffMarginal,
    lines: [
      { label: "Stabilized debt yield", value: `${fmt.pct(debtYield, 2)} (needs ${fmt.pct(BRIDGE_EXIT.minDebtYield)}–${fmt.pct(BRIDGE_EXIT.strongDebtYield)})` },
      { label: "Take-out DSCR", value: `${fmt.ratio(dscr)} at ${i.takeoutRatePct.toFixed(2)}%, ${amort}-yr amortization (needs ${fmt.ratio(BRIDGE_EXIT.minDscr)})` },
      { label: "Largest payoff that exits cleanly", value: fmt.money(maxPayoffPass) },
    ],
  };
}

/** Plain-language notes for a quote carrying an exit test. */
export function bridgeExitCopy(t: BridgeExitResult): { notes: string[]; warnings: string[] } {
  if (t.result === "PASS") return { notes: [`Exit test passes: ${fmt.pct(t.debtYield, 1)} stabilized debt yield, ${fmt.ratio(t.dscr)} on the take-out.`], warnings: [] };
  if (t.result === "MARGINAL")
    return { notes: [], warnings: [`Exit test is marginal: ${fmt.pct(t.debtYield, 1)} stabilized debt yield is inside the 9.5–10.5% band take-out lenders look for.`] };
  return {
    notes: [],
    warnings: [`Exit test fails: a take-out sized on stabilized NOI retires about ${fmt.money(t.maxPayoffMarginal)}, leaving a ${fmt.money(t.shortfall)} paydown at refinance.`],
  };
}
