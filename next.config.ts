import type { NextConfig } from "next";
import { securityHeaders } from "./lib/csp";

const nextConfig: NextConfig = {
  // Cache Components is Next 16's stable Partial Prerendering: a static shell
  // ships from the edge and dynamic holes (the rate ticker) stream in.
  cacheComponents: true,
  partialPrefetching: true,
  cacheLife: {
    rates: { stale: 300, revalidate: 900, expire: 86_400 },
  },
  poweredByHeader: false,
  // Keeps Sentry's server runtime hook out of the bundle so it registers its
  // diagnostics channel once at startup instead of warning when a DSN is set.
  serverExternalPackages: ["@sentry/server-runtime-injection"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders() },
      // JSON endpoints are never indexed.
      { source: "/api/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex" }] },
    ];
  },
};

export default nextConfig;
