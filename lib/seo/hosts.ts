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

/** Absolute URL on the canonical (main) site. */
export function canonicalUrl(path: string): string {
  const base = site.siteUrl.replace(/\/+$/, "");
  if (path === "/" || path === "") return `${base}/`;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
