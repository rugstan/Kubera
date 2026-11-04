import { expect, test } from "@playwright/test";

// The e2e server is a production build with no staff session and no database,
// so the construction desk must fail closed: the (staff) layout sends the
// visitor to sign-in (keeping the page asked for) and no records or forms render.
test.describe("construction desk without staff access", () => {
  for (const path of ["/construction", "/construction/new", "/construction/project?id=prj_0001"]) {
    test(`${path} asks for staff sign-in and stays out of search results`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page).toHaveURL((url) => url.pathname === "/login" && url.searchParams.get("next") === path);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      await expect(page.getByRole("button", { name: /create project|save|order|check with cslb/i })).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }
});
