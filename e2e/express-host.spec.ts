import { expect, test } from "@playwright/test";
import { gotoHydrated, mockAskAvailable } from "./helpers";

// playwright.config.ts lists 127.0.0.1 in EXPRESS_HOSTS, so requests to that
// host behave like kubera.loans: proxy.ts rewrites `/` to `/express`. The
// browser then reports `/` as its pathname while the server rendered
// `/express`; the floating Ask button must stay hidden and hydration must match.
function expressHostUrl(baseURL: string | undefined, path: string): string {
  const url = new URL(path, baseURL ?? "http://localhost:3999");
  url.hostname = "127.0.0.1";
  return url.toString();
}

for (const width of [390, 1280]) {
  test.describe(`express host at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("serves the qualifier at / with no floating Ask button and no page errors", async ({ page, baseURL }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await mockAskAvailable(page);

      const url = expressHostUrl(baseURL, "/");
      await gotoHydrated(page, url);
      expect(new URL(page.url()).pathname).toBe("/");
      await expect(page.getByRole("heading", { level: 1 })).toContainText(/qualifier/i);

      // Desktop reveals the button after scrolling; make sure that path is covered too.
      await page.mouse.wheel(0, 2_000);
      await page.waitForTimeout(300);
      await expect(page.locator("[data-ask-floating]")).toBeHidden();
      expect(errors).toEqual([]);
    });
  });
}

test("main-site /express does not render the floating Ask button", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await mockAskAvailable(page);
  await gotoHydrated(page, "/express");
  await expect(page.locator("[data-ask-floating]")).toHaveCount(0);
  expect(errors).toEqual([]);
});
