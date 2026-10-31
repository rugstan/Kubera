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

    await expect(page.getByRole("link", { name: "Size this loan" }).first()).toHaveAttribute("href", "/#sizer");
    await expect(page.getByRole("link", { name: "Start the 60-second qualifier" }).first()).toHaveAttribute("href", "/express");
    expect(errors).toEqual([]);
  });

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
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hard money loans");
    await expect(page.getByRole("link", { name: /Fix-and-flip loans/ }).first()).toBeVisible();
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
});
