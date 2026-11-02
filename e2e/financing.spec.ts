import { expect, test } from "@playwright/test";

test.describe("financing pages", () => {
  test("a program page renders its definition, facts, FAQ and links", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    const res = await page.goto("/financing/hud-223f-multifamily");
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("HUD 223(f) multifamily");
    await expect(page.getByText(/HUD 223\(f\) is an FHA mortgage insurance program/)).toBeVisible();

    const facts = page.getByRole("table");
    await expect(facts.getByRole("columnheader", { name: "Source and date" })).toBeVisible();
    await expect(facts.getByText("87%").first()).toBeVisible();

    // FAQ opens with the keyboard.
    const summary = page.locator("summary").first();
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("details").first()).toHaveAttribute("open", "");

    // The page's own actions carry its family: the qualifier and the sizer open on multifamily.
    const main = page.locator("main");
    await expect(main.getByRole("link", { name: "Size my loan", exact: true }).first()).toHaveAttribute("href", "/?sizer=multifamily#sizer");
    await expect(main.getByRole("link", { name: "Get loan options", exact: true }).first()).toHaveAttribute("href", "/express?family=multifamily");
    expect(errors).toEqual([]);
  });

  for (const family of ["construction", "hard-money"]) {
    test(`the ${family} hub's actions open the qualifier and the sizer on ${family}`, async ({ page }) => {
      await page.goto(`/financing/${family}`);
      const main = page.locator("main");
      for (const link of await main.getByRole("link", { name: "Get loan options", exact: true }).all()) await expect(link).toHaveAttribute("href", `/express?family=${family}`);
      for (const link of await main.getByRole("link", { name: "Size my loan", exact: true }).all()) await expect(link).toHaveAttribute("href", `/?sizer=${family}#sizer`);
      await expect(main.getByRole("link", { name: "Get loan options", exact: true })).toHaveCount(2);
      // The closing card is light, not a black band.
      await expect(main.locator(".bento-pro")).toHaveCount(0);
    });
  }

  test("emits one canonical and FAQ, loan and breadcrumb JSON-LD", async ({ page }) => {
    await page.goto("/financing/rcfe");
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
    expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toMatch(/\/financing\/rcfe$/);
    const types = await page.$$eval('script[type="application/ld+json"]', (nodes) =>
      nodes.flatMap((n) => {
        const data = JSON.parse(n.textContent ?? "null");
        return (Array.isArray(data) ? data : [data]).map((d: { "@type"?: string }) => d["@type"] ?? "graph");
      }),
    );
    expect(types).toEqual(expect.arrayContaining(["LoanOrCredit", "FAQPage", "BreadcrumbList"]));
  });

  test("a hub links to its programs", async ({ page }) => {
    await page.goto("/financing/senior-living");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Senior living financing");
    await page.getByRole("link", { name: /Skilled nursing/ }).first().click();
    await expect(page).toHaveURL(/\/financing\/skilled-nursing$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Skilled nursing");
  });

  test("the hard-money URL is both the program and its hub", async ({ page }) => {
    await page.goto("/financing/hard-money");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hard money and bridge loans");
    await expect(page.getByRole("link", { name: /Fix-and-flip loans/ }).first()).toBeVisible();
  });

  test("the index shows all five families above the fold at 1440px", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/financing");
    const tiles = page.getByRole("navigation", { name: "Financing by family" });
    for (const [family, name] of [["senior-living", "senior living"], ["hotels", "hotels"], ["multifamily", "multifamily"], ["construction", "construction"], ["hard-money", "hard money and bridge"]] as const) {
      const explore = tiles.getByRole("link", { name: `Explore ${name} financing`, exact: true });
      await expect(explore).toHaveAttribute("href", `/financing/${family}`);
      const box = (await explore.boundingBox())!;
      expect(box.y + box.height, family).toBeLessThanOrEqual(900);
      await expect(tiles.locator(`a[href="#${family}-heading"]`)).toHaveCount(1);
    }
    // Each family heading is a link to its hub.
    await expect(page.locator("#construction-heading a")).toHaveAttribute("href", "/financing/construction");
  });

  test("on a phone the sticky jump bar reaches construction and hard money", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/financing");
    const bar = page.getByRole("navigation", { name: "Jump to a financing family" });
    await expect(bar).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Financing by family" })).toBeHidden();
    await bar.getByRole("link", { name: "Hard money and bridge" }).click();
    await expect(page).toHaveURL(/#hard-money-heading$/);
    await expect(page.locator("#hard-money-heading")).toBeInViewport();
    // Still stuck under the header after the jump, and the heading is not hidden behind it.
    const barBox = (await bar.boundingBox())!;
    const headingBox = (await page.locator("#hard-money-heading").boundingBox())!;
    expect(barBox.y).toBeGreaterThanOrEqual(0);
    expect(headingBox.y).toBeGreaterThanOrEqual(barBox.y + barBox.height - 1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("hub pages never repeat their own programs under related links", async ({ page }) => {
    for (const family of ["senior-living", "hotels", "multifamily", "construction", "hard-money"]) {
      await page.goto(`/financing/${family}`);
      const own = await page.locator('section[aria-labelledby="family-heading"] a').evaluateAll((as) => as.map((a) => a.getAttribute("href")));
      const related = await page.locator('section[aria-labelledby="related-heading"] a').evaluateAll((as) => as.map((a) => a.getAttribute("href")));
      expect(own.length, family).toBeGreaterThan(0);
      for (const href of related) expect(own, `${family}: ${href}`).not.toContain(href);
      await expect(page.locator('section[aria-labelledby="family-heading"] h2')).toHaveText("Programs we arrange");
      await expect(page.getByText("Read more", { exact: true })).toHaveCount(0);
    }
  });

  test("unknown slugs return 404", async ({ request }) => {
    // Request twice: a first render of an unlisted path can stream before it is cached.
    await request.get("/financing/not-a-program");
    expect((await request.get("/financing/not-a-program")).status()).toBe(404);
  });

  test("the sitemap lists the financing pages", async ({ request }) => {
    const xml = await (await request.get("/sitemap.xml")).text();
    expect(xml).toContain("/financing/hud-232");
    expect(xml).toContain("/financing/hard-money");
    expect(xml).toContain("/financing/senior-living");
  });

  // WCAG 1.4.10 Reflow: no horizontal scroll at 320 CSS px. Every page with the
  // CtaBand once overflowed by ~13px because the qualifier pill could not wrap.
  for (const path of ["/financing/hud-223f-multifamily", "/calculators/sba-504", "/insights/california-mortgage-loan-disclosure-statement"]) {
    test(`${path} does not scroll sideways at 320px`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      expect((await page.goto(path))?.status()).toBe(200);
      await expect(page.getByRole("link", { name: "Get loan options" }).last()).toBeVisible();
      const { scroll, client } = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(scroll, `${path}: page is ${scroll}px wide at a ${client}px viewport`).toBeLessThanOrEqual(client);
    });
  }
});
