import { describe, expect, it } from "vitest";
import { buildCsp, securityHeaders } from "./csp";

const directive = (csp: string, name: string) =>
  csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${name} `) || d === name);

describe("buildCsp", () => {
  const prod = buildCsp({ NODE_ENV: "production", SUPABASE_URL: "https://abcd.supabase.co" });

  it("locks down framing, plugins, base and form targets", () => {
    expect(directive(prod, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(prod, "object-src")).toBe("object-src 'none'");
    expect(directive(prod, "base-uri")).toBe("base-uri 'self'");
    expect(directive(prod, "form-action")).toBe("form-action 'self'");
    expect(directive(prod, "upgrade-insecure-requests")).toBeDefined();
  });

  it("allows Turnstile, Supabase and Cal.com where they are used", () => {
    expect(directive(prod, "script-src")).toContain("https://challenges.cloudflare.com");
    expect(directive(prod, "frame-src")).toContain("https://challenges.cloudflare.com");
    expect(directive(prod, "frame-src")).toContain("https://app.cal.com");
    expect(directive(prod, "connect-src")).toContain("https://abcd.supabase.co");
    expect(directive(prod, "connect-src")).toContain("wss://abcd.supabase.co");
  });

  it("works without a nonce (static shell) and never allows eval in production", () => {
    expect(prod).not.toMatch(/nonce-/);
    expect(directive(prod, "script-src")).toContain("'unsafe-inline'");
    expect(directive(prod, "script-src")).not.toContain("'unsafe-eval'");
    expect(directive(buildCsp({ NODE_ENV: "development" }), "script-src")).toContain("'unsafe-eval'");
  });

  it("falls back to the Supabase wildcard when no project URL is configured", () => {
    expect(directive(buildCsp({ NODE_ENV: "production" }), "connect-src")).toContain("https://*.supabase.co");
  });

  it("has no wildcard sources beyond the scoped vendor subdomains", () => {
    for (const d of prod.split(";")) {
      for (const token of d.trim().split(/\s+/).slice(1)) {
        expect(token === "*" || token === "https:" || token === "http:").toBe(false);
      }
    }
  });
});

describe("securityHeaders", () => {
  it("includes CSP, HSTS, nosniff and a payment-free permissions policy", () => {
    const h = Object.fromEntries(securityHeaders({ NODE_ENV: "production" }).map((x) => [x.key, x.value]));
    expect(h["Content-Security-Policy"]).toBeTruthy();
    expect(h["Strict-Transport-Security"]).toContain("max-age=63072000");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Permissions-Policy"]).toContain("payment=()");
  });
});
