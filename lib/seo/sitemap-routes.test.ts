import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import sitemap from "@/app/sitemap";
import { allSitemapRoutes, coreRoutes, legalRoutes, toSitemap } from "./sitemap-routes";

const root = path.resolve(import.meta.dirname, "../..");

function hasPage(routePath: string): boolean {
  const segs = routePath === "/" ? [] : routePath.replace(/^\//, "").split("/");
  const candidates = [
    path.join(root, "app", ...segs, "page.tsx"),
    path.join(root, "app", "(site)", ...segs, "page.tsx"),
    path.join(root, "app", "(site)", "(legal)", ...segs, "page.tsx"),
  ];
  return candidates.some(existsSync);
}

describe("sitemap", () => {
  const entries = sitemap();

  it("lists absolute, unique, canonical urls", () => {
    const urls = entries.map((e) => e.url);
    expect(new Set(urls).size).toBe(urls.length);
    for (const u of urls) {
      expect(u).toMatch(/^https?:\/\//);
      expect(u).not.toContain("kubera.loans");
      expect(u).not.toContain("/api/");
    }
    expect(urls.some((u) => /\/express$/.test(u))).toBe(true);
  });

  it("every core page exists in the app directory", () => {
    for (const r of coreRoutes) expect(hasPage(r.path), r.path).toBe(true);
  });

  it("legal pages are the four compliance routes", () => {
    expect(legalRoutes.map((r) => r.path)).toEqual(["/privacy", "/terms", "/licensing", "/accessibility"]);
  });

  it("dedupes paths and trailing slashes across sources", () => {
    const routes = allSitemapRoutes([[{ path: "/a/", title: "A" }], [{ path: "/a", title: "A2" }, { path: "/", title: "Home" }]]);
    expect(routes.map((r) => r.path)).toEqual(["/a", "/"]);
  });

  it("omits lastModified unless known", () => {
    expect(toSitemap([{ path: "/x", title: "X" }])[0]).not.toHaveProperty("lastModified");
    expect(toSitemap([{ path: "/x", title: "X", lastModified: "2026-01-01" }])[0]).toHaveProperty("lastModified", "2026-01-01");
  });
});

describe("manifest", () => {
  it("has name, start_url and icons", () => {
    const m = manifest();
    expect(m.name).toBe("Kubera Commercial");
    expect(m.start_url).toBe("/");
    expect(m.icons?.length).toBeGreaterThan(0);
    for (const icon of m.icons ?? []) expect(icon.src.startsWith("/")).toBe(true);
  });
});
