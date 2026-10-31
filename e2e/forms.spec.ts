import { expect, test, type Page } from "@playwright/test";
import { QUALIFIER_RESULT, chooseOption, continueStep, fillDeal, fillQualifierThroughContact, pickAsset } from "./forms-helpers";
import { gotoHydrated, mockJsonApi } from "./helpers";

/** True when the focused element is invalid itself or sits inside an invalid group. */
async function focusIsOnInvalidControl(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    return Boolean(el && (el.getAttribute("aria-invalid") === "true" || el.closest('[aria-invalid="true"]')));
  });
}

test.describe("qualifier form behaviour", () => {
  test("focus moves to each step heading and progress marks the current step", async ({ page }) => {
    await gotoHydrated(page, "/express");
    const progress = page.getByRole("navigation", { name: /qualifier progress/i });
    await expect(progress.locator('[aria-current="step"]')).toContainText("Asset");

    await pickAsset(page);
    await expect(progress.locator('[aria-current="step"]')).toContainText("Deal");
    await expect(progress.locator('[aria-current="step"]')).toHaveCount(1);

    await fillDeal(page);
    await expect(progress.locator('[aria-current="step"]')).toContainText("Terms");

    await page.getByRole("button", { name: /^back$/i }).click();
    await expect(page.getByRole("heading", { name: /the numbers/i })).toBeFocused();
    await expect(progress.locator('[aria-current="step"]')).toContainText("Deal");
    // What was typed is still there.
    await expect(page.getByLabel(/loan amount requested/i)).toHaveValue("3,000,000");
  });

  test("nothing realistic is pre-filled: inputs are empty and show placeholders", async ({ page }) => {
    await gotoHydrated(page, "/express");
    await pickAsset(page);
    for (const [label, placeholder] of [
      [/loan amount requested/i, /3,000,000/],
      [/trailing 12-month noi/i, /400,000/],
      [/licensed beds/i, /60/],
      [/^occupancy/i, /88/],
    ] as const) {
      const input = page.getByLabel(label);
      await expect(input).toHaveValue("");
      await expect(input).toHaveAttribute("placeholder", placeholder);
    }
    // No transaction is pre-selected.
    await expect(page.getByRole("radio", { checked: true })).toHaveCount(0);
  });

  test("Continue with a blank step shows inline errors, marks fields invalid and focuses the first one", async ({ page }) => {
    await gotoHydrated(page, "/express");
    await pickAsset(page);
    await continueStep(page);

    // Still on step 2; nothing advanced.
    await expect(page.getByRole("heading", { name: /the numbers/i })).toBeVisible();
    const loan = page.getByLabel(/loan amount requested/i);
    await expect(loan).toHaveAttribute("aria-invalid", "true");
    await expect(loan).toHaveAttribute("aria-required", "true");
    const describedBy = await loan.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`#${describedBy}`)).toContainText(/enter the loan amount/i);
    await expect(page.locator("#f-transaction-error")).toContainText(/choose the type of transaction/i);
    await expect(page.getByLabel(/trailing 12-month noi/i)).toHaveAttribute("aria-invalid", "true");
    expect(await focusIsOnInvalidControl(page)).toBe(true);

    // Fixing a field clears its error.
    await loan.fill("3000000");
    await expect(loan).not.toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#f-loanAmount-error")).toHaveCount(0);
  });

  test("the loan amount enforces the $250,000 minimum before anything is sent", async ({ page }) => {
    await gotoHydrated(page, "/express");
    await pickAsset(page);
    await page.getByLabel(/loan amount requested/i).fill("100000");
    await page.getByLabel(/loan amount requested/i).blur();
    await expect(page.locator("#f-loanAmount-error")).toContainText("Minimum $250,000");
  });

  test("hotel assets add ADR and franchise tier as required fields", async ({ page }) => {
    await gotoHydrated(page, "/express");
    await pickAsset(page, /^flagged hotel$/i);
    await expect(page.getByLabel(/average daily rate/i)).toBeVisible();
    await continueStep(page);
    await expect(page.getByLabel(/average daily rate/i)).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel(/franchise tier/i)).toHaveAttribute("aria-invalid", "true");
  });

  test("a mobile number is required once contact permission is ticked", async ({ page }) => {
    const calls = await mockJsonApi(page, "/api/qualify", { body: QUALIFIER_RESULT });
    await gotoHydrated(page, "/express");
    await fillQualifierThroughContact(page);
    await page.getByRole("checkbox", { name: /i agree that kubera commercial may contact me/i }).check();
    await page.getByRole("button", { name: /see my indicative structure/i }).click();

    await expect(page.getByLabel(/mobile phone/i)).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#f-phone-error")).toContainText(/mobile number/i);
    expect(calls).toHaveLength(0);
    expect(await focusIsOnInvalidControl(page)).toBe(true);

    await page.getByLabel(/mobile phone/i).fill("415-555-0132");
    await page.getByRole("button", { name: /see my indicative structure/i }).click();
    await expect(page.getByText("HUD 232/223(f) Refinance")).toBeVisible();
    expect(calls).toHaveLength(1);
  });

  test("contact errors are inline and block the request", async ({ page }) => {
    const calls = await mockJsonApi(page, "/api/qualify", { body: QUALIFIER_RESULT });
    await gotoHydrated(page, "/express");
    await pickAsset(page);
    await fillDeal(page);
    await page.getByLabel(/when do you need to close/i).selectOption("90");
    await chooseOption(page, /^no$/i);
    await continueStep(page);
    await page.getByLabel(/^email/i).fill("not-an-email");
    await page.getByRole("button", { name: /see my indicative structure/i }).click();

    await expect(page.locator("#f-firstName-error")).toContainText(/first name/i);
    await expect(page.locator("#f-email-error")).toContainText(/valid email/i);
    expect(calls).toHaveLength(0);
  });

  test("a server rejection of one field is shown on that field, on the step it belongs to", async ({ page }) => {
    await mockJsonApi(page, "/api/qualify", { status: 400, body: { error: "Invalid submission", issues: [{ path: "intake.loanAmount", message: "Minimum $250,000" }] } });
    await gotoHydrated(page, "/express");
    await fillQualifierThroughContact(page);
    await page.getByRole("button", { name: /see my indicative structure/i }).click();

    // Back on the step that owns the rejected field, with the message inline.
    await expect(page.getByRole("heading", { name: /the numbers/i })).toBeFocused();
    await expect(page.getByLabel(/loan amount requested/i)).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#f-loanAmount-error")).toContainText("Minimum $250,000");
    await expect(page.getByRole("alert").filter({ hasText: /highlighted fields/i })).toBeVisible();
  });

  test("a network failure gets a plain-language message with a way to reach us", async ({ page }) => {
    await page.route("**/api/qualify", (route) => route.abort("failed"));
    await gotoHydrated(page, "/express");
    await fillQualifierThroughContact(page);
    await page.getByRole("button", { name: /see my indicative structure/i }).click();
    const alert = page.getByRole("alert").filter({ hasText: /couldn.t reach our servers/i });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/deals@kuberacommercial\.com/);
  });

  test("the logo links home", async ({ page }) => {
    await gotoHydrated(page, "/express");
    const logo = page.getByRole("link", { name: /kubera commercial home/i });
    await expect(logo).toHaveAttribute("href", "/");
    await logo.click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("hotel-to-senior assets offer Conversion instead of Construction", async ({ page }) => {
    await gotoHydrated(page, "/express");
    await pickAsset(page, /hotel to senior living/i);
    await expect(page.getByRole("radio", { name: "Conversion" })).toBeAttached();
    await expect(page.getByRole("radio", { name: "Construction" })).toHaveCount(0);
  });
});

test.describe("partner form behaviour", () => {
  test("vendor services are required: marked, validated, summarised and nothing is sent", async ({ page }) => {
    const calls = await mockJsonApi(page, "/api/partners", { body: { ok: true } });
    await gotoHydrated(page, "/partners#vendor");

    await expect(page.getByRole("group", { name: /services/i })).toContainText("*");
    await page.getByLabel(/first name/i).fill("Sam");
    await page.getByLabel(/last name/i).fill("Rivera");
    await page.getByLabel(/^email/i).fill("sam@appraisal.example.com");
    await page.getByLabel(/^company/i).fill("Rivera Appraisal Group");
    await page.getByRole("button", { name: /submit registration/i }).click();

    expect(calls).toHaveLength(0);
    const summary = page.getByRole("group", { name: /problem with your registration/i });
    await expect(summary).toBeVisible();
    await expect(summary).toBeFocused();
    await expect(summary).toContainText("Select at least one service you provide.");
    await expect(page.locator("#f-services-error")).toContainText(/at least one service/i);
    await expect(page.getByRole("checkbox", { name: /phase i esa/i })).toHaveAttribute("aria-invalid", "true");

    // The summary link takes keyboard focus to the first service.
    await summary.getByRole("link", { name: /services/i }).click();
    await expect(page.getByRole("checkbox", { name: /mai appraisal — healthcare/i })).toBeFocused();

    // Choosing a service clears the error.
    await chooseOption(page, /^phase i esa$/i);
    await expect(page.locator("#f-services-error")).toHaveCount(0);
  });

  test("an empty lender form lists every required field and has no pre-filled terms", async ({ page }) => {
    await gotoHydrated(page, "/partners#lender");
    for (const label of [/^min loan/i, /^max loan/i, /^max ltv/i, /broker compensation you pay/i]) {
      await expect(page.getByLabel(label)).toHaveValue("");
    }
    await expect(page.getByLabel(/lender type/i)).toHaveValue("");
    await page.getByRole("button", { name: /submit registration/i }).click();
    const summary = page.getByRole("group", { name: /problems with your registration/i });
    await expect(summary).toBeFocused();
    for (const label of ["First name", "Last name", "Email", "Organization", "Lender type", "Min loan", "Max loan", "Max LTV / LTC", "Broker compensation you pay"]) {
      await expect(summary.getByRole("link", { name: label })).toBeVisible();
    }
  });

  test("referral brokers need a license number unless they are unlicensed finders, and must accept the agreement", async ({ page }) => {
    await gotoHydrated(page, "/partners#referral");
    await page.getByLabel(/first name/i).fill("Ana");
    await page.getByLabel(/last name/i).fill("Cruz");
    await page.getByLabel(/^email/i).fill("ana@broker.example.com");
    await page.locator("#f-licenseType").selectOption("CA_DRE_BROKER");
    await page.getByRole("button", { name: /submit registration/i }).click();
    await expect(page.locator("#f-licenseNumber-error")).toContainText(/license number/i);
    await expect(page.locator("#f-acceptsAgreement-error")).toContainText(/agree/i);

    await page.locator("#f-licenseType").selectOption("UNLICENSED_REFERRAL");
    await expect(page.locator("#f-licenseNumber-error")).toHaveCount(0);
  });

  test("a rate-limit response is explained, with a way to reach partners@", async ({ page }) => {
    await mockJsonApi(page, "/api/partners", { status: 429, body: { error: "Too many submissions." } });
    await gotoHydrated(page, "/partners#vendor");
    await page.getByLabel(/first name/i).fill("Sam");
    await page.getByLabel(/last name/i).fill("Rivera");
    await page.getByLabel(/^email/i).fill("sam@appraisal.example.com");
    await page.getByLabel(/^company/i).fill("Rivera Appraisal Group");
    await chooseOption(page, /^phase i esa$/i);
    await page.getByRole("button", { name: /submit registration/i }).click();
    await expect(page.getByRole("alert").filter({ hasText: /too many submissions/i })).toContainText("partners@kuberacommercial.com");
  });
});
