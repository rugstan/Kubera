import { expect, test } from "@playwright/test";
import { gotoHydrated } from "./helpers";

test.describe("homepage", () => {
  test("renders the page shell and the loan sizer", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    const res = await page.goto("/");
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const sizer = page.locator("#sizer");
    await expect(sizer).toBeVisible();
    await expect(sizer.getByRole("heading", { level: 2 }).first()).toContainText(/size your loan/i);

    // The sizer streams in behind Suspense once rates resolve (or fall back).
    const tabs = sizer.getByRole("tablist").first().getByRole("tab");
    await expect(tabs.first()).toBeVisible();
    expect(await tabs.count()).toBeGreaterThanOrEqual(3);
    await expect(sizer.getByText(/HUD/).first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("switching sizer tabs changes the selected tab", async ({ page }) => {
    await gotoHydrated(page, "/");
    const tabs = page.locator("#sizer").getByRole("tablist").first().getByRole("tab");
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
    await tabs.nth(1).click();
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(tabs.first()).toHaveAttribute("aria-selected", "false");
  });

  test("shows the DRE license line in the footer", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/Real estate broker, California Department of Real Estate/i).first()).toBeAttached();
  });
});

test.describe("platform endpoints", () => {
  test("cron endpoints reject unauthenticated callers", async ({ request }) => {
    expect((await request.get("/api/cron/crm-retry")).status()).toBe(401);
    expect((await request.get("/api/cron/rates")).status()).toBe(401);
  });
});
