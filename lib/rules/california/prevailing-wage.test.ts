import { describe, expect, it } from "vitest";
import { evaluatePrevailingWage } from "./prevailing-wage";

describe("Davis-Bacon", () => {
  it.each([["HUD_221D4"], ["HUD_220"], ["HUD_232_NEW_CONSTRUCTION"]] as const)("is required for %s construction", (program) => {
    const r = evaluatePrevailingWage({ program, workType: "new_construction", units: 80 });
    expect(r.davisBacon).toBe("required");
    expect(r.jevFlags).toContain("DAVIS_BACON_WAGES_APPLY");
    expect(r.flags[0]!.authority).toContain("National Housing Act §212");
  });

  it("is required for HUD 221(d)(4) substantial rehabilitation too", () => {
    expect(evaluatePrevailingWage({ program: "HUD_221D4", workType: "substantial_rehabilitation" }).davisBacon).toBe("required");
  });

  it("is not triggered by a plain 223(f) refinance with no work", () => {
    const r = evaluatePrevailingWage({ program: "HUD_223F", workType: "none" });
    expect(r).toMatchObject({ davisBacon: "not_indicated", californiaPrevailingWage: "not_indicated", jevFlags: [], requiresComplianceReview: false });
  });

  it("asks for review when a Section 232 refinance carries repairs", () => {
    expect(evaluatePrevailingWage({ program: "HUD_232_223F", workType: "repairs" }).davisBacon).toBe("possible");
    const r = evaluatePrevailingWage({ program: "HUD_232_223F", workType: "substantial_rehabilitation" });
    expect(r.davisBacon).toBe("likely");
    expect(r.requiresComplianceReview).toBe(true);
  });

  it("follows federal funds into construction work", () => {
    const cdbg = evaluatePrevailingWage({ program: "CONSTRUCTION_PRIVATE", workType: "new_construction", units: 60, publicFunding: ["federal_cdbg"] });
    expect(cdbg.davisBacon).toBe("likely");
    const smallHome = evaluatePrevailingWage({ workType: "new_construction", units: 8, publicFunding: ["federal_home"] });
    expect(smallHome.davisBacon).toBe("possible");
    expect(evaluatePrevailingWage({ workType: "new_construction", units: 40, publicFunding: ["federal_home"] }).davisBacon).toBe("likely");
    expect(evaluatePrevailingWage({ workType: "none", publicFunding: ["federal_home"] }).davisBacon).toBe("not_indicated");
  });
});

describe("California prevailing wage", () => {
  it("flags public funds in a California construction project", () => {
    const r = evaluatePrevailingWage({ state: "CA", workType: "new_construction", units: 50, publicFunding: ["land_below_market", "fee_waiver_or_reduction"] });
    expect(r.californiaPrevailingWage).toBe("likely");
    expect(r.jevFlags).toEqual(["CA_PREVAILING_WAGE_APPLIES"]);
    expect(r.flags[0]!.authority).toContain("Labor Code §1720");
    expect(r.requiresComplianceReview).toBe(true);
  });

  it("requires it for SB 35 and AB 2011 streamlined approvals", () => {
    expect(evaluatePrevailingWage({ workType: "new_construction", streamlinedApproval: "sb35" }).californiaPrevailingWage).toBe("required");
    expect(evaluatePrevailingWage({ workType: "new_construction", streamlinedApproval: "ab2011" }).californiaPrevailingWage).toBe("required");
    expect(evaluatePrevailingWage({ workType: "new_construction", streamlinedApproval: "none" }).californiaPrevailingWage).toBe("not_indicated");
  });

  it("does not apply the California rule outside California", () => {
    const r = evaluatePrevailingWage({ state: "NV", workType: "new_construction", publicFunding: ["state_grant"], streamlinedApproval: "sb35" });
    expect(r.californiaPrevailingWage).toBe("not_indicated");
  });

  it("does not apply it to a deal with no construction work", () => {
    expect(evaluatePrevailingWage({ workType: "repairs", publicFunding: ["state_grant"] }).californiaPrevailingWage).toBe("not_indicated");
  });

  it("treats LIHTC-only and C-PACE as notes, not triggers", () => {
    const r = evaluatePrevailingWage({ workType: "substantial_rehabilitation", units: 30, publicFunding: ["lihtc_only", "c_pace"] });
    expect(r.californiaPrevailingWage).toBe("not_indicated");
    expect(r.underwritingNotes.join(" ")).toMatch(/low-income housing tax credits/);
    expect(r.underwritingNotes.join(" ")).toMatch(/C-PACE/);
  });

  it("marks a regulatory agreement alone as worth a look", () => {
    expect(evaluatePrevailingWage({ workType: "new_construction", publicAgencyRegulatoryAgreement: true }).californiaPrevailingWage).toBe("possible");
  });

  it("notes the higher-wage rule when both regimes apply", () => {
    const r = evaluatePrevailingWage({ program: "HUD_221D4", workType: "new_construction", units: 100, publicFunding: ["state_or_local_subsidy_loan"] });
    expect(r.davisBacon).toBe("required");
    expect(r.californiaPrevailingWage).toBe("likely");
    expect(r.jevFlags).toEqual(["DAVIS_BACON_WAGES_APPLY", "CA_PREVAILING_WAGE_APPLIES"]);
    expect(r.underwritingNotes.join(" ")).toMatch(/higher of the federal and state/);
  });

  it("says plainly when nothing is indicated for a construction deal", () => {
    const r = evaluatePrevailingWage({ program: "CONSTRUCTION_PRIVATE", workType: "new_construction", units: 40 });
    expect(r.underwritingNotes.join(" ")).toMatch(/No prevailing-wage trigger/);
  });
});
