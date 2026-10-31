import type { MetadataRoute } from "next";
import { canonicalUrl, isExpressHost, isPreviewDeployment } from "./hosts";

/** AI search and assistant crawlers that are explicitly welcome on the main site. */
export const AI_CRAWLERS = ["GPTBot", "OAI-SearchBot", "PerplexityBot", "ClaudeBot", "Google-Extended"] as const;

/** Paths no crawler needs. Add staff/portal prefixes here when those routes ship. */
export const DISALLOWED_PATHS = ["/api/"];

/**
 * robots.txt content for a request host.
 * - Preview deployments: disallow everything.
 * - kubera.loans: crawlable but no sitemap (pages also carry `X-Robots-Tag: noindex`).
 * - Main site: block `/api/`, list the sitemap, and name AI crawlers explicitly.
 *   A named group replaces the `*` group for that bot, so the disallow list is repeated.
 */
export function buildRobots(rawHost: string | null | undefined, env: Record<string, string | undefined> = process.env): MetadataRoute.Robots {
  if (isPreviewDeployment(env)) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
  if (isExpressHost(rawHost, env)) {
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
