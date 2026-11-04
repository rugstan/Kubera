import { expect, test } from "@playwright/test";
import { gotoHydrated } from "./helpers";

// The menu is built for customers: what we finance, rates, calculators, About
// and Contact, with one call to action. Glossary, Partners, Insights and Track
// record live in the footer, next to the borrower and staff sign-in links.

const MOVED_TO_FOOTER = ["Glossary", "Partners", "Insights", "Track record"];

test.describe("primary navigation", () => {
  test("the bar has no Glossary, Partners, Insights or Track record link", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoHydrated(page, "/");
    const nav = page.getByRole("navigation", { name: "Primary" });
    for (const name of MOVED_TO_FOOTER) await expect(nav.getByRole("link", { name })).toHaveCount(0);
    await nav.getByRole("button", { name: "Financing" }).click();
    for (const name of MOVED_TO_FOOTER) await expect(nav.getByRole("link", { name })).toHaveCount(0);
  });

  test("the mobile menu has no Glossary, Partners, Insights or Track record link either", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoHydrated(page, "/");
    await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: /open menu/i }).click();
    const menu = page.locator("#mobile-nav");
    await expect(menu).toBeVisible();
    for (const name of MOVED_TO_FOOTER) await expect(menu.getByRole("link", { name })).toHaveCount(0);
  });

  test("the Financing flyout lists Construction and Hard money and bridge", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoHydrated(page, "/");
    const nav = page.getByRole("navigation", { name: "Primary" });
    await nav.getByRole("button", { name: "Financing" }).click();
    await expect(nav.locator('a[href="/financing/construction"]')).toBeVisible();
    await expect(nav.locator('a[href="/financing/hard-money"]')).toBeVisible();
    for (const family of ["senior-living", "hotels", "multifamily"]) await expect(nav.locator(`a[href="/financing/${family}"]`)).toBeVisible();
  });

  test("the flyout's links open the family hubs", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoHydrated(page, "/");
    const nav = page.getByRole("navigation", { name: "Primary" });
    await nav.getByRole("button", { name: "Financing" }).click();
    await nav.getByRole("link", { name: "Hard money and bridge", exact: true }).click();
    await expect(page).toHaveURL(/\/financing\/hard-money$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});

test.describe("footer", () => {
  test("carries what the menu dropped, all five families and the sign-in links", async ({ page }) => {
    await gotoHydrated(page, "/");
    const footer = page.getByRole("contentinfo");
    for (const [name, href] of [
      ["Glossary", "/glossary"],
      ["Partner with Corin", "/partners"],
      ["Wholesale lenders", "/partners#lender"],
      ["Referral brokers", "/partners#referral"],
      ["Operators", "/partners#operator"],
      ["Third-party vendors", "/partners#vendor"],
      ["Insights", "/insights"],
      ["Newsletter", "/newsletter"],
      ["Senior living", "/financing/senior-living"],
      ["Hotels", "/financing/hotels"],
      ["Multifamily", "/financing/multifamily"],
      ["Construction", "/financing/construction"],
      ["Hard money and bridge", "/financing/hard-money"],
    ] as const) {
      await expect(footer.getByRole("link", { name, exact: true }), name).toHaveAttribute("href", href);
    }
    await expect(footer.getByRole("link", { name: "Get loan options", exact: true })).toHaveAttribute("href", "/express");
  });

  test("on a phone the columns fold into disclosure rows and the license line stays visible", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoHydrated(page, "/");
    const footer = page.getByRole("contentinfo");
    const box = (await footer.boundingBox())!;
    expect(box.height).toBeLessThan(1400);
    await expect(footer.getByText(/Real estate broker, California Department of Real Estate/).first()).toBeVisible();
    await expect(footer.getByRole("navigation", { name: "Account" }).getByRole("link", { name: "Staff sign in", exact: true })).toBeVisible();
    // Folded links are not reachable until their row opens.
    await expect(footer.getByRole("link", { name: "Glossary", exact: true })).toHaveCount(0);
    const tools = footer.locator("summary", { hasText: "Tools and resources" });
    expect((await tools.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await tools.click();
    const glossary = footer.getByRole("link", { name: "Glossary", exact: true });
    await expect(glossary).toBeVisible();
    expect((await glossary.boundingBox())!.height).toBeGreaterThanOrEqual(36);
    await footer.locator("summary", { hasText: "Financing" }).click();
    await expect(footer.getByRole("link", { name: "Construction", exact: true })).toBeVisible();
  });

  test("ends with the borrower portal and staff sign-in links", async ({ page }) => {
    await gotoHydrated(page, "/");
    const footer = page.getByRole("contentinfo");
    const account = footer.getByRole("navigation", { name: "Account" });
    const staff = account.getByRole("link", { name: "Staff sign in", exact: true });
    const portal = account.getByRole("link", { name: "Borrower portal", exact: true });
    await expect(staff).toHaveAttribute("href", "/login");
    await expect(staff).toHaveAttribute("rel", "nofollow");
    await expect(portal).toHaveAttribute("href", "/portal");
    await expect(portal).toHaveAttribute("rel", "nofollow");
    // The row comes after the licence and disclosure text.
    const order = await footer.evaluate((el) => {
      const account = el.querySelector('nav[aria-label="Account"]')!.getBoundingClientRect();
      const license = [...el.querySelectorAll("p")].find((p) => /Real estate broker/.test(p.textContent ?? ""))!.getBoundingClientRect();
      return { accountTop: account.top, licenseBottom: license.bottom };
    });
    expect(order.accountTop).toBeGreaterThan(order.licenseBottom);
  });

  test("the staff sign-in link reaches the sign-in page", async ({ page }) => {
    await gotoHydrated(page, "/about");
    await page.getByRole("contentinfo").getByRole("link", { name: "Staff sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("no longer carries the old assistant disclosure or tagline", async ({ page }) => {
    await gotoHydrated(page, "/");
    const text = await page.getByRole("contentinfo").innerText();
    expect(text).not.toMatch(/AI-assisted|Corin AI/i);
    expect(text).toMatch(/construction and hard money/i);
    expect(text).toMatch(/not the lender/i);
  });
});

test.describe("licence line", () => {
  for (const path of ["/", "/financing/hard-money", "/contact", "/does-not-exist"]) {
    test(`${path} shows the DRE licence line in the footer`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("contentinfo")).toContainText("Real estate broker, California Department of Real Estate");
    });
  }
});
