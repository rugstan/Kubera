import { describe, expect, it } from "vitest";
import { BRIDGE, HUD, SBA } from "@/lib/sizing/assumptions";
import { CONSTRUCTION, HARD_MONEY } from "@/lib/sizing/programs/assumptions";
import { DEAL_STRUCTURES, HOME_STRUCTURE_SLUGS, formatUsd, getDealStructure, sba504Stack, structurePath } from "./deal-structures";

describe("sba504Stack", () => {
  it("splits a $2.5M special-purpose project 50 / 35 / 15", () => {
    const [bank, cdc, equity] = sba504Stack({ totalUsd: 2_500_000, debentureCapUsd: SBA.cdcCap, specialPurpose: true });
    expect(bank!.amountUsd).toBeCloseTo(1_250_000);
    expect(cdc!.amountUsd).toBeCloseTo(875_000);
    expect(equity!.amountUsd).toBeCloseTo(375_000);
  });

  it("uses 10% equity for general-purpose property", () => {
    const [bank, cdc, equity] = sba504Stack({ totalUsd: 1_000_000, debentureCapUsd: SBA.cdcCap, specialPurpose: false });
    expect([bank!.share, cdc!.share, equity!.share].map((n) => Math.round(n * 100))).toEqual([50, 40, 10]);
  });

  it("caps the debenture and pushes the excess to the borrower", () => {
    const lines = sba504Stack({ totalUsd: 30_000_000, debentureCapUsd: SBA.cdcCapGreen, specialPurpose: true });
    expect(lines[1]!.amountUsd).toBe(SBA.cdcCapGreen);
    expect(lines.reduce((n, l) => n + l.amountUsd, 0)).toBeCloseTo(30_000_000);
  });
});

describe("illustrative structures", () => {
  it("are the six on /structures", () => {
    expect(DEAL_STRUCTURES).toHaveLength(6);
    expect(DEAL_STRUCTURES.map((s) => s.amount)).toEqual(["$2.5M", "$14.5M", "$16.8M", "$9.2M", "$24M", "$2.1M"]);
    expect(DEAL_STRUCTURES.map((s) => s.program)).toEqual([
      "SBA 504 refinance",
      "SBA 504 Green $5.5M + Bank 1st",
      "Bridge-to-HUD 232/223(f)",
      "Conversion bridge · California",
      "Bank construction loan + C-PACE",
      "Private lender · purchase + rehab",
    ]);
  });

  it("put four on the home page, including construction and hard money", () => {
    expect(HOME_STRUCTURE_SLUGS).toHaveLength(4);
    for (const slug of HOME_STRUCTURE_SLUGS) expect(getDealStructure(slug), slug).toBeDefined();
    expect(new Set(HOME_STRUCTURE_SLUGS).size).toBe(HOME_STRUCTURE_SLUGS.length);
    expect(HOME_STRUCTURE_SLUGS).toEqual(expect.arrayContaining(["multifamily-construction-bank-cpace", "investor-rehab-hard-money"]));
  });

  it("have unique slugs, paths and short titles", () => {
    const slugs = DEAL_STRUCTURES.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of DEAL_STRUCTURES) {
      expect(s.slug).toMatch(/^[a-z0-9-]+$/);
      expect(structurePath(s.slug)).toBe(`/structures/${s.slug}`);
      expect(getDealStructure(s.slug)).toBe(s);
      expect(s.metaTitle.length).toBeLessThanOrEqual(40);
      expect(s.summary.length).toBeLessThanOrEqual(160);
      expect(s.reasons.length).toBeGreaterThanOrEqual(3);
      expect(s.steps.length).toBeGreaterThanOrEqual(4);
      expect(s.watch.length).toBeGreaterThanOrEqual(4);
      expect(s.facts.length).toBeGreaterThanOrEqual(5);
    }
    expect(getDealStructure("nope")).toBeUndefined();
  });

  it("draw every stack from the loan total", () => {
    const withStack = DEAL_STRUCTURES.filter((s) => s.stack);
    expect(withStack.map((s) => s.slug)).toEqual(["assisted-living-sba-504-refinance", "flagged-hotel-sba-504-green-pip"]);
    for (const s of withStack) {
      const total = s.stack!.lines.reduce((n, l) => n + l.amountUsd, 0);
      expect(total).toBeCloseTo(s.amountUsd);
      expect(s.stack!.lines.reduce((n, l) => n + l.share, 0)).toBeCloseTo(1);
    }
  });

  it("show the hotel at 15% equity and the debenture within the energy-efficiency cap", () => {
    const hotel = getDealStructure("flagged-hotel-sba-504-green-pip")!;
    const [bank, cdc, equity] = hotel.stack!.lines;
    expect(equity!.share).toBeCloseTo(0.15);
    expect(cdc!.amountUsd).toBeLessThanOrEqual(SBA.cdcCapGreen);
    expect(bank!.share).toBeCloseTo(SBA.bankFirstPct);
    expect(hotel.tags).toContain("15% equity");
  });

  it("take program facts from the sizing assumptions, not retyped numbers", () => {
    const value = (slug: string, label: string) => getDealStructure(slug)!.facts.find((f) => f.label === label)?.value;
    expect(value("assisted-living-sba-504-refinance", "Debenture amortization")).toBe(`${SBA.cdcAmortYears} years, fixed`);
    expect(value("assisted-living-sba-504-refinance", "Modeled HUD annual audit avoided")).toBe(`$${HUD.annualAuditCost.toLocaleString("en-US")}`);
    expect(value("flagged-hotel-sba-504-green-pip", "Energy-efficiency debenture cap")).toBe(formatUsd(SBA.cdcCapGreen));
    expect(value("memory-care-bridge-to-hud", "HUD 232 refinance max LTV")).toBe(`${HUD.section232.refi.maxLtv * 100}%`);
    expect(value("memory-care-bridge-to-hud", "HUD 232 refinance min DSCR")).toBe(`${HUD.section232.refi.minDscr.toFixed(2)}x`);
    expect(value("memory-care-bridge-to-hud", "HUD 232 annual / upfront MIP")).toBe("0.65% / 1%");
    expect(value("assisted-living-sba-504-refinance", "Debenture ongoing fees")).toBe("1.09%");
    expect(value("memory-care-bridge-to-hud", "Bridge term")).toBe(`${BRIDGE.senior.termMonths} months`);
    expect(value("hotel-to-assisted-living-conversion-bridge", "Bridge max LTC")).toBe(`${BRIDGE.construction.maxLtc * 100}%`);
  });

  it("take construction and hard money facts from the program assumptions", () => {
    const value = (slug: string, label: string) => getDealStructure(slug)!.facts.find((f) => f.label === label)?.value;
    const bank = CONSTRUCTION.boxes.BANK;
    const rehab = HARD_MONEY.grid.FIX_AND_FLIP.EXPERIENCED;
    expect(value("multifamily-construction-bank-cpace", "Bank max loan-to-cost")).toBe(`${bank.maxLtc * 100}%`);
    expect(value("multifamily-construction-bank-cpace", "Bank spread")).toBe(`SOFR + ${bank.spread}%`);
    expect(value("multifamily-construction-bank-cpace", "Min DSCR at stabilization")).toBe(`${bank.minDscrAtStabilization.toFixed(2)}x`);
    expect(value("multifamily-construction-bank-cpace", "C-PACE term")).toBe(`${CONSTRUCTION.cpace.termYears} years, fixed`);
    expect(value("investor-rehab-hard-money", "Max loan-to-after-repair value")).toBe(`${rehab.maxLtarv * 100}%`);
    expect(value("investor-rehab-hard-money", "Note rate, experienced investor")).toBe(`${rehab.ratePct}%`);
    expect(value("investor-rehab-hard-money", "Term")).toBe(`${HARD_MONEY.minTermMonths} to ${HARD_MONEY.maxTermMonths} months, interest-only`);
  });

  it("keep loan funds with the lender of record on the construction and hard money structures", () => {
    for (const slug of ["multifamily-construction-bank-cpace", "investor-rehab-hard-money"]) {
      const s = getDealStructure(slug)!;
      expect(s.stack, slug).toBeUndefined();
      expect(s.gold, slug).toBeUndefined();
      expect(s.steps.some((step) => /as lender of record/.test(step.body) && /Kubera never holds or moves loan funds\./.test(step.body)), slug).toBe(true);
    }
  });

  it("flag unverified HUD parameters for re-checking", () => {
    const memory = getDealStructure("memory-care-bridge-to-hud")!;
    const hud = memory.facts.filter((f) => f.label.startsWith("HUD"));
    expect(hud.length).toBeGreaterThan(0);
    expect(hud.every((f) => /VERIFY/.test(f.note ?? ""))).toBe(true);
  });

  it("describe no role in loan funds or construction draws", () => {
    const text = JSON.stringify(DEAL_STRUCTURES);
    expect(text).not.toMatch(/\bdraw(s|n)?\b|lien waiver|disburs|escrow balance|trust account/i);
    expect(text).not.toMatch(/kubera (funds|lends|originates|services)/i);
  });

  it("never promise outcomes", () => {
    const text = JSON.stringify(DEAL_STRUCTURES);
    expect(text).not.toMatch(/\bguarantee(?:d|s)? (?:closing|approval|rate|terms?|results?)\b|we guarantee/i);
    expect(text).not.toMatch(/\b(you(?:'re| are)|is|are) (pre-?)?approved\b|qualified for|usury|exempt/i);
  });
});
