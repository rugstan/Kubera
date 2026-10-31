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
    await expect(submit).toBeDisabled();
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
