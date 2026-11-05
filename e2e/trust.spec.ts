import { expect, test, type Page } from "@playwright/test";

/** The CTA pill rows switch to a row at 640px, so check either side of that and a tablet width. */
async function noSidewaysScroll(page: Page, path: string) {
  await page.goto(path);
  for (const width of [390, 640, 768]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} overflows by ${overflow}px at ${width}px`).toBeLessThanOrEqual(0);
  }
}

const PAGES = [
  { path: "/about", h1: /licensed broker, not a lender/i },
  { path: "/team", h1: /licensed advisors lead every engagement/i },
  { path: "/contact", h1: /talk to a licensed advisor/i },
  { path: "/track-record", h1: /closed transactions, reported honestly/i },
  { path: "/structures", h1: /how these programs are typically arranged/i },
];

test.describe("trust pages", () => {
  for (const p of PAGES) {
    test(`${p.path} renders with one h1, a canonical and the license line`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const res = await page.goto(p.path);
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(p.h1);
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
      await expect(page.getByText(/Real estate broker, California Department of Real Estate/i).first()).toBeAttached();
      expect(errors).toEqual([]);
    });

    test(`${p.path} has no horizontal scroll at 390px, 640px or 768px`, async ({ page }) => {
      await noSidewaysScroll(page, p.path);
    });
  }

  test("a structure page has no horizontal scroll at 390px, 640px or 768px", async ({ page }) => {
    await noSidewaysScroll(page, "/structures/memory-care-bridge-to-hud");
  });

  test("/about shows its banner, loaded and described", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/about");
    const img = page.locator("[data-about-image] img");
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute("alt", /^Aerial view of a suburban neighborhood/);
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    const box = (await img.boundingBox())!;
    expect(box.width / box.height).toBeCloseTo(2, 1);
  });

  for (const [slug, alt] of [
    ["assisted-living-sba-504-refinance", /craftsman-style house/],
    ["flagged-hotel-sba-504-green-pip", /hotel under renovation/],
    ["memory-care-bridge-to-hud", /garden courtyard/],
    ["hotel-to-assisted-living-conversion-bridge", /entry ramp/],
    ["multifamily-construction-bank-cpace", /apartment building nearing completion/],
    ["investor-rehab-hard-money", /apartment building mid-renovation/],
  ] as const) {
    test(`/structures/${slug} shows its image under the illustrative note`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/structures/${slug}`);
      const img = page.locator(`[data-structure-image="${slug}"] img`);
      await expect(img).toHaveCount(1);
      await expect(img).toHaveAttribute("alt", alt);
      await img.scrollIntoViewIfNeeded();
      await expect(img).toBeVisible();
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
      const box = (await img.boundingBox())!;
      expect(box.width / box.height).toBeCloseTo(16 / 9, 1);
      const note = (await page.getByRole("note").filter({ hasText: /illustrative example/i }).boundingBox())!;
      expect(box.y).toBeGreaterThan(note.y + note.height);
    });
  }

  test("/structures shows a photo on every structure card; the home page cards stay text only", async ({ page }) => {
    await page.goto("/structures");
    const cards = page.locator("#structures article");
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
    await expect(page.locator("#structures [data-structure-card-image] img")).toHaveCount(count);
    const img = page.locator('[data-structure-card-image="memory-care-bridge-to-hud"] img');
    await expect(img).toHaveAttribute("alt", /garden courtyard/);
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);

    await page.goto("/");
    await expect(page.locator("main [data-structure-card-image]")).toHaveCount(0);
  });

  test("contact cards keep their content inside the card at 768px", async ({ page }) => {
    // Long email addresses must wrap: the rightmost card's overflow reaches the page edge.
    await page.goto("/contact");
    await page.setViewportSize({ width: 768, height: 900 });
    const spills = await page.evaluate(() =>
      [...document.querySelectorAll(".bento")].flatMap((card) => {
        const edge = card.getBoundingClientRect().right;
        return [...card.querySelectorAll("*")]
          .filter((el) => el.getBoundingClientRect().right > edge + 0.5)
          .map((el) => (el.textContent ?? "").trim().slice(0, 60));
      }),
    );
    expect(spills).toEqual([]);
  });

  test("contact lists the mailbox routing table", async ({ page }) => {
    await page.goto("/contact");
    const table = page.getByRole("table", { name: /which corin commercial mailbox/i });
    await expect(table).toBeVisible();
    for (const box of ["deals", "lenders", "partners", "vendors", "compliance"]) {
      await expect(table.getByRole("link", { name: `${box}@corincommercial.com` })).toBeVisible();
    }
    // No booking handle or phone in the e2e env: an email path for a call, no placeholder copy and no third-party frame.
    await expect(page.locator("#schedule")).toContainText(/two or three times that work for you/i);
    await expect(page.locator("main")).not.toContainText(/not set up yet|coming soon/i);
    await expect(page.getByRole("heading", { name: "Phone", exact: true })).toHaveCount(0);
    await expect(page.locator("iframe")).toHaveCount(0);
  });

  test("contact puts both actions above the fold on a phone, before the mailbox table", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/contact");
    const main = page.locator("main");
    const primary = main.getByRole("link", { name: "Get loan options", exact: true }).first();
    await expect(primary).toHaveAttribute("href", "/express");
    expect(((await primary.boundingBox())!.y) + 44).toBeLessThanOrEqual(844);
    // No booking handle in e2e, so the second action emails an advisor.
    const second = main.getByRole("link", { name: "Email an advisor", exact: true }).first();
    await expect(second).toHaveAttribute("href", /^mailto:\S+@/);
    expect(((await second.boundingBox())!.y) + 44).toBeLessThanOrEqual(844);
    // The routing table for lenders, partners and vendors comes last.
    const ids = await main.locator("section[id]").evaluateAll((els) => els.map((e) => e.id));
    expect(ids.at(-1)).toBe("mailboxes");
    await expect(main).not.toContainText(/for our office address/i);
  });

  test("track record ships empty, stays out of search and points to representative structures", async ({ page }) => {
    await page.goto("/track-record");
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
    await expect(page.getByRole("heading", { name: /no closed transactions published yet/i })).toBeVisible();
    await page.getByRole("link", { name: /see representative structures/i }).click();
    await expect(page).toHaveURL(/\/structures$/);
  });

  test("home cards open an illustrative structure page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /see how it is structured.*memory care/i }).click();
    await expect(page).toHaveURL(/\/structures\/memory-care-bridge-to-hud$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("$16.8M");
    await expect(page.getByText(/illustrative example/i).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /what a lender will look at closely/i })).toBeVisible();
  });

  test("an unknown structure shows the not-found page and is marked noindex", async ({ page }) => {
    // With Cache Components the response status is sent before notFound() resolves, so the
    // reliable signals are the rendered not-found page and the noindex robots meta tag.
    await page.goto("/structures/made-up-deal");
    await expect(page.getByRole("heading", { level: 1, name: /\$\d/ })).toHaveCount(0);
    await expect(page.locator('meta[name="robots"][content="noindex"]').first()).toBeAttached();
  });

  test("header and footer link to the trust pages", async ({ page }) => {
    await page.goto("/about");
    const footer = page.getByRole("contentinfo");
    for (const name of ["About Corin", "Representative structures", "Contact"]) {
      await expect(footer.getByRole("link", { name })).toBeVisible();
    }
    // The e2e build has no published closings and only a placeholder advisor, so the
    // two proof pages stay out of the footer until they have something to show.
    await expect(footer.getByRole("link", { name: "Track record", exact: true })).toHaveCount(0);
    await expect(footer.getByRole("link", { name: "Our advisors", exact: true })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Contact" })).toBeAttached();
  });

  test("sitemap lists the trust pages", async ({ request }) => {
    const xml = await (await request.get("/sitemap.xml")).text();
    for (const p of ["/about", "/team", "/contact", "/structures", "/structures/memory-care-bridge-to-hud"]) {
      expect(xml).toContain(`${p}</loc>`);
    }
    // No published closings yet: /track-record is noindex and left out of the sitemap.
    expect(xml).not.toContain("/track-record</loc>");
  });
});
