import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEAL_STRUCTURES } from "@/content/deal-structures";
import { PROGRAM_FAMILIES } from "@/content/programs/types";
import { ABOUT_IMAGE, FAMILY_IMAGES, HOME_HERO_IMAGE, STRUCTURE_IMAGES, familyImage, structureImage, type SiteImage } from "./images";

const root = process.cwd();
const assetsDir = path.join(root, "assets/images");

/** Every image in the registry, labelled for failure messages. */
const ALL_IMAGES: [string, SiteImage][] = [
  ["home hero", HOME_HERO_IMAGE],
  ["about", ABOUT_IMAGE],
  ...Object.entries(FAMILY_IMAGES).map(([family, image]): [string, SiteImage] => [`family ${family}`, image!]),
  ...Object.entries(STRUCTURE_IMAGES).map(([slug, image]): [string, SiteImage] => [`structure ${slug}`, image!]),
];

describe("site images", () => {
  it("describes every image plainly, without claiming it is a Corin deal, a client or a real place", () => {
    for (const [label, image] of ALL_IMAGES) {
      expect(image.alt.length, label).toBeGreaterThan(20);
      expect(image.alt.length, label).toBeLessThanOrEqual(160);
      expect(image.alt, label).not.toMatch(/\b(AI|generated|rendering|financed|funded|our (client|project|deal)s?|Corin|closed)\b/i);
      expect(image.alt, label).not.toMatch(/^(image|photo|picture) of\b/i);
      expect(image.src.width, label).toBeGreaterThanOrEqual(1200);
    }
  });

  it("gives every crop position as two percentages", () => {
    for (const [label, image] of ALL_IMAGES) if (image.position) expect(image.position, label).toMatch(/^\d{1,3}% \d{1,3}%$/);
  });

  it("keys family images by real families and returns null for a family that has no image", () => {
    for (const family of Object.keys(FAMILY_IMAGES)) expect(PROGRAM_FAMILIES).toContain(family);
    for (const family of PROGRAM_FAMILIES) expect(familyImage(family)).toBe(FAMILY_IMAGES[family] ?? null);
  });

  it("keys structure images by real structure slugs and returns null for a structure that has no image", () => {
    const slugs = DEAL_STRUCTURES.map((s) => s.slug);
    for (const slug of Object.keys(STRUCTURE_IMAGES)) expect(slugs, `${slug} is a structure in content/deal-structures.ts`).toContain(slug);
    for (const slug of slugs) expect(structureImage(slug)).toBe(STRUCTURE_IMAGES[slug] ?? null);
    expect(structureImage("not-a-structure")).toBeNull();
  });

  it("keeps assets/images to optimised WebP files that content/images.ts uses", () => {
    const registry = readFileSync(path.join(root, "content/images.ts"), "utf8");
    const files = readdirSync(assetsDir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(file, "WebP only").toMatch(/^[a-z0-9-]+\.webp$/);
      expect(statSync(path.join(assetsDir, file)).size, `${file} under 400 KB`).toBeLessThan(400_000);
      expect(registry, `${file} is referenced`).toContain(`@/assets/images/${file}`);
    }
  });

  it("uses each file in assets/images for exactly one registry entry", () => {
    const used = ALL_IMAGES.map(([, image]) => path.basename(image.src.src));
    expect([...used].sort()).toEqual(readdirSync(assetsDir).sort());
  });
});
