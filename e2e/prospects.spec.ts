import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { DEMO_TOTP_SECRET } from "../lib/auth/demo";
import { totp } from "../lib/auth/totp";
import { seriousViolations } from "./forms-helpers";

// Market intel and refinance-maturity prospecting (WS-S) against the fake
// identity provider and the invented demo prospects.
//
// Runs its own `next start` on the suite's build (port E2E_PORT + 3) with
// AUTH_PROVIDER=fake and stops it afterwards: the sign-ins stay out of the
// shared server's rate limit and the in-memory prospects start fresh. No
// email provider, xAI key or ATTOM key is set, so the env-free paths run: the
// market note is a rules digest, an email waits for a mailer, and a letter is
// released for mailing after the broker approves it.

test.describe.configure({ mode: "serial" });

const mainPort = Number(process.env.E2E_PORT ?? 3999);
let base = `http://localhost:${mainPort}`;
let server: ChildProcess | undefined;

async function isFake(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/login`);
    return (await res.text()).includes('data-auth-provider="fake"');
  } catch {
    return false;
  }
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  const port = Number(process.env.E2E_PROSPECTS_PORT ?? mainPort + 3);
  base = `http://localhost:${port}`;
  server = spawn(process.execPath, [path.join(process.cwd(), "node_modules/next/dist/bin/next"), "start", "-p", String(port)], {
    env: {
      ...process.env,
      AUTH_PROVIDER: "fake",
      NEXT_TELEMETRY_DISABLED: "1",
      NEXT_PUBLIC_DRE_CORPORATE_LICENSE: process.env.NEXT_PUBLIC_DRE_CORPORATE_LICENSE || "E2E-TEST-0000000",
      SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      SUPABASE_ANON_KEY: "",
      XAI_API_KEY: "",
      ATTOM_API_KEY: "",
      RESEND_API_KEY: "",
      ALLOWED_ORIGINS: base,
    },
    stdio: "ignore",
  });
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (await isFake(base)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`fake-auth server did not start on ${base}`);
});

test.afterAll(() => {
  server?.kill("SIGTERM");
});

async function signIn(page: Page, email: string, next: string) {
  await page.goto(`${base}${next}`);
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page).toHaveURL(/\/login\/verify$/);
  const code = (await page.getByTestId("fake-code").textContent())?.trim() ?? "";
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/mfa\?next=/);
  await page.getByLabel("Authenticator code").fill(totp(DEMO_TOTP_SECRET));
  await page.getByRole("button", { name: "Verify" }).click();
}

test("every prospecting page asks for staff sign-in and is not indexable", async ({ page }) => {
  for (const p of ["/prospects", "/prospects/intel", "/prospects/suppressions", "/prospects/00000000-0000-4000-8000-000000000001"]) {
    await page.goto(`${base}${p}`);
    await expect(page).toHaveURL((url) => url.pathname === "/login" && url.searchParams.get("next") === p);
  }
});

test("a broker works the ranked list, drafts a letter, approves it, and marks it mailed", async ({ page }) => {
  await signIn(page, "broker@kubera.test", "/prospects");
  await expect(page).toHaveURL(`${base}/prospects`);
  await expect(page.getByRole("heading", { name: "Refinance-maturity prospects", level: 1 })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.getByText("Demo data: every property and owner here is invented.")).toBeVisible();
  // The demo provider answers scans; a repeat scan refreshes and adds nothing.
  await page.getByLabel("ZIP codes (up to 25)").fill("90001 91201");
  await page.getByRole("button", { name: "Run scan" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Scan complete: 4 found, 0 new, 4 refreshed/ })).toBeVisible();

  // Ranked: the 48-unit multifamily with the best timing is first.
  const table = page.getByRole("table").last();
  const rows = table.getByRole("row");
  await expect(rows.nth(1)).toContainText("100 Example Ave");
  expect(await seriousViolations(page)).toEqual([]);

  await page.getByRole("link", { name: "100 Example Ave" }).click();
  await expect(page.getByRole("heading", { name: "100 Example Ave", level: 1 })).toBeVisible();
  const why = page.getByRole("table").first();
  await expect(why.getByRole("row", { name: /Maturity timing/ })).toContainText("35 of 35");
  await expect(why.getByRole("row", { name: /Geography/ })).toContainText("10 of 10");
  expect(await seriousViolations(page)).toEqual([]);

  // Email needs a contact; public records have none.
  await expect(page.getByText(/Add a contact email first/)).toBeVisible();

  // The letter goes to the owner's mailing address and waits for a broker.
  await page.getByRole("button", { name: "Draft a letter" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Draft sent to the approvals queue" })).toBeVisible();
  const card = page.getByRole("article", { name: "Draft version 1" });
  await expect(card.getByText("Waiting for broker approval")).toBeVisible();
  await card.getByText("Read the message").click();
  const body = card.locator("pre");
  await expect(body).toContainText("not the lender");
  await expect(body).toContainText("Real estate broker, California Department of Real Estate");
  await expect(body).toContainText("do-not-contact");
  await expect(body).not.toContainText(/approved for|guarantee|qualif/i);

  // Checking before the broker decides releases nothing.
  await card.getByRole("button", { name: "Check for broker decision" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Waiting for broker approval." })).toBeVisible();
  await expect(page.getByRole("article", { name: "Draft version 1" }).getByRole("button", { name: "Mark as mailed" })).toHaveCount(0);

  // The broker approves it in the approvals queue (the summary shows the exact message request).
  await page.goto(`${base}/approvals`);
  const queue = page.getByRole("list", { name: "Requests waiting for a decision" });
  const request = queue.getByRole("article", { name: /Prospect outreach \(letter\)/ });
  await expect(request).toBeVisible();
  await request.getByRole("button", { name: /^Approve/ }).click();
  await expect(page.getByRole("status").filter({ hasText: /approved: Prospect outreach/ })).toBeVisible();

  // Now the letter is released for mailing, once.
  await page.goto(`${base}/prospects`);
  await page.getByRole("link", { name: "100 Example Ave" }).click();
  await page.getByRole("article", { name: "Draft version 1" }).getByRole("button", { name: "Check for broker decision" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Approved. The letter is ready to mail." })).toBeVisible();
  const after = page.getByRole("article", { name: "Draft version 1" });
  await expect(after.getByText("Approved, ready to mail")).toBeVisible();
  await after.getByRole("button", { name: "Mark as mailed" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Marked as mailed." })).toBeVisible();
  await expect(page.getByRole("article", { name: "Draft version 1" }).getByText("Mailed", { exact: true })).toBeVisible();
});

test("an email draft needs a contact, and a do-not-contact entry stops further outreach", async ({ page }) => {
  await signIn(page, "broker@kubera.test", "/prospects");
  await page.getByRole("link", { name: "55 Sample Blvd" }).click();
  await page.getByLabel("Contact email").fill("care@sample.example");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  await page.getByRole("button", { name: "Draft an email" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Draft sent to the approvals queue" })).toBeVisible();
  await expect(page.getByRole("article", { name: "Draft version 1" }).getByText("Waiting for broker approval")).toBeVisible();

  // With no mail provider configured nothing is sent, and the draft stays pending.
  await page.getByRole("button", { name: "Check for broker decision" }).click();
  await expect(page.getByRole("status")).toContainText(/Waiting for broker approval|not configured/);

  await page.getByRole("button", { name: "Add to do-not-contact list" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Added to the do-not-contact list" })).toBeVisible();
  await expect(page.getByText("This prospect is on the do-not-contact list.").first()).toBeVisible();
  await page.goto(`${base}/prospects/suppressions`);
  await expect(page.getByRole("heading", { name: "Do-not-contact list", level: 1 })).toBeVisible();
  await expect(page.getByRole("table").getByText("c***@sample.example")).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test("the weekly market note is a cited rules digest without an xAI key, and a reviewer approves it", async ({ page }) => {
  await signIn(page, "broker@kubera.test", "/prospects/intel");
  await expect(page.getByRole("heading", { name: "Weekly market note", level: 1 })).toBeVisible();
  await expect(page.getByText(/No xAI key is configured/)).toBeVisible();
  await page.getByRole("button", { name: "Generate draft" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Draft ready for review \(rules digest/ })).toBeVisible();
  await page.getByRole("link", { name: /Market intel: week of/ }).first().click();
  await expect(page.getByText("Rules digest").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sources" })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  await page.getByLabel("Why is it rejected?").fill("Duplicate");
  await page.getByRole("button", { name: "Reject" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Rejected." })).toBeVisible();

  await page.goto(`${base}/prospects/intel`);
  await page.getByRole("button", { name: "Generate draft" }).click();
  // Wait for the new draft, or the first link may still be the rejected note.
  await expect(page.getByRole("status").filter({ hasText: /Draft ready for review/ })).toBeVisible();
  await page.getByRole("link", { name: /Market intel: week of/ }).first().click();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Nothing was published or sent/ })).toBeVisible();
});

test("the prospect list reflows at 390px without sideways page scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "broker@kubera.test", "/prospects");
  // Finish signing in first, or the loop below measures the sign-in page.
  await expect(page).toHaveURL(`${base}/prospects`);
  // Scan first: the prospect list and its "check waiting outreach" form only render once prospects exist.
  await page.getByLabel("ZIP codes (up to 25)").fill("90001 91201");
  await page.getByRole("button", { name: "Run scan" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Scan complete/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check waiting outreach for broker decisions" })).toBeVisible();
  for (const p of ["/prospects", "/prospects/intel", "/prospects/suppressions"]) {
    await page.goto(`${base}${p}`);
    await expect(page).toHaveURL(`${base}${p}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // The lists stream in behind Suspense; measure once they (and their buttons) have rendered.
    await expect(page.getByText(/^Loading\b.*…$/)).toHaveCount(0);
    if (p === "/prospects") await expect(page.getByRole("button", { name: "Check waiting outreach" })).toBeVisible();
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
    expect(scrollWidth, `${p}: page is ${scrollWidth}px wide at a ${innerWidth}px viewport`).toBeLessThanOrEqual(innerWidth);
  }
});

test("at 375px the prospect tables scroll inside focusable, named regions with no serious axe issues", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await signIn(page, "broker@kubera.test", "/prospects");
  await expect(page.getByRole("heading", { name: "Refinance-maturity prospects", level: 1 })).toBeVisible();
  // A scan adds the recent-scans table, so both tables on the list page are checked.
  await page.getByLabel("ZIP codes (up to 25)").fill("90001");
  await page.getByRole("button", { name: "Run scan" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Scan complete/ })).toBeVisible();
  const list = page.getByRole("region", { name: "Prospects table" });
  await expect(list).toHaveAttribute("tabindex", "0");
  await expect(page.getByRole("region", { name: "Recent scans table" })).toHaveAttribute("tabindex", "0");
  // The table is wider than the phone, so the region really scrolls; a keyboard user can reach it.
  expect(await list.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await list.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => list.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  expect(await seriousViolations(page)).toEqual([]);

  await page.getByRole("link", { name: "100 Example Ave" }).click();
  await expect(page.getByRole("heading", { name: "100 Example Ave", level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Score factors table" })).toHaveAttribute("tabindex", "0");
  expect(await seriousViolations(page)).toEqual([]);
});
