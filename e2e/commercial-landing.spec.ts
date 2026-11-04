import { expect, test, type Page } from "@playwright/test";
import { seriousViolations } from "./forms-helpers";
import { gotoHydrated, mockJsonApi } from "./helpers";

// The commercial property family (hub plus property-type and capital-type
// pages) and the short request form every financing page now carries. The form
// posts to /api/qualify, which is mocked here as in the other form specs.

const COMMERCIAL_PAGES: [string, string][] = [
  ["office-loans", "Office building loans"],
  ["industrial-loans", "Industrial and warehouse loans"],
  ["retail-loans", "Retail property loans"],
  ["self-storage-loans", "Self-storage loans"],
  ["medical-office-loans", "Medical office building loans"],
  ["mixed-use-loans", "Mixed-use property loans"],
  ["mobile-home-park-loans", "Manufactured housing communities"],
  ["acquisition-loans", "Acquisition loans"],
  ["mezzanine-preferred-equity", "Mezzanine and preferred equity"],
  ["life-company-loans", "Life company loans"],
  ["bank-credit-union-loans", "Bank and credit union loans"],
  ["cmbs-loans", "CMBS conduit loans"],
  ["debt-fund-bridge-loans", "Debt fund bridge loans"],
];

/** What the route answers a financing-page lead: no automated result, an advisor reviews it. */
const QUICK_RESPONSE = {
  leadId: "0d6f2a6e-5c1b-4b8e-9d2f-6f1a2b3c4d5e",
  uploadToken: null,
  result: { program: null, secondary: null, flag: "ADVISOR_REVIEW", indicativeLoan: 0, indicativeRatePct: null, term: null, recourse: null, closeTimeline: null, callScheduled: false, qualified: false },
};

async function noHorizontalScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(scroll, `page is ${scroll}px wide at a ${client}px viewport`).toBeLessThanOrEqual(client);
}

const requestForm = (page: Page) => page.locator("section#request");

async function fillRequest(page: Page, opts: { consent?: boolean } = {}) {
  const form = requestForm(page);
  await form.getByLabel(/^approximate loan amount/i).fill("4500000");
  await form.locator("label").filter({ hasText: /^purchase$/i }).click();
  await form.getByLabel(/when do you need to close/i).selectOption("90");
  await form.getByLabel(/^first name/i).fill("Pat");
  await form.getByLabel(/^last name/i).fill("Lee");
  await form.getByLabel(/^email/i).fill("pat.lee@example.com");
  await form.getByLabel(/^company/i).fill("Lee Holdings");
  await form.getByLabel(/anything else/i).fill("Two-story building near the 405.");
  if (opts.consent) {
    await form.getByLabel(/^mobile phone/i).fill("415-555-0100");
    await form.getByRole("checkbox", { name: /i agree that corin commercial may contact me/i }).check();
  }
}

test.describe("commercial property family", () => {
  test("the hub lists every commercial page, renders without an image and carries the request form", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const res = await page.goto("/financing/commercial");
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Commercial property financing");
    await expect(page.locator("[data-family-image]")).toHaveCount(0);
    const family = page.locator('section[aria-labelledby="family-heading"]');
    for (const [slug, name] of COMMERCIAL_PAGES) await expect(family.locator(`a[href="/financing/${slug}"]`), slug).toContainText(name);
    await expect(requestForm(page).getByRole("heading", { level: 2, name: "Send your deal to an advisor" })).toBeVisible();
    const main = page.locator("main");
    for (const link of await main.getByRole("link", { name: "Get loan options", exact: true }).all()) await expect(link).toHaveAttribute("href", "/express?family=commercial");
    for (const link of await main.getByRole("link", { name: "Size my loan", exact: true }).all()) await expect(link).toHaveAttribute("href", "/?sizer=commercial#sizer");
    await expect(page.getByText("Real estate broker, California Department of Real Estate").first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  for (const [slug, name] of COMMERCIAL_PAGES) {
    test(`/financing/${slug} loads with its facts, disclosures and the request form`, async ({ page }) => {
      const res = await page.goto(`/financing/${slug}`);
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
      await expect(page.getByRole("table")).toBeVisible();
      await expect(page.locator(`[data-lead-form="${slug}"]`)).toHaveCount(1);
      await expect(page.getByRole("complementary", { name: "Disclosures" })).toContainText("not a lender");
    });
  }

  test("the sitemap and the financing index list the new family", async ({ page, request }) => {
    const xml = await (await request.get("/sitemap.xml")).text();
    for (const slug of ["commercial", "office-loans", "cmbs-loans"]) expect(xml).toContain(`/financing/${slug}`);
    await page.goto("/financing");
    await expect(page.locator("#commercial-heading a")).toHaveAttribute("href", "/financing/commercial");
  });
});

test.describe("financing-page request form", () => {
  // The form sits mid-page; smooth scrolling (off under reduced motion) would
  // leave controls moving while Playwright clicks them.
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("submits from a program page with the page's property type and shows the advisor follow-up", async ({ page }) => {
    const calls = await mockJsonApi(page, "/api/qualify", { body: QUICK_RESPONSE });
    await gotoHydrated(page, "/financing/office-loans");
    const form = requestForm(page);
    await expect(form.getByLabel(/^property type/i)).toHaveValue("OFFICE");
    await fillRequest(page, { consent: true });
    await form.getByRole("button", { name: "Send to an advisor" }).click();

    const done = form.getByRole("heading", { level: 2, name: /thanks, pat\. a licensed advisor will follow up\./i });
    await expect(done).toBeFocused();
    await expect(form).toContainText("not guaranteed");
    await expect(form.getByRole("link", { name: "Get full loan options" })).toHaveAttribute("href", "/express?family=commercial");

    expect(calls).toHaveLength(1);
    expect(calls[0]!.contentType).toContain("application/json");
    expect(calls[0]!.body).toEqual({
      kind: "quick",
      quick: { assetType: "OFFICE", transaction: "PURCHASE", loanAmount: 4_500_000, timelineDays: 90, notes: "Two-story building near the 405.", slug: "office-loans" },
      contact: { firstName: "Pat", lastName: "Lee", email: "pat.lee@example.com", phone: "415-555-0100", company: "Lee Holdings", consent: true },
      consentMeta: { textVersion: "qualifier-contact-2026-11-01", page: "/financing/office-loans" },
    });
    // The page's own calls to action are still there.
    await expect(page.locator("main").getByRole("link", { name: "Get loan options", exact: true }).first()).toHaveAttribute("href", "/express?family=commercial");
    expect(await seriousViolations(page, "main")).toEqual([]);
  });

  test("works on an existing program page and a hub, with the visitor's own property choice", async ({ page }) => {
    const calls = await mockJsonApi(page, "/api/qualify", { body: QUICK_RESPONSE });
    await gotoHydrated(page, "/financing/hud-223f-multifamily");
    await expect(requestForm(page).getByLabel(/^property type/i)).toHaveValue("MULTIFAMILY");
    await requestForm(page).getByLabel(/^property type/i).selectOption("MIXED_USE");
    await fillRequest(page);
    await requestForm(page).getByRole("button", { name: "Send to an advisor" }).click();
    await expect(requestForm(page).getByRole("heading", { name: /a licensed advisor will follow up/i })).toBeVisible();
    expect(calls[0]!.body).toMatchObject({ kind: "quick", quick: { assetType: "MIXED_USE", slug: "hud-223f-multifamily" }, contact: { consent: false } });
    await expect(requestForm(page).getByRole("link", { name: "Get full loan options" })).toHaveAttribute("href", "/express?family=multifamily");

    await gotoHydrated(page, "/financing/construction");
    await expect(requestForm(page).getByRole("radiogroup", { name: /^transaction/i }).getByRole("radio", { name: /^construction$/i })).toBeChecked();
  });

  test("shows errors tied to each field, focuses the first, and stays accessible", async ({ page }) => {
    const calls = await mockJsonApi(page, "/api/qualify", { body: QUICK_RESPONSE });
    await gotoHydrated(page, "/financing/cmbs-loans");
    const form = requestForm(page);
    await form.getByRole("button", { name: "Send to an advisor" }).click();
    const property = form.getByLabel(/^property type/i);
    await expect(property).toBeFocused();
    await expect(property).toHaveAttribute("aria-invalid", "true");
    await expect(property).toHaveAttribute("aria-describedby", "f-assetType-error");
    await expect(page.locator("#f-assetType-error")).toHaveText(/choose the property type/i);
    await expect(page.locator("#f-email-error")).toHaveText(/enter your email address/i);
    await expect(form.getByLabel(/^email/i)).toHaveAttribute("aria-describedby", "f-email-error");
    // Ticking the consent box makes the phone number required.
    await form.getByRole("checkbox", { name: /i agree that corin commercial may contact me/i }).check();
    await form.getByRole("button", { name: "Send to an advisor" }).click();
    await expect(page.locator("#f-phone-error")).toHaveText(/add a mobile number/i);
    expect(calls).toHaveLength(0);
    expect(await seriousViolations(page, "main")).toEqual([]);
  });

  test("shows a server rejection on the field it belongs to", async ({ page }) => {
    await mockJsonApi(page, "/api/qualify", { status: 400, body: { error: "Invalid submission", issues: [{ path: "contact.email", message: "Invalid email address" }] } });
    await gotoHydrated(page, "/financing/retail-loans");
    await fillRequest(page);
    await requestForm(page).getByRole("button", { name: "Send to an advisor" }).click();
    await expect(page.locator("#f-email-error")).toBeVisible();
    await expect(requestForm(page).getByRole("alert")).toBeVisible();
  });

  test("the link under the page's actions takes keyboard users to the form", async ({ page }) => {
    await gotoHydrated(page, "/financing/industrial-loans");
    const link = page.getByRole("link", { name: "Or send a short request to an advisor" });
    await expect(link).toHaveAttribute("href", "#request");
    await link.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#request$/);
    await expect(requestForm(page).getByRole("heading", { level: 2, name: "Send your deal to an advisor" })).toBeInViewport();
  });

  for (const path of ["/financing/commercial", "/financing/office-loans", "/financing/mezzanine-preferred-equity"]) {
    test(`${path} reflows at 320px with no sideways scroll, form included`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      await mockJsonApi(page, "/api/qualify", { body: QUICK_RESPONSE });
      await gotoHydrated(page, path);
      await requestForm(page).scrollIntoViewIfNeeded();
      await noHorizontalScroll(page);
      const card = (await requestForm(page).boundingBox())!;
      const submit = (await requestForm(page).getByRole("button", { name: "Send to an advisor" }).boundingBox())!;
      expect(submit.x + submit.width).toBeLessThanOrEqual(card.x + card.width);
      // Error state at 320px still fits.
      await requestForm(page).getByRole("button", { name: "Send to an advisor" }).click();
      await noHorizontalScroll(page);
    });
  }

  test("a commercial program page has no serious accessibility violations", async ({ page }) => {
    await gotoHydrated(page, "/financing/self-storage-loans");
    expect(await seriousViolations(page)).toEqual([]);
  });
});
