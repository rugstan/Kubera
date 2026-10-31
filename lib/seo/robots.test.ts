import { describe, expect, it } from "vitest";
import { AI_CRAWLERS, buildRobots } from "./robots";

type Rule = { userAgent?: string | string[]; allow?: string | string[]; disallow?: string | string[] };
const rules = (r: ReturnType<typeof buildRobots>) => (Array.isArray(r.rules) ? r.rules : [r.rules]) as Rule[];

describe("buildRobots", () => {
  it("main site: blocks /api/, names AI crawlers, lists the sitemap", () => {
    const r = buildRobots("kuberacommercial.com", {});
    expect(r.sitemap).toMatch(/\/sitemap\.xml$/);
    const star = rules(r).find((x) => x.userAgent === "*")!;
    expect(star.allow).toBe("/");
    expect(star.disallow).toContain("/api/");
    const ai = rules(r).find((x) => Array.isArray(x.userAgent))!;
    expect(ai.userAgent).toEqual(expect.arrayContaining(["GPTBot", "OAI-SearchBot", "PerplexityBot", "ClaudeBot", "Google-Extended"]));
    expect([...AI_CRAWLERS]).toHaveLength(5);
    // A named group replaces "*" for that bot, so it must repeat the /api/ block.
    expect(ai.disallow).toContain("/api/");
  });

  it("express host: crawlable root, no sitemap", () => {
    for (const host of ["kubera.loans", "www.kubera.loans:443"]) {
      const r = buildRobots(host, {});
      expect(r.sitemap).toBeUndefined();
      expect(rules(r)).toHaveLength(1);
      expect(rules(r)[0]).toMatchObject({ userAgent: "*", allow: "/" });
    }
  });

  it("preview deployments disallow everything, on any host", () => {
    for (const host of ["kuberacommercial.com", "kubera.loans", "x.vercel.app"]) {
      const r = buildRobots(host, { VERCEL_ENV: "preview" });
      expect(r.sitemap).toBeUndefined();
      expect(rules(r)).toEqual([{ userAgent: "*", disallow: "/" }]);
    }
  });

  it("unknown hosts get the main-site rules", () => {
    expect(buildRobots("localhost:3000", {}).sitemap).toBeDefined();
    expect(buildRobots(null, {}).sitemap).toBeDefined();
  });
});
