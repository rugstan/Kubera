import { expect, test } from "@playwright/test";
import { gotoHydrated } from "./helpers";

// Lender matching (WS-M). The e2e server has no staff session and no database,
// so every lenders page sends the visitor to sign-in (keeping the requested
// path), renders no records or submission forms, and the PDF preview answers 401.
const DEAL = "00000000-0000-4000-8000-000000000001";
const PAGES = ["/lenders", "/lenders/boxes/new", `/lenders/boxes/${DEAL}`, `/lenders/deals/${DEAL}`];

test.describe("lenders desk without a staff session", () => {
  for (const path of PAGES) {
    test(`${path} asks for staff sign-in and is not indexable`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page).toHaveURL((url) => url.pathname === "/login" && url.searchParams.get("next") === path);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      await expect(page.getByRole("navigation", { name: "Lenders" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /request approval|import|add quote|confirm terms/i })).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }

  test("the executive summary preview answers 401 without a session", async ({ request }) => {
    const res = await request.get(`/lenders/deals/${DEAL}/package`);
    expect(res.status()).toBe(401);
    expect(res.headers()["cache-control"]).toContain("no-store");
  });
});

test("the partner form offers the construction LTC credit-box field", async ({ page }) => {
  await gotoHydrated(page, "/partners#lender");
  await expect(page.getByLabel(/max ltc, construction/i)).toHaveValue("");
});
