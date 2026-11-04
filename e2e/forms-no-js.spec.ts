import { expect, test, type Page } from "@playwright/test";

// Before hydration (slow network, a script chunk that failed to load, JavaScript
// off) the browser owns the shared <Form>. A native submit must never put what
// someone typed into the URL, where it would reach request logs, browser
// history, analytics and Referer headers.
test.use({ javaScriptEnabled: false });

const PII = /email=|phone=|firstName=|lastName=|%40/i;

/** Records every navigation the page starts after it first loads. */
function trackNavigations(page: Page) {
  const urls: string[] = [];
  page.on("request", (req) => {
    if (req.isNavigationRequest() && req.frame() === page.mainFrame()) urls.push(`${req.method()} ${req.url()}`);
  });
  return urls;
}

async function expectNoNativeSubmit(page: Page, navigations: string[]) {
  // A native submit would start a navigation almost at once; give it time to show up.
  await page.waitForTimeout(750);
  expect(navigations).toEqual([]);
  expect(page.url()).not.toMatch(PII);
}

test.describe("forms without JavaScript", () => {
  test("newsletter: Enter and a click on Subscribe never submit natively or put the email in the URL", async ({ page }) => {
    await page.goto("/newsletter");
    const form = page.locator("form").filter({ has: page.getByLabel("Email address") });
    await expect(form).toHaveAttribute("method", "post");
    await expect(form.getByRole("button", { name: /subscribe/i })).toBeDisabled();
    await expect(form.locator("noscript")).toHaveCount(1);

    const navigations = trackNavigations(page);
    const email = page.getByLabel("Email address");
    await email.fill("pat@example.com");
    await email.press("Enter");
    await expectNoNativeSubmit(page, navigations);

    await form.getByRole("button", { name: /subscribe/i }).click({ force: true });
    await expectNoNativeSubmit(page, navigations);
  });

  test("financing-page request: the page reads fully, and Enter or a click never submits natively", async ({ page }) => {
    await page.goto("/financing/office-loans");
    // The content is server-rendered, so the page is useful without JavaScript.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Office building loans");
    await expect(page.locator("main").getByRole("link", { name: "Get loan options", exact: true }).first()).toHaveAttribute("href", "/express?family=commercial");
    const form = page.locator("section#request form");
    await expect(form).toHaveAttribute("method", "post");
    await expect(form.getByRole("button", { name: /send to an advisor/i })).toBeDisabled();
    await expect(form.locator("noscript")).toHaveCount(1);

    const navigations = trackNavigations(page);
    await form.getByRole("textbox", { name: /^first name/i }).fill("Pat");
    await form.getByRole("textbox", { name: /^mobile phone/i }).fill("415-555-0100");
    const email = form.getByRole("textbox", { name: /^email\b/i });
    await email.fill("pat@example.com");
    await email.press("Enter");
    await expectNoNativeSubmit(page, navigations);

    await form.getByRole("button", { name: /send to an advisor/i }).click({ force: true });
    await expectNoNativeSubmit(page, navigations);
  });

  test("partners: Enter in a contact field never submits natively or puts contact details in the URL", async ({ page }) => {
    await page.goto("/partners");
    const form = page.locator("form").filter({ has: page.getByRole("textbox", { name: /^email\b/i }) });
    await expect(form).toHaveAttribute("method", "post");
    await expect(form.getByRole("button", { name: /submit registration/i })).toBeDisabled();

    const navigations = trackNavigations(page);
    await page.getByRole("textbox", { name: /^first name/i }).fill("Pat");
    await page.getByRole("textbox", { name: /^phone/i }).fill("415-555-0100");
    const email = page.getByRole("textbox", { name: /^email\b/i });
    await email.fill("pat@example.com");
    await email.press("Enter");
    await expectNoNativeSubmit(page, navigations);
  });
});
