import type { Metadata } from "next";
import { site } from "@/lib/site";
import type { SiteImage } from "@/content/images";
import { canonicalUrl } from "./hosts";
import { shareImage } from "./og";

export const MAX_TITLE_LENGTH = 60;
export const MAX_DESCRIPTION_LENGTH = 160;

interface PageMetadataInput {
  /** Short page title; the root layout template appends the brand. */
  title: string;
  /** Use when the full `<title>` is set explicitly (no template), e.g. the home page. */
  absoluteTitle?: string;
  description: string;
  /** Path on the canonical site, e.g. `/express`. */
  path: string;
  /**
   * The page's own photo (content/images.ts). Its 1200x630 crop becomes the
   * og:image and twitter:image; without one the brand card is used.
   */
  image?: SiteImage | null;
}

/** The title as it renders, given the root layout's `%s · Corin Commercial` template. */
export function renderedTitle({ title, absoluteTitle }: Pick<PageMetadataInput, "title" | "absoluteTitle">): string {
  return absoluteTitle ?? `${title} · ${site.name}`;
}

/**
 * Per-route metadata with a self-referencing canonical on the main domain and a
 * matching `openGraph.url`. Next replaces the whole `openGraph` object when a page
 * sets one, so the shared fields are repeated here.
 */
export function pageMetadata(input: PageMetadataInput): Metadata {
  const url = canonicalUrl(input.path);
  const full = renderedTitle(input);
  // A page-level `openGraph` replaces the root `opengraph-image` file convention,
  // so the image is always attached explicitly. It resolves against `metadataBase`.
  const image = shareImage(input.image);
  return {
    title: input.absoluteTitle ? { absolute: input.absoluteTitle } : input.title,
    description: input.description,
    alternates: { canonical: url },
    openGraph: { type: "website", siteName: site.name, locale: "en_US", url, title: full, description: input.description, images: [image] },
    twitter: { card: "summary_large_image", title: full, description: input.description, images: [{ url: image.url, alt: image.alt, width: image.width, height: image.height }] },
  };
}
