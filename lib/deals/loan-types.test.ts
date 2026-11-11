// Lender loan types (lib/deals/loan-types.ts): the taxonomy, the derivation
// tables, the shared TS/SQL cases and the pattern dialect both engines share.
import { describe, expect, it } from "vitest";
import {
  LENDER_LOAN_TYPE_DESCRIPTIONS,
  LENDER_LOAN_TYPE_GROUPS,
  LENDER_LOAN_TYPE_LABELS,
  LENDER_LOAN_TYPE_SHORT_LABELS,
  LOAN_TYPE_CLEANUPS,
  LOAN_TYPE_KEYWORD_RULES,
  PROGRAM_LOAN_TYPES,
  deriveLenderLoanTypes,
  deskLabels,
  explainLenderLoanTypes,
  isLenderLoanType,
  lenderLoanTypes,
  loanTypeCorpus,
  sortLoanTypes,
} from "./loan-types";
import { LOAN_TYPE_CASES } from "./loan-types.cases";
import { dealPrograms } from "./types";

const caseNamed = (name: string) => LOAN_TYPE_CASES.find((c) => c.name === name)!.src;

describe("taxonomy", () => {
  it("has 14 unique ids with a label, short label and description each", () => {
    expect(lenderLoanTypes).toHaveLength(14);
    expect(new Set(lenderLoanTypes).size).toBe(14);
    for (const t of lenderLoanTypes) {
      expect(t).toMatch(/^[a-z_]+$/);
      expect(LENDER_LOAN_TYPE_LABELS[t].length, t).toBeGreaterThan(0);
      expect(LENDER_LOAN_TYPE_SHORT_LABELS[t].length, t).toBeGreaterThan(0);
      expect(LENDER_LOAN_TYPE_DESCRIPTIONS[t].length, t).toBeGreaterThan(0);
    }
  });

  it("groups every type exactly once, in canonical order", () => {
    expect(LENDER_LOAN_TYPE_GROUPS.flatMap((g) => g.types)).toEqual([...lenderLoanTypes]);
  });
});

describe("program table", () => {
  it("maps every deal program, and only BANK_LIFE_CO to nothing (it is resolved last)", () => {
    expect(Object.keys(PROGRAM_LOAN_TYPES)).toEqual([...dealPrograms]);
    expect(Object.entries(PROGRAM_LOAN_TYPES).filter(([, v]) => v.length === 0).map(([k]) => k)).toEqual(["BANK_LIFE_CO"]);
  });
});

describe("derivation", () => {
  it.each(LOAN_TYPE_CASES)("$name", ({ src, expected }) => {
    expect(deriveLenderLoanTypes(src)).toEqual(expected);
  });

  it("explains each suggestion", () => {
    const reasons = explainLenderLoanTypes(caseNamed("output is canonical and deduped"));
    // PIP_BRIDGE and HOTEL_CMBS both map to hotel, and the notes say "hotel" too.
    const hotel = reasons.get("hotel")!;
    expect(hotel.filter((r) => r.kind === "program")).toEqual([
      { kind: "program", program: "PIP_BRIDGE" },
      { kind: "program", program: "HOTEL_CMBS" },
    ]);
    expect(hotel.filter((r) => r.kind === "keyword")).toHaveLength(1);
    expect(hotel.at(-1)).toMatchObject({ kind: "keyword", excerpt: expect.stringContaining("hotel") });
    expect(reasons.get("bank")).toEqual([{ kind: "category", category: "STATE_BANK" }]);
    expect(explainLenderLoanTypes(caseNamed("BANK_LIFE_CO alone -> bank")).get("bank")).toEqual([{ kind: "bank_life_co" }]);
  });

  it("parses directory desk labels", () => {
    expect(deskLabels(caseNamed("desk: two desks").appetiteNotes)).toEqual(["SBA hotel lender (7(a) / 504)", "Community bank / credit union CRE"]);
    expect(deskLabels("Staff note without desks")).toEqual([]);
    expect(deskLabels(null)).toEqual([]);
  });

  it("builds the corpus without directory boilerplate and keeps text after an unclosed parenthesis", () => {
    const corpus = loanTypeCorpus(caseNamed("directory segments are ignored"));
    for (const s of ["cpace", "HUD MAP", "Pacific Western"]) expect(corpus).not.toContain(s);
    expect(loanTypeCorpus(caseNamed("negation: unclosed parenthesis stops at the part boundary"))).toContain("Ground-up construction");
  });

  it("sorts and dedupes known ids only", () => {
    expect(sortLoanTypes(["hotel", "bogus", "dscr", "hotel"])).toEqual(["dscr", "hotel"]);
    expect(isLenderLoanType("DSCR")).toBe(false);
    expect(isLenderLoanType("dscr")).toBe(true);
  });
});

describe("pattern dialect", () => {
  it("uses only constructs that mean the same in a JS RegExp and a Postgres ARE", () => {
    for (const p of [...LOAN_TYPE_CLEANUPS.map((c) => c.pattern), ...LOAN_TYPE_KEYWORD_RULES.map((r) => r.pattern)]) {
      // No \b (backspace in Postgres), no lookaround or non-capturing groups, no lazy quantifiers.
      expect(p, p).not.toMatch(/\\b|\(\?[=!<:]|[*+?}]\?/);
      expect(() => new RegExp(p, "i"), p).not.toThrow();
    }
  });
});
