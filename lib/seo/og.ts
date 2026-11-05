// Share images (og:image, twitter:image) built from a page's own photo.
// scripts/og-images.mjs crops every photo in assets/images/ to 1200x630 JPEG at
// public/og/<name>.jpg; this maps a SiteImage to that file. og.test.ts fails
// when a photo has no share image, so a new photo needs the script re-run.

import { getCalculator } from "@/content/calculators";
import { ABOUT_IMAGE, pageImageFor, type SiteImage } from "@/content/images";
import { getFinancingPage } from "@/content/programs";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export interface ShareImage {
  url: string;
  width: number;
  height: number;
  alt: string;
  type: "image/jpeg" | "image/png";
}

/** The site-wide brand card (app/opengraph-image.tsx), for pages without a photo of their own. */
export const DEFAULT_SHARE_IMAGE: ShareImage = {
  url: "/opengraph-image",
  width: OG_WIDTH,
  height: OG_HEIGHT,
  alt: "Corin Commercial: commercial real estate loan brokerage",
  type: "image/png",
};

/**
 * File name of a photo without directory, build hash or extension:
 * `/_next/static/media/program-hud-232.2osz6kyorun8z.webp` -> `program-hud-232`.
 */
export function photoName(image: SiteImage): string {
  const base = image.src.src.split("/").pop() ?? "";
  const name = base.split(".")[0] ?? "";
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`Unexpected image file name: ${image.src.src}`);
  return name;
}

/** Path of the 1200x630 share image for a photo, relative to the site root. */
export function ogImagePath(image: SiteImage): string {
  return `/og/${photoName(image)}.jpg`;
}

/** Share image for a page: its own photo when it has one, else the brand card. */
export function shareImage(image: SiteImage | null | undefined): ShareImage {
  if (!image) return DEFAULT_SHARE_IMAGE;
  return { url: ogImagePath(image), width: OG_WIDTH, height: OG_HEIGHT, alt: image.alt, type: "image/jpeg" };
}

/** The photo of a financing page (/financing/<slug>): the program's own, else its family's. */
export function financingPageImage(slug: string): SiteImage | null {
  const page = getFinancingPage(slug);
  return page ? pageImageFor(page.entry) : null;
}

/**
 * The photo for a page about several programs (an insight, a calculator, a
 * city guide): the photo of the first related financing page that has one.
 */
export function relatedFinancingImage(slugsOrPaths: string[]): SiteImage | null {
  for (const s of slugsOrPaths) {
    const slug = s.startsWith("/financing/") ? s.slice("/financing/".length) : s.startsWith("/") ? "" : s;
    const image = slug ? financingPageImage(slug) : null;
    if (image) return image;
  }
  return null;
}

/**
 * The photo for an article: its first related financing page's, else the first
 * related calculator's program photo, else the California photo from /about.
 */
export function insightImage(related: { href: string }[]): SiteImage {
  const hrefs = related.map((r) => r.href);
  const calculatorPrograms = hrefs.filter((h) => h.startsWith("/calculators/")).flatMap((h) => getCalculator(h.slice("/calculators/".length))?.relatedPrograms ?? []);
  return relatedFinancingImage(hrefs) ?? relatedFinancingImage(calculatorPrograms) ?? ABOUT_IMAGE;
}
