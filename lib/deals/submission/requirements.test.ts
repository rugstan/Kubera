import { describe, expect, it } from "vitest";
import { evaluateReadiness } from "./readiness";
import { SUBMISSION_REQUIREMENTS, requirementById, requirementLabel, requirementLevel } from "./requirements";
import { computeSubmissionMetrics } from "./metrics";
import { allSubmissionFixtures, emptyProfileContext, emptySubmissionContext } from "./test-fixtures";
import { submissionPlaybooks, submissionSections, type SubmissionPlaybook } from "./types";

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
