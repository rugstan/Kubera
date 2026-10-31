import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { blend, contrast } from "./contrast";

const css = readFileSync(path.resolve(import.meta.dirname, "../../app/globals.css"), "utf8");

/** Value of a custom property declared in the @theme block. */
function theme(name: string): string {
  const m = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{3,6})`).exec(css);
  if (!m) throw new Error(`token --color-${name} not found as hex in globals.css`);
  return m[1]!;
}

/** Value a dark-surface rule re-points a token to (titanium only; accent text uses --color-accent-on-dark). */
function darkOverride(name: string): string {
  const block = /\.bg-ink,[\s\S]*?\.on-dark\s*\{([\s\S]*?)\}/.exec(css);
  if (!block) throw new Error("dark surface override block not found");
  const m = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{3,6})`).exec(block[1]!);
  if (!m) throw new Error(`dark override for --color-${name} not found`);
  return m[1]!;
}

const WHITE = "#ffffff";
const AA = 4.5;

describe("design tokens (WCAG 2.2 AA)", () => {
  it("pins the Phase 0 token values", () => {
    expect(theme("titanium").toLowerCase()).toBe("#6e6e73");
    expect(theme("accent").toLowerCase()).toBe("#047857");
    expect(theme("gold-ink").toLowerCase()).toBe("#8a6d16");
    expect(theme("gold").toLowerCase()).toBe("#d4af37");
  });

  it("titanium secondary text passes on white and on the canvas", () => {
    expect(contrast(theme("titanium"), WHITE)).toBeGreaterThanOrEqual(AA);
    expect(contrast(theme("titanium"), theme("canvas"))).toBeGreaterThanOrEqual(AA);
  });

  it("white text on the primary CTA passes, in rest and hover states", () => {
    expect(contrast(WHITE, theme("accent"))).toBeGreaterThanOrEqual(AA);
    expect(contrast(WHITE, theme("accent-hover"))).toBeGreaterThanOrEqual(AA);
  });

  it("emerald text links pass on white and canvas", () => {
    expect(contrast(theme("accent"), WHITE)).toBeGreaterThanOrEqual(AA);
    expect(contrast(theme("accent"), theme("canvas"))).toBeGreaterThanOrEqual(AA);
  });

  it("gold numerals use the solid ink on light surfaces", () => {
    expect(contrast(theme("gold-ink"), WHITE)).toBeGreaterThanOrEqual(AA);
    expect(contrast(theme("gold-ink"), theme("canvas"))).toBeGreaterThanOrEqual(AA);
    // The bright gold is only for dark surfaces: it fails on white.
    expect(contrast(theme("gold"), WHITE)).toBeLessThan(AA);
    expect(contrast(theme("gold"), theme("ink"))).toBeGreaterThanOrEqual(AA);
    expect(contrast(theme("gold"), "#000000")).toBeGreaterThanOrEqual(AA);
  });

  it("dark surfaces use passing titanium and accent text colours", () => {
    for (const surface of [theme("ink"), theme("pro"), theme("pro-surface")]) {
      expect(contrast(darkOverride("titanium"), surface)).toBeGreaterThanOrEqual(AA);
      expect(contrast(theme("accent-on-dark"), surface)).toBeGreaterThanOrEqual(AA);
    }
  });

  it("the low-alpha white floor on dark surfaces passes", () => {
    const m = /rgb\(255 255 255 \/ (0\.\d+)\) !important/.exec(css);
    expect(m).not.toBeNull();
    const alpha = Number(m![1]);
    for (const surface of [theme("ink"), theme("pro"), theme("pro-surface")]) {
      expect(contrast(blend("#ffffff", alpha, surface), surface)).toBeGreaterThanOrEqual(AA);
    }
  });

  it("enforces the 12px text floor", () => {
    expect(css).toMatch(/--text-min:\s*0\.75rem/);
    expect(css).toMatch(/\[class\*="text-\[11px\]"\][\s\S]*?font-size:\s*var\(--text-min\)/);
  });

  it("has CSS-only reveal that never hides content by default", () => {
    // The base rule must leave content visible; the fade lives inside @supports + no-preference.
    expect(css).toMatch(/\.reveal\s*\{\s*opacity:\s*1/);
    expect(css).toMatch(/@supports \(animation-timeline: view\(\)\)\s*\{\s*@media \(prefers-reduced-motion: no-preference\)/);
  });
});
