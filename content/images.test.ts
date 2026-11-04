import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROGRAM_FAMILIES } from "@/content/programs/types";
import { FAMILY_IMAGES, familyImage } from "./images";

const root = process.cwd();
const assetsDir = path.join(root, "assets/images");

describe("site images", () => {
  it("describes every image plainly, without claiming it is a Corin deal, a client or a real place", () => {
    for (const [family, image] of Object.entries(FAMILY_IMAGES)) {
      expect(PROGRAM_FAMILIES).toContain(family);
      expect(image.alt.length, family).toBeGreaterThan(20);
      expect(image.alt.length, family).toBeLessThanOrEqual(160);
      expect(image.alt, family).not.toMatch(/\b(AI|financed|funded|our client|Corin|closed)\b/i);
      expect(image.src.width).toBeGreaterThanOrEqual(1200);
    }
  });

  it("returns null for a family that has no image yet", () => {
    for (const family of PROGRAM_FAMILIES) expect(familyImage(family)).toBe(FAMILY_IMAGES[family] ?? null);
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
});
