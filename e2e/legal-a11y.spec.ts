import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";
import { gotoHydrated } from "./helpers";

// The legal pages carry dense tables and small print, which is where contrast
// regressions hide. axe-core ships with eslint-plugin-jsx-a11y; scripts/axe.ts
// scans the same routes as part of `npm run a11y`.
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const LEGAL_ROUTES = ["/privacy", "/terms", "/licensing", "/accessibility"];

type Violation = { id: string; impact: string | null; nodes: { target: string[] }[] };

for (const width of [1280, 390]) {
  test.describe(`legal pages a11y at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });
    for (const route of LEGAL_ROUTES) {
      test(`${route} has no serious or critical axe violations`, async ({ page }) => {
        await gotoHydrated(page, route);
        await page.addScriptTag({ path: axePath });
        const violations = await page.evaluate<Violation[], string[]>(
          async (tags) => (await (window as unknown as { axe: { run: (ctx: Document, opts: unknown) => Promise<{ violations: Violation[] }> } }).axe.run(document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] })).violations,
          AXE_TAGS,
        );
        const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
        expect(blocking).toEqual([]);
      });
    }
  });
}
