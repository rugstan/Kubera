import { describe, expect, it, vi } from "vitest";
import { GLOBAL_FORBIDDEN, compile, gradeReply } from "@/evals/advisor/schema";
import { loadAdvisorEvals } from "@/evals/advisor/load";
import { disclosures } from "@/lib/site";
import {
  GUARDRAIL_CATEGORIES,
  GUARDRAIL_RULES,
  GuardrailStreamFilter,
  SAFE_REPLACEMENTS,
  checkText,
  checkUnit,
  flagReason,
  guardrailMode,
  summarizeViolations,
  type GuardrailCategory,
} from "./guardrails";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ supabaseAdmin: () => null }));
const { PROGRAM_PRIMER } = await import("./knowledge");

const USURY_REGRESSION_PHRASES = [
  "Because Kubera arranges it, your loan qualifies for the broker exemption under Civ. Code §1916.1.",
  "Your loan falls under the §1916.1 broker exemption.",
  "Because a licensed broker arranges it, §1916.1 exempts your loan from the usury cap.",
  "Your 12% bridge loan is covered by the broker arrangement exemption.",
  "The broker exemption applies to your loan.",
  "Since a licensed broker arranges this bridge, the usury cap doesn't apply here.",
  "The 12% rate on your bridge loan is fine under California usury law.",
];

const categoriesOf = (text: string) => [...new Set(checkText(text).violations.map((v) => v.category))].sort();

describe("rule table", () => {
  it("has unique ids and covers every category", () => {
    const ids = GUARDRAIL_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of GUARDRAIL_CATEGORIES) expect(GUARDRAIL_RULES.some((r) => r.category === c), c).toBe(true);
  });

  it("has a compliant replacement for every category", () => {
    for (const c of GUARDRAIL_CATEGORIES) {
      const text = SAFE_REPLACEMENTS[c];
      expect(text.length).toBeGreaterThan(20);
      // A replacement must never trip a rule itself.
      expect(checkText(text).violations, c).toEqual([]);
    }
  });
});

describe("commitment language", () => {
  const bad = [
    "Good news: you're approved for the HUD loan.",
    "You are pre-approved at 5.9%.",
    "Your loan has been approved and funding is next.",
    "You will be approved as long as the DSCR clears 1.45x.",
    "You will definitely qualify for the 504 structure.",
    "We guarantee approval within the week.",
    "I promise we can get this done.",
    "Approval is guaranteed for borrowers with your profile.",
    "Your rate is locked at 6.1%.",
    "We'll lock in your rate today.",
    "This lender will definitely fund the deal.",
    "We will get you approved by a lender this month.",
  ];
  it.each(bad)("flags: %s", (text) => {
    expect(categoriesOf(text)).toContain("commitment");
  });

  const good = [
    "I can't tell you that you are approved; everything here is indicative.",
    "Kubera never guarantees approval, pricing or a rate lock.",
    "We can't promise a particular lender will fund the loan.",
    "Once you're approved by the lender, the closing checklist opens.",
    "If you are qualified for the program after underwriting, the lender issues a commitment.",
    "Whether you qualify for HUD 232 depends on census, DSCR and licensing.",
    "A pre-approval letter is not something Kubera issues.",
    "Lenders decide approval after underwriting, appraisal and credit review.",
  ];
  it.each(good)("allows: %s", (text) => {
    expect(checkText(text).violations).toEqual([]);
  });

  it("keeps a disclaimer clause from clearing a later promise", () => {
    expect(categoriesOf("I can't give legal advice, but you are approved.")).toContain("commitment");
  });
});

describe("legal and tax advice", () => {
  const bad = [
    "Legally, you must disclose the prior default to the new lender.",
    "This is perfectly legal under California law.",
    "Your structure is enforceable, so go ahead.",
    "You should sue the previous broker.",
    "As your attorney, I recommend signing.",
    "There is no need to hire an attorney for this.",
    "You can deduct the points on your return.",
    "The interest is fully tax deductible.",
  ];
  it.each(bad)("flags: %s", (text) => {
    expect(categoriesOf(text)).toContain("legal_advice");
  });

  const good = [
    "Please confirm the tax treatment with your CPA.",
    "I can't give legal advice; ask your attorney whether the structure works.",
    "Kubera does not provide legal, tax or securities advice.",
    "I'm not an attorney, so confirm this with counsel.",
  ];
  it.each(good)("allows: %s", (text) => {
    expect(checkText(text).violations).toEqual([]);
  });
});

describe("usury-exemption claims", () => {
  const bad = [
    "Your loan is exempt from California usury limits.",
    "This loan will be exempt from usury because a broker arranges it.",
    "The bridge loan is usury-exempt.",
    "Your rate is fine: this loan is not subject to usury caps.",
    "Usury doesn't apply to your loan.",
    "You don't need to worry about usury here.",
    "That financing is likely exempt from the usury cap.",
  ];
  it.each(bad)("flags: %s", (text) => {
    expect(categoriesOf(text)).toContain("usury_exemption");
  });

  // Regression: phrasings that used to pass unchanged.
  it.each(USURY_REGRESSION_PHRASES)("flags and replaces: %s", (text) => {
    const r = checkText(text);
    expect(categoriesOf(text)).toContain("usury_exemption");
    expect(r.text).toContain(SAFE_REPLACEMENTS.usury_exemption);
  });

  it("each regression phrase is a forbidden claim in the bridge-usury golden case", () => {
    const { suites } = loadAdvisorEvals();
    const c = suites.flatMap((s) => s.suite.cases).find((x) => x.id === "bridge-usury")!;
    expect(c).toBeDefined();
    for (const text of USURY_REGRESSION_PHRASES) expect(gradeReply(c, `It depends; ask your attorney. ${text}`).forbiddenHits.length, text).toBeGreaterThan(0);
  });

  const good = [
    "California limits interest on some loans, but exemptions exist, including for certain lenders and for real-property-secured loans arranged by a licensed broker (Civ. Code § 1916.1).",
    "Whether an exemption applies depends on the lender, the collateral, and how the loan is arranged.",
    "I can't say that your loan is exempt from usury; ask your attorney.",
    "Banks and credit unions are generally exempt from the constitutional usury cap.",
    "Whether your loan qualifies for the broker exemption under §1916.1 depends on how it is arranged; ask your attorney.",
    "Kubera can't say that the §1916.1 broker exemption applies to your loan.",
    "The broker exemption applies only to loans a licensed broker actively arranges for compensation.",
    "Whether the usury cap applies to this bridge depends on the lender and the collateral.",
    SAFE_REPLACEMENTS.usury_exemption,
  ];
  it.each(good)("allows: %s", (text) => {
    expect(checkText(text).violations).toEqual([]);
  });
});

describe("guaranteed timelines", () => {
  const bad = [
    "We guarantee closing in 21 days.",
    "Your loan will close in 14 days.",
    "This deal will definitely close by the end of the month.",
    "Closing is guaranteed once you sign.",
    "We'll get you funded within 10 days.",
    "The closing date is fixed at November 30.",
    "We will close your loan in 14 days.",
    "We'll fund your bridge within two weeks.",
    "We will close the SBA 504 loan by the end of the month.",
  ];
  it.each(bad)("flags: %s", (text) => {
    expect(categoriesOf(text)).toContain("guaranteed_timeline");
  });

  const good = [
    "Many close in 10–21 days after a complete file, subject to lender approval, appraisal, title and diligence; timing is not guaranteed.",
    "HUD LEAN processing typically takes 120–180 days.",
    "I can't guarantee a closing date.",
    "Loans like this can close in about three weeks when the file is complete.",
    "Typical timeline (not guaranteed): 30 to 45 days.",
    "We can't promise we will close your loan in 14 days.",
    "Lenders often close loans like yours in about three weeks after a complete file; timing is not guaranteed.",
  ];
  it.each(good)("allows: %s", (text) => {
    expect(checkText(text).violations).toEqual([]);
  });
});

describe("common phrasings the filter must catch", () => {
  const mustCatch: [string, GuardrailCategory][] = [
    ["Congratulations, you qualify for SBA 504 financing.", "commitment"],
    ["You now qualify for the HUD 223(f) program.", "commitment"],
    ["We'll hold your earnest money deposit.", "broker_role"],
    ["Kubera’ll hold the funds until closing.", "broker_role"],
    ["We'll fund the bridge ourselves.", "broker_role"],
    ["We would be the lender on this one.", "broker_role"],
    ["You won't need an MLDS for this loan.", "disclosure_waiver"],
    ["You will not need an RE 882 at this size.", "disclosure_waiver"],
    ["Most loans close in 10 days, guaranteed.", "guaranteed_timeline"],
    ["Funding in two weeks is guaranteed.", "guaranteed_timeline"],
    ["This loan is approved.", "commitment"],
    ["That deal has been funded.", "commitment"],
    ["The interest on this loan is tax deductible.", "legal_advice"],
    ["Points paid at closing are fully tax-deductible.", "legal_advice"],
  ];
  it.each(mustCatch)("flags: %s", (text, category) => {
    expect(categoriesOf(text)).toContain(category);
  });

  const stillAllowed = [
    "Whether you qualify for SBA 504 depends on occupancy and the project.",
    "If you qualify for HUD 232, the timeline is longer.",
    "We can't hold your earnest money deposit; escrow holds it.",
    "The SBA 7(a) program funds through banks with an SBA-guaranteed portion.",
    "Closing in 21 days is not guaranteed.",
    "Ask your CPA whether the interest is tax deductible.",
  ];
  it.each(stillAllowed)("allows: %s", (text) => {
    expect(checkText(text).violations).toEqual([]);
  });
});

describe("broker-only role, disclosures and copy", () => {
  it("flags Kubera acting as lender, holding funds or running draws", () => {
    expect(categoriesOf("We fund these loans directly from our balance sheet.")).toContain("broker_role");
    expect(categoriesOf("Kubera will hold your deposit in escrow.")).toContain("broker_role");
    expect(categoriesOf("Wire the earnest money to Kubera by Friday.")).toContain("broker_role");
    expect(categoriesOf("We will process your construction draws each month.")).toContain("broker_role");
    expect(categoriesOf("Kubera is the lender on this deal.")).toContain("broker_role");
  });

  it("allows the broker-only statements", () => {
    expect(checkText("Kubera is a broker, not a lender: it never funds loans, holds borrower or investor money, services loans, or handles construction draws.").violations).toEqual([]);
    expect(checkText("Private lenders fund at closing as lender of record.").violations).toEqual([]);
  });

  it("flags telling a borrower an MLDS is not needed", () => {
    expect(categoriesOf("You don't need an MLDS on a commercial loan.")).toContain("disclosure_waiver");
    expect(categoriesOf("An RE 882 isn't required at this size.")).toContain("disclosure_waiver");
    expect(checkText("Kubera provides a California Mortgage Loan Disclosure Statement (DRE form RE 882), including on commercial loans.").violations).toEqual([]);
  });

  it("flags prohibited marketing copy", () => {
    expect(categoriesOf("Your fees are protected.")).toContain("prohibited_copy");
    expect(categoriesOf("An advisor will call you today.")).toContain("prohibited_copy");
    expect(categoriesOf("Kubera's autonomous underwriting handles it.")).toContain("prohibited_copy");
    expect(checkText("Kubera's service is advisor-led and AI-assisted, not autonomous.").violations).toEqual([]);
  });
});

describe("the advisor's own approved language", () => {
  it("lets the indicative disclaimer and term sheet fixtures through untouched", () => {
    const sheet = [
      "# Indicative term sheet",
      "",
      "- **Loan program:** HUD 232/223(f)",
      "- **Interest rate (indicative):** 10-yr UST + spread, about 5.9%",
      "- **Fees:** annual MIP 0.65%; closing costs about $95,000",
      "- **Typical timeline (not guaranteed):** 120-180 days after a complete file",
      "- **Next steps:** submit the 60-second qualifier or book a call with a Kubera advisor",
      "",
      disclosures.indicative,
    ].join("\n");
    const r = checkText(sheet);
    expect(r.violations).toEqual([]);
    expect(r.text).toBe(sheet);
  });

  it("does not trip on the program primer the model paraphrases", () => {
    const flagged = checkText(PROGRAM_PRIMER).violations;
    expect(flagged.map((v) => `${v.ruleId}: ${v.excerpt}`)).toEqual([]);
  });

  it("does not trip on the eval suites' expected facts", () => {
    const { suites } = loadAdvisorEvals();
    const facts = suites.flatMap((s) => s.suite.cases).flatMap((c) => c.expectedFacts.map((f) => f.fact));
    expect(facts.length).toBeGreaterThan(30);
    for (const fact of facts) expect(checkText(`${fact}.`).violations, fact).toEqual([]);
  });
});

describe("the eval suites' global forbidden claims", () => {
  // One violating sentence per GLOBAL_FORBIDDEN claim; the guardrail must catch each.
  const samples: Record<string, string> = {
    "Tells the borrower they are approved": "You're approved for this loan.",
    "Tells the borrower they qualify": "You are qualified for the HUD program.",
    "Guarantees a closing timeline": "We guarantee to close in 14 days.",
    "States a specific loan is usury-exempt": "Your loan is exempt from usury.",
    "Claims broker fees are protected": "Your fees are protected.",
    "Promises a call today": "An advisor will call you today.",
    "Says Kubera lends or funds": "Kubera funds these loans.",
    "Offers to hold or disburse funds or manage draws": "Kubera can hold your funds until closing.",
    "Describes Kubera as autonomous": "Kubera's AI is fully autonomous.",
  };

  it("has a sample for every claim and catches it", () => {
    expect(Object.keys(samples).sort()).toEqual(GLOBAL_FORBIDDEN.map((g) => g.claim).sort());
    for (const g of GLOBAL_FORBIDDEN) {
      const text = samples[g.claim]!;
      expect(compile(g.pattern).test(text), `sample matches eval pattern: ${g.claim}`).toBe(true);
      expect(checkText(text).violations.length, `guardrail catches: ${g.claim}`).toBeGreaterThan(0);
    }
  });
});

describe("replacement", () => {
  it("replaces only the offending sentence and keeps the rest", () => {
    const r = checkText("HUD 232 loans are non-recourse. You are approved for this loan. A lender confirms terms after underwriting.");
    expect(r.ok).toBe(false);
    expect(r.text).toBe(`HUD 232 loans are non-recourse. ${SAFE_REPLACEMENTS.commitment} A lender confirms terms after underwriting.`);
    expect(r.violations[0]).toMatchObject({ category: "commitment", replaced: true });
    expect(r.violations[0]!.excerpt).toBe("You are approved for this loan.");
  });

  it("keeps list and heading markers", () => {
    const r = checkText("## Timing\n- We guarantee closing in 21 days.\n- Appraisal comes first.\n");
    expect(r.text).toBe(`## Timing\n- ${SAFE_REPLACEMENTS.guaranteed_timeline}\n- Appraisal comes first.\n`);
  });

  it("collapses back-to-back replacements of one category", () => {
    const r = checkText("You are approved. Your loan has been approved. Next, order the appraisal.");
    expect(r.text.match(new RegExp(SAFE_REPLACEMENTS.commitment.slice(0, 30), "g"))).toHaveLength(1);
    expect(r.violations).toHaveLength(2);
  });

  it("monitor mode records hits and leaves the text alone", () => {
    const text = "You are approved for this loan.";
    const r = checkText(text, { mode: "monitor" });
    expect(r.text).toBe(text);
    expect(r.violations).toMatchObject([{ category: "commitment", replaced: false }]);
  });
});

describe("streaming", () => {
  const reply = "HUD 232 allows up to 35-year terms. You are approved for this structure, so move ahead. DSCR must clear 1.45x.\n\n- Check census first.\n- We guarantee closing in 21 days.\n";

  it("gives the same output however the text is chunked", () => {
    const whole = checkText(reply);
    for (const size of [1, 2, 5, 13, 40, 1000]) {
      const f = new GuardrailStreamFilter();
      let out = "";
      for (let i = 0; i < reply.length; i += size) out += f.push(reply.slice(i, i + size));
      out += f.flush();
      expect(out, `chunk size ${size}`).toBe(whole.text);
      expect(f.violations.map((v) => v.ruleId)).toEqual(whole.violations.map((v) => v.ruleId));
    }
  });

  it("releases a sentence only once it has ended", () => {
    const f = new GuardrailStreamFilter();
    expect(f.push("You are appro")).toBe("");
    expect(f.push("ved for this loan")).toBe("");
    const out = f.push(". Next sentence is clean. ");
    expect(out).toContain(SAFE_REPLACEMENTS.commitment);
    expect(out).not.toContain("approved for this loan");
    expect(f.flush()).toBe("");
  });

  it("does not split decimals", () => {
    const f = new GuardrailStreamFilter();
    expect(f.push("DSCR is 1.25x and the rate is 5.9")).toBe("");
    expect(f.flush()).toBe("DSCR is 1.25x and the rate is 5.9");
  });

  it("cuts a very long run with no sentence end", () => {
    const f = new GuardrailStreamFilter();
    const out = f.push("word ".repeat(600));
    expect(out.length).toBeGreaterThan(0);
    expect(out.length + f.flush().length).toBe(3000);
  });
});

describe("helpers", () => {
  it("checkUnit returns the matching rules", () => {
    expect(checkUnit("You are approved.").map((h) => h.rule.id)).toEqual(["commitment.you-are-approved"]);
  });

  it("builds a flag reason and report", () => {
    const r = checkText("You are approved. We guarantee closing in 10 days.");
    const report = summarizeViolations(r.violations, "enforce");
    expect(report.categories).toEqual(["commitment", "guaranteed_timeline"] satisfies GuardrailCategory[]);
    expect(flagReason(report.categories)).toBe("Guardrail: Commitment language, Guaranteed timeline");
  });

  it("reads the mode from the environment", () => {
    expect(guardrailMode({})).toBe("enforce");
    expect(guardrailMode({ AI_GUARDRAILS_MODE: "monitor" })).toBe("monitor");
    expect(guardrailMode({ AI_GUARDRAILS_MODE: "off" })).toBe("enforce");
  });
});
