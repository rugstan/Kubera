import { describe, expect, it } from "vitest";
import { CALCULATORS } from "@/content/calculators";
import { DEAL_STRUCTURES } from "@/content/deal-structures";
import { INSIGHTS } from "@/content/insights/articles";
import { MARKETS } from "@/content/markets/california";
import { financingSlugs } from "@/content/programs";
import { isUnknownSlugPath } from "./known-slugs";

describe("isUnknownSlugPath", () => {
  it("accepts every listed slug", () => {
    const paths = [
      ...financingSlugs.map((s) => `/financing/${s}`),
      ...INSIGHTS.map((i) => `/insights/${i.slug}`),
      ...DEAL_STRUCTURES.map((s) => `/structures/${s.slug}`),
      ...CALCULATORS.map((c) => `/calculators/${c.slug}`),
      ...MARKETS.map((m) => `/california/${m.slug}`),
    ];
    expect(paths.length).toBeGreaterThan(20);
    for (const p of paths) {
      expect(isUnknownSlugPath(p), p).toBe(false);
      expect(isUnknownSlugPath(`${p}/`), `${p}/`).toBe(false);
    }
  });

  it("flags unknown slugs under each dynamic prefix", () => {
    for (const p of ["/financing/zz1", "/insights/zz2", "/structures/nope", "/calculators/nope", "/california/nope", "/financing/%E0%A4%A"]) {
      expect(isUnknownSlugPath(p), p).toBe(true);
    }
  });

  it("leaves index pages, other routes and deeper paths to Next", () => {
    for (const p of ["/", "/financing", "/financing/", "/insights", "/contact", "/api/financing/x", "/financing/a/b", "/glossary/x"]) {
      expect(isUnknownSlugPath(p), p).toBe(false);
    }
  });
});
