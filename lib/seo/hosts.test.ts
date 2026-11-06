import { describe, expect, it } from "vitest";
import { aliasHost, aliasRedirect, canonicalHost, canonicalUrl, classifyHost, expressAction, isExpressHost, isPreviewDeployment, normalizeHost } from "./hosts";

describe("host detection", () => {
  it("normalizes ports, case and forwarded lists", () => {
    expect(normalizeHost("Kubera.Loans:3000")).toBe("kubera.loans");
    expect(normalizeHost("kubera.loans, proxy.internal")).toBe("kubera.loans");
    expect(normalizeHost(null)).toBe("");
  });

  it("recognizes the default express hosts only", () => {
    expect(isExpressHost("kubera.loans", {})).toBe(true);
    expect(isExpressHost("www.kubera.loans", {})).toBe(true);
    expect(isExpressHost("corincommercial.com", {})).toBe(false);
    expect(isExpressHost("localhost:3000", {})).toBe(false);
    expect(isExpressHost(undefined, {})).toBe(false);
  });

  it("honors EXPRESS_HOSTS", () => {
    expect(isExpressHost("go.example.com", { EXPRESS_HOSTS: " go.example.com , x.example.com" })).toBe(true);
    expect(isExpressHost("kubera.loans", { EXPRESS_HOSTS: "go.example.com" })).toBe(false);
  });

  it("flags preview deployments", () => {
    expect(isPreviewDeployment({ VERCEL_ENV: "preview" })).toBe(true);
    expect(isPreviewDeployment({ VERCEL_ENV: "production" })).toBe(false);
    expect(isPreviewDeployment({})).toBe(false);
  });
});

describe("expressAction (kubera.loans routing)", () => {
  it("renders the qualifier at the root", () => {
    expect(expressAction("/")).toEqual({ type: "rewrite", pathname: "/express" });
  });

  it("308s /express to / on the same domain", () => {
    expect(expressAction("/express")).toEqual({ type: "redirect", pathname: "/", mainSite: false, status: 308 });
    expect(expressAction("/express/")).toMatchObject({ type: "redirect", pathname: "/", mainSite: false, status: 308 });
  });

  it("has no sitemap", () => {
    expect(expressAction("/sitemap.xml")).toEqual({ type: "notFound" });
  });

  it("passes API calls and metadata assets through", () => {
    for (const p of ["/api/qualify", "/_next/static/a.js", "/icon.png", "/apple-icon.png", "/opengraph-image", "/manifest.webmanifest", "/robots.txt"]) {
      expect(expressAction(p)).toEqual({ type: "next" });
    }
  });

  it("sends everything else to the main site", () => {
    expect(expressAction("/partners")).toEqual({ type: "redirect", pathname: "/partners", mainSite: true, status: 308 });
    expect(expressAction("/financing/hud-232")).toMatchObject({ type: "redirect", mainSite: true });
  });
});

describe("canonicalUrl", () => {
  it("builds absolute urls on the main site", () => {
    expect(canonicalUrl("/")).toMatch(/^https?:\/\/[^/]+\/$/);
    expect(canonicalUrl("/express")).toMatch(/^https?:\/\/[^/]+\/express$/);
    expect(canonicalUrl("partners")).toMatch(/\/partners$/);
    expect(canonicalUrl("/express")).not.toContain("kubera.loans");
  });
});

describe("classifyHost (keyed off the configured site URL)", () => {
  const SITE = "https://corincommercial.com";

  it("derives the canonical host and its www twin from the site URL", () => {
    expect(canonicalHost(SITE)).toBe("corincommercial.com");
    expect(aliasHost(SITE)).toBe("www.corincommercial.com");
    expect(aliasHost("https://www.example.com")).toBe("example.com");
    // A bare host such as localhost has no twin.
    expect(aliasHost("http://localhost:3999")).toBe("");
  });

  it("sorts request hosts into canonical, alias, express and other", () => {
    expect(classifyHost("corincommercial.com", {}, SITE)).toBe("canonical");
    expect(classifyHost("CorinCommercial.com:443", {}, SITE)).toBe("canonical");
    expect(classifyHost("www.corincommercial.com", {}, SITE)).toBe("alias");
    expect(classifyHost("kubera.loans", {}, SITE)).toBe("express");
    expect(classifyHost("kubera-tau.vercel.app", {}, SITE)).toBe("other");
    expect(classifyHost("203.0.113.7", {}, SITE)).toBe("other");
    expect(classifyHost("localhost:3000", {}, SITE)).toBe("other");
    // No host header at all (an internal request) is never treated as a duplicate.
    expect(classifyHost(null, {}, SITE)).toBe("canonical");
  });

  it("keeps local runs indexable when the site URL is local (dev and e2e)", () => {
    expect(classifyHost("localhost:3999", {}, "http://localhost:3999")).toBe("canonical");
    expect(classifyHost("127.0.0.1", { EXPRESS_HOSTS: "127.0.0.1" }, "http://localhost:3999")).toBe("express");
  });
});

describe("aliasRedirect", () => {
  const SITE = "https://corincommercial.com";

  it("301s GET and HEAD to the same path and query on the canonical host", () => {
    expect(aliasRedirect("/financing/hud-232", "?utm_source=x&b=2", "GET", SITE)).toEqual({ url: "https://corincommercial.com/financing/hud-232?utm_source=x&b=2", status: 301 });
    expect(aliasRedirect("/", "", "HEAD", SITE)).toEqual({ url: "https://corincommercial.com/", status: 301 });
  });

  it("uses 308 for other methods so a POST body is not dropped", () => {
    expect(aliasRedirect("/api/qualify", "", "POST", SITE).status).toBe(308);
  });
});
