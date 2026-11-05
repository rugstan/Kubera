import { describe, expect, it } from "vitest";
import { staffRouteFolders } from "@/lib/auth/staff-route-folders";
import { AI_CRAWLERS, buildRobots } from "./robots";

type Rule = { userAgent?: string | string[]; allow?: string | string[]; disallow?: string | string[] };
const rules = (r: ReturnType<typeof buildRobots>) => (Array.isArray(r.rules) ? r.rules : [r.rules]) as Rule[];

describe("buildRobots", () => {
  it("main site: blocks /api/, names AI crawlers, lists the sitemap", () => {
    const r = buildRobots("corincommercial.com", {});
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

  it("does not publish the staff desks, which are noindexed by header instead", async () => {
    const text = JSON.stringify(buildRobots("corincommercial.com", {}));
    for (const f of staffRouteFolders()) expect(text, `/${f}`).not.toContain(`"/${f}"`);
    expect(text).not.toMatch(/ai-review/);
    // Sign-in and the portal stay disallowed, so a redirect from a desk lands on a blocked path.
    const star = rules(buildRobots("corincommercial.com", {})).find((x) => x.userAgent === "*")!;
    for (const p of ["/login", "/mfa", "/auth", "/portal", "/api/"]) expect(star.disallow, p).toContain(p);
    // Every desk sends X-Robots-Tag: noindex from next.config.ts.
    const { default: config } = await import("@/next.config");
    const headers = await config.headers!();
    for (const f of staffRouteFolders()) {
      const rule = headers.find((h) => h.source === `/${f}/:path*`);
      expect(rule?.headers, `/${f}`).toEqual(expect.arrayContaining([{ key: "X-Robots-Tag", value: "noindex, nofollow" }]));
    }
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
    for (const host of ["corincommercial.com", "kubera.loans", "x.vercel.app"]) {
      const r = buildRobots(host, { VERCEL_ENV: "preview" });
      expect(r.sitemap).toBeUndefined();
      expect(rules(r)).toEqual([{ userAgent: "*", disallow: "/" }]);
    }
  });

  it("hosts other than the site URL, its www twin and the express domain disallow everything", () => {
    for (const host of ["kubera-tau.vercel.app", "203.0.113.7", "localhost:3000"]) {
      const r = buildRobots(host, {}, "https://corincommercial.com");
      expect(r.sitemap, host).toBeUndefined();
      expect(rules(r), host).toEqual([{ userAgent: "*", disallow: "/" }]);
    }
  });

  it("the canonical host, its www twin and a request without a host get the main-site rules", () => {
    for (const host of ["corincommercial.com", "www.corincommercial.com", null]) {
      expect(buildRobots(host, {}, "https://corincommercial.com").sitemap, String(host)).toMatch(/\/sitemap\.xml$/);
    }
    // e2e and local runs set the site URL to localhost, which then counts as canonical.
    expect(buildRobots("localhost:3999", {}, "http://localhost:3999").sitemap).toBeDefined();
  });
});
