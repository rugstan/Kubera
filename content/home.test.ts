import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { faqSchema } from "@/components/seo/schemas";
import { HOME_FAMILIES, HOME_FAQ, HOME_REASONS, HOME_STEPS } from "./home";
import { PROGRAM_FAMILIES, getFinancingPage } from "./programs";

// Same rules as content/growth.test.ts, applied to the homepage copy.
const FORBIDDEN: [string, RegExp][] = [
  ["approval claim", /\bapproved\b|\bpre-?approv/i],
  ["qualified for", /qualif(y|ied|ies) for\b/i],
  ["fees protected", /fees? protected/i],
  ["call-today promise", /will call you today/i],
  ["autonomous", /\bautonomous\b/i],
  ["guarantee", /\bguarantee[sd]?\b(?!\s+(?:fee|share))(?<!not guaranteed)/i],
  ["usury-exempt claim", /usury[- ]exempt|exempt from usury/i],
  ["Corin as lender", /\b(we|corin) (lend|fund|originate|service)s?\b/i],
  ["instant promises", /\b(instant|same[- ]day) (approval|funding|close)/i],
  ["closing timeline range", /\b\d+\s*[–-]\s*\d+\s+(?:days|business days)\b/i],
];

const source = readFileSync(path.join(import.meta.dirname, "home.ts"), "utf8");

const strings: [string, string][] = [
  ...HOME_FAMILIES.flatMap((f): [string, string][] => [
    [`${f.family} audience`, f.audience],
    [`${f.family} fact`, f.fact],
    ...(f.note ? [[`${f.family} note`, f.note] as [string, string]] : []),
  ]),
  ...HOME_STEPS.flatMap((s): [string, string][] => [
    [`step ${s.title}`, s.title],
    [`step ${s.title} body`, s.body],
  ]),
  ...HOME_REASONS.flatMap((r): [string, string][] => [
    [`reason ${r.title}`, r.title],
    [`reason ${r.title} body`, r.body],
  ]),
  ...HOME_FAQ.flatMap((q): [string, string][] => [
    [`faq ${q.question}`, q.question],
    [`faq ${q.question} answer`, q.answer],
  ]),
];

describe("homepage families", () => {
  it("shows every program family exactly once, in menu order", () => {
    expect(HOME_FAMILIES.map((f) => f.family)).toEqual([...PROGRAM_FAMILIES]);
  });

  it("links only to financing pages that exist, three to five per family", () => {
    for (const f of HOME_FAMILIES) {
      expect(f.programSlugs.length, f.family).toBeGreaterThanOrEqual(3);
      expect(f.programSlugs.length, f.family).toBeLessThanOrEqual(5);
      for (const slug of f.programSlugs) expect(getFinancingPage(slug), `${f.family}: ${slug}`).toBeDefined();
    }
  });

  it("builds the program facts from the assumptions", () => {
    const fact = (family: string) => HOME_FAMILIES.find((f) => f.family === family)!.fact;
    expect(fact("senior-living")).toBe("HUD 232: up to 35-year fixed, non-recourse terms");
    expect(fact("hotels")).toContain("equity from 15% on hotels");
    expect(fact("multifamily")).toBe("HUD 223(f): up to 87% LTV, 35-year fixed");
    expect(fact("construction")).toMatch(/^From .+ at banks to .+ with private lenders$/);
    expect(fact("hard-money")).toMatch(/^\d+–\d+ months, interest-only, sized on the property and your exit$/);
  });
});

describe("homepage copy", () => {
  it("types no percentage or dollar figure into the source", () => {
    expect(source).not.toMatch(/\d\s*%|\$\s*\d/);
  });

  it.each(strings)("%s passes the copy rules", (_label, text) => {
    for (const [why, re] of FORBIDDEN) expect(text, why).not.toMatch(re);
    expect(text, "free").not.toMatch(/\bfree\b/i);
  });

  it("never mentions AI or the command bar", () => {
    for (const [label, text] of strings) expect(text, label).not.toMatch(/\bAI\b|artificial intelligence|⌘K/i);
    expect(source).not.toMatch(/\bAI\b|artificial intelligence|⌘K/);
  });

  it("states no answer's timing as a day range", () => {
    for (const q of HOME_FAQ) expect(q.answer, q.question).not.toMatch(/\d+\s*[-–]\s*\d+\s+(days|business days)/);
  });
});

describe("homepage FAQ", () => {
  it("keeps the broker, timing and draw answers", () => {
    const answer = (q: RegExp) => HOME_FAQ.find((f) => q.test(f.question))!.answer;
    expect(answer(/lender\?/)).toMatch(/^No\. Corin Commercial is a real estate broker, not a lender\./);
    expect(answer(/how long/i)).toContain("They are not guaranteed.");
    expect(answer(/draws/)).toMatch(/no role in draw requests/);
  });

  it("describes compensation as the licensing page does: paid by you, by the lender, or both", () => {
    const paid = HOME_FAQ.find((f) => /get paid/i.test(f.question))!;
    expect(paid.answer).toMatch(/compensation from the lender, or both/);
    expect(paid.answer).toMatch(/including lender-paid compensation/);
    // The MLDS covers loans secured by real property only, never "every loan".
    expect(paid.answer).toMatch(/on loans secured by real property/);
    expect(paid.link?.href).toBe("/licensing#compensation");
  });

  it("serializes to FAQPage JSON-LD with one question per item", () => {
    const node = faqSchema([...HOME_FAQ]) as { "@type": string; mainEntity: unknown[] };
    expect(node["@type"]).toBe("FAQPage");
    expect(node.mainEntity).toHaveLength(HOME_FAQ.length);
    expect(new Set(HOME_FAQ.map((q) => q.question)).size).toBe(HOME_FAQ.length);
  });
});
