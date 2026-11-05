import type { MetadataRoute } from "next";
import { canonicalUrl, classifyHost, isPreviewDeployment } from "./hosts";

/** AI search and assistant crawlers that are explicitly welcome on the main site. */
export const AI_CRAWLERS = ["GPTBot", "OAI-SearchBot", "PerplexityBot", "ClaudeBot", "Google-Extended"] as const;

/**
 * Paths no crawler needs: the API, the borrower portal and the sign-in pages
 * (which also send noindex metadata). The staff desks are deliberately not
 * listed: robots.txt is public, so naming each desk would publish the back
 * office's route map. They need a session (anonymous requests redirect to
 * /login, which is disallowed here) and send `X-Robots-Tag: noindex` from
 * next.config.ts plus noindex metadata from the staff layout.
 */
export const DISALLOWED_PATHS = ["/api/", "/portal", "/login", "/mfa", "/auth", "/access-denied"];

/**
 * robots.txt content for a request host.
 * - Preview deployments: disallow everything.
 * - Hosts that are not the configured site URL, its www twin or the express
 *   domain (the Vercel copy, the server's bare IP): disallow everything, so
 *   the duplicate is neither crawled nor indexed. Pages there also carry
 *   `X-Robots-Tag: noindex` from proxy.ts.
 * - kubera.loans: crawlable but no sitemap (pages also carry `X-Robots-Tag: noindex`).
 * - Main site: block `/api/`, list the sitemap, and name AI crawlers explicitly.
 *   A named group replaces the `*` group for that bot, so the disallow list is repeated.
 */
export function buildRobots(rawHost: string | null | undefined, env: Record<string, string | undefined> = process.env, siteUrl?: string): MetadataRoute.Robots {
  const kind = classifyHost(rawHost, env, siteUrl);
  if (isPreviewDeployment(env) || kind === "other") {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
  if (kind === "express") {
    return { rules: [{ userAgent: "*", allow: "/", disallow: DISALLOWED_PATHS }] };
  }
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: DISALLOWED_PATHS },
      { userAgent: [...AI_CRAWLERS], allow: "/", disallow: DISALLOWED_PATHS },
    ],
    sitemap: canonicalUrl("/sitemap.xml"),
  };
}
