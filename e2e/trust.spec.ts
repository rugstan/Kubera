import { expect, test } from "@playwright/test";

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

    test(`${p.path} has no horizontal scroll at 390px`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(p.path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test("contact lists the mailbox routing table", async ({ page }) => {
    await page.goto("/contact");
    const table = page.getByRole("table", { name: /which kubera commercial mailbox/i });
    await expect(table).toBeVisible();
    for (const box of ["deals", "lenders", "partners", "vendors", "compliance"]) {
      await expect(table.getByRole("link", { name: `${box}@kuberacommercial.com` })).toBeVisible();
    }
    // No booking handle in the e2e env: an honest email fallback, no third-party frame.
    await expect(page.getByText(/online scheduling is not set up yet/i)).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(0);
  });

  test("track record ships empty and points to representative structures", async ({ page }) => {
    await page.goto("/track-record");
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
    for (const name of ["About Kubera", "Our advisors", "Track record", "Representative structures", "Contact"]) {
      await expect(footer.getByRole("link", { name })).toBeVisible();
    }
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Contact" })).toBeAttached();
  });

  test("sitemap lists the trust pages", async ({ request }) => {
    const xml = await (await request.get("/sitemap.xml")).text();
    for (const p of ["/about", "/team", "/contact", "/track-record", "/structures", "/structures/memory-care-bridge-to-hud"]) {
      expect(xml).toContain(`${p}</loc>`);
    }
  });
});
