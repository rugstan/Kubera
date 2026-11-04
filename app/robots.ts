import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { buildRobots } from "@/lib/seo/robots";

// Host-aware: the express domain and the main site get different rules, so this
// reads the request host and is rendered per request.
export default async function robots(): Promise<MetadataRoute.Robots> {
  const h = await headers();
  return buildRobots(h.get("x-forwarded-host") ?? h.get("host"));
}
