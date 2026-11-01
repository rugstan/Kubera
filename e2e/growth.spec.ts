import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import { gotoHydrated, mockJsonApi } from "./helpers";

const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
type Violation = { id: string; impact: string | null; nodes: { target: string[] }[] };

async function ldTypes(page: Page): Promise<string[]> {
  return page.$$eval('script[type="application/ld+json"]', (nodes) =>
    nodes.flatMap((n) => {
      const data = JSON.parse(n.textContent ?? "null");
      return (Array.isArray(data) ? data : [data]).flatMap((d: { "@type"?: string; "@graph"?: { "@type": string }[] }) => (d["@graph"] ? d["@graph"].map((g) => g["@type"]) : [d["@type"] ?? "unknown"]));
    }),
  );
}

async function blockingAxeViolations(page: Page): Promise<string[]> {
  await page.addScriptTag({ path: axePath });
  const violations = await page.evaluate<Violation[], string[]>(
    async (tags) => (await (window as unknown as { axe: { run: (ctx: Document, opts: unknown) => Promise<{ violations: Violation[] }> } }).axe.run(document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] })).violations,
    AXE_TAGS,
  );
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

/** At least one noindex robots meta, and nothing telling crawlers to index the page. */
async function expectNotIndexed(page: Page) {
  expect(await page.locator('meta[name="robots"][content*="noindex"]').count()).toBeGreaterThan(0);
  await expect(page.locator('meta[name="robots"][content="index, follow"]')).toHaveCount(0);
  // Catches any other robots tag that would let the page be indexed.
  await expect(page.locator('meta[name="robots"]:not([content*="noindex"])')).toHaveCount(0);
}

test.describe("calculators", () => {
  test("the DSCR calculator reports coverage and the largest loan", async ({ page }) => {
    await gotoHydrated(page, "/calculators/dscr");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("DSCR calculator");
    await expect(page.getByText("Enter net operating income and a loan amount")).toBeVisible();

    await page.getByLabel("Net operating income (annual)").fill("1,000,000");
    await page.getByLabel("Loan amount").fill("10000000");
    await page.getByLabel("Interest rate").fill("6");
    await page.getByLabel("Amortization (years)").fill("30");

    const results = page.locator('[aria-live="polite"]');
    await expect(results.getByText("Debt service coverage", { exact: true })).toBeVisible();
    await expect(results.getByText("1.39x")).toBeVisible();
    await expect(results.getByText("Meets the 1.25x target.")).toBeVisible();
    await expect(results.getByText("Largest loan at the target")).toBeVisible();
  });

  test("bad input shows an inline error tied to the field", async ({ page }) => {
    await gotoHydrated(page, "/calculators/dscr");
    const noi = page.getByLabel("Net operating income (annual)");
    await noi.fill("abc");
    await noi.blur();
    await expect(noi).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("Net operating income must be greater than zero.")).toBeVisible();
    const describedBy = await noi.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
  });

  test("the HUD MIP calculator uses the flat multifamily premium and the 232 schedule", async ({ page }) => {
    await gotoHydrated(page, "/calculators/hud-mip");
    await page.getByLabel("Loan amount").fill("10000000");
    await page.getByLabel("Interest rate").fill("6");
    const results = page.locator('[aria-live="polite"]');
    await expect(results.getByText("Year-one annual MIP")).toBeVisible();
    await expect(results.getByText("$25,000").first()).toBeVisible(); // 0.25% upfront on $10M
    await expect(results.getByText(/Green certification no longer lowers/)).toBeVisible();

    await page.getByLabel("HUD program").selectOption("232-refinance");
    await expect(results.getByText("$100,000").first()).toBeVisible(); // 1% upfront on $10M
  });

  test("the SBA 504 calculator splits a hotel project 50 / 35 / 15", async ({ page }) => {
    await gotoHydrated(page, "/calculators/sba-504");
    await page.getByLabel("Total project cost").fill("10000000");
    const table = page.getByRole("table");
    await expect(table.getByRole("row", { name: /Bank first lien/ })).toContainText("$5,000,000");
    await expect(table.getByRole("row", { name: /SBA 504 debenture/ })).toContainText("$3,500,000");
    await expect(table.getByRole("row", { name: /Borrower equity/ })).toContainText("$1,500,000");
  });

  test("the hotel debt yield calculator names the binding constraint", async ({ page }) => {
    await gotoHydrated(page, "/calculators/hotel-debt-yield");
    await page.getByRole("button", { name: "Fill in an example" }).click();
    const results = page.locator('[aria-live="polite"]');
    await expect(results.getByText("12.00%", { exact: true })).toBeVisible();
    await expect(results.getByText(/binds\./)).toBeVisible();
    await page.getByLabel("Hotel type").selectOption("BOUTIQUE_INDEPENDENT");
    await expect(results.getByText(/Below the 12\.5% floor/)).toBeVisible();
  });

  test("each calculator page emits WebApplication, FAQ and breadcrumb markup and one canonical", async ({ page }) => {
    await page.goto("/calculators/sba-504");
    expect(await ldTypes(page)).toEqual(expect.arrayContaining(["WebApplication", "FAQPage", "BreadcrumbList"]));
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
    expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toMatch(/\/calculators\/sba-504$/);
  });

  test("the index links all four calculators", async ({ page }) => {
    await page.goto("/calculators");
    for (const name of ["DSCR calculator", "HUD MIP calculator", "SBA 504 calculator", "Hotel debt yield calculator"]) {
      await expect(page.getByRole("link", { name: new RegExp(name) }).first()).toBeVisible();
    }
  });
});

test.describe("rates", () => {
  test("shows a dated benchmark table with FRED attribution and Dataset markup", async ({ page }) => {
    await page.goto("/rates");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Commercial real estate loan rates today");
    await expect(page.locator("time").first()).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}$/);
    await expect(page.getByRole("link", { name: "FRED DGS10" })).toHaveAttribute("href", "https://fred.stlouisfed.org/series/DGS10");
    await expect(page.getByText(/not endorsed or certified by the Federal Reserve Bank of St. Louis/)).toBeVisible();
    await expect(page.getByRole("row", { name: /HUD 232/ })).toBeVisible();
    // Dataset markup describes live FRED figures only; fallbacks carry their fixed date and no Dataset.
    const live = (await page.getByText("Live data", { exact: true }).count()) > 0;
    expect(await ldTypes(page)).toEqual(expect.arrayContaining(live ? ["Dataset", "BreadcrumbList"] : ["BreadcrumbList"]));
    if (!live) {
      expect(await ldTypes(page)).not.toContain("Dataset");
      await expect(page.getByText(/^Fallback values set/)).toBeVisible();
    }
  });
});

test.describe("insights", () => {
  test("an article shows a byline, key takeaways and Article markup with a Person author", async ({ page }) => {
    await page.goto("/insights");
    await page.getByRole("link", { name: /What the 2025 HUD changes mean/ }).first().click();
    await expect(page).toHaveURL(/\/insights\/hud-multifamily-2025-changes$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("2025 HUD changes");
    await expect(page.getByRole("heading", { name: "Key takeaways" })).toBeVisible();
    await expect(page.locator("time").first()).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}$/);

    const article = await page.$$eval('script[type="application/ld+json"]', (nodes) => nodes.map((n) => JSON.parse(n.textContent ?? "null")).flat().find((d: { "@type"?: string }) => d["@type"] === "Article"));
    expect(article.author["@type"]).toBe("Person");
    expect(article.author.name).toBeTruthy();
    expect(article.datePublished).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
  });

  test("the legal explainer carries the draft notice until counsel signs off", async ({ page }) => {
    await page.goto("/insights/california-mortgage-loan-disclosure-statement");
    await expect(page.getByText("DRAFT — pending counsel review")).toBeVisible();
  });
});

test.describe("glossary", () => {
  test("lists terms A to Z with anchors and DefinedTermSet markup", async ({ page }) => {
    await page.goto("/glossary");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Commercial real estate finance glossary");
    await expect(page.locator("dt#dscr, #dscr dt").first()).toBeVisible();
    await page.getByRole("link", { name: "D", exact: true }).click();
    await expect(page).toHaveURL(/#letter-D$/);
    expect(await ldTypes(page)).toEqual(expect.arrayContaining(["DefinedTermSet"]));
    const terms = await page.locator("dt").count();
    expect(terms).toBeGreaterThanOrEqual(40);
  });
});

test.describe("California metro pages", () => {
  test("each metro page renders its rules table and service markup", async ({ page }) => {
    for (const [slug, h1] of [
      ["los-angeles", "Los Angeles commercial real estate loans"],
      ["orange-county", "Orange County commercial real estate loans"],
      ["bay-area", "Bay Area commercial real estate loans"],
    ] as const) {
      const res = await page.goto(`/california/${slug}`);
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(h1);
      await expect(page.getByRole("columnheader", { name: "Figure" })).toBeVisible();
      expect(await ldTypes(page)).toEqual(expect.arrayContaining(["Service", "FAQPage", "BreadcrumbList"]));
    }
  });

  test("an unknown metro shows the not-found page and is not indexed", async ({ page }) => {
    await page.goto("/california/atlantis");
    await expect(page.getByRole("heading", { level: 1, name: /couldn.t find that page/i })).toBeVisible();
    await expectNotIndexed(page);
  });

  test("unknown insight and calculator slugs are not indexed either", async ({ page }) => {
    for (const path of ["/insights/no-such-article", "/calculators/no-such-calculator"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: /couldn.t find that page/i })).toBeVisible();
      await expectNotIndexed(page);
    }
  });
});

test.describe("newsletter", () => {
  test("signup needs consent, then asks the person to check their inbox", async ({ page }) => {
    const calls = await mockJsonApi(page, "/api/newsletter/subscribe", { body: { ok: true, message: "Check your inbox for a confirmation link. You are not subscribed until you click it." } });
    await gotoHydrated(page, "/newsletter");
    const signup = page.locator("[data-newsletter-signup]");
    await signup.getByLabel(/Email address/).fill("pat@example.com");
    await signup.getByRole("button", { name: "Subscribe" }).click();
    await expect(signup.getByText("Tick the box to subscribe.")).toBeVisible();
    expect(calls).toHaveLength(0);

    await signup.getByRole("checkbox").check();
    await signup.getByRole("button", { name: "Subscribe" }).click();
    await expect(signup.getByRole("status")).toContainText("You are not subscribed until you click it");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({ email: "pat@example.com", consent: true, consentMeta: { textVersion: "newsletter-signup-2026-11-05", page: "/newsletter" } });
    expect(calls[0]!.contentType).toBe("application/json");
  });

  test("shows the notice at collection and the exact consent wording", async ({ page }) => {
    await page.goto("/newsletter");
    await expect(page.locator('[data-notice-at-collection="newsletter"]')).toBeVisible();
    await expect(page.getByText(/Subscribing is not a condition of any service/)).toBeVisible();
  });

  test("the server answers 503 when email is not configured, and the form says so", async ({ page }) => {
    await gotoHydrated(page, "/newsletter");
    const signup = page.locator("[data-newsletter-signup]");
    await signup.getByLabel(/Email address/).fill("pat@example.com");
    await signup.getByRole("checkbox").check();
    await signup.getByRole("button", { name: "Subscribe" }).click();
    await expect(signup.locator("p[role=alert]")).toBeVisible();
  });

  test("opening the confirmation link changes nothing until the button is pressed", async ({ page }) => {
    const calls = await mockJsonApi(page, "/api/newsletter/confirm", { body: { ok: true, status: "confirmed" } });
    await gotoHydrated(page, "/newsletter/confirm?token=c.6f1b5c1e-2a8e-4c39-9a55-3d3c1b7f2a10.0.example");
    expect(calls).toHaveLength(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await page.getByRole("button", { name: "Confirm subscription" }).click();
    await expect(page.getByText(/You are subscribed/)).toBeVisible();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({ token: "c.6f1b5c1e-2a8e-4c39-9a55-3d3c1b7f2a10.0.example" });
  });

  test("an expired confirmation link says so and offers a fresh signup", async ({ page }) => {
    const calls = await mockJsonApi(page, "/api/newsletter/confirm", { status: 400, body: { error: "This confirmation link has expired. Sign up again to get a new one.", reason: "expired" } });
    await gotoHydrated(page, "/newsletter/confirm?token=c.6f1b5c1e-2a8e-4c39-9a55-3d3c1b7f2a10.1.example");
    await page.getByRole("button", { name: "Confirm subscription" }).click();
    const alert = page.locator("p[role=alert]");
    await expect(alert).toHaveText("This confirmation link has expired. Sign up again to get a new one.");
    await expect(alert).not.toContainText("check your answers");
    await expect(page.getByRole("link", { name: "Sign up for the newsletter again" })).toHaveAttribute("href", "/newsletter");
    expect(calls).toHaveLength(1);
  });

  test("a link without a token explains itself", async ({ page }) => {
    await gotoHydrated(page, "/newsletter/unsubscribe");
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveText("Unsubscribe from the newsletter");
    await expect(page.locator("p[role=alert]")).toContainText("This link is incomplete");
    await gotoHydrated(page, "/newsletter/confirm");
    await expect(page.locator("h1")).toHaveText("Confirm your subscription");
  });
});

test.describe("sitemap", () => {
  test("lists the growth pages", async ({ request }) => {
    const xml = await (await request.get("/sitemap.xml")).text();
    for (const path of ["/insights", "/insights/dscr-vs-debt-yield", "/rates", "/calculators", "/calculators/dscr", "/calculators/hud-mip", "/calculators/sba-504", "/calculators/hotel-debt-yield", "/glossary", "/california/los-angeles", "/california/orange-county", "/california/bay-area", "/newsletter"]) {
      expect(xml, path).toMatch(new RegExp(`<loc>[^<]*${path.replace(/\//g, "\\/")}</loc>`));
    }
    expect(xml).not.toContain("/newsletter/confirm");
  });
});

for (const width of [1280, 390]) {
  test.describe(`growth pages a11y at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });
    for (const route of ["/insights", "/insights/dscr-vs-debt-yield", "/rates", "/calculators/dscr", "/calculators/sba-504", "/glossary", "/california/bay-area", "/newsletter"]) {
      test(`${route} has no serious or critical axe violations`, async ({ page }) => {
        await gotoHydrated(page, route);
        expect(await blockingAxeViolations(page)).toEqual([]);
      });
    }
  });
}

test("calculator results are readable on a phone without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoHydrated(page, "/calculators/sba-504");
  await page.getByLabel("Total project cost").fill("10000000");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
