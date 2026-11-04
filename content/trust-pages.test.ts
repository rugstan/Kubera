import { describe, expect, it } from "vitest";
import { MAX_DESCRIPTION_LENGTH, MAX_TITLE_LENGTH, renderedTitle } from "@/lib/seo/metadata";
import { allSitemapRoutes } from "@/lib/seo/sitemap-routes";
import { DEAL_STRUCTURES, structurePath } from "./deal-structures";
import { TRACK_RECORD } from "./track-record";
import { TRUST_PAGES, indexedTrustPages, trustRoutes } from "./trust-pages";

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

  it("includes every indexed trust page and structure once", () => {
    for (const p of indexedTrustPages()) expect(paths.filter((x) => x === p.path)).toHaveLength(1);
    for (const s of DEAL_STRUCTURES) expect(paths.filter((x) => x === structurePath(s.slug))).toHaveLength(1);
  });

  it("leaves /track-record out until a closed transaction is published, then lists it", () => {
    expect(TRACK_RECORD).toHaveLength(0);
    expect(paths).not.toContain(TRUST_PAGES.trackRecord.path);
    const record = { id: "x", closedYear: 2026, assetType: "Hotel", program: "SBA 504", loanAmountUsd: 1, location: "CA", summary: "s", clientPermission: true, verifiedOn: "2026-10-01" };
    expect(indexedTrustPages([record]).map((p) => p.path)).toContain(TRUST_PAGES.trackRecord.path);
    expect(indexedTrustPages([]).map((p) => p.path)).not.toContain(TRUST_PAGES.trackRecord.path);
  });

  it("does not drop the existing routes", () => {
    for (const p of ["/", "/express", "/partners", "/privacy", "/licensing"]) expect(paths).toContain(p);
  });
});
