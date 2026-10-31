import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { DEMO_TOTP_SECRET } from "../lib/auth/demo";
import { totp } from "../lib/auth/totp";
import { seriousViolations } from "./forms-helpers";

// Staff sign-in (email code + TOTP), pipeline, approvals and the document
// viewer against the fake identity provider and its in-memory demo data.
//
// The fake provider needs AUTH_PROVIDER=fake. If the suite's server already
// runs with it (AUTH_PROVIDER=fake npm run test:e2e), the tests use it;
// otherwise they start a second `next start` on the same build with the fake
// provider (port E2E_STAFF_PORT, default E2E_PORT + 1) and stop it afterwards.

test.describe.configure({ mode: "serial" });

const mainPort = Number(process.env.E2E_PORT ?? 3999);
const mainBase = `http://localhost:${mainPort}`;
let base = mainBase;
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
  if (await isFake(mainBase)) return;
  const port = Number(process.env.E2E_STAFF_PORT ?? mainPort + 1);
  base = `http://localhost:${port}`;
  // Node runs the Next CLI directly so stopping it stops the server too.
  server = spawn(process.execPath, [path.join(process.cwd(), "node_modules/next/dist/bin/next"), "start", "-p", String(port)], {
    env: {
      ...process.env,
      AUTH_PROVIDER: "fake",
      NEXT_TELEMETRY_DISABLED: "1",
      NEXT_PUBLIC_DRE_CORPORATE_LICENSE: process.env.NEXT_PUBLIC_DRE_CORPORATE_LICENSE || "E2E-TEST-0000000",
      SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      SUPABASE_ANON_KEY: "",
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

async function signInWithCode(page: Page, email: string, path = "/pipeline") {
  await page.goto(`${base}${path}`);
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page).toHaveURL(/\/login\/verify$/);
  const code = (await page.getByTestId("fake-code").textContent())?.trim() ?? "";
  expect(code).toMatch(/^\d{6}$/);
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function signInBroker(page: Page, path = "/pipeline") {
  await signInWithCode(page, "broker@kubera.test", path);
  await expect(page).toHaveURL(/\/mfa\?next=/);
  await page.getByLabel("Authenticator code").fill(totp(DEMO_TOTP_SECRET));
  await page.getByRole("button", { name: "Verify" }).click();
}

test("staff pages and files require sign-in", async ({ page, request }) => {
  await page.goto(`${base}/approvals`);
  await expect(page).toHaveURL(`${base}/login?next=%2Fapprovals`);
  const file = await request.get(`${base}/documents/30000000-0000-4000-8000-000000000001/file`, { maxRedirects: 0 });
  expect(file.status()).toBe(303);
  expect(file.headers()["location"]).toContain("/login?next=");
});

test("unknown emails get the same answer as real accounts", async ({ page }) => {
  await page.goto(`${base}/login`);
  await page.getByLabel("Work email").fill("nobody@example.com");
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page).toHaveURL(/\/login\/verify$/);
  await expect(page.getByText(/has an account, we sent a 6-digit code/)).toBeVisible();
  await expect(page.getByTestId("fake-code")).toHaveCount(0);
});

test("a broker signs in with email code and TOTP, then works the pipeline", async ({ page }) => {
  await signInBroker(page);
  await expect(page).toHaveURL(`${base}/pipeline`);
  await expect(page.getByRole("heading", { name: "Pipeline", level: 1 })).toBeVisible();
  const table = page.getByRole("table", { name: /Deal pipeline/ });
  await expect(table.getByRole("link", { name: "Sunrise Senior Living (demo)" })).toBeVisible();
  // Lost deals are hidden until asked for.
  await expect(table.getByText("Cedar Court Refinance (demo)")).toHaveCount(0);

  await page.getByLabel("Search deals").fill("harbor");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table.getByRole("link", { name: "Harbor Inn (demo)" })).toBeVisible();
  await page.getByLabel("Search deals").fill("");

  await page.getByLabel("Stage", { exact: true }).selectOption("closing");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await page.getByLabel("Stage", { exact: true }).selectOption("");
  await page.getByLabel("Include closed and lost").check();
  await expect(table.getByText("Cedar Court Refinance (demo)")).toBeVisible();

  const loanHeader = table.getByRole("columnheader", { name: /Loan/ });
  await loanHeader.getByRole("button").click();
  await expect(loanHeader).toHaveAttribute("aria-sort", /ascending|descending/);
});

test("a broker approves and rejects requests; expired ones never send", async ({ page }) => {
  await signInBroker(page, "/approvals");
  await expect(page).toHaveURL(`${base}/approvals`);
  await expect(page.getByRole("heading", { name: "Approvals", level: 1 })).toBeVisible();

  const queue = page.getByRole("list", { name: "Requests waiting for a decision" });
  await expect(queue).toBeVisible();
  const oak = queue.getByRole("article", { name: /Oak Terrace Apartments/ });
  if (await oak.count()) {
    await oak.getByRole("button", { name: /^Approve/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "CRM update approved: Move Oak Terrace" })).toBeVisible();
    await expect(queue.getByRole("article", { name: /Oak Terrace Apartments/ })).toHaveCount(0);
  }

  // A sensitive send (MLDS) asks for a fresh authenticator code before it is approved.
  const mlds = queue.getByRole("article", { name: /MLDS \(RE 882\) for Sunrise/ });
  if (await mlds.count()) {
    const code = mlds.getByLabel("Authenticator code");
    await expect(code).toBeVisible();
    await code.fill("000000" === totp(DEMO_TOTP_SECRET) ? "111111" : "000000");
    await mlds.getByRole("button", { name: /^Approve/ }).click();
    await expect(mlds.getByRole("alert")).toContainText("did not match");
    await expect(queue.getByRole("article", { name: /MLDS \(RE 882\) for Sunrise/ })).toHaveCount(1);
    await mlds.getByLabel("Authenticator code").fill(totp(DEMO_TOTP_SECRET));
    await mlds.getByRole("button", { name: /^Approve/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "MLDS (RE 882) e-sign send approved: Send the MLDS" })).toBeVisible();
    await expect(queue.getByRole("article", { name: /MLDS \(RE 882\) for Sunrise/ })).toHaveCount(0);
  }

  const harbor = queue.getByRole("article", { name: /Harbor Inn SBA 504 package/ });
  if (await harbor.count()) {
    await harbor.getByRole("button", { name: /^Reject/ }).click();
    await harbor.getByLabel("Reason for rejecting").fill("Package is missing the updated STR report");
    await harbor.getByRole("button", { name: "Reject request" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Lender submission rejected: Send the Harbor Inn" })).toBeVisible();
  }

  // The request from yesterday timed out: it shows as expired, never sent, and cannot be approved.
  await expect(queue.getByRole("article", { name: /Maple Street/ })).toHaveCount(0);

  await page.getByRole("link", { name: "Decided" }).click();
  await expect(page).toHaveURL(`${base}/approvals?view=decided`);
  const decided = page.getByRole("list", { name: "Decided requests" });
  await expect(decided.getByRole("article", { name: /Oak Terrace Apartments/ }).getByText(/^Approved/)).toBeVisible();
  await expect(decided.getByRole("article", { name: /Oak Terrace Apartments/ }).getByText(/DRE 01234567/)).toBeVisible();
  await expect(decided.getByRole("article", { name: /Harbor Inn SBA 504 package/ }).getByText("Rejected · not sent")).toBeVisible();
  await expect(decided.getByRole("article", { name: /Maple Street/ }).getByText("Expired · never sent")).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(`${base}/login?signed_out=1`);
  await page.goto(`${base}/approvals`);
  await expect(page).toHaveURL(/\/login\?next=/);
});

test("documents open through an audited, short-lived link; quarantined files do not", async ({ page, context }) => {
  await signInBroker(page, "/documents");
  await expect(page).toHaveURL(`${base}/documents`);
  await page.getByRole("link", { name: "Sunrise T-12 Sep 2026.pdf" }).click();
  await expect(page.getByRole("heading", { name: "Sunrise T-12 Sep 2026.pdf" })).toBeVisible();
  const [file] = await Promise.all([context.waitForEvent("page"), page.getByRole("link", { name: "Open document" }).click()]);
  await file.waitForLoadState();
  await expect(file.locator("body")).toContainText("Demo document placeholder");
  await file.close();

  await page.goto(`${base}/documents/30000000-0000-4000-8000-000000000004`);
  await expect(page.getByText(/held in quarantine/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Open document" })).toHaveCount(0);
  const blocked = await page.request.get(`${base}/documents/30000000-0000-4000-8000-000000000004/file`);
  expect(blocked.status()).toBe(423);
});

test("extraction review reflows at 390px and has no serious accessibility violations while items wait", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInBroker(page, "/documents/extractions");
  await expect(page).toHaveURL(`${base}/documents/extractions`);
  await expect(page.getByRole("heading", { name: "Extraction review", level: 1 })).toBeVisible();
  const queue = page.getByRole("list", { name: "Extractions waiting for review" });
  // The queue streams in behind a Suspense boundary: wait for it (or the empty state) before deciding.
  await expect(queue.or(page.getByText("Nothing is waiting for review."))).toBeVisible();
  test.skip((await queue.count()) === 0, "Demo queue already reviewed on a reused server");
  await expect(queue.getByRole("table").first()).toBeVisible();
  // Only the field tables scroll sideways, never the page.
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth, `page is ${scrollWidth}px wide at a ${innerWidth}px viewport`).toBeLessThanOrEqual(innerWidth);
  // The approve and reject buttons' names start with their visible text (label-in-name).
  expect(await seriousViolations(page)).toEqual([]);
  await page.setViewportSize({ width: 1280, height: 900 });
  expect(await seriousViolations(page)).toEqual([]);
});

test("the staff shell has no sideways page scroll at 640px, 768px or 1024px", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await signInBroker(page, "/approvals");
  await expect(page).toHaveURL(`${base}/approvals`);
  for (const p of ["/approvals", "/pipeline", "/documents", "/ai-review", "/reports"]) {
    await page.goto(`${base}${p}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(/^Loading\b.*…$/)).toHaveCount(0);
    for (const width of [640, 768, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
      expect(scrollWidth, `${p}: page is ${scrollWidth}px wide at a ${innerWidth}px viewport`).toBeLessThanOrEqual(innerWidth);
    }
    // Every staff section stays reachable from the nav.
    await expect(page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Prospects" })).toBeAttached();
  }
});

test("staff review low-confidence extractions: correct and approve, or reject", async ({ page }) => {
  await signInBroker(page, "/documents/extractions");
  await expect(page).toHaveURL(`${base}/documents/extractions`);
  await expect(page.getByRole("heading", { name: "Extraction review", level: 1 })).toBeVisible();
  const queue = page.getByRole("list", { name: "Extractions waiting for review" });
  await expect(queue.or(page.getByText("Nothing is waiting for review."))).toBeVisible();
  const pfs = queue.getByRole("article", { name: /Personal financial statement: Sunrise guarantor PFS/ });
  test.skip((await pfs.count()) === 0, "Demo queue already reviewed on a reused server");

  // Fields show with their confidence and evidence; the figures that disagree are flagged.
  await expect(pfs.getByRole("table", { name: /Extracted fields/ })).toBeVisible();
  await expect(pfs.getByText("row 12: Total assets")).toBeVisible();
  await expect(pfs.getByText("62%", { exact: true })).toBeVisible();
  await expect(pfs.getByRole("list", { name: "Checks that failed" })).toContainText(/mismatch/);

  // Approving as read is refused while the totals disagree.
  await pfs.getByRole("button", { name: /^Approve with these values/ }).click();
  await expect(pfs.getByRole("alert")).toContainText(/disagree/);

  await pfs.getByLabel("Total assets").fill("1900000");
  await pfs.getByRole("button", { name: /^Approve with these values/ }).click();
  await expect(page).toHaveURL(/\/documents\/extractions\?approved=/);
  await expect(page.getByRole("status").filter({ hasText: "Extraction approved" })).toBeVisible();
  await expect(queue.getByRole("article", { name: /Sunrise guarantor PFS/ })).toHaveCount(0);

  const t12 = queue.getByRole("article", { name: /T-12 operating statement: Harbor Inn/ });
  await t12.getByRole("button", { name: /^Reject: / }).click();
  await t12.getByLabel("Reason for rejecting").fill("Wrong year; the borrower will send the 2026 T-12");
  await t12.getByRole("button", { name: "Reject extraction" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Extraction rejected" })).toBeVisible();
  await expect(page.getByText("Nothing is waiting for review.")).toBeVisible();
});

test("extraction review requires sign-in", async ({ page }) => {
  await page.goto(`${base}/documents/extractions`);
  await expect(page).toHaveURL(/\/login\?next=%2Fdocuments%2Fextractions/);
});

test("an analyst enrolls TOTP on first sign-in and can view but not approve", async ({ page }) => {
  await signInWithCode(page, "analyst@kubera.test", "/approvals");
  await expect(page).toHaveURL(/\/mfa\?next=/);
  const setup = page.getByRole("button", { name: "Set up authenticator" });
  await expect(page.getByRole("button", { name: /Set up authenticator|Verify/ })).toBeVisible();
  test.skip((await setup.count()) === 0, "Analyst already enrolled on a reused server");
  await setup.click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim() ?? "";
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  await page.getByLabel("Code from your app").fill("000000");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText("That code did not match.")).toBeVisible();
  await page.getByLabel("Code from your app").fill(totp(secret));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(`${base}/approvals`);
  const approve = page.getByRole("button", { name: /^Approve/ }).first();
  await expect(approve).toBeDisabled();
  await expect(page.getByText("Only a broker can approve outbound actions.").first()).toBeVisible();
});

test("portal accounts cannot enter the staff area", async ({ page }) => {
  await signInWithCode(page, "borrower@kubera.test", "/pipeline");
  await expect(page).toHaveURL(/\/access-denied\?reason=not_staff/);
  await expect(page.getByRole("heading", { name: "No access" })).toBeVisible();
});

test("sign-in and staff pages have no serious accessibility violations", async ({ page }) => {
  await page.goto(`${base}/login`);
  expect(await seriousViolations(page)).toEqual([]);
  await signInBroker(page, "/pipeline");
  await expect(page.getByRole("table", { name: /Deal pipeline/ })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await page.goto(`${base}/approvals?view=decided`);
  await expect(page.getByRole("list", { name: "Decided requests" })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await page.goto(`${base}/documents`);
  await expect(page.getByRole("table", { name: "Documents in the vault" })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await page.goto(`${base}/documents/extractions`);
  await expect(page.getByRole("heading", { name: "Extraction review", level: 1 })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});
