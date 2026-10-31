import { describe, expect, it } from "vitest";
import { MAX_DESCRIPTION_LENGTH, MAX_TITLE_LENGTH, renderedTitle } from "@/lib/seo/metadata";
import { allSitemapRoutes } from "@/lib/seo/sitemap-routes";
import { DEAL_STRUCTURES, structurePath } from "./deal-structures";
import { TRUST_PAGES, trustRoutes } from "./trust-pages";

describe("trust page metadata", () => {
  it.each(Object.values(TRUST_PAGES))("$path has a short unique title and description", (p) => {
    expect(renderedTitle({ title: p.title }).length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(p.description.length).toBeGreaterThan(50);
    expect(p.description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
  });

  it("uses distinct titles and descriptions across trust pages and structures", () => {
    const titles = trustRoutes.map((r) => r.title);
    const descriptions = trustRoutes.map((r) => r.description);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it("keeps every structure title and description within limits", () => {
    for (const s of DEAL_STRUCTURES) {
      expect(renderedTitle({ title: s.metaTitle }).length, s.slug).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
      expect(s.summary.length, s.slug).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
    }
  });
});

describe("sitemap", () => {
  const paths = allSitemapRoutes().map((r) => r.path);

  it("includes every trust page and structure once", () => {
    for (const p of Object.values(TRUST_PAGES)) expect(paths.filter((x) => x === p.path)).toHaveLength(1);
    for (const s of DEAL_STRUCTURES) expect(paths.filter((x) => x === structurePath(s.slug))).toHaveLength(1);
  });

  it("does not drop the existing routes", () => {
    for (const p of ["/", "/express", "/partners", "/privacy", "/licensing"]) expect(paths).toContain(p);
  });
});
