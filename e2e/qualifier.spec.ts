import { expect, test, type Page } from "@playwright/test";
import { gotoHydrated, mockJsonApi } from "./helpers";

const RESULT = {
  leadId: null,
  uploadToken: null,
  result: {
    program: "HUD 232/223(f) Refinance",
    secondary: "SBA 504",
    flag: "OPTIMAL_FOR_HUD_232",
    indicativeLoan: 3_000_000,
    indicativeRatePct: 6.15,
    term: "35 years",
    recourse: "Non-recourse",
    closeTimeline: "6–9 months",
    callScheduled: false,
    qualified: true,
  },
};

async function fillThroughToContact(page: Page) {
  await page.getByRole("button", { name: /assisted living/i }).click();
  await expect(page.getByRole("heading", { name: /the numbers/i })).toBeVisible();
  await page.getByRole("button", { name: /^continue$/i }).click();
  await expect(page.getByRole("heading", { name: /timing/i })).toBeVisible();
  await page.getByRole("button", { name: /^continue$/i }).click();
  await expect(page.getByLabel(/first name/i)).toBeVisible();
  await page.getByLabel(/first name/i).fill("Pat");
  await page.getByLabel(/last name/i).fill("Lee");
  await page.getByLabel(/^email/i).fill("pat.lee@example.com");
  await page.getByLabel(/mobile phone|^phone/i).fill("415-555-0132");
}

test.describe("express qualifier", () => {
  test("happy path: four steps, consent, submit, indicative result", async ({ page }) => {
    const calls = await mockJsonApi(page, "/api/qualify", { body: RESULT });
    await gotoHydrated(page, "/express");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    await fillThroughToContact(page);

    const submit = page.getByRole("button", { name: /see my indicative structure/i });
    await page.getByRole("checkbox").check();
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(page.getByText("HUD 232/223(f) Refinance")).toBeVisible();
    // The page owns the single H1; the result heading is an H2 inside it.
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 2, name: /thanks, pat/i })).toBeVisible();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.contentType).toContain("application/json");
    expect(calls[0]!.body).toMatchObject({
      intake: { assetType: "ASSISTED_LIVING", transaction: "REFINANCE", source: "express" },
      contact: { firstName: "Pat", lastName: "Lee", email: "pat.lee@example.com", consent: true },
      consentMeta: { textVersion: "qualifier-contact-2026-10-31", page: "/express" },
    });
  });

  test("submits without the optional contact consent", async ({ page }) => {
    // The consent text says consent is not a condition of any service, so it must not gate submit.
    const calls = await mockJsonApi(page, "/api/qualify", { body: RESULT });
    await gotoHydrated(page, "/express");
    await fillThroughToContact(page);
    await expect(page.getByRole("checkbox")).not.toBeChecked();
    const submit = page.getByRole("button", { name: /see my indicative structure/i });
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByText("HUD 232/223(f) Refinance")).toBeVisible();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({ contact: { email: "pat.lee@example.com", consent: false } });
  });

  test("the document upload's Choose file control shows a visible keyboard focus ring", async ({ page }) => {
    // A stored lead returns an upload token, which reveals the upload step.
    await mockJsonApi(page, "/api/qualify", { body: { ...RESULT, leadId: "6f1b5c1e-2a8e-4c39-9a55-3d3c1b7f2a10", uploadToken: "t".repeat(43) } });
    await gotoHydrated(page, "/express");
    await fillThroughToContact(page);
    await page.getByRole("button", { name: /see my indicative structure/i }).click();

    const docType = page.getByRole("combobox", { name: /document type/i });
    await expect(docType).toBeVisible();
    await docType.focus();
    await page.keyboard.press("Tab");

    const input = page.locator('input[type="file"]');
    await expect(input).toBeFocused();
    // The input itself is sr-only (clipped to 1px), so its label must draw the ring.
    const label = page.locator("label.pill", { has: input });
    await expect(label).toHaveText(/choose file/i);
    const ring = await label.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
    });
    expect(ring.style).not.toBe("none");
    expect(ring.width).toBeGreaterThanOrEqual(2);

    // No ring once focus moves away.
    await page.keyboard.press("Shift+Tab");
    await expect(docType).toBeFocused();
    expect(await label.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("none");
  });

  test("shows the server's error message and keeps the form usable", async ({ page }) => {
    await mockJsonApi(page, "/api/qualify", { status: 429, body: { error: "Too many submissions. Please call us directly." } });
    await gotoHydrated(page, "/express");
    await fillThroughToContact(page);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /see my indicative structure/i }).click();

    await expect(page.getByRole("alert").filter({ hasText: /too many submissions/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /see my indicative structure/i })).toBeEnabled();
  });

  test("preselects the asset from the query string and skips the first step", async ({ page }) => {
    await gotoHydrated(page, "/express?asset=MULTIFAMILY&loan=5000000");
    await expect(page.getByRole("heading", { name: /the numbers/i })).toBeVisible();
  });
});
