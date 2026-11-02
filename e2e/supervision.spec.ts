import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { DEMO_TOTP_SECRET } from "../lib/auth/demo";
import { totp } from "../lib/auth/totp";
import { seriousViolations } from "./forms-helpers";

// AI review queue and business reports against the fake identity provider and
// the illustrative demo data (conversations and a ledger fixture).
//
// Runs its own `next start` on the suite's build (port E2E_PORT + 2) with
// AUTH_PROVIDER=fake and stops it afterwards. A server of its own keeps these
// sign-ins out of the shared server's per-IP sign-in rate limit, which the
// staff suite already uses up, and gives the demo data (flags, notes, spend)
// a fresh in-memory start.

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
  const port = Number(process.env.E2E_SUPERVISION_PORT ?? mainPort + 2);
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

async function signIn(page: Page, email: string, path: string, withTotp = true) {
  await page.goto(`${base}${path}`);
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page).toHaveURL(/\/login\/verify$/);
  const code = (await page.getByTestId("fake-code").textContent())?.trim() ?? "";
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Sign in" }).click();
  if (withTotp) {
    await expect(page).toHaveURL(/\/mfa\?next=/);
    await page.getByLabel("Authenticator code").fill(totp(DEMO_TOTP_SECRET));
    await page.getByRole("button", { name: "Verify" }).click();
  }
}

test("AI review and reports require sign-in", async ({ page, request }) => {
  await page.goto(`${base}/ai-review`);
  await expect(page).toHaveURL(`${base}/login?next=%2Fai-review`);
  await page.goto(`${base}/reports`);
  await expect(page).toHaveURL(/\/login\?next=%2Freports/);
  const csv = await request.get(`${base}/reports/export?report=fees`, { maxRedirects: 0 });
  expect(csv.status()).toBe(401);
});

test("a broker reviews a flagged conversation: guardrail hit, annotation, sign-off", async ({ page }) => {
  await signIn(page, "broker@corin.test", "/ai-review");
  await expect(page).toHaveURL(`${base}/ai-review`);
  await expect(page.getByRole("heading", { name: "AI review", level: 1 })).toBeVisible();

  // The queue starts on flagged conversations that still need review.
  const list = page.getByRole("list", { name: "Needs review" });
  await expect(list.getByRole("link", { name: /Am I approved for a HUD loan/ })).toBeVisible();
  await expect(list.getByText("Guardrail: 1")).toBeVisible();
  await expect(list.getByRole("link", { name: /How much equity does an SBA 504 hotel loan need/ })).toBeVisible();
  // The reviewed one is not in the queue; it is under Reviewed.
  await expect(list.getByRole("link", { name: /guarantee my loan will close/ })).toHaveCount(0);
  expect(await seriousViolations(page)).toEqual([]);

  await list.getByRole("link", { name: /Am I approved for a HUD loan/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Am I approved for a HUD loan");

  // What the borrower saw is the rewritten sentence; the original is kept for reviewers.
  const transcript = page.getByRole("list", { name: "Conversation" });
  await expect(transcript.getByText(/Corin can't promise approval, pricing, a rate lock or a particular lender/)).toBeVisible();
  await expect(transcript.getByText("Output guardrail rewrote 1 sentence in this reply: Commitment language.")).toBeVisible();
  await transcript.getByText("What the model wrote (internal)").click();
  await expect(transcript.getByText("you're approved for a HUD 232 loan")).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  // Annotate the assistant message.
  await page.getByLabel("About", { exact: true }).selectOption({ label: "Message 2, Corin AI" });
  await page.getByLabel("Label", { exact: true }).selectOption("compliance_issue");
  await page.getByLabel("Note", { exact: true }).fill("Model said approved; the guardrail caught it. Tighten the term-sheet prompt.");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Note added." })).toBeVisible();
  await expect(transcript.getByText("Tighten the term-sheet prompt.")).toBeVisible();

  // Sign off: it leaves the needs-review queue.
  await page.getByRole("button", { name: "Mark reviewed" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Marked reviewed." })).toBeVisible();
  await page.goto(`${base}/ai-review`);
  await expect(page.getByRole("list", { name: "Needs review" }).getByRole("link", { name: /Am I approved for a HUD loan/ })).toHaveCount(0);
  await page.getByRole("link", { name: "Guardrail hits" }).click();
  await expect(page.getByRole("list", { name: "Guardrail hits" }).getByRole("link", { name: /Am I approved for a HUD loan/ })).toBeVisible();
});

test("a broker flags and unflags a clean conversation", async ({ page }) => {
  await signIn(page, "broker@corin.test", "/ai-review?view=all");
  const list = page.getByRole("list", { name: "All conversations" });
  await list.getByRole("link", { name: /What DSCR does a HUD 232 refinance need/ }).click();
  await page.getByLabel("Why flag this conversation?").fill("Check the 35-year term wording");
  await page.getByRole("button", { name: "Flag for review" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Flagged for review." })).toBeVisible();
  await expect(page.getByText("Check the 35-year term wording")).toBeVisible();
  await page.getByRole("button", { name: "Remove flag" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Flag removed." })).toBeVisible();
});

test("a broker reads the reports and downloads a CSV", async ({ page }) => {
  await signIn(page, "broker@corin.test", "/reports");
  await expect(page).toHaveURL(`${base}/reports`);
  await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();

  // Pipeline: four open deals in the fixture, in lifecycle order.
  await expect(page.getByRole("table", { name: "Open deals by stage", exact: true }).getByRole("row", { name: /Term sheet/ })).toBeVisible();
  await expect(page.getByRole("table", { name: "Time in stage", exact: true })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  // Fee forecast reconciles with the ledger.
  await page.getByRole("link", { name: "Fee forecast" }).click();
  await expect(page).toHaveURL(/view=fees/);
  await expect(page.getByText(/All \d+ checks match/)).toBeVisible();
  await expect(page.getByRole("table", { name: "Booked fees by month", exact: true })).toBeVisible();
  await expect(page.getByRole("table", { name: "Projected fees by deal stage", exact: true }).getByRole("row", { name: /Term sheet.*55%/ })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download CSV" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^fee-report-.*\.csv$/);

  // Lenders and lead sources.
  await page.getByRole("link", { name: "Lender hit rate" }).click();
  await expect(page.getByRole("table", { name: "Lender hit rate", exact: true }).getByRole("row", { name: /Cambridge Realty Capital/ })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  await page.getByRole("link", { name: "Lead sources" }).click();
  await expect(page.getByRole("table", { name: "Lead-source return on spend", exact: true }).getByRole("row", { name: /google_ads/ })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test("report views reflow at 390px: only the tables scroll, never the page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "broker@corin.test", "/reports");
  await expect(page).toHaveURL(`${base}/reports`);
  for (const view of ["overview", "fees", "lenders", "sources"]) {
    await page.goto(`${base}/reports${view === "overview" ? "" : `?view=${view}`}`);
    await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();
    await expect(page.getByRole("table").first()).toBeAttached();
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
    expect(scrollWidth, `${view}: page is ${scrollWidth}px wide at a ${innerWidth}px viewport`).toBeLessThanOrEqual(innerWidth);
  }
});

test("recording marketing spend updates the lead-source return", async ({ page }) => {
  await signIn(page, "broker@corin.test", "/reports?view=sources");
  const table = page.getByRole("table", { name: "Lead-source return on spend", exact: true });
  await expect(table.getByRole("row", { name: /partner_referral.*Not recorded/ })).toBeVisible();

  const today = new Date().toISOString().slice(0, 10);
  await page.getByLabel("Lead source", { exact: true }).fill("partner_referral");
  await page.getByLabel("First day").fill("2020-01-01");
  await page.getByLabel("Last day").fill(today);
  await page.getByLabel("Amount spent (USD)").fill("500");
  await page.getByRole("button", { name: "Record spend" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Recorded the spend for partner_referral." })).toBeVisible();
  await expect(table.getByRole("row", { name: /partner_referral/ })).not.toContainText("Not recorded");

  // The same period again is refused.
  await page.getByLabel("Lead source", { exact: true }).fill("partner_referral");
  await page.getByLabel("First day").fill("2020-01-01");
  await page.getByLabel("Last day").fill(today);
  await page.getByLabel("Amount spent (USD)").fill("500");
  await page.getByRole("button", { name: "Record spend" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "already recorded" })).toBeVisible();
});
