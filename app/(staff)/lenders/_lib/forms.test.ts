import { describe, expect, it } from "vitest";
import { parseCreditBoxTerms } from "@/lib/agents/lenders/credit-box";
import { computeAllIn } from "@/lib/agents/lenders/all-in";
import { FormInputError, boxTermsFromForm, metricsFromSource, parseSchedule, quoteTermsFromForm } from "./forms";

const form = (entries: [string, string][]) => {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
};

describe("quoteTermsFromForm", () => {
  it("reads dollars, percents and schedules into priceable terms", () => {
    const t = quoteTermsFromForm(
      form([
        ["lenderName", "Bank of Fresno"],
        ["loanAmount", "12,500,000"],
        ["ratePct", "6.85"],
        ["termMonths", "120"],
        ["amortizationMonths", "360"],
        ["ioMonths", "24"],
        ["originationFeePct", "1"],
        ["lenderFees", "$35,000"],
        ["prepayKind", "step_down"],
        ["prepaySchedule", "5-4-3-2-1"],
        ["recourse", "non_recourse"],
        ["expiresOn", "2026-12-15"],
        ["bindingConstraint", "dscr"],
      ]),
    );
    expect(t).toMatchObject({ loanAmountCents: 1_250_000_000, ratePct: 6.85, ioMonths: 24, lenderFeesCents: 3_500_000, prepay: { kind: "step_down", schedule: [5, 4, 3, 2, 1] }, recourse: "non_recourse", bindingConstraint: "dscr", expiresOn: "2026-12-15", rateType: "fixed" });
    expect(computeAllIn(t).allInRatePct).toBeGreaterThan(6.85);
  });

  it("treats a blank amortization as interest-only to maturity", () => {
    const t = quoteTermsFromForm(form([["loanAmount", "1000000"], ["ratePct", "10"], ["termMonths", "18"], ["ioMonths", "6"]]));
    expect(t).toMatchObject({ amortizationMonths: null, ioMonths: 18 });
  });

  it("requires the core terms and rejects junk", () => {
    expect(() => quoteTermsFromForm(form([["ratePct", "6"]]))).toThrow(/required/);
    expect(() => quoteTermsFromForm(form([["loanAmount", "abc"], ["ratePct", "6"], ["termMonths", "12"]]))).toThrow(FormInputError);
    expect(() => quoteTermsFromForm(form([["loanAmount", "100"], ["ratePct", "6"], ["termMonths", "12.5"]]))).toThrow(/whole number/);
    expect(() => parseSchedule("5-4-x")).toThrow(/5-4-3-2-1/);
    expect(parseSchedule("3/2/1")).toEqual([3, 2, 1]);
  });
});

describe("boxTermsFromForm", () => {
  it("produces input parseCreditBoxTerms accepts", () => {
    const raw = boxTermsFromForm(
      form([
        ["label", "HUD West"],
        ["programs", "HUD_232"],
        ["programs", "HUD_MULTIFAMILY"],
        ["assetClasses", "SENIOR_LIVING"],
        ["states", "ca, nv"],
        ["minLoan", "2,000,000"],
        ["maxLtvPct", "80"],
        ["minDscr", "1.45x"],
        ["recourse", "non_recourse"],
      ]),
    );
    expect(parseCreditBoxTerms(raw)).toMatchObject({ programs: ["HUD_232", "HUD_MULTIFAMILY"], states: ["CA", "NV"], minLoanCents: 200_000_000, maxLtvPct: 80, minDscr: 1.45, lienPositions: ["first"], recourse: "non_recourse" });
  });
});

describe("metricsFromSource", () => {
  it("derives LTV, LTC and debt yield from the deal's numbers", () => {
    const m = metricsFromSource(new URLSearchParams("noi=1,500,000&value=18,000,000&cost=20,000,000&dscr=1.5&state=ca&assetClass=SENIOR_LIVING&nonRecourse=on&closeDays=60&hold=84"), 1_250_000_000);
    expect(m.overrides).toMatchObject({ ltvPct: 69.44, ltcPct: 62.5, debtYieldPct: 12, dscr: 1.5, propertyState: "CA", assetClass: "SENIOR_LIVING", requiresNonRecourse: true, targetCloseDays: 60 });
    expect(m.spreads.noiCents).toBe(150_000_000);
    expect(m.holdMonths).toBe(84);
  });

  it("prefers typed ratios and ignores unknown values", () => {
    const m = metricsFromSource(new URLSearchParams("ltv=75&value=1000&assetClass=CASINO&lien=third&state=California"), 100_000);
    expect(m.overrides.ltvPct).toBe(75);
    expect(m.overrides.assetClass).toBeUndefined();
    expect(m.overrides.lienPosition).toBeUndefined();
    expect(m.overrides.propertyState).toBeUndefined();
    expect(() => metricsFromSource(new URLSearchParams("dscr=abc"))).toThrow(/DSCR must be a number/);
  });
});
