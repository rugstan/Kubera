import { describe, expect, it } from "vitest";
import { evaluateReadiness } from "./readiness";
import { SUBMISSION_REQUIREMENTS, isGroundUp, requirementById, requirementLabel, requirementLevel } from "./requirements";
import { computeSubmissionMetrics } from "./metrics";
import { allSubmissionFixtures, emptyProfileContext, emptySubmissionContext } from "./test-fixtures";
import { submissionPlaybooks, submissionSections, type SubmissionContext, type SubmissionPlaybook } from "./types";

const CORE_SCREEN = ["request.amount", "request.purpose", "request.recourse_lien", "property.identity", "property.size", "value.basis", "sponsor.experience", "sponsor.strength"];

/** Screen-required ids an empty profile is missing, beyond the core set (spec 4.5). */
const EMPTY_SCREEN_EXTRAS: Record<SubmissionPlaybook, string[]> = {
  construction: ["value.stabilized", "financials.noi_stabilized", "plan.narrative", "plan.exit", "construction.budget", "construction.timeline", "construction.entitlements", "construction.track_record"],
  bridge: ["property.occupancy", "value.stabilized", "financials.noi_in_place", "financials.noi_stabilized", "sponsor.credit", "plan.narrative", "plan.exit"],
  hard_money: ["value.stabilized", "sponsor.credit", "plan.narrative", "plan.exit", "hm.file"],
  fix_flip: ["value.stabilized", "sponsor.credit", "plan.narrative", "plan.exit", "hm.file"],
  dscr_rental: ["property.occupancy", "sponsor.credit", "rental.rent", "rental.lease_status"],
  sba_7a: ["sponsor.credit", "sba.business", "sba.occupancy", "sba.cash_flow", "sba.injection"],
  sba_504: ["sponsor.credit", "sba.business", "sba.occupancy", "sba.cash_flow", "sba.injection"],
  hud_multifamily: ["property.occupancy", "financials.noi_in_place", "hud.section"],
  hud_232: ["property.occupancy", "financials.noi_in_place", "hud.section", "hud.232_operations"],
  agency: ["property.occupancy", "financials.noi_in_place", "agency.occupancy"],
  cmbs: ["property.occupancy", "financials.noi_in_place", "tenancy.rollover"],
  hotel_cmbs: ["property.occupancy", "financials.noi_in_place", "hotel.identity", "hotel.performance", "hotel.pip"],
  hotel_pip_bridge: ["property.occupancy", "value.stabilized", "financials.noi_in_place", "financials.noi_stabilized", "plan.narrative", "plan.exit", "rehab.budget", "hotel.identity", "hotel.performance", "hotel.pip"],
  bank: ["property.occupancy", "financials.noi_in_place", "sponsor.credit"],
  life_company: ["property.occupancy", "financials.noi_in_place", "tenancy.rollover"],
  mezz_pref: ["property.occupancy", "value.stabilized", "financials.noi_in_place", "financials.noi_stabilized", "plan.narrative", "plan.exit", "stack.senior", "stack.consent"],
  c_pace: ["property.occupancy", "value.stabilized", "financials.noi_in_place", "construction.budget", "stack.senior", "stack.consent", "cpace.improvements"],
};

describe("requirement table", () => {
  it("has about 55 unique, well-formed ids", () => {
    const ids = SUBMISSION_REQUIREMENTS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(50);
    for (const r of SUBMISSION_REQUIREMENTS) {
      expect(r.id).toMatch(/^[a-z0-9]+\.[a-z0-9_]+$/);
      expect(submissionSections).toContain(r.section);
      expect(r.label.length).toBeGreaterThan(5);
      expect(r.fix.hint.length).toBeGreaterThan(10);
      // Labels are read by the approving broker and printed in the email's "Not yet in hand" line.
      expect(r.label).not.toMatch(/approv|qualif|guarantee/i);
      const playbooks = submissionPlaybooks.filter((p) => requirementLevel(r, p, "screen") || requirementLevel(r, p, "term_sheet"));
      expect(playbooks.length, r.id).toBeGreaterThan(0);
    }
    expect(requirementById("value.basis")?.section).toBe("value");
    expect(requirementLabel("value.basis")).toMatch(/As-is value|purchase price/i);
    expect(requirementLabel("checklist.phase_i_esa")).toBe("phase i esa");
    expect(requirementLabel("nope")).toBe("nope");
  });

  it("gives every playbook the core set at Screen and a program-specific item", () => {
    for (const p of submissionPlaybooks) {
      for (const id of ["request.amount", "request.purpose", "request.recourse_lien", "property.identity", "value.basis", "sponsor.experience", "sponsor.strength"]) {
        expect(requirementLevel(requirementById(id)!, p, "screen"), `${p} ${id}`).toBe("required");
      }
      const specific = SUBMISSION_REQUIREMENTS.filter((r) => !r.levels.all && r.levels[p] && Object.keys(r.levels).length < submissionPlaybooks.length);
      expect(specific.length, p).toBeGreaterThan(0);
    }
  });

  it("raises sources and uses to required at Screen on an acquisition, construction or renovation only", () => {
    const req = requirementById("capital.sources_uses")!;
    const ctx = allSubmissionFixtures().find(([p]) => p === "bridge")![1];
    expect(requirementLevel(req, "bridge", "screen", ctx)).toBe("required");
    ctx.profile!.purpose = "refinance";
    expect(requirementLevel(req, "bridge", "screen", ctx)).toBe("recommended");
    expect(requirementLevel(req, "bridge", "term_sheet", ctx)).toBe("required");
  });

  it("keeps SBA forms out of Screen and recommended at Term sheet", () => {
    const req = requirementById("sba.forms")!;
    expect(requirementLevel(req, "sba_7a", "screen")).toBeUndefined();
    expect(requirementLevel(req, "sba_7a", "term_sheet")).toBe("recommended");
    expect(requirementLevel(req, "bridge", "term_sheet")).toBeUndefined();
  });

  describe.each(submissionPlaybooks.map((p) => [p] as const))("%s", (playbook) => {
    it("an empty profile lists the expected Screen items", () => {
      const ctx = emptyProfileContext(playbook);
      const r = evaluateReadiness(ctx, computeSubmissionMetrics(ctx), "screen");
      expect([...r.missing].sort()).toEqual([...CORE_SCREEN, ...EMPTY_SCREEN_EXTRAS[playbook]].sort());
      expect(r.ready).toBe(false);
    });

    it("the complete fixture lists nothing at Screen or Term sheet, required or recommended", () => {
      const ctx = allSubmissionFixtures().find(([p]) => p === playbook)![1];
      const m = computeSubmissionMetrics(ctx);
      for (const stage of ["screen", "term_sheet"] as const) {
        const r = evaluateReadiness(ctx, m, stage);
        expect(r.missing, stage).toEqual([]);
        expect(r.recommended.filter((i) => !i.met).map((i) => i.id), stage).toEqual([]);
        expect(r.ready).toBe(true);
        expect(r.score).toBe(100);
      }
    });
  });

  it("a deal with no profile at all is evaluated under the program's default playbook", () => {
    const ctx = emptySubmissionContext("HOTEL_CMBS");
    const r = evaluateReadiness(ctx, computeSubmissionMetrics(ctx), "screen");
    expect(r.playbook).toBe("hotel_cmbs");
    expect(r.missing).toEqual(expect.arrayContaining(["hotel.identity", "hotel.pip", "request.amount"]));
  });
});

// F9: a project not yet built has no occupancy, in-place NOI, T-12 or rent roll; it needs the construction items.
describe("ground-up deals", () => {
  const IN_PLACE = ["property.occupancy", "financials.noi_in_place", "docs.t12", "docs.rent_roll"];
  const ids = (ctx: SubmissionContext, stage: "screen" | "term_sheet") => {
    const r = evaluateReadiness(ctx, computeSubmissionMetrics(ctx), stage);
    return [...r.required, ...r.recommended].map((i) => i.id);
  };
  const cases: [string, () => SubmissionContext, string[]][] = [
    ["C-PACE on a construction purpose", () => {
      const ctx = emptyProfileContext("c_pace");
      ctx.profile!.purpose = "construction";
      return ctx;
    }, ["financials.noi_stabilized", "value.stabilized", "construction.budget", "construction.timeline", "construction.entitlements"]],
    ["HUD 221(d)(4)", () => {
      const ctx = emptyProfileContext("hud_multifamily");
      ctx.profile!.programDetails = { hud: { section: "221d4" } } as never;
      return ctx;
    }, ["financials.noi_stabilized", "value.stabilized", "capital.sources_uses"]],
    ["HUD 232 new construction", () => {
      const ctx = emptyProfileContext("hud_232");
      ctx.profile!.programDetails = { hud: { section: "232_new" } } as never;
      return ctx;
    }, ["financials.noi_stabilized", "value.stabilized", "capital.sources_uses"]],
    ["mezz on a CONSTRUCTION deal", () => {
      const ctx = emptyProfileContext("mezz_pref");
      ctx.deal = { ...ctx.deal, program: "CONSTRUCTION" };
      return ctx;
    }, ["financials.noi_stabilized", "value.stabilized", "capital.sources_uses"]],
  ];
  it.each(cases)("%s: no in-place items, the construction items instead", (_label, make, construction) => {
    const ctx = make();
    expect(isGroundUp(ctx)).toBe(true);
    for (const stage of ["screen", "term_sheet"] as const) {
      const listed = ids(ctx, stage);
      for (const id of IN_PLACE) expect(listed, `${stage} ${id}`).not.toContain(id);
      const required = evaluateReadiness(ctx, computeSubmissionMetrics(ctx), stage).required.map((i) => i.id);
      for (const id of construction) expect(required, `${stage} ${id}`).toContain(id);
    }
  });

  it("leaves existing income property alone: a HUD 223(f) refinance still needs occupancy and in-place NOI", () => {
    const ctx = emptyProfileContext("hud_multifamily");
    ctx.profile!.programDetails = { hud: { section: "223f" } } as never;
    expect(isGroundUp(ctx)).toBe(false);
    const required = evaluateReadiness(ctx, computeSubmissionMetrics(ctx), "screen").required.map((i) => i.id);
    expect(required).toEqual(expect.arrayContaining(["property.occupancy", "financials.noi_in_place"]));
    expect(required).not.toContain("financials.noi_stabilized");
  });
});
