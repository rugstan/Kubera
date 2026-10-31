import type { MetadataRoute } from "next";
import { toSitemap } from "@/lib/seo/sitemap-routes";

export default function sitemap(): MetadataRoute.Sitemap {
  return toSitemap();
}
