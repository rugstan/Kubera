// Bridge exit test: three hand-built cases on a $10M payoff, then the
// multifamily-tab integration on the private bridge quote.

import { describe, expect, it } from "vitest";
import { BRIDGE_EXIT } from "./assumptions";
import { bridgeExitCopy, bridgeExitTest } from "./bridgeExit";
import { sizeMultifamilyPlus } from "./multifamily";
import { TEST_RATES as rates, quoteOf } from "./test-helpers";

describe("bridge exit term sheets", () => {
  it("1 — passes at an 11% stabilized debt yield", () => {
    // 1,100,000 / 10,000,000 = 11.0% ≥ 10.5%; DSCR 1.1M / (10M × constant(5.90%, 30)) = 1.545x.
    const t = bridgeExitTest({ payoff: 10_000_000, stabilizedNoi: 1_100_000, takeoutRatePct: 5.9 });
    expect(t.result).toBe("PASS");
    expect(t.debtYield).toBeCloseTo(0.11, 10);
    expect(t.dscr).toBeCloseTo(1.54546, 4);
    expect(t.shortfall).toBe(0);
  });

  it("2 — is marginal at a 10% debt yield even with strong coverage", () => {
    // 10.0% sits inside the 9.5–10.5% band; DSCR 1.405x clears 1.25x.
    const t = bridgeExitTest({ payoff: 10_000_000, stabilizedNoi: 1_000_000, takeoutRatePct: 5.9 });
    expect(t.result).toBe("MARGINAL");
    expect(t.dscr).toBeCloseTo(1.40496, 4);
    expect(bridgeExitCopy(t).warnings[0]).toMatch(/marginal/);
  });

  it("3 — fails at 9% and sizes the paydown", () => {
    // Max payoff at the 9.5% minimum: min(900,000 / 0.095, 900,000 / 1.25 / constant(6.50%, 30)) = 9,473,684.21.
    const t = bridgeExitTest({ payoff: 10_000_000, stabilizedNoi: 900_000, takeoutRatePct: 6.5 });
    expect(t.result).toBe("FAIL");
    expect(t.debtYield).toBeCloseTo(0.09, 10);
    expect(t.dscr).toBeCloseTo(1.18658, 4);
    expect(t.maxPayoffMarginal).toBeCloseTo(9_473_684.21, 1);
    expect(t.maxPayoffPass).toBeCloseTo(8_571_428.57, 1);
    expect(t.shortfall).toBeCloseTo(526_315.79, 1);
    expect(bridgeExitCopy(t).warnings[0]).toMatch(/Exit test fails/);
  });

  it("uses the researched thresholds", () => {
    expect(BRIDGE_EXIT).toMatchObject({ minDebtYield: 0.095, strongDebtYield: 0.105, minDscr: 1.25 });
  });
});

describe("bridge exit on the multifamily tab", () => {
  it("attaches the exit test to the private bridge quote, on stabilized NOI when given", () => {
    const r = sizeMultifamilyPlus(
      {
        assetType: "MULTIFAMILY",
        units: 60,
        sqft: 0,
        loanAmount: 9_000_000,
        noi: 600_000,
        stabilizedNoi: 1_050_000,
        value: 12_000_000,
        transaction: "PURCHASE",
        affordable: false,
        green: false,
        agencyTermYears: 10,
        agencyIoYears: 0,
        fico: 740,
      },
      rates,
    );
    const bridge = quoteOf(r, "WHITE_LABEL_CRE_BRIDGE");
    // Bridge 75% LTV = 9.0M; in-place debt yield cap 600,000 / 7% = 8,571,428 → 8,571,000.
    expect(bridge.loanAmount).toBe(8_571_000);
    expect(bridge.exit?.kind).toBe("BRIDGE_REFINANCE");
    // 1,050,000 / 8,571,000 = 12.25% → passes.
    expect(bridge.exit?.result).toBe("PASS");
    expect(bridge.notes.some((n) => /Exit test passes/.test(n))).toBe(true);
  });
});
