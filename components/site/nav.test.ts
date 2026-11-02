import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FAMILY_LABELS, financingSlugs, hubForFamily, PROGRAM_FAMILIES } from "@/content/programs";
import {
  ACCOUNT_LINKS,
  ALL_FINANCING,
  CALL_LINK,
  FINANCING_FAMILIES,
  HEADER_CTA,
  POPULAR_PROGRAMS,
  PRIMARY_LINKS,
  SIZER_LINK,
  expressHrefFor,
  sizerLinkFor,
} from "./nav";

const source = (file: string) => readFileSync(path.resolve(import.meta.dirname, file), "utf8");

describe("financing menu data", () => {
  it("lists every program family with its label, so Construction and Hard money are never dropped", () => {
    expect(FINANCING_FAMILIES.map((f) => f.label)).toEqual(PROGRAM_FAMILIES.map((f) => FAMILY_LABELS[f]));
    for (const family of PROGRAM_FAMILIES) {
      const link = FINANCING_FAMILIES.find((l) => l.href === `/financing/${family}`);
      expect(link?.label, family).toBe(FAMILY_LABELS[family]);
    }
    expect(FINANCING_FAMILIES.map((l) => l.href)).toEqual(expect.arrayContaining(["/financing/construction", "/financing/hard-money"]));
  });

  it("links each family to a real hub page", () => {
    for (const family of PROGRAM_FAMILIES) {
      expect(hubForFamily(family).slug).toBe(family);
      expect(financingSlugs).toContain(family);
    }
  });

  it("points every popular program at an existing financing page", () => {
    expect(POPULAR_PROGRAMS).toHaveLength(8);
    for (const p of POPULAR_PROGRAMS) {
      expect(p.href.startsWith("/financing/"), p.href).toBe(true);
      expect(financingSlugs, p.href).toContain(p.href.replace("/financing/", ""));
    }
  });

  it("keeps the all-programs link on the index", () => {
    expect(ALL_FINANCING.href).toBe("/financing");
  });
});

describe("customer-first primary navigation", () => {
  it("keeps About and Contact and moves Glossary, Partners, Insights and Track record to the footer", () => {
    const hrefs = PRIMARY_LINKS.map((l) => l.href);
    expect(hrefs).toEqual(expect.arrayContaining(["/about", "/contact"]));
    for (const moved of ["/glossary", "/partners", "/insights", "/track-record"]) expect(hrefs).not.toContain(moved);
  });

  it("uses one primary call to action wording and target", () => {
    expect(HEADER_CTA.href).toBe("/express");
    expect(HEADER_CTA.label).toBe("Get loan options");
    expect(HEADER_CTA.shortLabel).toBe("Get options");
    expect(SIZER_LINK).toEqual({ href: "/#sizer", label: "Size my loan" });
    expect(CALL_LINK).toEqual({ href: "/contact#schedule", label: "Book a call" });
  });

  it("carries the family on a family page's actions, with the same labels", () => {
    expect(expressHrefFor()).toBe("/express");
    expect(sizerLinkFor()).toEqual(SIZER_LINK);
    expect(expressHrefFor("construction")).toBe("/express?family=construction");
    expect(expressHrefFor("hard-money")).toBe("/express?family=hard-money");
    expect(sizerLinkFor("hard-money")).toEqual({ href: "/?sizer=hard-money#sizer", label: "Size my loan" });
    for (const family of PROGRAM_FAMILIES) expect(sizerLinkFor(family).label).toBe(SIZER_LINK.label);
  });

  it("has no public AI wording in any nav label", () => {
    const labels = [
      ...FINANCING_FAMILIES,
      ...POPULAR_PROGRAMS,
      ...PRIMARY_LINKS,
      ...ACCOUNT_LINKS,
      ALL_FINANCING,
      SIZER_LINK,
      CALL_LINK,
      { label: HEADER_CTA.label },
      { label: HEADER_CTA.shortLabel },
    ].map((l) => l.label);
    for (const label of labels) expect(label, label).not.toMatch(/\bAI\b/);
  });
});

describe("sources", () => {
  it("nav.ts carries the account links to both sign-in pages", () => {
    const src = source("nav.ts");
    expect(src).toContain("/login");
    expect(src).toContain("/portal");
    expect(ACCOUNT_LINKS.map((l) => l.href)).toEqual(["/portal", "/login"]);
  });

  it("the footer links Glossary, Partners, the account row and every family from the shared data", () => {
    const src = source("Footer.tsx");
    for (const needle of ["/glossary", "/partners", "ACCOUNT_LINKS", "FINANCING_FAMILIES"]) expect(src, needle).toContain(needle);
  });

  it("the footer's account row uses plain anchors with rel=nofollow so nothing prefetches the auth pages", () => {
    const src = source("Footer.tsx");
    const account = src.slice(src.indexOf('aria-label="Account"'));
    expect(account).toContain('rel="nofollow"');
    expect(account).not.toContain("<Link");
  });

  it("the footer no longer renders the AI disclosure", () => {
    expect(source("Footer.tsx")).not.toContain("disclosures.ai");
  });

  it("the header has no Ask entry points", () => {
    const src = source("GlassHeader.tsx");
    for (const gone of ["openCommandBar", "Ask Corin", "data-ask"]) expect(src, gone).not.toContain(gone);
  });

  it("nav.ts imports only the program types, never the program copy", () => {
    const imports = [...source("nav.ts").matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(imports).toEqual(["@/content/programs/types"]);
  });
});
