import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEAL_STRUCTURES } from "@/content/deal-structures";
import { financingSlugs, getFinancingPage, hubs, programs } from "@/content/programs";
import { PROGRAM_FAMILIES } from "@/content/programs/types";
import {
  ABOUT_IMAGE,
  FAMILY_IMAGES,
  HOME_HERO_IMAGE,
  PENDING_IMAGES,
  PROGRAM_IMAGES,
  STRUCTURE_IMAGES,
  familyImage,
  pageImageFor,
  programImage,
  structureImage,
  type SiteImage,
} from "./images";

const root = process.cwd();
const assetsDir = path.join(root, "assets/images");

/**
 * Every distinct image in the registry, labelled for failure messages. A
 * program page may reuse a structure's image object (same file, same alt), so
 * the list holds each object once.
 */
const LABELLED: [string, SiteImage][] = [
  ["home hero", HOME_HERO_IMAGE],
  ["about", ABOUT_IMAGE],
  ...Object.entries(FAMILY_IMAGES).map(([family, image]): [string, SiteImage] => [`family ${family}`, image!]),
  ...Object.entries(STRUCTURE_IMAGES).map(([slug, image]): [string, SiteImage] => [`structure ${slug}`, image!]),
  ...Object.entries(PROGRAM_IMAGES).map(([slug, image]): [string, SiteImage] => [`program ${slug}`, image!]),
];
const ALL_IMAGES = LABELLED.filter(([, image], i) => LABELLED.findIndex(([, other]) => other === image) === i);

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

  it("keys program images by real program slugs, never a hub, and returns null for a page without one", () => {
    const programSlugs = programs.map((p) => p.slug);
    const hubSlugs = hubs.map((h) => h.slug);
    for (const slug of Object.keys(PROGRAM_IMAGES)) {
      expect(programSlugs, `${slug} is a program in content/programs`).toContain(slug);
      expect(hubSlugs, `${slug} is not a hub`).not.toContain(slug);
    }
    for (const slug of programSlugs) expect(programImage(slug)).toBe(PROGRAM_IMAGES[slug] ?? null);
    expect(programImage("not-a-program")).toBeNull();
  });

  it("reuses the structure images for the six mapped programs instead of copying them", () => {
    expect(PROGRAM_IMAGES["fix-and-flip"]).toBe(STRUCTURE_IMAGES["investor-rehab-hard-money"]);
    expect(PROGRAM_IMAGES["pip-bridge"]).toBe(STRUCTURE_IMAGES["flagged-hotel-sba-504-green-pip"]);
    expect(PROGRAM_IMAGES["hotel-to-senior-living-conversion"]).toBe(STRUCTURE_IMAGES["hotel-to-assisted-living-conversion-bridge"]);
    expect(PROGRAM_IMAGES["memory-care"]).toBe(STRUCTURE_IMAGES["memory-care-bridge-to-hud"]);
    expect(PROGRAM_IMAGES.rcfe).toBe(STRUCTURE_IMAGES["assisted-living-sba-504-refinance"]);
    expect(PROGRAM_IMAGES["c-pace"]).toBe(STRUCTURE_IMAGES["multifamily-construction-bank-cpace"]);
  });

  it("gives a financing page its program image, else its family image, else none", () => {
    for (const slug of financingSlugs) {
      const { entry } = getFinancingPage(slug)!;
      expect(pageImageFor(entry), slug).toBe(programImage(slug) ?? familyImage(entry.family));
    }
    // Hubs show their family image; hard money is a program that doubles as the hub.
    for (const hub of hubs) expect(pageImageFor(hub), hub.slug).toBe(familyImage(hub.family));
    expect(pageImageFor(getFinancingPage("commercial")!.entry)).toBe(FAMILY_IMAGES.commercial);
    expect(pageImageFor(getFinancingPage("hard-money")!.entry)).toBe(FAMILY_IMAGES["hard-money"]);
    expect(pageImageFor(getFinancingPage("fix-and-flip")!.entry)).toBe(STRUCTURE_IMAGES["investor-rehab-hard-money"]);
  });

  it("gives every family an image and every program page its own, so no page falls back to its family's", () => {
    for (const family of PROGRAM_FAMILIES) expect(familyImage(family), family).not.toBeNull();
    // Hard money is the one program that is also its family's hub: it shows the family image.
    const withoutOwn = programs.filter((p) => !programImage(p.slug)).map((p) => p.slug);
    expect(withoutOwn).toEqual(["hard-money"]);
    expect(programs.find((p) => p.slug === "hard-money")?.isHub).toBe(true);
  });

  it("uses each made-for-the-page program image on one page only", () => {
    const files = Object.values(PROGRAM_IMAGES).map((image) => path.basename(image!.src.src));
    const own = files.filter((f) => f.startsWith("program-"));
    expect(own).toHaveLength(31);
    expect(new Set(own).size).toBe(own.length);
  });

  it("lists exactly the financing pages that still have no image in PENDING_IMAGES", () => {
    // Empty since every hub and program page has an image; a new page without one must be listed (or given one).
    expect(PENDING_IMAGES).toEqual([]);
    const withoutImage = financingSlugs.filter((slug) => pageImageFor(getFinancingPage(slug)!.entry) === null);
    expect([...withoutImage].sort()).toEqual([...PENDING_IMAGES].sort());
    expect(new Set(PENDING_IMAGES).size, "no duplicates").toBe(PENDING_IMAGES.length);
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
