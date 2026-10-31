import { expect, test } from "@playwright/test";
import { gotoHydrated, mockJsonApi } from "./helpers";

test.describe("partner portal", () => {
  test("vendor registration posts a valid payload and confirms", async ({ page }) => {
    const calls = await mockJsonApi(page, "/api/partners", { body: { ok: true, partnerId: null } });
    await gotoHydrated(page, "/partners#vendor");

    await expect(page.getByRole("tab", { name: /vendor/i })).toHaveAttribute("aria-selected", "true");
    await page.getByLabel(/first name/i).fill("Sam");
    await page.getByLabel(/last name/i).fill("Rivera");
    await page.getByLabel(/^email/i).fill("sam@appraisal.example.com");
    await page.getByLabel(/^organization/i).fill("Rivera Appraisal Group");
    await page.getByRole("button", { name: /phase i esa/i }).click();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /submit registration/i }).click();

    await expect(page.getByText(/you.re in the queue/i)).toBeVisible();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.contentType).toContain("application/json");
    expect(calls[0]!.body).toMatchObject({
      partnerType: "VENDOR",
      organization: "Rivera Appraisal Group",
      services: ["PHASE_I_ESA"],
      contact: { firstName: "Sam", email: "sam@appraisal.example.com", consent: true },
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

  test("surfaces a server validation error", async ({ page }) => {
    await mockJsonApi(page, "/api/partners", { status: 400, body: { error: "Invalid registration", issues: [{ path: "contact.email", message: "Invalid email" }] } });
    await gotoHydrated(page, "/partners#vendor");
    await page.getByLabel(/first name/i).fill("Sam");
    await page.getByLabel(/last name/i).fill("Rivera");
    await page.getByLabel(/^email/i).fill("sam@appraisal.example.com");
    await page.getByLabel(/^organization/i).fill("Rivera Appraisal Group");
    await page.getByRole("button", { name: /phase i esa/i }).click();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /submit registration/i }).click();
    await expect(page.getByRole("alert").filter({ hasText: /email/i })).toBeVisible();
  });
});
