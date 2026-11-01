import { expect, test } from "@playwright/test";
import { QUALIFIER_RESULT as RESULT, chooseOption, continueStep, fillContact, fillQualifierThroughContact, fillTerms, pickAsset } from "./forms-helpers";
import { gotoHydrated, mockJsonApi } from "./helpers";

test.describe("express qualifier", () => {
  test("happy path: four steps, consent, submit, indicative result", async ({ page }) => {
    const calls = await mockJsonApi(page, "/api/qualify", { body: RESULT });
    await gotoHydrated(page, "/express");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    await fillQualifierThroughContact(page, { phone: "415-555-0132" });

    const submit = page.getByRole("button", { name: /see my indicative structure/i });
    await page.getByRole("checkbox", { name: /i agree that kubera commercial may contact me/i }).check();
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(page.getByText("HUD 232/223(f) Refinance")).toBeVisible();
    // The page owns the single H1; the result heading is an H2 inside it.
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    const thanks = page.getByRole("heading", { level: 2, name: /thanks, pat/i });
    await expect(thanks).toBeVisible();
    // Focus moves to the result so screen-reader users hear it.
    await expect(thanks).toBeFocused();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.contentType).toContain("application/json");
    expect(calls[0]!.body).toMatchObject({
      intake: {
        assetType: "ASSISTED_LIVING",
        transaction: "REFINANCE",
        loanAmount: 3_000_000,
        noi: 400_000,
        unitCount: 60,
        occupancyPct: 88,
        timelineDays: 90,
        ownerOperator: true,
        source: "express",
      },
      contact: { firstName: "Pat", lastName: "Lee", email: "pat.lee@example.com", phone: "415-555-0132", consent: true },
      consentMeta: { textVersion: "qualifier-contact-2026-11-01", page: "/express" },
    });
  });

  test("submits without the optional contact consent", async ({ page }) => {
    // The consent text says consent is not a condition of any service, so it must not gate submit.
    const calls = await mockJsonApi(page, "/api/qualify", { body: RESULT });
    await gotoHydrated(page, "/express");
    await fillQualifierThroughContact(page);
    const consent = page.getByRole("checkbox", { name: /i agree that kubera commercial may contact me/i });
    await expect(consent).not.toBeChecked();
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
    await fillQualifierThroughContact(page);
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
    await fillQualifierThroughContact(page);
    await page.getByRole("button", { name: /see my indicative structure/i }).click();

    await expect(page.getByRole("alert").filter({ hasText: /too many submissions/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /see my indicative structure/i })).toBeEnabled();
  });

  test("asks hard money borrowers for strategy, rehab and ARV and sends them as intake.hardMoney", async ({ page }) => {
    const calls = await mockJsonApi(page, "/api/qualify", { body: RESULT });
    await gotoHydrated(page, "/express");
    await pickAsset(page, /^2 to 4 unit rental$/i);
    await expect(page.getByLabel(/after-repair value/i)).toHaveCount(0);
    await chooseOption(page, /^hard money or fix-and-flip$/i);
    await expect(page.getByLabel(/purchase price or as-is value/i)).toBeVisible();
    await page.getByRole("radiogroup", { name: /strategy/i }).locator("label").filter({ hasText: /^fix and flip$/i }).click();
    await page.getByRole("radiogroup", { name: /purchase or refinance/i }).locator("label").filter({ hasText: /^purchase$/i }).click();
    await page.getByLabel(/loan amount requested/i).fill("600000");
    await page.getByLabel(/trailing 12-month noi/i).fill("0");
    await page.getByLabel(/purchase price or as-is value/i).fill("900000");
    await page.getByLabel(/rehab budget/i).fill("150000");
    await page.getByLabel(/after-repair value/i).fill("1400000");
    await page.getByLabel(/^units/i).fill("3");
    await page.getByLabel(/^occupancy/i).fill("0");
    await continueStep(page);
    await fillTerms(page);
    await fillContact(page);
    await page.getByRole("button", { name: /see my indicative structure/i }).click();
    await expect(page.getByRole("heading", { level: 2, name: /thanks, pat/i })).toBeVisible();
    expect(calls[0]!.body).toMatchObject({
      intake: {
        assetType: "RESIDENTIAL_2_4",
        transaction: "HARD_MONEY",
        value: 900_000,
        hardMoney: { strategy: "FIX_AND_FLIP", purpose: "PURCHASE", rehabBudget: 150_000, arv: 1_400_000 },
      },
    });
  });

  test("preselects the asset from the query string and skips the first step", async ({ page }) => {
    await gotoHydrated(page, "/express?asset=MULTIFAMILY&loan=5000000");
    await expect(page.getByRole("heading", { name: /the numbers/i })).toBeVisible();
    // Only what the visitor passed is pre-filled.
    await expect(page.getByLabel(/loan amount requested/i)).toHaveValue("5,000,000");
    await expect(page.getByLabel(/trailing 12-month noi/i)).toHaveValue("");
  });
});
