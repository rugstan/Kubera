import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { site } from "@/lib/site";
import { proxy } from "./proxy";

// The unit environment has no NEXT_PUBLIC_SITE_URL, so the site URL is the
// production one and these requests behave exactly as they do on the VPS.
const canonical = new URL(site.siteUrl);
const www = `www.${canonical.hostname}`;

function request(url: string, init: { method?: string; host?: string } = {}) {
  const headers = new Headers();
  if (init.host) headers.set("host", init.host);
  return new NextRequest(url, { method: init.method ?? "GET", headers });
}

describe("proxy host rules", () => {
  it("301s the www twin to the canonical host with the same path and query", () => {
    const res = proxy(request(`https://${www}/financing/hud-232?utm_source=test&b=2`, { host: www }));
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`${canonical.origin}/financing/hud-232?utm_source=test&b=2`);
  });

  it("301s robots.txt and the sitemap on the www twin too", () => {
    for (const path of ["/robots.txt", "/sitemap.xml", "/"]) {
      const res = proxy(request(`https://${www}${path}`, { host: www }));
      expect(res.status, path).toBe(301);
      expect(res.headers.get("location"), path).toBe(`${canonical.origin}${path}`);
    }
  });

  it("keeps a POST's method with a 308", () => {
    const res = proxy(request(`https://${www}/api/qualify`, { host: www, method: "POST" }));
    expect(res.status).toBe(308);
  });

  it("serves the canonical host without a noindex header", () => {
    const res = proxy(request(`${canonical.origin}/financing/hud-232`, { host: canonical.host }));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-robots-tag")).toBeNull();
  });

  it("noindexes every other host that serves the build (the Vercel copy, a bare IP)", () => {
    for (const host of ["kubera-tau.vercel.app", "203.0.113.7"]) {
      const res = proxy(request(`https://${host}/financing/hud-232`, { host }));
      expect(res.headers.get("location"), host).toBeNull();
      expect(res.headers.get("x-robots-tag"), host).toBe("noindex, follow");
    }
  });

  it("prefers X-Forwarded-Host, which nginx sets to the client's host", () => {
    const headers = new Headers({ host: "127.0.0.1:3000", "x-forwarded-host": www });
    const res = proxy(new NextRequest("http://127.0.0.1:3000/about", { headers }));
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`${canonical.origin}/about`);
  });
});
