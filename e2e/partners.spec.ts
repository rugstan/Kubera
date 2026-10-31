import { expect, test, type Page } from "@playwright/test";
import { chooseOption } from "./forms-helpers";
import { gotoHydrated, mockJsonApi } from "./helpers";

async function fillVendor(page: Page) {
  await page.getByLabel(/first name/i).fill("Sam");
  await page.getByLabel(/last name/i).fill("Rivera");
  await page.getByLabel(/^email/i).fill("sam@appraisal.example.com");
  await page.getByLabel(/^company/i).fill("Rivera Appraisal Group");
  await chooseOption(page, /^phase i esa$/i);
}

test.describe("partner portal", () => {
  test("vendor registration posts a valid payload and confirms", async ({ page }) => {
    const calls = await mockJsonApi(page, "/api/partners", { body: { ok: true, partnerId: null } });
    await gotoHydrated(page, "/partners#vendor");

    await expect(page.getByRole("tab", { name: /vendor/i })).toHaveAttribute("aria-selected", "true");
    await fillVendor(page);
    await page.getByLabel(/^phone/i).fill("415-555-0132");
    await page.getByRole("checkbox", { name: /i agree that kubera commercial may contact me/i }).check();
    await page.getByRole("button", { name: /submit registration/i }).click();

    await expect(page.getByText(/you.re in the queue/i)).toBeVisible();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.contentType).toContain("application/json");
    expect(calls[0]!.body).toMatchObject({
      partnerType: "VENDOR",
      organization: "Rivera Appraisal Group",
      services: ["PHASE_I_ESA"],
      contact: { firstName: "Sam", email: "sam@appraisal.example.com", phone: "415-555-0132", consent: true },
      consentMeta: { textVersion: "partner-contact-2026-11-01", page: "/partners" },
    });
  });

  test("tabs switch the registration form and update the URL hash", async ({ page }) => {
    await gotoHydrated(page, "/partners");
    await page.getByRole("tab", { name: /referral/i }).click();
    await expect(page).toHaveURL(/#referral$/);
    await expect(page.getByLabel(/license #/i)).toBeVisible();
    await page.getByRole("tab", { name: /operators/i }).click();
    await expect(page).toHaveURL(/#operator$/);
    await expect(page.getByLabel(/beds \/ keys under management/i)).toBeVisible();
  });

  test("keeps what was typed when switching tabs", async ({ page }) => {
    await gotoHydrated(page, "/partners");
    await page.getByLabel(/first name/i).fill("Sam");
    await page.getByLabel(/^email/i).fill("sam@appraisal.example.com");
    await page.getByRole("tab", { name: /vendor/i }).click();
    await expect(page.getByLabel(/first name/i)).toHaveValue("Sam");
    await expect(page.getByLabel(/^email/i)).toHaveValue("sam@appraisal.example.com");
  });

  test("surfaces a server validation error on the field it names", async ({ page }) => {
    await mockJsonApi(page, "/api/partners", { status: 400, body: { error: "Invalid registration", issues: [{ path: "contact.email", message: "Invalid email" }] } });
    await gotoHydrated(page, "/partners#vendor");
    await fillVendor(page);
    await page.getByRole("button", { name: /submit registration/i }).click();

    const email = page.getByLabel(/^email/i);
    await expect(email).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#f-email-error")).toContainText(/valid email/i);
    await expect(page.getByRole("alert").filter({ hasText: /highlighted fields/i })).toBeVisible();
  });
});
