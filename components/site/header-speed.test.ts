import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Guards for how fast the header menus open. Measured on a production build
// with Chromium (desktop, and 4x CPU throttling for a phone): JS height
// animations, a per-link stagger and a full-viewport backdrop blur made the
// Financing flyout take about 0.75 s at roughly 13 fps; CSS opacity/transform
// brought it to about 0.16 s at 60 fps. The Sentry SDK in the first script
// (even with no DSN) also delayed the first tap while the page hydrated.

const read = (p: string) => readFileSync(p, "utf8");

describe("header menu speed", () => {
  const header = read("components/site/GlassHeader.tsx");

  it("opens the menus with CSS, not a JS animation library", () => {
    expect(header).not.toMatch(/from "motion\/react"|framer-motion/);
    expect(header).toContain("menu-drop");
    expect(read("app/globals.css")).toMatch(/\.menu-drop\s*\{\s*animation: menu-drop \d+ms/);
  });

  it("does not blur the whole page behind the flyout", () => {
    const scrim = /data-nav-scrim[\s\S]*?className="([^"]+)"/.exec(header)?.[1] ?? "";
    expect(scrim).toContain("fixed inset-0");
    expect(scrim).not.toMatch(/backdrop-blur/);
  });

  it("loads the Sentry browser SDK only when a DSN is configured", () => {
    const client = read("instrumentation-client.ts");
    expect(client).not.toMatch(/^import .* from "@sentry\/nextjs";?$/m);
    expect(client).toMatch(/if \(options\) \{\s*void import\("@sentry\/nextjs"\)/);
  });
});
