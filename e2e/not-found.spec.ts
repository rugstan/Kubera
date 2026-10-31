import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";
import { gotoHydrated } from "./helpers";

// Mistyped URLs and notFound() calls must show the branded 404: site chrome,
// one <main id="main-content"> (the skip-link target), one H1, ways back, and
// Next's noindex tag.
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
type Violation = { id: string; impact: string | null; nodes: { target: string[] }[] };

// An unmatched URL is a hard 404. A [slug] route with cacheComponents streams
// its prerendered shell before notFound() resolves on the first uncached hit,
// so that response can be a 200 soft 404; the noindex tag is what keeps it out
// of search results either way.
const ROUTES = [
  { url: "/does-not-exist", label: "unmatched URL", hard404: true },
  { url: "/financing/does-not-exist", label: "notFound() in a (site) [slug] route", hard404: false },
];

for (const width of [390, 768, 1440]) {
  test.describe(`branded 404 at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });
    for (const { url, label, hard404 } of ROUTES) {
      test(`${label} (${url}) has one main, one h1 and ways back`, async ({ page }) => {
        const res = await page.goto(url);
        if (hard404) expect(res?.status()).toBe(404);
        await page.waitForLoadState("networkidle");

        await expect(page.locator("main")).toHaveCount(1);
        await expect(page.locator("main#main-content")).toHaveCount(1);
        await expect(page.locator("h1")).toHaveCount(1);
        await expect(page.locator("h1")).toHaveText(/couldn.t find that page/i);
        await expect(page.locator('meta[name="robots"][content*="noindex"]')).not.toHaveCount(0);

        const main = page.locator("main");
        await expect(main.locator('a[href="/"]')).toBeVisible();
        await expect(main.locator('a[href="/financing"]')).toBeVisible();
        await expect(main.locator('a[href="/contact"]')).toBeVisible();
        await expect(page.locator("footer")).toContainText("California Department of Real Estate");
      });
    }
  });
}

test("404 page has no serious or critical axe violations", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await gotoHydrated(page, "/does-not-exist");
  await page.addScriptTag({ path: axePath });
  const violations = await page.evaluate<Violation[], string[]>(
    async (tags) =>
      (
        await (
          window as unknown as {
            axe: { run: (ctx: Document, opts: unknown) => Promise<{ violations: Violation[] }> };
          }
        ).axe.run(document, { runOnly: { type: "tag", values: [...tags, "best-practice"] }, resultTypes: ["violations"] })
      ).violations,
    AXE_TAGS,
  );
  const blocking = violations
    .filter((v) => v.impact === "serious" || v.impact === "critical" || v.id === "landmark-one-main" || v.id === "skip-link")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  expect(blocking).toEqual([]);
});

test("skip link moves focus to the 404 page's main landmark", async ({ page }) => {
  await gotoHydrated(page, "/does-not-exist");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main-content")).toBeFocused();
});
