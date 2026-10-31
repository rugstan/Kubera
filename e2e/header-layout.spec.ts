import { expect, test, type Page } from "@playwright/test";
import { gotoHydrated, mockAskAvailable } from "./helpers";

// The page clips horizontal overflow, so anything the header cannot fit is cut
// off instead of scrolling. Run with the AI probe mocked as available (the
// production state), which makes "Ask Kubera AI" the widest the header gets.
// 320px is the WCAG 1.4.10 Reflow benchmark (1280px at 400% zoom); 360 and 375
// are common phone widths.
const WIDTHS = [320, 360, 375, 1024, 1152, 1200, 1279, 1280, 1366, 1440];

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

      // Below 1280px the menu button carries every page, so it must be fully on screen.
      const menuButton = page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: /open menu/i });
      if (width < 1280) {
        await expect(menuButton).toBeVisible();
        const box = (await menuButton.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, "menu button is cut off").toBeLessThanOrEqual(width);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      }
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

  test("on a short landscape phone the open menu scrolls so its last entries are reachable", async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 360 });
    await mockAskAvailable(page);
    await gotoHydrated(page, "/");
    const toggle = page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: /open menu/i });
    await toggle.click();
    const menu = page.locator("#mobile-nav");
    await expect(menu.getByRole("link", { name: "Contact", exact: true })).toBeAttached();
    // Let the open animation settle before measuring.
    await expect(async () => {
      const header = (await page.locator("header").boundingBox())!;
      expect(header.y + header.height).toBeLessThanOrEqual(360);
    }).toPass();

    for (const target of [menu.getByRole("link", { name: "Contact", exact: true }), menu.getByRole("button", { name: "Ask Kubera AI" })]) {
      await target.scrollIntoViewIfNeeded();
      const box = (await target.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height, "menu entry is below the viewport").toBeLessThanOrEqual(360);
      // Nothing (such as another layer) covers it: a click at its centre reaches it.
      const hit = await target.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!at && (at === el || el.contains(at));
      });
      expect(hit).toBe(true);
    }

    await menu.getByRole("link", { name: "Contact", exact: true }).click();
    await expect(page).toHaveURL(/\/contact$/);
  });

  test("Escape closes the mobile menu and returns focus to the toggle", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await gotoHydrated(page, "/");
    const nav = page.getByRole("navigation", { name: "Primary" });
    await nav.getByRole("button", { name: /open menu/i }).click();
    const menu = page.locator("#mobile-nav");
    await expect(menu).toBeVisible();
    await menu.getByRole("link", { name: "Rates", exact: true }).focus();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    const toggle = nav.getByRole("button", { name: /open menu/i });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toBeFocused();
  });
});
