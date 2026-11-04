import { describe, expect, it } from "vitest";
import { evaluateUsury } from "@/lib/compliance/gates";
import { collateralSchema } from "@/lib/compliance/schemas";
import { evaluateEquityPledge } from "./equity-pledge";

const codes = (r: ReturnType<typeof evaluateEquityPledge>) => r.flags.map((f) => f.code);

describe("mezzanine and equity-pledge flag", () => {
  it("flags a mezzanine loan secured only by a pledge of equity interests", () => {
    const r = evaluateEquityPledge({ position: "mezzanine", realPropertyLien: false });
    expect(r.usuryExemptionUnavailable).toBe(true);
    expect(codes(r)).toEqual(["usury_exemption_unavailable", "cfl_license_review"]);
    expect(r.flags[0]!.reason).toContain("pledge of equity interests");
    expect(r.flags[0]!.authority).toContain("Civ. Code §1916.1");
    expect(r.counselReview).toBe(true);
    expect(r.collateral).toEqual({ realPropertyLien: false, equityPledgeOrUccOnly: true });
  });

  it("never says the loan is exempt", () => {
    for (const position of ["senior_mortgage", "junior_mortgage", "mezzanine", "equity_pledge_loan", "preferred_equity", "unsecured"] as const) {
      const r = evaluateEquityPledge({ position, realPropertyLien: position === "senior_mortgage" || position === "junior_mortgage", hasDebtLikeTerms: true });
      const text = [...r.reasons, ...r.flags.map((f) => f.reason)].join(" ").replace("Do not represent that the loan is exempt", "");
      expect(text).not.toMatch(/\bis exempt\b|\bare exempt\b|qualifies for the exemption/i);
    }
  });

  it("does not flag a first or junior mortgage with a real-property lien", () => {
    for (const position of ["senior_mortgage", "junior_mortgage"] as const) {
      const r = evaluateEquityPledge({ position, realPropertyLien: true });
      expect(r).toMatchObject({ usuryExemptionUnavailable: false, flags: [], counselReview: false });
      expect(r.collateral).toEqual({ realPropertyLien: true, equityPledgeOrUccOnly: false });
    }
  });

  it("flags an unsecured or equity-pledge loan too", () => {
    expect(codes(evaluateEquityPledge({ position: "unsecured", realPropertyLien: false }))).toContain("usury_exemption_unavailable");
    expect(codes(evaluateEquityPledge({ position: "equity_pledge_loan", realPropertyLien: false }))).toContain("usury_exemption_unavailable");
  });

  it("asks for counsel when a mezzanine loan also has a lien, without flagging the exemption as unavailable", () => {
    const r = evaluateEquityPledge({ position: "mezzanine", realPropertyLien: true, pledgeOfEquityInterests: true });
    expect(r.usuryExemptionUnavailable).toBe(false);
    expect(r.counselReview).toBe(true);
    expect(r.collateral).toEqual({ realPropertyLien: true, equityPledgeOrUccOnly: false });
  });

  it("treats preferred equity as equity unless it has debt-like terms", () => {
    const pure = evaluateEquityPledge({ position: "preferred_equity", realPropertyLien: false });
    expect(pure).toMatchObject({ usuryExemptionUnavailable: false, flags: [], counselReview: false });
    const debtLike = evaluateEquityPledge({ position: "preferred_equity", realPropertyLien: false, hasDebtLikeTerms: true });
    expect(debtLike.usuryExemptionUnavailable).toBe(true);
    expect(debtLike.flags[0]!.reason).toContain("may be treated as a loan");
  });

  it("produces a collateral shape that the compliance gate accepts and answers consistently", () => {
    const r = evaluateEquityPledge({ position: "mezzanine", realPropertyLien: false });
    expect(collateralSchema.safeParse(r.collateral).success).toBe(true);
    const usury = evaluateUsury({
      noteRatePct: 14,
      fedDiscountRatePct: 4,
      lender: { name: "Mezz Fund LP", category: "PRIVATE_NON_EXEMPT" },
      collateral: r.collateral,
      elements: {},
      transactionDate: "2026-10-31",
    } as never);
    expect(usury.flags.map((f) => f.code)).toContain("usury_exemption_unavailable");
  });
});
