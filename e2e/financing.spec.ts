import { expect, test } from "@playwright/test";

test.describe("financing pages", () => {
  test("a program page renders its definition, facts, FAQ and links", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    const res = await page.goto("/financing/hud-223f-multifamily");
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("HUD 223(f) multifamily");
    await expect(page.getByText(/HUD 223\(f\) is an FHA mortgage insurance program/)).toBeVisible();

    // The key facts are a card in the side column: still a table for assistive technology (its column
    // headers are read, not shown), laid out as a stacked list that shows each figure's source and date.
    const facts = page.getByRole("table", { name: /key facts with sources and as-of dates/i });
    await expect(facts).toBeVisible();
    for (const name of ["Item", "Figure", "Source and date"]) await expect(facts.getByRole("columnheader", { name })).toBeAttached();
    const row = facts.getByRole("row", { name: /^Market-rate: max LTV/ });
    await expect(row.getByRole("rowheader")).toHaveText("Market-rate: max LTV / min DSCR");
    await expect(row.getByRole("cell").first()).toHaveText("87% / 1.15x");
    await expect(row.getByRole("cell").last()).toHaveText(/^HUD Mortgagee Letter 2025-03.*; as of \d{4}-\d{2}-\d{2}$/);
    await expect(row.getByRole("cell").last()).toBeVisible();

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
      // Three on a desktop: the hero, the sticky card in the side column and the closing card.
      await expect(main.getByRole("link", { name: "Get loan options", exact: true })).toHaveCount(3);
      await expect(main.locator("[data-side-cta]").getByRole("link", { name: "Get loan options", exact: true })).toBeVisible();
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

  test("the index shows all six families above the fold at 1440px", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/financing");
    const tiles = page.getByRole("navigation", { name: "Financing by family" });
    for (const [family, name] of [
      ["senior-living", "senior living"],
      ["hotels", "hotels"],
      ["multifamily", "multifamily"],
      ["commercial", "commercial property"],
      ["construction", "construction"],
      ["hard-money", "hard money and bridge"],
    ] as const) {
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
    for (const family of ["senior-living", "hotels", "multifamily", "commercial", "construction", "hard-money"]) {
      await page.goto(`/financing/${family}`);
      const own = await page.locator('section[aria-labelledby="family-heading"] a').evaluateAll((as) => as.map((a) => a.getAttribute("href")));
      const related = await page.locator('section[aria-labelledby="related-heading"] a').evaluateAll((as) => as.map((a) => a.getAttribute("href")));
      expect(own.length, family).toBeGreaterThan(0);
      for (const href of related) expect(own, `${family}: ${href}`).not.toContain(href);
      await expect(page.locator('section[aria-labelledby="family-heading"] h2')).toHaveText("Programs we arrange");
      await expect(page.getByText("Read more", { exact: true })).toHaveCount(0);
    }
  });

  for (const [family, alt] of [
    ["senior-living", /assisted living building/],
    ["hotels", /hotel at dusk/],
    ["multifamily", /apartment buildings/],
    ["commercial", /glass and stone office building/],
    ["construction", /under construction/],
    ["hard-money", /apartment building/],
  ] as const) {
    test(`the ${family} hub shows its image beside the heading, loaded and described`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/financing/${family}`);
      const img = page.locator(`[data-page-image="${family}"][data-family-image="${family}"] img`);
      await expect(img).toHaveAttribute("alt", alt);
      await expect(img).toBeVisible();
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
      // The whole 3:2 master in the hero's right half, sized before the file arrives, above the fold.
      const box = (await img.boundingBox())!;
      expect(box.width / box.height).toBeCloseTo(1.5, 1);
      const h1 = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
      expect(box.x, "image sits right of the heading").toBeGreaterThanOrEqual(h1.x + h1.width);
      expect(box.y + box.height, "image is above a 1440x900 fold").toBeLessThanOrEqual(900);
    });
  }

  // A hub, a program on a reused structure image, programs with images made for them (one per
  // family) and hard money, a program that is its family's hub and so shows the family image.
  for (const [path, slug, source, alt] of [
    ["/financing/multifamily", "multifamily", "family", /apartment buildings with glass balconies/],
    ["/financing/hard-money", "hard-money", "family", /renovated two-story apartment building/i],
    ["/financing/fix-and-flip", "fix-and-flip", "program", /apartment building mid-renovation/],
    ["/financing/memory-care", "memory-care", "program", /garden courtyard/],
    ["/financing/hud-223f-multifamily", "hud-223f-multifamily", "program", /garden-style apartment building with breezeway stairs/],
    ["/financing/hotel-cmbs", "hotel-cmbs", "program", /eight-story limestone and glass hotel tower/],
    ["/financing/hud-232", "hud-232", "program", /senior care campus/],
    ["/financing/office-loans", "office-loans", "program", /glass curtain wall/],
    ["/financing/construction-loans", "construction-loans", "program", /concrete frame under construction/],
  ] as const) {
    test(`${path} shows a relevant image in its hero at 1440px, loaded and described`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(path);
      const figure = page.locator(`[data-page-image="${slug}"]`);
      await expect(figure).toHaveCount(1);
      if (source === "family") await expect(figure).toHaveAttribute("data-family-image", /.+/);
      else await expect(figure).not.toHaveAttribute("data-family-image");
      const img = figure.locator("img");
      await expect(img).toHaveAttribute("alt", alt);
      await expect(img).toBeVisible();
      await expect(img).not.toHaveAttribute("loading", "lazy");
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
      const box = (await img.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(900);
      await expect(page.locator("main img")).toHaveCount(1);
    });
  }

  test("at 1440px the body is a main column beside the key facts and a sticky call to action", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/financing/hud-223f-multifamily");
    const facts = (await page.locator("[data-key-facts]").boundingBox())!;
    const firstSection = (await page.getByRole("heading", { level: 2 }).filter({ hasNotText: /key facts/i }).first().boundingBox())!;
    const form = (await page.locator("section#request").boundingBox())!;
    // Side column on the right, about a third of the container; the form in the wider main column.
    expect(facts.x).toBeGreaterThan(firstSection.x + 600);
    expect(facts.width).toBeGreaterThan(330);
    expect(facts.width).toBeLessThan(450);
    expect(form.width).toBeGreaterThan(700);
    expect(form.x + form.width).toBeLessThan(facts.x);
    // The call to action stays in view while the main column scrolls.
    const cta = page.locator("[data-side-cta]");
    await page.locator("#faq-heading").scrollIntoViewIfNeeded();
    await expect(cta).toBeInViewport();
  });

  test("on a phone the hero reads text, then image, then the key facts and the content", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/financing/fix-and-flip");
    const y = async (selector: string) => (await page.locator(selector).first().boundingBox())!.y;
    const h1 = await y("h1");
    const image = await y("[data-page-image]");
    const facts = await y("[data-key-facts]");
    const form = await y("section#request");
    expect(h1).toBeLessThan(image);
    expect(image).toBeLessThan(facts);
    expect(facts).toBeLessThan(form);
    // The sticky card is a desktop extra: the hero's actions are already on screen above.
    await expect(page.locator("[data-side-cta]")).toBeHidden();
    const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(scroll).toBeLessThanOrEqual(client);
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
  // The image pages too: a hub, a program with its own image and one on its family's.
  for (const path of ["/financing/hud-223f-multifamily", "/financing/senior-living", "/financing/fix-and-flip", "/calculators/sba-504", "/insights/california-mortgage-loan-disclosure-statement"]) {
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
