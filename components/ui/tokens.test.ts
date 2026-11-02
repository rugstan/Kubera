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
const BLACK = "#000000";
/** The translucent nav composited over white: rgb(250 250 252) at 0.8 is lighter than canvas. */
const GLASS = "#fafafc";
const AA = 4.5;
const NON_TEXT = 3;

describe("design tokens (WCAG 2.2 AA)", () => {
  it("pins the Apple-style token values", () => {
    expect(theme("canvas").toLowerCase()).toBe("#f5f5f7");
    expect(theme("surface").toLowerCase()).toBe("#ffffff");
    expect(theme("ink").toLowerCase()).toBe("#1d1d1f");
    expect(theme("titanium").toLowerCase()).toBe("#6e6e73");
    expect(theme("accent").toLowerCase()).toBe("#0066cc");
    expect(theme("accent-fill").toLowerCase()).toBe("#0071e3");
    expect(theme("accent-on-dark").toLowerCase()).toBe("#2997ff");
    expect(theme("pro").toLowerCase()).toBe("#000000");
    expect(theme("pro-surface").toLowerCase()).toBe("#1d1d1f");
    expect(theme("success").toLowerCase()).toBe("#18762f");
    expect(theme("warning").toLowerCase()).toBe("#a63d00");
    expect(theme("danger").toLowerCase()).toBe("#c9001a");
  });

  it("has no decorative tokens: no gold, no green accent", () => {
    expect(css).not.toMatch(/--color-gold|emerald|#047857|#d4af37/i);
    expect(css).not.toMatch(/\.gold-text|\.badge-gold|\.badge-emerald/);
  });

  it("uses a white page body", () => {
    expect(css).toMatch(/body\s*\{\s*background:\s*var\(--color-surface\)/);
  });

  it("no longer carries the AI entry-point display rules", () => {
    expect(css).not.toMatch(/data-ask/);
  });

  it("titanium secondary text passes on white and on the canvas", () => {
    expect(contrast(theme("titanium"), WHITE)).toBeGreaterThanOrEqual(AA);
    expect(contrast(theme("titanium"), theme("canvas"))).toBeGreaterThanOrEqual(AA);
  });

  it("graphite and ink text pass on the neutral chip fill", () => {
    expect(contrast(theme("ink"), theme("fill"))).toBeGreaterThanOrEqual(AA);
    expect(contrast(theme("graphite"), theme("fill"))).toBeGreaterThanOrEqual(AA);
  });

  it("white text on every filled button state passes", () => {
    expect(contrast(WHITE, theme("accent-fill"))).toBeGreaterThanOrEqual(AA);
    expect(contrast(WHITE, theme("accent-fill-hover"))).toBeGreaterThanOrEqual(AA);
    expect(contrast(WHITE, theme("accent-hover"))).toBeGreaterThanOrEqual(AA);
  });

  it("blue text links pass on white, canvas and the translucent nav", () => {
    for (const bg of [WHITE, theme("canvas"), GLASS]) {
      expect(contrast(theme("accent"), bg)).toBeGreaterThanOrEqual(AA);
    }
  });

  it("the hover and tint-text blue passes on white, canvas and the 10% blue tint", () => {
    const accent = theme("accent");
    for (const base of [WHITE, theme("canvas")]) {
      expect(contrast(theme("accent-hover"), base)).toBeGreaterThanOrEqual(AA);
      expect(contrast(theme("accent-hover"), blend(accent, 0.1, base))).toBeGreaterThanOrEqual(AA);
    }
  });

  it("the fill blue is never text: it fails as text on the canvas", () => {
    expect(contrast(theme("accent-fill"), theme("canvas"))).toBeLessThan(AA);
  });

  it("status colours pass as text on white, canvas and their own surface", () => {
    for (const status of ["success", "warning", "danger"] as const) {
      const fg = theme(status);
      for (const bg of [WHITE, theme("canvas"), theme(`${status}-surface`)]) {
        expect(contrast(fg, bg), `${status} on ${bg}`).toBeGreaterThanOrEqual(AA);
      }
    }
  });

  it("ink text on the status surfaces and the neutral notice passes", () => {
    for (const status of ["success", "warning", "danger"] as const) {
      expect(contrast(theme("ink"), theme(`${status}-surface`))).toBeGreaterThanOrEqual(AA);
    }
    expect(contrast(theme("ink"), theme("canvas"))).toBeGreaterThanOrEqual(AA);
  });

  it("input borders reach 3:1 on white and canvas (WCAG 1.4.11)", () => {
    expect(contrast(theme("field-border"), WHITE)).toBeGreaterThanOrEqual(NON_TEXT);
    expect(contrast(theme("field-border"), theme("canvas"))).toBeGreaterThanOrEqual(NON_TEXT);
    // The old second .field rule (rgb(0 0 0 / 0.32)) was 2.24:1; it must not come back.
    expect(css).not.toMatch(/\.field\s*\{\s*border-color:\s*rgb\(0 0 0/);
  });

  it("the focus ring passes 3:1 on white, canvas and black", () => {
    for (const bg of [WHITE, theme("canvas"), BLACK]) {
      expect(contrast(theme("accent-fill"), bg)).toBeGreaterThanOrEqual(NON_TEXT);
    }
  });

  it("dark surfaces use passing titanium and accent text colours", () => {
    for (const surface of [theme("ink"), theme("pro"), theme("pro-surface"), theme("pro-elevated")]) {
      expect(contrast(darkOverride("titanium"), surface)).toBeGreaterThanOrEqual(AA);
      expect(contrast(theme("accent-on-dark"), surface)).toBeGreaterThanOrEqual(AA);
    }
  });

  it("the filled button keeps a 3:1 boundary on black", () => {
    expect(contrast(theme("accent-fill"), theme("pro"))).toBeGreaterThanOrEqual(NON_TEXT);
  });

  it("the quiet grey is only for dark surfaces, large text or dots", () => {
    expect(contrast(theme("quiet"), theme("pro"))).toBeGreaterThanOrEqual(NON_TEXT);
    // It is not a body-text colour on light surfaces.
    expect(contrast(theme("quiet"), WHITE)).toBeLessThan(AA);
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
