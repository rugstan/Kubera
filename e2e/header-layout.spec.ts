import { expect, test, type Page } from "@playwright/test";
import { gotoHydrated, mockAskAvailable } from "./helpers";

// The page clips horizontal overflow, so anything the header cannot fit is cut
// off instead of scrolling. Run with the AI probe mocked as available (the
// production state), which makes "Ask Kubera AI" the widest the header gets.
const WIDTHS = [1024, 1152, 1200, 1279, 1280, 1366, 1440];

async function headerMetrics(page: Page) {
  return page.evaluate(() => {
    const nav = document.querySelector("header nav") as HTMLElement;
    const cta = Array.from(nav.querySelectorAll("a")).find((a) => a.textContent?.trim() === "Size a loan") as HTMLElement;
    const r = cta.getBoundingClientRect();
    return {
      scrollWidth: nav.scrollWidth,
      clientWidth: nav.clientWidth,
      cta: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      navHeight: nav.getBoundingClientRect().height,
      // Each direct child (logo, desktop link list, actions) must hold its own
      // content too, or links overlap inside a squeezed box.
      squeezed: Array.from(nav.children)
        .filter((c) => (c as HTMLElement).offsetParent !== null)
        .filter((c) => c.scrollWidth > c.clientWidth)
        .map((c) => c.tagName.toLowerCase()),
    };
  });
}

test.describe("primary header layout", () => {
  for (const width of WIDTHS) {
    test(`fits without clipping at ${width}px with AI available`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await mockAskAvailable(page);
      await gotoHydrated(page, "/");
      await expect(page.locator("html")).not.toHaveAttribute("data-ask", "off");

      const m = await headerMetrics(page);
      expect(m.scrollWidth, "header nav overflows horizontally").toBeLessThanOrEqual(m.clientWidth);
      // The bar is a single 56px row: nothing wrapped onto a second line.
      expect(m.navHeight).toBeLessThanOrEqual(56);
      expect(m.squeezed).toEqual([]);
      expect(m.cta.left).toBeGreaterThanOrEqual(0);
      expect(m.cta.right).toBeLessThanOrEqual(m.viewport.width);
      expect(m.cta.top).toBeGreaterThanOrEqual(0);
      expect(m.cta.bottom).toBeLessThanOrEqual(m.viewport.height);

      // Every visible header control sits fully inside the viewport, so keyboard
      // focus never lands on something the user cannot see.
      const outside = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>("header nav a, header nav button"))
          .filter((el) => el.offsetParent !== null)
          .map((el) => ({ label: el.textContent?.trim() || el.getAttribute("aria-label"), r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.left < 0 || r.right > window.innerWidth)
          .map(({ label }) => label),
      );
      expect(outside).toEqual([]);
    });
  }

  test("desktop bar shows the link list from 1280px and the financing menu is keyboard operable", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await mockAskAvailable(page);
    await gotoHydrated(page, "/");
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav.getByRole("button", { name: /open menu/i })).toBeHidden();
    await expect(nav.getByRole("link", { name: "Rates" })).toBeVisible();

    const trigger = nav.getByRole("button", { name: "Financing" });
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(nav.getByRole("link", { name: "Hotels" })).toBeHidden();
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    for (const name of ["All financing", "Senior living", "Hotels", "Multifamily"]) {
      const link = nav.getByRole("link", { name });
      await expect(link).toBeVisible();
      const box = (await link.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(1280);
    }
    await page.keyboard.press("Escape");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger).toBeFocused();

    await trigger.click();
    await nav.getByRole("link", { name: "Hotels" }).click();
    await expect(page).toHaveURL(/\/financing\/hotels$/);
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Financing" })).toHaveAttribute("aria-expanded", "false");
  });

  test("below 1280px the menu button carries every page", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await gotoHydrated(page, "/");
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav.getByRole("link", { name: "Rates" })).toBeHidden();
    await nav.getByRole("button", { name: /open menu/i }).click();
    const menu = page.locator("#mobile-nav");
    for (const name of ["Financing", "Senior living", "Hotels", "Multifamily", "Rates", "Contact"]) {
      await expect(menu.getByRole("link", { name, exact: true })).toBeVisible();
    }
  });
});
