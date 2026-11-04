import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_DESCRIPTION_LENGTH, MAX_TITLE_LENGTH, renderedTitle } from "@/lib/seo/metadata";
import { allSitemapRoutes } from "@/lib/seo/sitemap-routes";
import { AGENCY, ASSUMPTIONS_REVIEWED, BRIDGE, CMBS, HUD, SBA } from "@/lib/sizing/assumptions";
import {
  FAMILY_LABELS,
  financingPath,
  financingSlugs,
  getFinancingPage,
  hubForFamily,
  hubs,
  PROGRAM_FAMILIES,
  programRoutes,
  programs,
  programsInFamily,
} from "./index";
import { pct, x } from "./format";
import type { ProgramEntry } from "./types";

const REQUIRED_PROGRAM_SLUGS = [
  "hud-232",
  "hud-223f-senior-housing",
  "bridge-to-hud",
  "assisted-living",
  "rcfe",
  "memory-care",
  "skilled-nursing",
  "sba-504-hotel",
  "sba-7a-504-hotel-stack",
  "hotel-cmbs",
  "pip-bridge",
  "hotel-to-senior-living-conversion",
  "hud-221d4",
  "hud-223f-multifamily",
  "hud-223a7",
  "fannie-mae-multifamily",
  "freddie-mac-multifamily",
  "multifamily-bridge",
  "dscr-investor",
  "construction-loans",
  "construction-to-permanent",
  "c-pace",
  "hard-money",
  "fix-and-flip",
  "private-bridge",
];
const REQUIRED_HUB_SLUGS = ["senior-living", "hotels", "multifamily", "construction", "hard-money"];

const allEntries = [...programs, ...hubs];

/** Every string in a page, for copy checks. */
function allText(entry: (typeof allEntries)[number]): string {
  const parts: string[] = [entry.name, entry.title, entry.description, entry.summary, entry.definition];
  for (const s of entry.sections) parts.push(s.heading, ...s.paragraphs, ...(s.bullets ?? []));
  for (const q of entry.faq) parts.push(q.question, q.answer);
  for (const f of (entry as Partial<ProgramEntry>).facts ?? []) parts.push(f.label, f.value, f.source);
  return parts.join("\n");
}

describe("page inventory", () => {
  it("has at least 25 program pages and every required slug", () => {
    expect(programs.length).toBeGreaterThanOrEqual(25);
    const slugs = programs.map((p) => p.slug);
    for (const slug of REQUIRED_PROGRAM_SLUGS) expect(slugs).toContain(slug);
  });

  it("serves the five hub URLs", () => {
    for (const slug of REQUIRED_HUB_SLUGS) expect(getFinancingPage(slug)).toBeDefined();
    expect(getFinancingPage("hard-money")?.kind).toBe("program");
    expect(getFinancingPage("senior-living")?.kind).toBe("hub");
  });

  it("has one hub page per family", () => {
    for (const family of PROGRAM_FAMILIES) {
      const hub = hubForFamily(family);
      expect(hub.slug).toBeTruthy();
      expect(FAMILY_LABELS[family]).toBeTruthy();
      expect(programsInFamily(family).length).toBeGreaterThan(0);
    }
  });

  it("has unique slugs across programs and hubs", () => {
    expect(new Set(financingSlugs).size).toBe(programs.length + hubs.length);
  });

  it("returns undefined for unknown slugs", () => {
    expect(getFinancingPage("nope")).toBeUndefined();
  });
});

describe("metadata", () => {
  it("gives every page a unique title and description", () => {
    const titles = allEntries.map((e) => e.title);
    const descriptions = allEntries.map((e) => e.description);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it("keeps rendered titles within the limit and descriptions within 160 characters", () => {
    for (const e of allEntries) {
      expect(renderedTitle({ title: e.title }).length, `${e.slug} title`).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
      expect(e.description.length, `${e.slug} description`).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
      expect(e.description.length, `${e.slug} description`).toBeGreaterThanOrEqual(80);
    }
  });

  it("leads with a definition", () => {
    for (const e of allEntries) {
      expect(e.definition.slice(0, 220), e.slug).toMatch(/\b(is|are)\b/);
      expect(e.definition.length, e.slug).toBeGreaterThan(120);
    }
  });
});

describe("structure", () => {
  it("has facts with sources and as-of dates, an FAQ and related links on each program", () => {
    for (const p of programs) {
      expect(p.facts.length, `${p.slug} facts`).toBeGreaterThanOrEqual(4);
      for (const f of p.facts) {
        expect(f.asOf, `${p.slug} ${f.label}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(f.source.trim(), `${p.slug} ${f.label}`).not.toBe("");
        expect(f.value.trim(), `${p.slug} ${f.label}`).not.toBe("");
      }
      expect(p.faq.length, `${p.slug} faq`).toBeGreaterThanOrEqual(3);
      expect(p.related.length, `${p.slug} related`).toBeGreaterThanOrEqual(4);
      expect(p.sections.length, `${p.slug} sections`).toBeGreaterThanOrEqual(2);
    }
  });

  it("has an FAQ and related links on each hub", () => {
    for (const h of hubs) {
      expect(h.faq.length, h.slug).toBeGreaterThanOrEqual(2);
      expect(h.related.length, h.slug).toBeGreaterThanOrEqual(3);
    }
  });

  it("only relates to pages that exist and never to itself", () => {
    for (const e of allEntries) {
      for (const slug of e.related) {
        expect(getFinancingPage(slug), `${e.slug} -> ${slug}`).toBeDefined();
        expect(slug, e.slug).not.toBe(e.slug);
      }
      expect(new Set(e.related).size, e.slug).toBe(e.related.length);
    }
  });

  it("never repeats a hub's own programs in its related links", () => {
    // A hub lists its family under "Programs we arrange"; related links point elsewhere.
    const hubEntries = [...hubs, ...programs.filter((p) => p.isHub)];
    expect(hubEntries.map((h) => h.family).sort()).toEqual([...PROGRAM_FAMILIES].sort());
    for (const h of hubEntries) {
      const family = new Set(programsInFamily(h.family).map((p) => p.slug));
      for (const slug of h.related) expect(family.has(slug), `${h.slug} -> ${slug}`).toBe(false);
    }
  });

  it("links every page from at least one other page", () => {
    const linked = new Set(allEntries.flatMap((e) => e.related));
    for (const slug of financingSlugs) {
      const hub = hubForFamily(getFinancingPage(slug)!.entry.family);
      expect(linked.has(slug) || hub.slug === slug, `${slug} has no inbound link`).toBe(true);
    }
  });

  it("has unique FAQ questions within each page", () => {
    for (const e of allEntries) {
      const qs = e.faq.map((q) => q.question);
      expect(new Set(qs).size, e.slug).toBe(qs.length);
    }
  });
});

describe("facts come from lib/sizing/assumptions", () => {
  const factValue = (slug: string, label: RegExp) => {
    const page = getFinancingPage(slug);
    if (page?.kind !== "program") throw new Error(`${slug} is not a program`);
    const f = page.entry.facts.find((row) => label.test(row.label));
    if (!f) throw new Error(`${slug}: no fact matching ${label}`);
    return f.value;
  };

  it("hud-232 matches Section 232 assumptions", () => {
    expect(factValue("hud-232", /max LTV/)).toBe(pct(HUD.section232.refi.maxLtv));
    expect(factValue("hud-232", /Minimum DSCR/)).toBe(x(HUD.section232.refi.minDscr));
    expect(factValue("hud-232", /New construction: max/)).toBe(pct(HUD.section232.newConstruction.maxLtc));
    expect(factValue("hud-232", /Upfront MIP/)).toBe(pct(HUD.section232.refi.upfrontMip, 2));
  });

  it("HUD multifamily pages match the 2025 multifamily values and flat MIP", () => {
    const mf = HUD.multifamily;
    expect(factValue("hud-223f-multifamily", /Market-rate/)).toBe(`${pct(mf.s223f.maxLtv)} / ${x(mf.s223f.minDscr)}`);
    expect(factValue("hud-223f-multifamily", /Affordable/)).toBe(`${pct(mf.s223f.maxLtvAffordable)} / ${x(mf.s223f.minDscrAffordable)}`);
    expect(factValue("hud-223f-multifamily", /Cash-out/)).toBe(pct(mf.s223f.cashOutMaxLtv));
    expect(factValue("hud-223f-multifamily", /Annual MIP/)).toContain(pct(mf.mip.annual, 2));
    expect(factValue("hud-221d4", /Market-rate/)).toBe(`${pct(mf.s221d4.maxLtc)} / ${x(mf.s221d4.minDscr)}`);
    expect(factValue("hud-221d4", /Affordable/)).toBe(`${pct(mf.s221d4.maxLtcAffordable)} / ${x(mf.s221d4.minDscrAffordable)}`);
    expect(factValue("hud-223a7", /Annual MIP/)).toContain(pct(mf.mip.annual, 2));
  });

  it("does not mention the disabled middle-income tier and states green does not lower MIP", () => {
    expect(HUD.multifamily.middleIncome221d4.enabled).toBe(false);
    for (const slug of ["hud-221d4", "hud-223f-multifamily", "hud-223a7", "multifamily"]) {
      expect(allText(getFinancingPage(slug)!.entry), slug).not.toMatch(/middle-income/i);
    }
    expect(HUD.greenLowersMip).toBe(false);
    expect(allText(getFinancingPage("hud-223f-multifamily")!.entry)).toMatch(/green certification/i);
  });

  it("SBA pages match SBA assumptions", () => {
    expect(factValue("sba-504-hotel", /Minimum DSCR/)).toBe(x(SBA.minDscr));
    expect(factValue("sba-504-hotel", /Bank first lien/)).toContain(pct(SBA.bankFirstPct));
    expect(factValue("sba-504-hotel", /Borrower equity/)).toContain(pct(SBA.equity.base + SBA.equity.specialPurpose));
    expect(factValue("sba-7a-504-hotel-stack", /combined/)).toContain(`${SBA.combinedExposureCap / 1_000_000}M`);
    expect(factValue("sba-7a-504-hotel-stack", /guaranty share/)).toBe(pct(SBA.sevenAGuaranteedShare));
  });

  it("CMBS, agency and bridge pages match their assumptions", () => {
    expect(factValue("hotel-cmbs", /Max LTV/)).toBe(pct(CMBS.maxLtv));
    expect(factValue("hotel-cmbs", /Minimum DSCR/)).toBe(x(CMBS.minDscr));
    expect(factValue("fannie-mae-multifamily", /Max LTV/)).toBe(pct(AGENCY.maxLtv));
    expect(factValue("freddie-mac-multifamily", /Minimum DSCR/)).toBe(x(AGENCY.minDscr));
    expect(factValue("pip-bridge", /loan-to-cost/)).toBe(pct(BRIDGE.hotelPip.maxLtc));
    expect(factValue("multifamily-bridge", /Max LTV/)).toBe(pct(BRIDGE.cre.maxLtv));
    expect(factValue("bridge-to-hud", /Max LTV/)).toBe(pct(BRIDGE.senior.maxLtv));
    expect(factValue("construction-loans", /Corin sizing assumption: max/)).toBe(pct(BRIDGE.construction.maxLtc));
  });

  it("shows bridge and SBA timeline facts as a plain range plus one qualifier", () => {
    expect(factValue("private-bridge", /Typical close/)).toBe(`${BRIDGE.closeRange} after a complete file`);
    expect(factValue("pip-bridge", /Typical close/)).toBe(`${BRIDGE.closeRange} after a complete file`);
    expect(factValue("multifamily-bridge", /Typical close/)).toBe(`${BRIDGE.closeRange} after a complete file`);
    expect(factValue("sba-504-hotel", /Typical close/)).toBe(`${SBA.closeRange} after a complete file`);
    expect(BRIDGE.closeDays).toContain(BRIDGE.closeRange);
    expect(SBA.typicalCloseDays).toContain(SBA.closeRange);
  });

  it("uses the assumptions review date for assumption-based facts", () => {
    const hud = getFinancingPage("hud-232");
    if (hud?.kind !== "program") throw new Error("expected program");
    expect(hud.entry.facts.every((f) => f.asOf === ASSUMPTIONS_REVIEWED)).toBe(true);
  });

  it("holds no literal percentages, ratios, dollar amounts or durations outside market-facts", () => {
    const dir = path.dirname(new URL(import.meta.url).pathname);
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "market-facts.ts");
    const patterns: [string, RegExp][] = [
      ["percentage", /\d\s?%/],
      ["coverage ratio", /\d\.\d+x\b/],
      ["dollar amount", /\$\d/],
      ["duration", /\b\d+[-\s]?(year|yr|month|day)s?\b/i],
      ["day range", /\d+[–-]\d+\s?(days|months)/],
    ];
    for (const file of files) {
      const code = readFileSync(path.join(dir, file), "utf8")
        .split("\n")
        .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*") && !line.trim().startsWith("/*"))
        .join("\n");
      for (const [name, re] of patterns) {
        const match = re.exec(code);
        expect(match, `${file}: literal ${name} "${match?.[0]}" - import it from lib/sizing/assumptions or market-facts`).toBeNull();
      }
    }
  });
});

describe("copy rules", () => {
  const FORBIDDEN: [string, RegExp][] = [
    ["approved", /\bapproved\b|\bpre-?approv/i],
    ["qualified for", /qualif(y|ied|ies) for\b/i],
    ["fees protected", /fees? protected/i],
    ["call-today promise", /will call you today/i],
    ["autonomous", /\bautonomous\b/i],
    ["guaranteed outcome", /(?<!not )\bguarantee[sd]?\b(?! fee)/i],
    ["usury-exempt claim", /usury[- ]exempt|exempt from usury/i],
    ["Corin as lender", /\b(we|corin) (lend|fund|originate|service)s?\b/i],
    ["instant promises", /\b(instant|same[- ]day) (approval|funding|close)/i],
  ];

  it("avoids forbidden phrases on every page", () => {
    for (const e of allEntries) {
      const text = allText(e);
      for (const [name, re] of FORBIDDEN) {
        expect(re.exec(text)?.[0] ?? null, `${e.slug}: ${name}`).toBeNull();
      }
    }
  });

  it("never offers a closing timeline without conditions", () => {
    for (const e of allEntries) {
      for (const para of allText(e).split("\n")) {
        if (/\bclose[sd]? in\b/i.test(para)) {
          expect(para, `${e.slug}: ${para.slice(0, 80)}`).toMatch(/subject to|not guaranteed|after a complete file|typical/i);
        }
      }
    }
  });

  it("never repeats the closing-timeline qualifier inside one sentence", () => {
    for (const e of allEntries) {
      for (const para of allText(e).split("\n")) {
        const msg = `${e.slug}: ${para.slice(0, 120)}`;
        expect(para, msg).not.toMatch(/close[sd]? in many close/i);
        expect(para.match(/after a complete file/gi)?.length ?? 0, msg).toBeLessThanOrEqual(1);
        expect(para.match(/not guaranteed/gi)?.length ?? 0, msg).toBeLessThanOrEqual(1);
      }
    }
  });

  it("places no role for Corin in construction draws", () => {
    for (const e of allEntries.filter((p) => p.family === "construction" || /draw/i.test(allText(p)))) {
      for (const para of allText(e).split("\n")) {
        if (/\bdraws?\b/i.test(para) && !para.endsWith("?")) {
          expect(para, `${e.slug}: ${para.slice(0, 80)}`).toMatch(/no role|not Corin|lender|HUD|holdback|Corin has no/i);
        }
      }
    }
  });

  it("states that private lenders fund as lender of record on hard money pages", () => {
    for (const p of programsInFamily("hard-money")) {
      expect(allText(p), p.slug).toMatch(/lender of record/i);
    }
  });
});

describe("sitemap", () => {
  it("lists the financing index, every hub and every program", () => {
    const paths = programRoutes.map((r) => r.path);
    expect(paths).toContain("/financing");
    for (const slug of financingSlugs) expect(paths).toContain(financingPath(slug));
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("is included in the site sitemap with a description for llms.txt", () => {
    const all = allSitemapRoutes();
    for (const slug of financingSlugs) {
      const route = all.find((r) => r.path === financingPath(slug));
      expect(route, slug).toBeDefined();
      expect(route?.description, slug).toBeTruthy();
      expect(route?.section).toBe("Programs");
    }
  });
});

describe("market facts shared with the sizer", () => {
  it("derive hard money, agency and bridge exit figures from the program boxes", async () => {
    const { AGENCY_GRID, BRIDGE_EXIT, HARD_MONEY: HM } = await import("@/lib/sizing/programs/assumptions");
    const { AGENCY_MARKET, BRIDGE_EXIT_TEST, HARD_MONEY } = await import("./market-facts");
    const rates = [...Object.values(HM.grid.FIX_AND_FLIP), ...Object.values(HM.grid.BRIDGE)].map((r) => r.ratePct);
    expect(HARD_MONEY.rate).toBe(`${Math.min(...rates)}%–${Math.max(...rates)}%`);
    expect(HARD_MONEY.term).toContain(`${HM.minTermMonths}–${HM.maxTermMonths} months`);
    expect(HARD_MONEY.defaultRate).toBe(`up to ${HM.defaultRatePct}%`);
    expect(BRIDGE_EXIT_TEST.dscr).toBe(`${BRIDGE_EXIT.minDscr.toFixed(2)}x`);
    expect(BRIDGE_EXIT_TEST.debtYield).toContain(`${BRIDGE_EXIT.minDebtYield * 100}%`);
    expect(AGENCY_MARKET.fannieSmall).toContain(`$${AGENCY_GRID.fannie.smallLoanMax / 1_000_000}M`);
    expect(AGENCY_MARKET.freddieSmall).toContain(`${AGENCY_GRID.tiers.TIER_2.minDscr.toFixed(2)}x`);
  });
});
