import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { calcDscr } from "@/lib/calculators/dscr";
import { MAX_DESCRIPTION_LENGTH, MAX_TITLE_LENGTH, renderedTitle } from "@/lib/seo/metadata";
import { allSitemapRoutes } from "@/lib/seo/sitemap-routes";
import { buildLlmsTxt } from "@/lib/seo/llms";
import { AGENCY, CMBS, HUD, SBA } from "@/lib/sizing/assumptions";
import { CALCULATORS, CALCULATORS_BASE, calculatorPath, calculatorRoutes } from "./calculators";
import { GLOSSARY, GLOSSARY_PATH, getTerm, glossaryLetters, learnMoreHref, sortedGlossary } from "./glossary";
import { INSIGHTS, INSIGHTS_BASE, getInsight, insightAuthor, insightPath, insightText, insightsNewestFirst, readingMinutes, relatedInsights, wordCount } from "./insights";
import { INSIGHT_CATEGORIES } from "./insights/types";
import { CALIFORNIA_BASE, MARKETS, getMarket, marketPath } from "./markets/california";
import { getFinancingPage } from "./programs";
import { CONSTRUCTION_BANK_SPREAD, HARD_MONEY } from "./programs/market-facts";
import { FIXED_RATE_ROWS, RATES_PATH, SERIES, SPREAD_ROWS, fredSeriesUrl, programRange } from "./rates";

const root = path.resolve(import.meta.dirname, "..");
const exists = (p: string) => existsSync(path.join(root, p));

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

function expectCleanCopy(label: string, text: string) {
  for (const [why, re] of FORBIDDEN) expect(text, `${label}: ${why}`).not.toMatch(re);
}

// --- insights ---------------------------------------------------------------------------

describe("insights", () => {
  it("ships at least five articles with unique slugs and a page route", () => {
    expect(INSIGHTS.length).toBeGreaterThanOrEqual(5);
    expect(new Set(INSIGHTS.map((i) => i.slug)).size).toBe(INSIGHTS.length);
    expect(exists("app/(site)/insights/page.tsx")).toBe(true);
    expect(exists("app/(site)/insights/[slug]/page.tsx")).toBe(true);
  });

  it("has unique titles and descriptions within length limits", () => {
    expect(new Set(INSIGHTS.map((i) => i.metaTitle)).size).toBe(INSIGHTS.length);
    expect(new Set(INSIGHTS.map((i) => i.description)).size).toBe(INSIGHTS.length);
    for (const i of INSIGHTS) {
      expect(renderedTitle({ title: i.metaTitle }).length, `${i.slug} title`).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
      expect(i.description.length, `${i.slug} description`).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
      expect(i.description.length, `${i.slug} description`).toBeGreaterThanOrEqual(80);
      expect(INSIGHT_CATEGORIES).toContain(i.category);
    }
  });

  it("has ISO dates, sources, takeaways, an FAQ and enough substance", () => {
    for (const i of INSIGHTS) {
      expect(i.published, i.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(i.updated >= i.published, i.slug).toBe(true);
      expect(i.sources.length, i.slug).toBeGreaterThanOrEqual(1);
      expect(i.keyTakeaways.length, i.slug).toBeGreaterThanOrEqual(3);
      expect(i.faq.length, i.slug).toBeGreaterThanOrEqual(3);
      expect(i.sections.length, i.slug).toBeGreaterThanOrEqual(3);
      expect(wordCount(i), i.slug).toBeGreaterThan(450);
      expect(readingMinutes(i), i.slug).toBeGreaterThanOrEqual(2);
      expect(new Set(i.faq.map((q) => q.question)).size, i.slug).toBe(i.faq.length);
    }
  });

  it("links only to pages that exist", () => {
    const glossary = new Set(GLOSSARY.map((t) => t.slug));
    const calculators = new Set(CALCULATORS.map((c) => calculatorPath(c.slug)));
    for (const i of INSIGHTS) {
      expect(i.related.length, i.slug).toBeGreaterThanOrEqual(2);
      for (const link of i.related) {
        if (link.href.startsWith("/financing/")) expect(getFinancingPage(link.href.replace("/financing/", "")), `${i.slug} ${link.href}`).toBeDefined();
        else if (link.href.startsWith("/glossary#")) expect(glossary.has(link.href.split("#")[1]!), `${i.slug} ${link.href}`).toBe(true);
        else if (link.href.startsWith("/calculators/")) expect(calculators.has(link.href), `${i.slug} ${link.href}`).toBe(true);
        else expect(["/licensing", "/about", "/contact", "/team"], `${i.slug} ${link.href}`).toContain(link.href);
      }
    }
  });

  it("states the HUD 2025 values from the assumptions, not retyped", () => {
    const text = insightText(getInsight("hud-multifamily-2025-changes")!);
    expect(text).toContain(`${(HUD.multifamily.s223f.maxLtv * 100).toFixed(0)}%`);
    expect(text).toContain(`${HUD.multifamily.s223f.minDscr.toFixed(2)}x`);
    expect(text).toContain(`${(HUD.multifamily.mip.annual * 100).toFixed(2)}%`);
    expect(text).toMatch(/green certification/i);
    const sba = insightText(getInsight("sba-504-vs-7a-hotel-acquisition")!);
    expect(sba).toContain(`${SBA.combinedExposureCap / 1_000_000}M`);
    const dscr = insightText(getInsight("dscr-vs-debt-yield")!);
    expect(dscr).toContain(`${(CMBS.minDebtYield.BOUTIQUE_INDEPENDENT * 100).toFixed(1)}%`);
    expect(AGENCY.maxLtv).toBeGreaterThan(0);
  });

  it("computes worked examples with the calculators", () => {
    const r = calcDscr({ noi: 1_000_000, loanAmount: 10_000_000, ratePct: 6, amortYears: 30, targetDscr: 1.25 });
    expect(r.ok).toBe(true);
    const text = insightText(getInsight("dscr-vs-debt-yield")!);
    if (r.ok) expect(text).toContain(`${r.result.dscr.toFixed(2)}x`);
  });

  it("obeys the copy rules", () => {
    for (const i of INSIGHTS) expectCleanCopy(i.slug, insightText(i));
  });

  it("marks the legal explainer as a draft until counsel signs off, and says it is not legal advice", () => {
    const mlds = getInsight("california-mortgage-loan-disclosure-statement")!;
    expect(mlds.legalDraft).toBe(true);
    expect(insightText(mlds)).toMatch(/not legal advice/i);
    expect(insightText(mlds)).toMatch(/three business days/i);
  });

  it("bylines come from the team roster", () => {
    const a = insightAuthor();
    expect(a.name).toBeTruthy();
    expect(a.jobTitle).toBeTruthy();
    expect(a.path).toBe("/team");
  });

  it("sorts newest first and finds related articles", () => {
    const sorted = insightsNewestFirst();
    for (let n = 1; n < sorted.length; n++) expect(sorted[n - 1]!.published >= sorted[n]!.published).toBe(true);
    const related = relatedInsights("hud-232-or-bridge-first", 3);
    expect(related).toHaveLength(3);
    expect(related.map((r) => r.slug)).not.toContain("hud-232-or-bridge-first");
    expect(getInsight("nope")).toBeUndefined();
  });
});

// --- glossary ---------------------------------------------------------------------------

describe("glossary", () => {
  it("has unique slugs and terms and at least 40 entries", () => {
    expect(GLOSSARY.length).toBeGreaterThanOrEqual(40);
    expect(new Set(GLOSSARY.map((t) => t.slug)).size).toBe(GLOSSARY.length);
    expect(new Set(GLOSSARY.map((t) => t.term)).size).toBe(GLOSSARY.length);
    for (const t of GLOSSARY) expect(t.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it("defines each term in a sentence or three, and cross-references only real terms", () => {
    for (const t of GLOSSARY) {
      expect(t.definition.length, t.slug).toBeGreaterThan(60);
      expect(t.definition.length, t.slug).toBeLessThan(700);
      for (const r of t.related ?? []) {
        expect(getTerm(r), `${t.slug} -> ${r}`).toBeDefined();
        expect(r, t.slug).not.toBe(t.slug);
      }
    }
  });

  it("links to financing pages and calculators that exist", () => {
    for (const t of GLOSSARY) {
      if (!t.learnMore) continue;
      const href = learnMoreHref(t.learnMore);
      if (href.startsWith("/calculators/")) expect(CALCULATORS.some((c) => calculatorPath(c.slug) === href), t.slug).toBe(true);
      else expect(getFinancingPage(t.learnMore), `${t.slug} -> ${t.learnMore}`).toBeDefined();
    }
  });

  it("covers every term the calculators and insights point to", () => {
    for (const c of CALCULATORS) for (const slug of c.relatedTerms) expect(getTerm(slug), `${c.slug} -> ${slug}`).toBeDefined();
  });

  it("sorts A to Z and lists the letters used", () => {
    const sorted = sortedGlossary();
    for (let n = 1; n < sorted.length; n++) expect(sorted[n - 1]!.term.localeCompare(sorted[n]!.term, "en", { sensitivity: "base" })).toBeLessThanOrEqual(0);
    const letters = glossaryLetters(sorted);
    expect(letters).toEqual([...letters].sort());
    expect(letters.length).toBeGreaterThan(8);
  });

  it("states program figures from the assumptions and obeys the copy rules", () => {
    expect(getTerm("dscr")!.definition).toContain(`${HUD.section232.refi.minDscr.toFixed(2)}x`);
    expect(getTerm("mip")!.definition).toContain(`${(HUD.multifamily.mip.annual * 100).toFixed(2)}%`);
    expect(getTerm("mip")!.definition).toMatch(/green certification no longer lowers/);
    for (const t of GLOSSARY) expectCleanCopy(t.slug, `${t.term} ${t.definition}`);
  });

  it("has a page route", () => {
    expect(exists("app/(site)/glossary/page.tsx")).toBe(true);
    expect(GLOSSARY_PATH).toBe("/glossary");
  });
});

// --- calculators ------------------------------------------------------------------------

describe("calculator pages", () => {
  it("has the four calculators the plan names, each with a page", () => {
    expect(CALCULATORS.map((c) => c.slug).sort()).toEqual(["dscr", "hotel-debt-yield", "hud-mip", "sba-504"]);
    expect(exists("app/(site)/calculators/page.tsx")).toBe(true);
    expect(exists("app/(site)/calculators/[slug]/page.tsx")).toBe(true);
  });

  it("has unique titles, descriptions and definition-first leads", () => {
    expect(new Set(CALCULATORS.map((c) => c.description)).size).toBe(CALCULATORS.length);
    for (const c of CALCULATORS) {
      expect(renderedTitle({ title: c.title }).length, c.slug).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
      expect(c.description.length, c.slug).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
      expect(c.description.length, c.slug).toBeGreaterThanOrEqual(80);
      expect(c.definition.slice(0, 220), c.slug).toMatch(/\b(is|are)\b/);
      expect(c.faq.length, c.slug).toBeGreaterThanOrEqual(4);
      expect(new Set(c.faq.map((q) => q.question)).size, c.slug).toBe(c.faq.length);
      for (const s of c.relatedPrograms) expect(getFinancingPage(s), `${c.slug} -> ${s}`).toBeDefined();
    }
  });

  it("quotes the sizer's assumptions", () => {
    const hud = CALCULATORS.find((c) => c.slug === "hud-mip")!;
    expect(hud.howItWorks.join(" ")).toContain(`${(HUD.multifamily.mip.annual * 100).toFixed(2)}%`);
    const hotel = CALCULATORS.find((c) => c.slug === "hotel-debt-yield")!;
    expect(hotel.howItWorks.join(" ")).toContain(`${(CMBS.minDebtYield.PREMIUM_FLAG * 100).toFixed(1)}%`);
    const sba = CALCULATORS.find((c) => c.slug === "sba-504")!;
    expect(sba.howItWorks.join(" ")).toContain(`${(SBA.equity.specialPurpose * 100).toFixed(0)}%`);
  });

  it("obeys the copy rules", () => {
    for (const c of CALCULATORS) expectCleanCopy(c.slug, [c.definition, ...c.howItWorks, ...c.readingTheResult, ...c.faq.flatMap((q) => [q.question, q.answer])].join("\n"));
  });
});

// --- California metro pages ----------------------------------------------------------------

describe("California metro pages", () => {
  it("ships exactly Los Angeles, Orange County and the Bay Area", () => {
    expect(MARKETS.map((m) => m.slug)).toEqual(["los-angeles", "orange-county", "bay-area"]);
    expect(exists("app/(site)/california/[slug]/page.tsx")).toBe(true);
    expect(getMarket("san-diego")).toBeUndefined();
  });

  it("has unique copy: titles, descriptions, sections and FAQ answers never repeat across metros", () => {
    const seen = new Map<string, string>();
    for (const m of MARKETS) {
      for (const para of [m.definition, ...m.sections.flatMap((s) => [s.heading, ...s.paragraphs]), ...m.faq.flatMap((q) => [q.question, q.answer])]) {
        const prior = seen.get(para);
        // The broker-not-lender answer is the one shared sentence by design.
        if (prior && !/^Does Corin lend money/.test(para) && !/^No\. Corin Commercial is a licensed California real estate broker/.test(para)) {
          throw new Error(`"${para.slice(0, 80)}" appears on ${prior} and ${m.slug}`);
        }
        seen.set(para, m.slug);
      }
      expect(renderedTitle({ title: m.title }).length, m.slug).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
      expect(m.description.length, m.slug).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
      expect(m.sections.length, m.slug).toBeGreaterThanOrEqual(4);
      expect(m.definition.slice(0, 260), m.slug).toMatch(/\b(is|are)\b/);
      expect(m.sections.flatMap((s) => s.paragraphs).join(" ").split(/\s+/).length, m.slug).toBeGreaterThan(450);
    }
    expect(new Set(MARKETS.map((m) => m.description)).size).toBe(MARKETS.length);
  });

  it("computes its figures from the rules engine and flags them for verification", () => {
    const la = getMarket("los-angeles")!;
    const ab = la.facts.find((f) => /AB 1482 cap/.test(f.label))!;
    expect(ab.value).toMatch(/^\d+\.\d% for \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}$/);
    expect(ab.verify).toBe(true);
    expect(la.facts.find((f) => /Prop 13/.test(f.label))!.value).toMatch(/\$[\d,]+ to about \$[\d,]+ at a 1\.20% levy/);
    expect(la.facts.find((f) => /HUD 223\(f\)/.test(f.label))!.value).toBe(`${(HUD.multifamily.s223f.maxLtv * 100).toFixed(0)}% LTV, ${HUD.multifamily.s223f.minDscr.toFixed(2)}x DSCR`);
    // Bay Area counties fall into different CPI regions in the rules engine.
    const bay = getMarket("bay-area")!.facts.filter((f) => /AB 1482 cap/.test(f.label));
    expect(bay).toHaveLength(2);
    expect(bay[0]!.label).toContain("San Francisco Bay area");
    expect(bay[1]!.label).toContain("California statewide");
    for (const m of MARKETS) for (const f of m.facts) expect(f.asOf, `${m.slug} ${f.label}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("links to financing pages and other markets that exist, and states Corin is a broker not a lender", () => {
    for (const m of MARKETS) {
      for (const s of m.relatedPrograms) expect(getFinancingPage(s), `${m.slug} -> ${s}`).toBeDefined();
      for (const s of m.relatedMarkets) expect(getMarket(s), `${m.slug} -> ${s}`).toBeDefined();
      expect(m.faq.some((q) => /does corin lend/i.test(q.question) && /\bNo\b/.test(q.answer)), m.slug).toBe(true);
      expectCleanCopy(m.slug, [m.definition, ...m.sections.flatMap((s) => [...s.paragraphs, ...(s.bullets ?? [])]), ...m.faq.filter((q) => !/does corin lend/i.test(q.question)).flatMap((q) => [q.question, q.answer])].join("\n"));
    }
  });

  it("makes no claims about closed deals, rankings or market statistics", () => {
    for (const m of MARKETS) {
      const text = [m.definition, ...m.sections.flatMap((s) => s.paragraphs), ...m.faq.map((q) => q.answer)].join("\n");
      expect(text, m.slug).not.toMatch(/\bwe (closed|funded)\b|\b#1\b|\bleading\b|\bbest\b|\bmarket share\b|\$\d+(?:\.\d+)? ?(?:billion|B)\b/i);
    }
  });
});

// --- rates ----------------------------------------------------------------------------------

describe("rates page content", () => {
  it("names the four FRED series with source links", () => {
    expect(SERIES.map((s) => s.seriesId)).toEqual(["DGS5", "DGS10", "SOFR30DAYAVG", "DPRIME"]);
    for (const s of SERIES) {
      expect(fredSeriesUrl(s.seriesId)).toBe(`https://fred.stlouisfed.org/series/${s.seriesId}`);
      expect(s.publisher).toBeTruthy();
    }
    expect(exists("app/(site)/rates/page.tsx")).toBe(true);
  });

  it("derives program ranges from the benchmark plus the spread band", () => {
    const row = SPREAD_ROWS.find((r) => r.key === "hud232")!;
    expect(row.baseKey).toBe("tenYear");
    const range = programRange(row, { fiveYear: 4, tenYear: 4.5, sofr30: 4, prime: 7 });
    expect(range.lo).toBeCloseTo(4.5 + 1.4, 10);
    expect(range.hi).toBeCloseTo(4.5 + 1.8, 10);
    const bridge = SPREAD_ROWS.find((r) => r.key === "bridge")!;
    expect(bridge.baseKey).toBe("sofr30");
  });

  it("lists construction and hard money rates from the market facts the program pages show", () => {
    const construction = SPREAD_ROWS.find((r) => r.key === "constructionBank")!;
    expect(construction.baseKey).toBe("sofr30");
    expect({ lo: construction.lo, hi: construction.hi }).toEqual(CONSTRUCTION_BANK_SPREAD);
    const hardMoney = FIXED_RATE_ROWS.find((r) => r.key === "hardMoney")!;
    expect(`${hardMoney.lo}%–${hardMoney.hi}%`).toBe(HARD_MONEY.rate);
    expect(hardMoney.basis).toMatch(/fixed/i);
  });
});

// --- sitemap and llms.txt ----------------------------------------------------------------------

describe("sitemap integration", () => {
  const routes = allSitemapRoutes();
  const paths = new Set(routes.map((r) => r.path));

  it("lists every growth page exactly once", () => {
    const expected = [
      INSIGHTS_BASE,
      ...INSIGHTS.map((i) => insightPath(i.slug)),
      RATES_PATH,
      CALCULATORS_BASE,
      ...CALCULATORS.map((c) => calculatorPath(c.slug)),
      GLOSSARY_PATH,
      CALIFORNIA_BASE,
      ...MARKETS.map((m) => marketPath(m.slug)),
      "/newsletter",
    ];
    for (const p of expected) expect(paths.has(p), p).toBe(true);
    expect(new Set(routes.map((r) => r.path)).size).toBe(routes.length);
  });

  it("does not list the confirm and unsubscribe pages", () => {
    expect(paths.has("/newsletter/confirm")).toBe(false);
    expect(paths.has("/newsletter/unsubscribe")).toBe(false);
    expect(calculatorRoutes.length).toBe(CALCULATORS.length + 1);
  });

  it("gives articles a last-modified date", () => {
    for (const i of INSIGHTS) expect(routes.find((r) => r.path === insightPath(i.slug))!.lastModified).toBe(i.updated);
  });

  it("feeds llms.txt", () => {
    const txt = buildLlmsTxt();
    expect(txt).toContain("/calculators/dscr");
    expect(txt).toContain("/insights/hud-multifamily-2025-changes");
    expect(txt).toContain("/glossary");
    expect(txt).toContain("/rates");
  });
});

describe("page sources", () => {
  const read = (p: string) => readFileSync(path.join(root, p), "utf8");

  it("every growth page sets canonical metadata through pageMetadata", () => {
    for (const p of [
      "app/(site)/insights/page.tsx",
      "app/(site)/insights/[slug]/page.tsx",
      "app/(site)/rates/page.tsx",
      "app/(site)/calculators/page.tsx",
      "app/(site)/calculators/[slug]/page.tsx",
      "app/(site)/glossary/page.tsx",
      "app/(site)/california/page.tsx",
      "app/(site)/california/[slug]/page.tsx",
      "app/(site)/newsletter/page.tsx",
    ]) {
      expect(read(p), p).toContain("pageMetadata");
    }
  });

  it("dated and dynamic content sits behind Suspense", () => {
    expect(read("app/(site)/rates/page.tsx")).toContain("<Suspense");
    expect(read("components/calculators/CalculatorPage.tsx")).toContain("<Suspense");
    expect(read("app/(site)/newsletter/confirm/page.tsx")).toContain("<Suspense");
    expect(read("app/(site)/newsletter/unsubscribe/page.tsx")).toContain("<Suspense");
  });

  it("the token pages are not indexed", () => {
    for (const p of ["app/(site)/newsletter/confirm/page.tsx", "app/(site)/newsletter/unsubscribe/page.tsx"]) expect(read(p), p).toMatch(/index:\s*false/);
  });
});
