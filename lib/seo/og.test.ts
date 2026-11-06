import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEAL_STRUCTURES } from "@/content/deal-structures";
import { CALCULATORS } from "@/content/calculators";
import { INSIGHTS } from "@/content/insights";
import { MARKETS } from "@/content/markets/california";
import { financingSlugs, getFinancingPage } from "@/content/programs";
import { pageImageFor, structureImage } from "@/content/images";
import { DEFAULT_SHARE_IMAGE, insightImage, OG_HEIGHT, OG_WIDTH, ogImagePath, photoName, relatedFinancingImage, shareImage } from "./og";
import { pageMetadata } from "./metadata";

const root = process.cwd();

/** Width and height from a baseline or progressive JPEG's SOF marker. */
function jpegSize(buf: Buffer): { width: number; height: number } {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error("not a JPEG");
  let i = 2;
  while (i < buf.length) {
    const marker = buf[i + 1]!;
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  throw new Error("no SOF marker");
}

describe("share images", () => {
  it("has a 1200x630 JPEG for every photo in assets/images (run scripts/og-images.mjs)", () => {
    const photos = readdirSync(path.join(root, "assets/images")).filter((f) => f.endsWith(".webp"));
    expect(photos.length).toBeGreaterThan(0);
    for (const f of photos) {
      const file = path.join(root, "public/og", f.replace(/\.webp$/, ".jpg"));
      expect(existsSync(file), file).toBe(true);
      const buf = readFileSync(file);
      expect(jpegSize(buf), f).toEqual({ width: OG_WIDTH, height: OG_HEIGHT });
      expect(buf.length, `${f} is too heavy for a link preview`).toBeLessThan(300 * 1024);
    }
  });

  it("maps a photo to its share image by file name", () => {
    const image = pageImageFor(getFinancingPage("hud-232")!.entry)!;
    expect(photoName(image)).toBe("program-hud-232");
    expect(ogImagePath(image)).toBe("/og/program-hud-232.jpg");
    expect(shareImage(image)).toEqual({ url: "/og/program-hud-232.jpg", width: 1200, height: 630, alt: image.alt, type: "image/jpeg" });
    expect(shareImage(null)).toBe(DEFAULT_SHARE_IMAGE);
  });

  it("gives every financing, structure, insight, calculator and city page its own photo with alt text", () => {
    const images = [
      ...financingSlugs.map((s) => [`/financing/${s}`, pageImageFor(getFinancingPage(s)!.entry)] as const),
      ...DEAL_STRUCTURES.map((s) => [`/structures/${s.slug}`, structureImage(s.slug)] as const),
      ...INSIGHTS.map((i) => [`/insights/${i.slug}`, insightImage(i.related)] as const),
      ...CALCULATORS.map((c) => [`/calculators/${c.slug}`, relatedFinancingImage(c.relatedPrograms)] as const),
      ...MARKETS.map((m) => [`/california/${m.slug}`, relatedFinancingImage(m.relatedPrograms)] as const),
    ];
    for (const [page, image] of images) {
      expect(image, page).not.toBeNull();
      expect(existsSync(path.join(root, "public", ogImagePath(image!))), page).toBe(true);
      expect(image!.alt.length, page).toBeGreaterThan(20);
    }
  });

  it("puts the page photo in og:image and twitter:image with size and alt", () => {
    const image = structureImage(DEAL_STRUCTURES[0]!.slug)!;
    const m = pageMetadata({ title: "t", description: "d", path: "/x", image });
    const og = (m.openGraph as { images: { url: string; width: number; height: number; alt: string }[] }).images[0]!;
    expect(og).toMatchObject({ url: ogImagePath(image), width: 1200, height: 630, alt: image.alt });
    const tw = (m.twitter as { images: { url: string; alt: string }[] }).images[0]!;
    expect(tw).toMatchObject({ url: ogImagePath(image), alt: image.alt });
  });
});
