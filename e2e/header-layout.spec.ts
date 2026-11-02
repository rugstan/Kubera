import { expect, test, type Page } from "@playwright/test";
import { gotoHydrated } from "./helpers";

// The page clips horizontal overflow, so anything the header cannot fit is cut
// off instead of scrolling. 320px is the WCAG 1.4.10 Reflow benchmark (1280px at
// 400% zoom); 360 and 375 are common phone widths. The link list shows from
// 1024px (Tailwind lg); below that the menu button carries every page.
const WIDTHS = [320, 360, 375, 1024, 1152, 1200, 1279, 1280, 1366, 1440];
const DESKTOP = 1024;

const FAMILIES = ["Senior living", "Hotels", "Multifamily", "Construction", "Hard money and bridge"];
const POPULAR = [
  "HUD 232",
  "HUD 223(f) multifamily",
  "HUD 221(d)(4)",
  "SBA 7(a) + 504 hotel stack",
  "Hotel CMBS",
  "Bridge-to-HUD",
  "Construction-to-permanent",
  "Fix-and-flip loans",
];
// No scheduling handle in e2e: the call link is the email fallback (content/contact.ts callLink).
const GET_STARTED = ["Get loan options", "Size my loan", "Email an advisor", "Today's rates"];

async function headerMetrics(page: Page) {
  return page.evaluate(() => {
    const nav = document.querySelector("header nav") as HTMLElement;
    const cta = nav.querySelector("[data-header-cta=primary]") as HTMLElement;
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
    test(`fits without clipping at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await gotoHydrated(page, "/");

      const m = await headerMetrics(page);
      expect(m.scrollWidth, "header nav overflows horizontally").toBeLessThanOrEqual(m.clientWidth);
      // The bar is a single row of at most 48px: nothing wrapped onto a second line.
      expect(m.navHeight).toBeLessThanOrEqual(48);
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

      const nav = page.getByRole("navigation", { name: "Primary" });
      const menuButton = nav.getByRole("button", { name: /open menu/i });
      if (width < DESKTOP) {
        // Below the breakpoint the menu button carries every page, so it must be fully on screen.
        await expect(menuButton).toBeVisible();
        await expect(nav.getByRole("link", { name: "Rates", exact: true })).toBeHidden();
        const box = (await menuButton.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, "menu button is cut off").toBeLessThanOrEqual(width);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      } else {
        await expect(menuButton).toBeHidden();
        for (const name of ["Rates", "Calculators", "About", "Contact"]) {
          await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
        }
        await expect(nav.getByRole("button", { name: "Financing" })).toBeVisible();
      }
    });
  }

  test("the bar holds only customer links: no Glossary, Partners, Insights or Track record", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoHydrated(page, "/");
    const nav = page.getByRole("navigation", { name: "Primary" });
    const names = (await nav.getByRole("link").allInnerTexts()).map((t) => t.trim()).filter(Boolean);
    expect(names[0]).toMatch(/^Kubera/);
    expect(names.slice(1)).toEqual(["Rates", "Calculators", "About", "Contact", "Size my loan", "Get loan options"]);
  });

  test("shows the phone only when one is configured", async ({ page }) => {
    // The e2e server sets no NEXT_PUBLIC_CONTACT_PHONE.
    await page.setViewportSize({ width: 1440, height: 800 });
    await gotoHydrated(page, "/");
    await expect(page.locator("[data-header-phone]")).toHaveCount(0);
  });

  test("the financing flyout is full width and keyboard operable", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoHydrated(page, "/");
    const nav = page.getByRole("navigation", { name: "Primary" });

    const trigger = nav.getByRole("button", { name: "Financing" });
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(nav.getByRole("link", { name: "Hotels", exact: true })).toBeHidden();
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");

    const panel = page.locator(`[id="${await trigger.getAttribute("aria-controls")}"]`);
    await expect(panel).toBeVisible();
    // Full-width panel directly under the bar, never past the viewport.
    await expect(async () => {
      const box = (await panel.locator("> div").boundingBox())!;
      const bar = (await page.locator("header").boundingBox())!;
      const width = await page.evaluate(() => document.documentElement.clientWidth);
      expect(box.x).toBe(0);
      expect(box.width).toBe(width);
      expect(box.y).toBeGreaterThanOrEqual(bar.y + bar.height - 2);
    }).toPass();

    const names = ["All financing programs", ...FAMILIES, ...POPULAR, ...GET_STARTED];
    // Let the open animation settle (height, then the staggered rise) before measuring.
    await expect(async () => {
      for (const name of names) {
        const link = panel.getByRole("link", { name, exact: true });
        await expect(link, name).toBeVisible();
        const box = (await link.boundingBox())!;
        expect(box.x, `${name} left`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `${name} right`).toBeLessThanOrEqual(1280);
        expect(box.y + box.height, `${name} bottom`).toBeLessThanOrEqual(800);
      }
    }).toPass();

    // The two families the owner flagged as missing are in the panel, linked to their hubs.
    await expect(panel.getByRole("link", { name: "Construction", exact: true })).toHaveAttribute("href", "/financing/construction");
    await expect(panel.getByRole("link", { name: "Hard money and bridge", exact: true })).toHaveAttribute("href", "/financing/hard-money");
    await expect(panel.getByRole("link", { name: "Get loan options", exact: true })).toHaveAttribute("href", "/express");
    await expect(panel.getByRole("link", { name: "Email an advisor", exact: true })).toHaveAttribute("href", /^mailto:\S+@/);

    await page.keyboard.press("Escape");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger).toBeFocused();
    await expect(panel).toBeHidden();

    await trigger.click();
    await panel.getByRole("link", { name: "Hotels", exact: true }).click();
    await expect(page).toHaveURL(/\/financing\/hotels$/);
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Financing" })).toHaveAttribute("aria-expanded", "false");
  });

  test("the flyout dims the page and closes on an outside click, the scrim or tabbing away", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoHydrated(page, "/");
    const nav = page.getByRole("navigation", { name: "Primary" });
    const trigger = nav.getByRole("button", { name: "Financing" });
    const scrim = page.locator("[data-nav-scrim]");

    await expect(scrim).toHaveCount(0);
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    // The scrim covers the whole viewport, not just the header box.
    await expect(scrim).toHaveCount(1);
    const view = await page.evaluate(() => ({ width: document.documentElement.clientWidth, height: window.innerHeight }));
    expect(await scrim.boundingBox()).toEqual({ x: 0, y: 0, ...view });

    // Clicking the panel's empty padding keeps it open. The bar may sit below the rate ticker, so aim from its bottom edge.
    const bar = (await page.locator("header").boundingBox())!;
    await page.mouse.click(8, bar.y + bar.height + 12);
    await expect(trigger).toHaveAttribute("aria-expanded", "true");

    // Clicking the dimmed page below the panel closes it.
    await page.mouse.click(640, 780);
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(scrim).toHaveCount(0);

    // Focus leaving the menu closes it.
    await trigger.click();
    await page.getByRole("link", { name: "Today's rates", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  test("with reduced motion the flyout appears in place", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoHydrated(page, "/");
    const nav = page.getByRole("navigation", { name: "Primary" });
    await nav.getByRole("button", { name: "Financing" }).click();
    // Scoped to the bar: the footer lists the same family names.
    const item = nav.getByRole("link", { name: "Senior living", exact: true }).locator("xpath=..");
    const style = await item.evaluate((el) => {
      const s = getComputedStyle(el);
      return { opacity: s.opacity, transform: s.transform };
    });
    expect(style).toEqual({ opacity: "1", transform: "none" });
  });

  test("below the desktop breakpoint the menu button carries every page", async ({ page }) => {
    await page.setViewportSize({ width: 1023, height: 800 });
    await gotoHydrated(page, "/");
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav.getByRole("link", { name: "Rates", exact: true })).toBeHidden();
    await nav.getByRole("button", { name: /open menu/i }).click();
    const menu = page.locator("#mobile-nav");
    for (const name of ["Financing", ...FAMILIES, "Rates", "Calculators", "About", "Contact"]) {
      await expect(menu.getByRole("link", { name, exact: true })).toBeVisible();
    }
    await expect(menu.getByRole("link", { name: "Construction", exact: true })).toHaveAttribute("href", "/financing/construction");
    await expect(menu.getByRole("link", { name: "Hard money and bridge", exact: true })).toHaveAttribute("href", "/financing/hard-money");
    await expect(menu.getByRole("link", { name: "Financing", exact: true })).toHaveAttribute("href", "/financing");
    await expect(menu.getByRole("link", { name: "Get loan options", exact: true })).toHaveAttribute("href", "/express");
    await expect(menu.getByRole("link", { name: "Size my loan", exact: true })).toHaveAttribute("href", "/#sizer");
    await expect(menu.getByText(/ask kubera/i)).toHaveCount(0);
    // No phone is configured in the e2e env, so no call link.
    await expect(menu.getByRole("link", { name: /^call/i })).toHaveCount(0);
  });

  test("the open mobile menu closes when the window grows to the desktop layout", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 800 });
    await gotoHydrated(page, "/");
    const nav = page.getByRole("navigation", { name: "Primary" });
    await nav.getByRole("button", { name: /open menu/i }).click();
    await expect(page.locator("#mobile-nav")).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator("#mobile-nav")).toHaveCount(0);
  });

  test("on a short landscape phone the open menu scrolls so its last entries are reachable", async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 360 });
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

    for (const target of [menu.getByRole("link", { name: "Contact", exact: true }), menu.getByRole("link", { name: "Size my loan", exact: true })]) {
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
