import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/metadata";

/**
 * Metadata for a legal page. Goes through the shared `pageMetadata()` so legal
 * routes get the same canonical, matching Open Graph URL, 1200x630 share image,
 * large Twitter card and branded title as every other page.
 */
export function legalMetadata(path: `/${string}`, title: string, description: string): Metadata {
  return pageMetadata({ title, description, path });
}
