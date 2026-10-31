import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";
import { gotoHydrated } from "./helpers";

// Deal desk (WS-T). The e2e server has no Supabase, so there is no staff
// session: every page and export must fail closed and leak no records.
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
type Violation = { id: string; impact: string | null; nodes: { target: string[] }[] };

const PAGES = ["/deals", "/deals/lenders", "/deals/dre", "/deals/00000000-0000-4000-8000-000000000001"];

test.describe("deal desk without a staff session", () => {
  for (const path of PAGES) {
    test(`${path} asks for staff sign-in and is not indexable`, async ({ page }) => {
      await gotoHydrated(page, path);
      await expect(page.getByRole("heading", { name: "Staff sign-in required" })).toBeVisible();
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      await expect(page.getByRole("navigation", { name: "Deal desk" })).toBeVisible();
      await expect(page.getByRole("table")).toHaveCount(0);
    });
  }

  test("has no serious or critical axe violations and no horizontal scroll at 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await gotoHydrated(page, "/deals");
    await page.addScriptTag({ path: axePath });
    const violations = await page.evaluate<Violation[]>(
      async () =>
        (
          await (window as unknown as { axe: { run: (ctx: Document, opts: unknown) => Promise<{ violations: Violation[] }> } }).axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
            resultTypes: ["violations"],
          })
        ).violations,
    );
    expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("exports and PDFs answer 401, and share links 503 without storage", async ({ request }) => {
    expect((await request.get("/deals/dre/export?kind=threshold")).status()).toBe(401);
    expect((await request.get("/deals/00000000-0000-4000-8000-000000000001/form-159/00000000-0000-4000-8000-000000000002")).status()).toBe(401);
    const share = await request.get(`/api/deals/share/${"a".repeat(43)}`);
    expect(share.status()).toBe(503);
    expect(share.headers()["cache-control"]).toContain("no-store");
  });
});
