import type { Metadata } from "next";
import { site } from "@/lib/site";

/**
 * Metadata for a legal page: one canonical URL and a per-route Open Graph URL.
 * Child openGraph objects replace the parent's, so the shared fields are repeated.
 */
export function legalMetadata(path: `/${string}`, title: string, description: string): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", siteName: site.name, title, description, url: path },
  };
}
