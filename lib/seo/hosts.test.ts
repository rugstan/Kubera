import { describe, expect, it } from "vitest";
import { canonicalUrl, expressAction, isExpressHost, isPreviewDeployment, normalizeHost } from "./hosts";

describe("host detection", () => {
  it("normalizes ports, case and forwarded lists", () => {
    expect(normalizeHost("Kubera.Loans:3000")).toBe("kubera.loans");
    expect(normalizeHost("kubera.loans, proxy.internal")).toBe("kubera.loans");
    expect(normalizeHost(null)).toBe("");
  });

  it("recognizes the default express hosts only", () => {
    expect(isExpressHost("kubera.loans", {})).toBe(true);
    expect(isExpressHost("www.kubera.loans", {})).toBe(true);
    expect(isExpressHost("kuberacommercial.com", {})).toBe(false);
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
    for (const p of ["/api/qualify", "/_next/static/a.js", "/icon.svg", "/apple-icon", "/opengraph-image", "/manifest.webmanifest", "/robots.txt"]) {
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
