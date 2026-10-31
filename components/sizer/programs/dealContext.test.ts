import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { dealContextSchema } from "@/lib/ai/advisor";
import { FALLBACK_BENCHMARKS as rates } from "@/lib/sizing/assumptions";
import { sizeConstruction } from "@/lib/sizing/programs/construction";
import { sizeHardMoney } from "@/lib/sizing/programs/hardMoney";
import { sizeMultifamilyPlus } from "@/lib/sizing/programs/multifamily";
import { buildDealContext, flatInputs } from "./dealContext";
import { CONSTRUCTION_DEFAULT, CREDIT_BANDS, EXISTING_HUD_DEFAULT, HARD_MONEY_DEFAULT, MULTIFAMILY_DEFAULT, bandFor } from "./defaults";

describe("sizer deal context", () => {
  it("flattens nested inputs and drops what the advisor would reject", () => {
    const flat = flatInputs({ a: 1, b: undefined, c: { d: 2, e: { deep: true } }, "bad key": 3, s: "x".repeat(300), n: Number.NaN, list: [1, 2] });
    expect(flat).toEqual({ a: 1, c_d: 2, s: "x".repeat(120) });
  });

  it("produces a context the advisor accepts for every new tab", () => {
    const cases = [
      { vertical: "Hard money", inputs: HARD_MONEY_DEFAULT, result: sizeHardMoney(HARD_MONEY_DEFAULT, rates) },
      { vertical: "Construction", inputs: { ...CONSTRUCTION_DEFAULT, mezzTargetLtc: 0.8, cpaceAmount: 1_000_000 }, result: sizeConstruction({ ...CONSTRUCTION_DEFAULT, mezzTargetLtc: 0.8, cpaceAmount: 1_000_000 }, rates) },
      {
        vertical: "Multifamily & CRE",
        inputs: { ...MULTIFAMILY_DEFAULT, existingHud: EXISTING_HUD_DEFAULT },
        result: sizeMultifamilyPlus({ ...MULTIFAMILY_DEFAULT, existingHud: EXISTING_HUD_DEFAULT }, rates, { hud223a7: true }),
      },
    ];
    for (const c of cases) {
      const ctx = JSON.parse(buildDealContext({ ...c, benchmarks: rates }));
      const parsed = dealContextSchema.safeParse(ctx);
      expect(parsed.success, c.vertical).toBe(true);
      expect(ctx.bestFit?.program).toBeTruthy();
    }
  });

  it("maps scores to the credit band they fall in", () => {
    expect([bandFor(800), bandFor(740), bandFor(739), bandFor(700), bandFor(660), bandFor(659)]).toEqual(["760", "760", "720", "720", "680", "640"]);
    for (const b of CREDIT_BANDS) expect(bandFor(b.fico)).toBe(b.value);
  });
});
