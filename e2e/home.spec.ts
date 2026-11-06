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

  test("runs the sections in conversion order", async ({ page }) => {
    await page.goto("/");
    const headings = await page.locator("main h2").allTextContents();
    const order = [/what are you financing/i, /tell us about the deal once/i, /size your loan/i, /we work for you/i, /how deals like yours/i, /questions borrowers ask/i, /tell us about your deal/i];
    const at = order.map((re) => headings.findIndex((h) => re.test(h)));
    expect(at.every((i) => i >= 0), JSON.stringify(headings)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // One black band on the page: Why a broker.
    await expect(page.locator("main .bg-pro")).toHaveCount(1);
    await expect(page.locator("main .bg-pro h2")).toHaveText(/we work for you/i);
  });

  test("shows all six families with hub links, deep-link ids and qualifier links", async ({ page }) => {
    await page.goto("/");
    const programs = page.locator("#programs");
    for (const family of ["senior-living", "hotels", "multifamily", "commercial", "construction", "hard-money"]) {
      await expect(programs.locator(`#${family}`)).toHaveCount(1);
      const hub = programs.locator(`#${family}`).getByRole("link", { name: /^explore /i });
      await expect(hub).toBeVisible();
      await expect(hub).toHaveAttribute("href", `/financing/${family}`);
      const options = programs.locator(`#${family}`).getByRole("link", { name: /^get options/i });
      await expect(options).toHaveAttribute("href", `/express?family=${family}`);
    }
    await expect(programs.getByRole("heading", { level: 3 })).toHaveCount(6);
  });

  test("uses one primary call to action, worded the same everywhere", async ({ page }) => {
    await page.goto("/");
    const hero = page.locator("main > section").first();
    await expect(hero.getByRole("link", { name: "Get loan options", exact: true })).toHaveAttribute("href", "/express");
    await expect(hero.getByRole("link", { name: "Size my loan", exact: true })).toHaveAttribute("href", "/#sizer");
    // Online scheduling is not configured in e2e, so the call action is "Email an advisor", never a page that cannot book.
    await expect(hero.getByRole("link", { name: /email an advisor/i })).toHaveAttribute("href", /^mailto:\S+@/);
    await expect(page.locator("main").getByRole("link", { name: /book a call/i })).toHaveCount(0);
    const process = page.locator("main > section", { has: page.getByRole("heading", { name: /tell us about the deal once/i }) });
    await expect(process.getByRole("link", { name: "Get loan options", exact: true })).toHaveAttribute("href", "/express");
    const final = page.locator("main > section", { has: page.getByRole("heading", { name: /tell us about your deal\./i }) });
    await expect(final.getByRole("link", { name: "Get loan options", exact: true })).toHaveAttribute("href", "/express");
    await expect(final.getByRole("link", { name: "Email an advisor", exact: true })).toHaveAttribute("href", /^mailto:\S+@/);
    // One filled primary per homepage section (the sizer's own result bar is the sizer's).
    for (const section of await page.locator("main > section:not(#sizer)").all()) expect(await section.locator(".pill-primary").count()).toBeLessThanOrEqual(1);
  });

  test("answers borrower questions with FAQPage JSON-LD", async ({ page }) => {
    await page.goto("/");
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    const faq = blocks.map((b) => JSON.parse(b) as { "@type"?: string; mainEntity?: unknown[] }).find((n) => n["@type"] === "FAQPage");
    expect(faq?.mainEntity?.length).toBeGreaterThanOrEqual(5);
    const question = page.locator("details", { hasText: /are you a lender/i });
    await expect(question).toContainText(/not a lender/i);
  });

  test("never mentions AI in the page content or metadata", async ({ page }) => {
    await page.goto("/");
    expect(await page.locator("main").innerText()).not.toMatch(/\bAI\b|AI-assisted|Corin AI/);
    await expect(page).toHaveTitle("Corin Commercial | California Commercial Loan Broker");
    const description = await page.locator('meta[name="description"]').getAttribute("content");
    expect(description).toMatch(/construction, bridge and hard money/);
    expect(description).not.toMatch(/\bAI\b/);
  });

  test("on a phone the primary CTA is above the fold with no sideways scroll", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoHydrated(page, "/");
    const cta = page.locator("main > section").first().getByRole("link", { name: "Get loan options", exact: true });
    await expect(cta).toBeVisible();
    const box = (await cta.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(844);
    expect(box.height).toBeGreaterThanOrEqual(36);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("every family has an entry point in the hero, above a 1440x900 fold", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoHydrated(page, "/");
    const families = page.getByRole("navigation", { name: "What we finance" });
    for (const [name, href] of [
      ["Senior living", "/financing/senior-living"],
      ["Hotels", "/financing/hotels"],
      ["Multifamily", "/financing/multifamily"],
      ["Commercial property", "/financing/commercial"],
      ["Construction", "/financing/construction"],
      ["Hard money and bridge", "/financing/hard-money"],
    ] as const) {
      const link = families.getByRole("link", { name, exact: true });
      await expect(link).toHaveAttribute("href", href);
      const box = (await link.boundingBox())!;
      expect(box.y + box.height, name).toBeLessThanOrEqual(900);
    }
    // The facts row under the hero clears the fold too.
    const facts = (await page.locator("main > section").first().locator("dl").boundingBox())!;
    expect(facts.y + facts.height).toBeLessThanOrEqual(900);
  });

  test("on a phone all six family cards fit in under two screens", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoHydrated(page, "/");
    const cards = page.locator("#programs article");
    await expect(cards).toHaveCount(6);
    const first = (await cards.first().boundingBox())!;
    const last = (await cards.last().boundingBox())!;
    // Five cards fit in 1.6 screens; the sixth (commercial property) adds one card's height.
    expect(last.y + last.height - first.y).toBeLessThanOrEqual(844 * 1.92);
    // Each card shows its lead program and a link to the rest.
    await expect(page.locator("#multifamily").getByRole("link", { name: /^\+\d+ more multifamily programs$/ })).toBeVisible();
    // The card footers share one layout: the link and the pill on one row.
    for (const card of await cards.all()) {
      const explore = (await card.getByRole("link", { name: /^explore /i }).boundingBox())!;
      const options = (await card.getByRole("link", { name: /^get options/i }).boundingBox())!;
      expect(Math.abs(explore.y + explore.height / 2 - (options.y + options.height / 2))).toBeLessThan(6);
    }
  });

  test("keeps the DRE number on one line in the hero eyebrow on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const license = page.locator("main > section").first().locator(".eyebrow [data-dre-license]");
    await expect(license).toHaveText(/^CA DRE #\S+$/);
    const box = (await license.boundingBox())!;
    expect(box.height).toBeLessThan(30);
    // A long license value wraps rather than widening the page at the 320px reflow width.
    await page.setViewportSize({ width: 320, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });

  test("states no day-range closing timelines", async ({ page }) => {
    await gotoHydrated(page, "/");
    await expect(page.locator("#sizer").getByText(/Typical close:/).first()).toBeVisible();
    expect(await page.locator("main").innerText()).not.toMatch(/\b\d+\s*[–-]\s*\d+\s+(?:days|business days)\b/);
  });

  test("shows the hero image below the facts row, loaded and described", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const hero = page.locator("main > section").first();
    const img = hero.locator("[data-home-hero-image] img");
    await expect(img).toHaveAttribute("alt", /apartment building/);
    await expect(img).not.toHaveAttribute("loading", "lazy");
    await img.scrollIntoViewIfNeeded();
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    const box = (await img.boundingBox())!;
    expect(box.width / box.height).toBeCloseTo(2, 1);
    // Under the facts row, never over the headline or the actions.
    const facts = (await hero.locator("dl").boundingBox())!;
    expect(box.y).toBeGreaterThan(facts.y + facts.height);
  });

  test("family cards show their photos from md and leave them off on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    // Every family, commercial property included (family-commercial, 2026-11-05).
    await expect(page.locator("#programs [data-family-card-image] img")).toHaveCount(6);
    const img = page.locator("#hotels [data-family-card-image] img");
    await expect(img).toHaveAttribute("alt", /hotel at dusk/);
    await img.scrollIntoViewIfNeeded();
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    const box = (await img.boundingBox())!;
    expect(box.width / box.height).toBeCloseTo(4 / 3, 1);

    // Phone cards stay compact (see "about a screen and a half" above).
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("#programs [data-family-card-image]").first()).toBeHidden();
  });

  test("a family deep link lands on its card", async ({ page }) => {
    await gotoHydrated(page, "/#construction");
    await expect(page.locator("#construction")).toBeInViewport();
  });
});

test.describe("platform endpoints", () => {
  test("cron endpoints reject unauthenticated callers", async ({ request }) => {
    expect((await request.get("/api/cron/crm-retry")).status()).toBe(401);
    expect((await request.get("/api/cron/rates")).status()).toBe(401);
  });
});
