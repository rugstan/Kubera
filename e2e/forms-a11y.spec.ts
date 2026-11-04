import { expect, test } from "@playwright/test";
import { continueStep, fillQualifierThroughContact, pickAsset, seriousViolations } from "./forms-helpers";
import { gotoHydrated } from "./helpers";

// axe-core against the form states the static page scans never reach: error
// states, later steps and every partner tab. Zero serious or critical findings.

test.describe("form accessibility (axe-core, desktop)", () => {
  test("qualifier: asset step, blank deal step with errors, contact step with errors", async ({ page }) => {
    await gotoHydrated(page, "/express");
    expect(await seriousViolations(page)).toEqual([]);

    await pickAsset(page);
    await continueStep(page);
    await expect(page.locator("#f-loanAmount-error")).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test("qualifier: contact step with every error showing", async ({ page }) => {
    await gotoHydrated(page, "/express");
    await fillQualifierThroughContact(page);
    await page.getByLabel(/first name/i).fill("");
    await page.getByLabel(/^email/i).fill("nope");
    await page.getByRole("checkbox", { name: /i agree that corin commercial may contact me/i }).check();
    await page.getByRole("button", { name: /see my indicative structure/i }).click();
    await expect(page.locator("#f-email-error")).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  for (const tab of ["lender", "referral", "operator", "vendor"]) {
    test(`partners: ${tab} form, empty and with the error summary`, async ({ page }) => {
      await gotoHydrated(page, `/partners#${tab}`);
      expect(await seriousViolations(page)).toEqual([]);
      await page.getByRole("button", { name: /submit registration/i }).click();
      await expect(page.getByRole("group", { name: /problem/i })).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);
    });
  }
});
