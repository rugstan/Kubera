import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lenderLoanTypes, PROGRAM_LOAN_TYPES, sortLoanTypes } from "../loan-types";
import { dealPrograms, type DealProgram } from "../types";
import {
  allowedPlaybooks,
  defaultPlaybook,
  INCOME_PLAYBOOKS,
  isIncomeProperty,
  PLAYBOOK_LABELS,
  PLAYBOOK_SHORT_LABELS,
  playbookLoanTypes,
  playbookTrancheSource,
  programDetailKeysFor,
  programsForPlaybook,
  SECTION_LABELS,
  SECTION_PROGRAM_DETAIL_KEY,
  sectionView,
  SHORT_TERM_PLAYBOOKS,
  submissionFixHref,
  visibleSections,
} from "./playbooks";
import {
  asIsValueSources,
  emailFinancialsModes,
  exitStrategies,
  loanPurposes,
  noiBases,
  OVERRIDE_REASON_LENGTH,
  programDetailKeys,
  rateTypes,
  recourseOptions,
  sizeUnits,
  sponsorCreditBands,
  stabilizedValueSources,
  SUBMISSION_ARRAY_LIMITS,
  SUBMISSION_TEXT_LIMITS,
  submissionAssetTypes,
  submissionLienPositions,
  submissionPlaybooks,
  submissionSections,
  targetStages,
  tenancyKinds,
  type SectionId,
  type SubmissionPlaybook,
} from "./types";

const SQL = readFileSync(path.resolve(import.meta.dirname, "../../../supabase/migrations/20261105160000_int_deal_submission.sql"), "utf8");

/** Every `<column> in ( '...', ... )` list in the migration, in file order. */
function sqlLists(column: string): string[][] {
  return [...SQL.matchAll(new RegExp(`\\b${column} in \\(([^)]*)\\)`, "g"))].map((m) => [...m[1]!.matchAll(/'([^']+)'/g)].map((v) => v[1]!));
}

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

describe("migration and TypeScript agree", () => {
  it("the playbook check list equals submissionPlaybooks, in order", () => {
    expect(sqlLists("playbook")).toEqual([[...submissionPlaybooks]]);
  });

  it.each([
    ["purpose", loanPurposes],
    ["rate_type", rateTypes],
    ["recourse", recourseOptions],
    ["lien_position", submissionLienPositions],
    ["size_unit", sizeUnits],
    ["tenancy", tenancyKinds],
    ["as_is_value_source", asIsValueSources],
    ["stabilized_value_source", stabilizedValueSources],
    ["noi_basis", noiBases],
    ["exit_strategy", exitStrategies],
    ["credit_band", sponsorCreditBands],
    ["email_financials_mode", emailFinancialsModes],
  ] as const)("%s check list matches", (column, values) => {
    expect(sqlLists(column)).toEqual([[...values]]);
  });

  it("both target_stage checks (deal_summaries, lender_outreach) equal targetStages", () => {
    expect(sqlLists("target_stage")).toEqual([[...targetStages], [...targetStages]]);
  });

  it("every submission asset type passes the asset_type shape check", () => {
    const shape = /'\^\[A-Z0-9_\]\{2,40\}\$'/;
    expect(SQL).toMatch(shape);
    for (const t of submissionAssetTypes) expect(t).toMatch(/^[A-Z0-9_]{2,40}$/);
  });

  it.each(Object.entries(SUBMISSION_TEXT_LIMITS))("text limit %s = %i matches its column check", (key, max) => {
    expect(SQL).toContain(`length(${snake(key)}) between 1 and ${max}`);
  });

  it("array caps match the column checks", () => {
    expect(SQL).toContain(`cardinality(highlights) <= ${SUBMISSION_ARRAY_LIMITS.highlights}`);
    expect(SQL).toContain(`jsonb_array_length(risks) <= ${SUBMISSION_ARRAY_LIMITS.risks}`);
    expect(SQL).toContain(`jsonb_array_length(sources) <= ${SUBMISSION_ARRAY_LIMITS.sources}`);
    expect(SQL).toContain(`jsonb_array_length(uses) <= ${SUBMISSION_ARRAY_LIMITS.uses}`);
  });

  it("the override reason length matches lender_outreach", () => {
    expect(SQL).toContain(`length(btrim(readiness_override_reason)) between ${OVERRIDE_REASON_LENGTH.min} and ${OVERRIDE_REASON_LENGTH.max}`);
  });
});

/** Spec section 3.2, written out. */
const SPEC_3_2: Record<DealProgram, readonly SubmissionPlaybook[]> = {
  CONSTRUCTION: ["construction", "c_pace", "mezz_pref"],
  PRIVATE_BRIDGE: ["bridge", "mezz_pref"],
  HARD_MONEY: ["hard_money", "fix_flip"],
  PIP_BRIDGE: ["hotel_pip_bridge"],
  HOTEL_CMBS: ["hotel_cmbs"],
  SBA_7A: ["sba_7a"],
  SBA_504: ["sba_504"],
  HUD_232: ["hud_232"],
  HUD_MULTIFAMILY: ["hud_multifamily"],
  AGENCY: ["agency"],
  BANK_LIFE_CO: ["bank", "life_company", "cmbs", "dscr_rental", "mezz_pref", "c_pace"],
};

describe("playbooks per deal program", () => {
  it.each(dealPrograms)("%s has a default playbook, listed first among the allowed", (program) => {
    const d = defaultPlaybook(program);
    expect(submissionPlaybooks).toContain(d);
    expect(allowedPlaybooks(program)[0]).toBe(d);
  });

  it("allowedPlaybooks matches spec section 3.2", () => {
    for (const p of dealPrograms) expect(allowedPlaybooks(p)).toEqual(SPEC_3_2[p]);
  });

  it("every playbook can be chosen under at least one program", () => {
    for (const pb of submissionPlaybooks) expect(programsForPlaybook(pb).length, pb).toBeGreaterThan(0);
  });

  it("labels cover every playbook", () => {
    expect(Object.keys(PLAYBOOK_LABELS).sort()).toEqual([...submissionPlaybooks].sort());
    expect(Object.keys(PLAYBOOK_SHORT_LABELS).sort()).toEqual([...submissionPlaybooks].sort());
  });
});

describe("lender loan types", () => {
  it("every playbook maps to at least one known loan type, in canonical order", () => {
    for (const pb of submissionPlaybooks) {
      const types = playbookLoanTypes[pb];
      expect(types.length, pb).toBeGreaterThan(0);
      for (const t of types) expect(lenderLoanTypes).toContain(t);
      expect(sortLoanTypes(types)).toEqual([...types]);
    }
  });

  it("a program's default playbook covers the loan types the program derives", () => {
    for (const p of dealPrograms) for (const t of PROGRAM_LOAN_TYPES[p]) expect(playbookLoanTypes[defaultPlaybook(p)], p).toContain(t);
  });

  it("spec examples: fix_flip → fix_flip, dscr_rental → dscr, hotel_cmbs → cmbs + hotel", () => {
    expect(playbookLoanTypes.fix_flip).toEqual(["fix_flip"]);
    expect(playbookLoanTypes.dscr_rental).toEqual(["dscr"]);
    expect(playbookLoanTypes.hotel_cmbs).toEqual(["cmbs", "hotel"]);
  });

  it("the tranche line is the senior loan except for mezz / pref and C-PACE", () => {
    expect(playbookTrancheSource.mezz_pref).toBe("subordinate_debt");
    expect(playbookTrancheSource.c_pace).toBe("c_pace");
    for (const pb of submissionPlaybooks) if (pb !== "mezz_pref" && pb !== "c_pace") expect(playbookTrancheSource[pb]).toBe("senior_loan");
  });
});

describe("sections (spec 4.2)", () => {
  const SPEC_4_2: Partial<Record<SectionId, readonly SubmissionPlaybook[]>> = {
    construction: ["construction", "c_pace"],
    rehab: ["bridge", "hotel_pip_bridge", "hard_money", "fix_flip"],
    rental: ["dscr_rental"],
    sba: ["sba_7a", "sba_504"],
    hotel: ["hotel_cmbs", "hotel_pip_bridge"],
    tenancy: ["cmbs", "life_company", "bank"],
    agency: ["agency"],
    hud: ["hud_232", "hud_multifamily"],
    capital_stack: ["mezz_pref", "c_pace"],
  };
  const units = (n: number) => ({ sizeCount: n, sizeUnit: "units" as const });

  it("every section has a label; the order is the spec's", () => {
    expect(Object.keys(SECTION_LABELS)).toEqual([...submissionSections]);
    expect(submissionSections).toHaveLength(17);
  });

  it("program sections show for exactly their playbooks", () => {
    for (const [section, only] of Object.entries(SPEC_4_2) as [SectionId, readonly SubmissionPlaybook[]][]) {
      for (const pb of submissionPlaybooks) expect(sectionView(section, pb, units(40)) !== null, `${section} / ${pb}`).toBe(only.includes(pb));
    }
  });

  it("core sections show for every playbook; documents are read-only", () => {
    for (const pb of submissionPlaybooks) {
      for (const s of ["loan_request", "property", "value", "sponsor", "plan_exit", "sources_uses"] as const) expect(sectionView(s, pb, null)).toBe("form");
      expect(sectionView("documents", pb, null)).toBe("read_only");
    }
  });

  it("operating financials: income playbooks, and DSCR rental only at 5+ units", () => {
    for (const pb of submissionPlaybooks) {
      if (pb === "dscr_rental") continue;
      expect(sectionView("financials", pb, null) !== null, pb).toBe(INCOME_PLAYBOOKS.includes(pb));
    }
    expect(sectionView("financials", "dscr_rental", units(4))).toBeNull();
    expect(sectionView("financials", "dscr_rental", units(5))).toBe("form");
    expect(sectionView("financials", "dscr_rental", null)).toBeNull();
    expect(isIncomeProperty("dscr_rental", { sizeCount: 8, sizeUnit: "sf" })).toBe(false);
  });

  it("hard money and fix & flip link the rehab section to the hard money file", () => {
    expect(sectionView("rehab", "hard_money", null)).toBe("hard_money_file");
    expect(sectionView("rehab", "fix_flip", null)).toBe("hard_money_file");
    expect(sectionView("rehab", "bridge", null)).toBe("form");
    expect(programDetailKeysFor("fix_flip", null)).not.toContain("rehab");
  });

  it("a hotel deal shows Hotel and not Construction; a construction deal the reverse", () => {
    const hotel = visibleSections("hotel_cmbs", null).map((s) => s.id);
    const build = visibleSections("construction", null).map((s) => s.id);
    expect(hotel).toContain("hotel");
    expect(hotel).not.toContain("construction");
    expect(build).toContain("construction");
    expect(build).not.toContain("hotel");
  });

  it("each program-detail key is edited by exactly one section", () => {
    expect(Object.values(SECTION_PROGRAM_DETAIL_KEY).sort()).toEqual([...programDetailKeys].sort());
  });

  it("the groups named by the requirement table", () => {
    expect([...SHORT_TERM_PLAYBOOKS].sort()).toEqual(["bridge", "construction", "fix_flip", "hard_money", "hotel_pip_bridge", "mezz_pref"]);
    expect(INCOME_PLAYBOOKS).not.toContain("dscr_rental");
  });
});

describe("fix links", () => {
  it("point at the editor field, the deal, the checklist and the construction desk", () => {
    expect(submissionFixHref("d1", { kind: "editor", section: "value", field: "asIsValueCents" })).toBe("/deals/d1/submission?section=value#field-asIsValueCents");
    expect(submissionFixHref("d1", { kind: "editor", section: "hotel" })).toBe("/deals/d1/submission?section=hotel#section-hotel");
    expect(submissionFixHref("d1", { kind: "deal_details" })).toBe("/deals/d1#details");
    expect(submissionFixHref("d1", { kind: "checklist", itemId: "i9" })).toBe("/checklists/deal?id=d1#item-i9");
    expect(submissionFixHref("d1", { kind: "hard_money_file" })).toBe("/checklists/deal?id=d1#hard-money");
    expect(submissionFixHref("d1", { kind: "principals" })).toBe("/checklists/deal?id=d1#principals");
    expect(submissionFixHref("d1", { kind: "construction_project", projectId: "p1" })).toBe("/construction/project?id=p1");
    expect(submissionFixHref("d1", { kind: "construction_project", projectId: null })).toBe("/construction");
  });
});
