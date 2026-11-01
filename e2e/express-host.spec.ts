import { expect, test } from "@playwright/test";
import { gotoHydrated } from "./helpers";

// playwright.config.ts lists 127.0.0.1 in EXPRESS_HOSTS, so requests to that
// host behave like kubera.loans: proxy.ts rewrites `/` to `/express`. The
// browser then reports `/` as its pathname while the server rendered
// `/express`; hydration must match and the page must raise no errors.
function expressHostUrl(baseURL: string | undefined, path: string): string {
  const url = new URL(path, baseURL ?? "http://localhost:3999");
  url.hostname = "127.0.0.1";
  return url.toString();
}

for (const width of [390, 1280]) {
  test.describe(`express host at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("serves the qualifier at / with no page errors", async ({ page, baseURL }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));

      const url = expressHostUrl(baseURL, "/");
      await gotoHydrated(page, url);
      expect(new URL(page.url()).pathname).toBe("/");
      await expect(page.getByRole("heading", { level: 1 })).toContainText(/qualifier/i);

      // Scrolling is where lazy and sticky parts of a page tend to throw; cover that path too.
      await page.mouse.wheel(0, 2_000);
      await page.waitForTimeout(300);
      expect(errors).toEqual([]);
    });
  });
}

test("main-site /express loads with no page errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await gotoHydrated(page, "/express");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(errors).toEqual([]);
});
