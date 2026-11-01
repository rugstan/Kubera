import { expect, test, type Page } from "@playwright/test";
import { QUALIFIER_RESULT, continueStep, fillContact, fillDeal, fillTerms, pickAsset, seriousViolations, shot } from "./forms-helpers";
import { gotoHydrated, mockJsonApi } from "./helpers";

// Usability checks at a 390 x 844 phone viewport: no sideways scrolling, tap
// targets of at least 44px, readable text, and the sizer's results-first
// pieces (sticky summary, swipeable cards). Screenshots land in
// coverage/e2e/screenshots (and e2e/screenshots with E2E_SAVE_SCREENSHOTS=1).

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

async function noHorizontalOverflow(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(scroll, "page is wider than the viewport").toBeLessThanOrEqual(client);
}

/** Every visible control inside `root` must be at least 44px tall (checkboxes are measured by their label). */
async function tapTargetsAreBigEnough(page: Page, rootSelector: string) {
  const small = await page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return ["root not found"];
    const out: string[] = [];
    const candidates = root.querySelectorAll<HTMLElement>('button, a[href], input:not([type="checkbox"]):not([type="radio"]):not([type="file"]), select, textarea, label:has(input[type="radio"]), label:has(input[type="checkbox"])');
    for (const el of candidates) {
      if (el.closest('[hidden], [aria-hidden="true"]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Links inside running text (legal notice) are exempt: WCAG 2.5.8 inline exception.
      if (el.tagName === "A" && el.closest("p")) continue;
      // The sr-only file input and visually-hidden controls are not tap targets.
      if (r.height < 43.5) out.push(`${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 40)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  }, rootSelector);
  expect(small, "controls under 44px").toEqual([]);
}

test.describe("qualifier at 390px", () => {
  test("every step fits the screen, has 44px targets and no accessibility violations", async ({ page }) => {
    await mockJsonApi(page, "/api/qualify", { body: QUALIFIER_RESULT });
    await gotoHydrated(page, "/express");
    await noHorizontalOverflow(page);
    await tapTargetsAreBigEnough(page, "main");
    await shot(page, "qualifier-390-1-asset");

    await pickAsset(page);
    await noHorizontalOverflow(page);
    await tapTargetsAreBigEnough(page, "main form");
    await shot(page, "qualifier-390-2-deal-empty");

    // Blank step: errors visible, still no overflow.
    await continueStep(page);
    await noHorizontalOverflow(page);
    await shot(page, "qualifier-390-2-deal-errors");
    expect(await seriousViolations(page, "main")).toEqual([]);

    await fillDeal(page);
    await noHorizontalOverflow(page);
    await tapTargetsAreBigEnough(page, "main form");
    await shot(page, "qualifier-390-3-terms");

    await fillTerms(page);
    await noHorizontalOverflow(page);
    await tapTargetsAreBigEnough(page, "main form");
    await fillContact(page, { phone: "415-555-0132" });
    // The submit label is long; it must wrap inside the card rather than push past it.
    const card = await page.locator("main .bento").first().boundingBox();
    const submit = await page.getByRole("button", { name: /see my indicative structure/i }).boundingBox();
    expect(submit!.x + submit!.width, "submit button overflows the card").toBeLessThanOrEqual(card!.x + card!.width);
    await shot(page, "qualifier-390-4-contact");
    expect(await seriousViolations(page, "main")).toEqual([]);

    await page.getByRole("button", { name: /see my indicative structure/i }).click();
    await expect(page.getByRole("heading", { level: 2, name: /thanks, pat/i })).toBeFocused();
    await noHorizontalOverflow(page);
    await shot(page, "qualifier-390-5-result");
  });

  test("the logo link is a 44px tap target", async ({ page }) => {
    await gotoHydrated(page, "/express");
    const box = await page.getByRole("link", { name: /kubera commercial home/i }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});

test.describe("partner portal at 390px", () => {
  test("tabs, form and error summary fit the screen with 44px targets", async ({ page }) => {
    await gotoHydrated(page, "/partners#lender");
    await noHorizontalOverflow(page);
    await tapTargetsAreBigEnough(page, "main, #main-content, body > div");
    await shot(page, "partners-390-lender");

    await page.getByRole("tab", { name: /vendors/i }).click();
    await page.getByRole("button", { name: /submit registration/i }).click();
    await expect(page.getByRole("group", { name: /problem/i })).toBeFocused();
    await noHorizontalOverflow(page);
    await shot(page, "partners-390-vendor-errors");
    expect(await seriousViolations(page)).toEqual([]);
  });
});

test.describe("sizer at 390px", () => {
  test("shows a swipeable card row and a sticky best-fit bar that jumps to the results", async ({ page }) => {
    await gotoHydrated(page, "/");
    const results = page.locator("#sizer-results-senior");
    await expect(results).toBeAttached();
    await noHorizontalOverflow(page);

    // The cards scroll sideways inside their own container, not the page.
    const scrollable = await results.evaluate((el) => el.scrollWidth > el.clientWidth + 8);
    expect(scrollable).toBe(true);
    await expect(results).toHaveAttribute("aria-roledescription", "carousel");

    // Inputs are first on a phone: scroll to them and the results are off screen, so the bar appears.
    await page.locator("#sizer").scrollIntoViewIfNeeded();
    await page.locator("#sizer aside").scrollIntoViewIfNeeded();
    const bar = page.getByRole("region", { name: /best-fit summary/i });
    await expect(bar).toBeVisible();
    await expect(bar).toContainText(/best fit/i);
    const seeAll = bar.getByRole("button", { name: /see all structures/i });
    expect((await seeAll.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await shot(page, "sizer-390-sticky-bar", { fullPage: false });

    await seeAll.click();
    await expect(results).toBeFocused();
    await expect(results).toBeInViewport({ ratio: 0.3 });
    // Once the results are on screen the bar steps aside.
    await expect(bar).toBeHidden();
    await shot(page, "sizer-390-results", { fullPage: false });
  });

  test("tabbing through the inputs never hides the focused control behind the best-fit bar", async ({ page }) => {
    // Reduced motion turns off smooth scrolling, so each focus scroll is finished when measured.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await gotoHydrated(page, "/");
    const panel = page.locator('#sizer [role="tabpanel"]:visible').first();
    const lastToggle = panel.getByRole("switch").last();
    await expect(lastToggle).toBeAttached();
    // Start at the open tab's first field and Tab forward to its last toggle.
    await panel.locator("input, select, button").first().focus();
    const bar = page.getByRole("region", { name: /best-fit summary/i });
    const covered: string[] = [];
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press("Tab");
      const barBox = (await bar.count()) > 0 ? await bar.boundingBox() : null;
      if (barBox) {
        const r = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement;
          return { name: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40), bottom: el.getBoundingClientRect().bottom };
        });
        if (r.bottom > barBox.y + 1) covered.push(`"${r.name}" bottom ${Math.round(r.bottom)} > bar top ${Math.round(barBox.y)}`);
      }
      if (await lastToggle.evaluate((el) => el === document.activeElement)) break;
    }
    await expect(lastToggle).toBeFocused();
    await expect(bar).toBeVisible();
    const toggle = (await lastToggle.boundingBox())!;
    const barBox = (await bar.boundingBox())!;
    expect(toggle.y + toggle.height, "the last toggle sits under the best-fit bar").toBeLessThanOrEqual(barBox.y);
    expect(covered, "focused controls under the best-fit bar").toEqual([]);
    await shot(page, "sizer-390-focus-clear-of-bar", { fullPage: false });
  });

  test("next and previous move through the cards and the indicator follows", async ({ page }) => {
    await gotoHydrated(page, "/");
    const results = page.locator("#sizer-results-senior");
    await results.scrollIntoViewIfNeeded();
    const status = page.getByText(/^Structure \d+ of \d+$/);
    await expect(status).toHaveText(/^Structure 1 of \d+$/);
    const next = page.getByRole("button", { name: /next structure/i });
    const previous = page.getByRole("button", { name: /previous structure/i });
    await expect(previous).toBeDisabled();
    expect((await next.boundingBox())!.width).toBeGreaterThanOrEqual(44);

    await next.click();
    await expect(status).toHaveText(/^Structure 2 of \d+$/);
    expect(await results.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);
    await shot(page, "sizer-390-card-2", { fullPage: false });

    await previous.click();
    await expect(status).toHaveText(/^Structure 1 of \d+$/);
    await expect(previous).toBeDisabled();
  });

  test("the carousel is a plain grid, with no bar or arrows, on a desktop screen", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoHydrated(page, "/");
    const results = page.locator("#sizer-results-senior");
    await results.scrollIntoViewIfNeeded();
    expect(await results.evaluate((el) => getComputedStyle(el).display)).toBe("grid");
    expect(await results.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await expect(page.getByRole("button", { name: /next structure/i })).toBeHidden();
    await page.locator("#sizer aside").scrollIntoViewIfNeeded();
    await expect(page.getByRole("region", { name: /best-fit summary/i })).toHaveCount(0);
  });
});
