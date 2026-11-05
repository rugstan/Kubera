import type { NextConfig } from "next";
import { STAFF_ROUTE_PREFIXES } from "./lib/auth/staff-routes";
import { securityHeaders } from "./lib/csp";

const nextConfig: NextConfig = {
  // The VPS deploy (.github/workflows/vps.yml) builds a self-contained server
  // (.next/standalone/server.js). Vercel and CI builds keep the default output.
  ...(process.env.NEXT_OUTPUT_STANDALONE === "1" ? { output: "standalone" as const } : {}),
  // Cache Components is Next 16's stable Partial Prerendering: a static shell
  // ships from the edge and dynamic holes (the rate ticker) stream in.
  cacheComponents: true,
  partialPrefetching: true,
  cacheLife: {
    rates: { stale: 300, revalidate: 900, expire: 86_400 },
  },
  poweredByHeader: false,
  // Next renders every request from an "HTML-limited" bot (Bingbot, Applebot,
  // DuckDuckBot, Google-Extended, Lighthouse, link-preview bots) dynamically so
  // that streamed metadata lands in <head>. Every public page here is fully
  // prerendered with its metadata already in <head>, so those bots were getting
  // a slower, uncacheable (`private, no-store`) and ~60% heavier copy of the same
  // page. A pattern that matches no user agent serves them the static page.
  htmlLimitedBots: /(?!)/,
  // Keeps Sentry's server runtime hook out of the bundle so it registers its
  // diagnostics channel once at startup instead of warning when a DSN is set.
  serverExternalPackages: ["@sentry/server-runtime-injection"],
  async redirects() {
    // The AI-use page was folded into the privacy policy. The destination has no
    // fragment, so an old /privacy/ai#request link keeps its anchor on /privacy.
    return [{ source: "/privacy/ai", destination: "/privacy", permanent: true }];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders() },
      // JSON endpoints are never indexed.
      { source: "/api/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex" }] },
      // Staff desks are noindexed by header rather than listed in the public
      // robots.txt (see lib/seo/robots.ts). `:path*` also matches the bare prefix.
      ...STAFF_ROUTE_PREFIXES.map((prefix) => ({
        source: `${prefix}/:path*`,
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      })),
    ];
  },
};

export default nextConfig;
