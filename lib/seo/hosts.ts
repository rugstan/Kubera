// Host-aware SEO and routing rules shared by `proxy.ts`, `app/robots.ts` and
// the sitemap. Kept free of Next imports so it is unit-testable.

import { site } from "@/lib/site";

const DEFAULT_EXPRESS_HOSTS = "kubera.loans,www.kubera.loans";

type Env = Record<string, string | undefined>;

/** Hosts that only serve the 60-second qualifier (configurable via EXPRESS_HOSTS). */
export function expressHosts(env: Env = process.env): Set<string> {
  return new Set(
    (env.EXPRESS_HOSTS ?? DEFAULT_EXPRESS_HOSTS)
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Lowercased host without port, using the first value of a forwarded list. */
export function normalizeHost(raw: string | null | undefined): string {
  return (raw ?? "").split(",")[0]!.trim().split(":")[0]!.toLowerCase();
}

export function isExpressHost(rawHost: string | null | undefined, env: Env = process.env): boolean {
  return expressHosts(env).has(normalizeHost(rawHost));
}

/** Preview deployments must never be indexed. */
export function isPreviewDeployment(env: Env = process.env): boolean {
  return env.VERCEL_ENV === "preview";
}

/** Paths on the express domain that are served as-is (assets, metadata files, API). */
const EXPRESS_PASSTHROUGH_PREFIXES = [
  "/api/",
  "/_next/",
  "/icon",
  "/apple-icon",
  "/opengraph-image",
  "/twitter-image",
  "/manifest.webmanifest",
  "/robots.txt",
];

export type ExpressAction =
  | { type: "next" }
  | { type: "rewrite"; pathname: string }
  | { type: "redirect"; pathname: string; mainSite: boolean; status: 308 }
  | { type: "notFound" };

/**
 * What the proxy does with a request on an express host (kubera.loans):
 * - `/` renders the qualifier (rewrite to /express, URL stays `kubera.loans/`)
 * - `/express` 308s to `/` so the qualifier has one URL on this domain
 * - the sitemap does not exist on this domain
 * - everything else belongs to the main site
 */
export function expressAction(pathname: string): ExpressAction {
  if (pathname === "/") return { type: "rewrite", pathname: "/express" };
  if (pathname === "/express" || pathname === "/express/") return { type: "redirect", pathname: "/", mainSite: false, status: 308 };
  if (pathname === "/sitemap.xml") return { type: "notFound" };
  if (EXPRESS_PASSTHROUGH_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) return { type: "next" };
  return { type: "redirect", pathname, mainSite: true, status: 308 };
}

export const NOINDEX_HEADER = "noindex, follow";

/** Lowercased hostname of the configured site URL (NEXT_PUBLIC_SITE_URL), e.g. `corincommercial.com`. */
export function canonicalHost(siteUrl: string = site.siteUrl): string {
  try {
    return new URL(siteUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** The other spelling of the canonical host: `www.` added, or removed when the site URL has it. */
export function aliasHost(siteUrl: string = site.siteUrl): string {
  const host = canonicalHost(siteUrl);
  if (!host || !host.includes(".")) return "";
  return host.startsWith("www.") ? host.slice(4) : `www.${host}`;
}

/**
 * The firm's own domain and its www twin. They are the main site whatever
 * NEXT_PUBLIC_SITE_URL says: a build with a mistyped, staging or localhost site
 * URL must never send `noindex` (or a disallow-all robots.txt) from
 * corincommercial.com, which would drop the live site from search.
 */
const PRIMARY_HOST = site.primaryDomain.toLowerCase();
const PRIMARY_ALIAS = `www.${PRIMARY_HOST}`;

/**
 * How a request host relates to the configured site URL:
 * - `canonical`: the site URL's own host or the firm's primary domain (also a
 *   request with no host header).
 * - `alias`: their www / non-www twin, which 301s to the canonical host.
 * - `express`: the qualifier-only domain (kubera.loans).
 * - `other`: anything else (the Vercel copy, the VPS's bare IP, localhost
 *   when the site URL names the real domain). Served, but never indexed.
 */
export type HostKind = "canonical" | "alias" | "express" | "other";

export function classifyHost(rawHost: string | null | undefined, env: Env = process.env, siteUrl: string = site.siteUrl): HostKind {
  const host = normalizeHost(rawHost);
  if (isExpressHost(host, env)) return "express";
  if (!host || host === canonicalHost(siteUrl) || host === PRIMARY_HOST) return "canonical";
  if (host === aliasHost(siteUrl) || host === PRIMARY_ALIAS) return "alias";
  return "other";
}

/**
 * Where a request on the alias host goes: the same path and query on the
 * canonical origin (www.corincommercial.com always goes to
 * https://corincommercial.com). 301 for GET and HEAD (what search engines
 * consolidate on); 308 for other methods so a form POST is not turned into a
 * GET. The path is set on the canonical origin, never resolved against it, so
 * a `//other.host/...` path cannot send the visitor to another site.
 */
export function aliasRedirect(
  pathname: string,
  search: string,
  method: string,
  siteUrl: string = site.siteUrl,
  rawHost?: string | null,
): { url: string; status: 301 | 308 } {
  const target = new URL(normalizeHost(rawHost) === PRIMARY_ALIAS ? `https://${PRIMARY_HOST}` : siteUrl);
  target.pathname = pathname;
  target.search = search;
  target.hash = "";
  return { url: target.toString(), status: method === "GET" || method === "HEAD" ? 301 : 308 };
}

/** Absolute URL on the canonical (main) site. */
export function canonicalUrl(path: string): string {
  const base = site.siteUrl.replace(/\/+$/, "");
  if (path === "/" || path === "") return `${base}/`;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
