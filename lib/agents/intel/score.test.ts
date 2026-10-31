import { describe, expect, it } from "vitest";
import { monthsUntil, recommendProgram, scoreProspect, windowBucket } from "./score";
import { NOW, maturityRecord, plusMonths } from "./testing";

const ctx = { now: NOW, marketRatePct: 6.25 };
const factor = (r: ReturnType<typeof scoreProspect>, name: string) => r.factors.find((f) => f.factor === name)!;

describe("windowBucket and monthsUntil", () => {
  it("buckets months to maturity", () => {
    expect([-1, 0, 2.9, 3, 5.9, 6, 11.9, 12, 17.9, 18, 40].map(windowBucket)).toEqual(["matured", "under_3_months", "under_3_months", "months_3_6", "months_3_6", "months_6_12", "months_6_12", "months_12_18", "months_12_18", "later", "later"]);
  });
  it("measures months from today", () => {
    expect(monthsUntil("2027-05-05", NOW)).toBeCloseTo(6, 0);
    expect(monthsUntil("2026-08-05", NOW)).toBeCloseTo(-3, 0);
    expect(monthsUntil("garbage", NOW)).toBeNaN();
  });
});

describe("scoreProspect", () => {
  it("scores a strong California multifamily refinance 6 to 12 months out near the top, with every factor explained", () => {
    const r = scoreProspect(maturityRecord(), ctx);
    expect(r.factors.map((f) => f.factor)).toEqual(["Maturity timing", "Loan size", "Property fit", "Geography", "Rate pressure", "Loan vintage"]);
    expect(r.factors.every((f) => f.points >= 0 && f.points <= f.max && f.detail.length > 10)).toBe(true);
    expect(r.factors.reduce((s, f) => s + f.max, 0)).toBe(100);
    expect(r.score).toBe(r.factors.reduce((s, f) => s + f.points, 0));
    expect(r.score).toBeGreaterThanOrEqual(90);
    expect(r.windowBucket).toBe("months_6_12");
    expect(r.program).toBe("hud_223f");
  });

  it("peaks timing at 6 to 12 months and falls off on both sides", () => {
    const at = (m: number) => factor(scoreProspect(maturityRecord({ loan: { maturityDate: plusMonths(m) } }), ctx), "Maturity timing").points;
    expect(at(8)).toBe(35);
    expect(at(4)).toBe(32);
    expect(at(14)).toBe(26);
    expect(at(1)).toBe(24);
    expect(at(-2)).toBe(22);
    expect(at(21)).toBe(12);
    expect(at(30)).toBe(4);
    expect(at(-18)).toBe(6);
    expect(at(8)).toBeGreaterThan(at(14));
    expect(at(8)).toBeGreaterThan(at(1));
  });

  it("prefers the core loan-size range", () => {
    const at = (amount: number | null) => factor(scoreProspect(maturityRecord({ loan: { originalAmount: amount } }), ctx), "Loan size").points;
    expect([at(500_000), at(1_500_000), at(3_000_000), at(10_000_000), at(40_000_000), at(120_000_000), at(null)]).toEqual([2, 6, 11, 15, 12, 7, 4]);
  });

  it("scores property fit and treats a 1 to 4 unit building as out of the commercial range", () => {
    const at = (over: Parameters<typeof maturityRecord>[0]) => factor(scoreProspect(maturityRecord(over), ctx), "Property fit").points;
    expect(at({ propertyType: "multifamily", units: 48 })).toBe(20);
    expect(at({ propertyType: "multifamily", units: 3 })).toBe(3);
    expect(at({ propertyType: "senior_housing" })).toBe(20);
    expect(at({ propertyType: "hotel" })).toBe(18);
    expect(at({ propertyType: "industrial" })).toBe(14);
    expect(at({ propertyType: "office" })).toBe(11);
    expect(at({ propertyType: "other" })).toBe(5);
  });

  it("gives out-of-state properties no geography points and says licensing review is needed", () => {
    const r = scoreProspect(maturityRecord({ address: { state: "NV" } }), ctx);
    expect(factor(r, "Geography")).toMatchObject({ points: 0 });
    expect(factor(r, "Geography").detail).toMatch(/licensing review/);
    expect(r.program).toBe("other");
  });

  it("scores rate pressure both ways and when the rate is unknown", () => {
    const at = (rate: number | null) => factor(scoreProspect(maturityRecord({ loan: { ratePct: rate } }), ctx), "Rate pressure");
    expect(at(3.5).points).toBe(12);
    expect(at(4.6).points).toBe(9);
    expect(at(6.0).points).toBe(5);
    expect(at(8.0).points).toBe(10);
    expect(at(null).points).toBe(4);
    expect(at(3.5).detail).toContain("payment step-up");
  });

  it("scores loan vintage", () => {
    const at = (orig: string | null) => factor(scoreProspect(maturityRecord({ loan: { originationDate: orig, maturityDate: plusMonths(8) } }), ctx), "Loan vintage").points;
    expect([at(plusMonths(-112)), at(plusMonths(-20)), at(plusMonths(-300)), at(null)]).toEqual([8, 7, 4, 3]);
  });

  it("clamps to 0..100 and rounds to a whole number", () => {
    const low = scoreProspect(maturityRecord({ propertyType: "other", address: { state: "TX" }, loan: { originalAmount: 100_000, ratePct: null, originationDate: null, maturityDate: plusMonths(40) } }), ctx);
    expect(low.score).toBeGreaterThanOrEqual(0);
    expect(low.score).toBeLessThan(25);
    expect(Number.isInteger(low.score)).toBe(true);
  });

  it("throws on an unreadable maturity date instead of scoring it", () => {
    expect(() => scoreProspect(maturityRecord({ loan: { maturityDate: "soon" } }), ctx)).toThrow(/Unreadable maturity date/);
  });
});

describe("recommendProgram", () => {
  const rec = (over: Parameters<typeof maturityRecord>[0]) => maturityRecord(over);
  it("picks a starting program from type, size and time left", () => {
    expect(recommendProgram(rec({}), 8)).toBe("hud_223f");
    expect(recommendProgram(rec({}), 4)).toBe("agency");
    expect(recommendProgram(rec({}), 2)).toBe("bridge");
    expect(recommendProgram(rec({ loan: { originalAmount: 800_000 } }), 8)).toBe("bank_life_co");
    expect(recommendProgram(rec({ propertyType: "senior_housing" }), 8)).toBe("hud_232");
    expect(recommendProgram(rec({ propertyType: "senior_housing" }), 4)).toBe("bridge");
    expect(recommendProgram(rec({ propertyType: "hotel", loan: { originalAmount: 20_000_000 } }), 8)).toBe("hotel_cmbs");
    expect(recommendProgram(rec({ propertyType: "hotel", loan: { originalAmount: 6_000_000 } }), 8)).toBe("sba_504");
    expect(recommendProgram(rec({ propertyType: "industrial" }), 8)).toBe("sba_504");
    expect(recommendProgram(rec({ propertyType: "retail" }), 8)).toBe("bank_life_co");
    expect(recommendProgram(rec({ propertyType: "other" }), 8)).toBe("other");
    expect(recommendProgram(rec({ propertyType: "multifamily" }), -1)).toBe("bridge");
  });
});
