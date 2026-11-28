import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { DEMO_TOTP_SECRET } from "../lib/auth/demo";
import { totp } from "../lib/auth/totp";
import { seriousViolations } from "./forms-helpers";

// The lender-ready deal submission (spec 7.3): the editor at
// /deals/[id]/submission, the preview, the request for broker approval and the
// approvals queue, against the fake identity provider and the in-memory demo
// desks. Runs its
// own `next start` on the suite's build (port E2E_PORT + 5) with
// AUTH_PROVIDER=fake, so the desks start fresh and nothing is sent: no mail
// credentials are set and LENDER_EMAIL_ENABLED is unset.
//
// Demo deals used (lib/deals/demo.ts): Brindle Example Apartments has every
// Screen item answered (profile, sponsor, two guarantors with personal
// financial statements); Larkspur Example Terrace has only a lead intake, so
// prefill has values to suggest; Desert Palms Hotel PIP and Coastal Ground-up
// Townhomes have nothing entered (their playbooks pick the sections).

test.describe.configure({ mode: "serial" });

const DEALS = {
  ready: "10000000-0000-4000-8000-000000000009",
  empty: "10000000-0000-4000-8000-000000000010",
  pipHotel: "10000000-0000-4000-8000-000000000007",
  townhomes: "10000000-0000-4000-8000-000000000006",
};

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
  const port = Number(process.env.E2E_SUBMISSION_PORT ?? mainPort + 5);
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
      RESEND_API_KEY: "",
      CLOUDFLARE_EMAIL_TOKEN: "",
      LENDER_EMAIL_ENABLED: "",
      ESIGN_PROVIDER: "",
      CSLB_LOOKUP_ENABLED: "",
      PORTAL_SESSION_SECRET: "",
      PII_ENCRYPTION_KEY: "",
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

async function signInWithCode(page: Page, next: string, email: string) {
  await page.goto(`${base}${next}`);
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page).toHaveURL(/\/login\/verify$/);
  const code = (await page.getByTestId("fake-code").textContent())?.trim() ?? "";
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/mfa\?next=/);
}

async function signIn(page: Page, next: string) {
  await signInWithCode(page, next, "broker@corin.test");
  await page.getByLabel("Authenticator code").fill(totp(DEMO_TOTP_SECRET));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL((url) => url.pathname === next.split("?")[0]);
}

/** No serious or critical axe violations, and no sideways page scroll at 390px or at the desktop width (WCAG 1.4.10). */
async function expectAccessibleAndReflows(page: Page, label: string) {
  const width = page.viewportSize()?.width ?? 1280;
  for (const w of [width, 390]) {
    await page.setViewportSize({ width: w, height: 900 });
    const { scrollWidth, innerWidth, widest } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      widest: [...document.querySelectorAll("body *")]
        .filter((e) => e.getBoundingClientRect().right > window.innerWidth + 0.5 && !e.closest("[role=region][tabindex]") && !e.closest("#staff-header"))
        .slice(-3)
        .map((e) => `${e.tagName.toLowerCase()} "${(e.textContent ?? "").trim().slice(0, 40)}"`),
    }));
    expect(scrollWidth, `${label}: page is ${scrollWidth}px wide at a ${innerWidth}px viewport (${widest.join("; ")})`).toBeLessThanOrEqual(innerWidth);
    expect(await seriousViolations(page), `${label}: axe at ${w}px`).toEqual([]);
  }
  await page.setViewportSize({ width, height: 900 });
}

const notice = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
/** An editor or deal-desk card by its h2 title. */
const section = (page: Page, title: string) => page.locator("section").filter({ has: page.getByRole("heading", { name: title, level: 2, exact: true }) });
/** The desktop side panel (meter and metrics). */
const panel = (page: Page) => page.getByRole("region", { name: "Lender-ready meter and computed metrics" });
const metric = (page: Page, key: string) => panel(page).locator(`[data-metric="${key}"]`);
const editor = (id: string) => `/deals/${id}/submission`;

test("signed out, the editor, the preview and the summary PDF ask for staff sign-in and are not indexable", async ({ page, request }) => {
  for (const p of [editor(DEALS.ready), `${editor(DEALS.ready)}/preview`]) {
    await page.goto(`${base}${p}`);
    await expect(page).toHaveURL((url) => url.pathname === "/login" && url.searchParams.get("next") === p);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    const res = await request.get(`${base}${p}`, { maxRedirects: 0 });
    expect(res.headers()["x-robots-tag"]).toContain("noindex");
  }
  const pdf = await request.get(`${base}${editor(DEALS.ready)}/summary.pdf`);
  expect(pdf.status()).toBe(401);
  expect(pdf.headers()["cache-control"]).toContain("no-store");
});

test("a broker starts an empty deal from the suggested values, which keep their per-borrower tags", async ({ page }) => {
  await signIn(page, editor(DEALS.empty));
  await expect(page.getByRole("heading", { name: "Larkspur Example Terrace (demo): lender submission", level: 1 })).toBeVisible();
  const screen = panel(page).locator('[data-stage="screen"]');
  await expect(screen).toContainText(/required items missing/);
  await expect(screen.getByRole("link", { name: "Loan purpose" })).toHaveAttribute("href", "#field-purpose");

  const suggested = section(page, "Suggested values");
  await expect(suggested.getByRole("row", { name: /In-place NOI/ })).toContainText("Per borrower");
  await expect(suggested.getByRole("row", { name: /In-place NOI/ })).toContainText("$410,000");
  await expect(suggested.getByRole("row", { name: /Credit band/ })).toContainText("Per borrower");
  await expectAccessibleAndReflows(page, "editor with suggestions");
  await suggested.getByRole("button", { name: "Start from these" }).click();
  await expect(notice(page, /Started from \d+ suggested values/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Suggested values" })).toHaveCount(0);
  await expect(page.locator("#field-purpose")).toHaveValue("refinance");
  await expect(page.locator("#field-purpose-source")).toHaveText(/Per borrower/);
  await expect(page.locator("#field-noiInPlaceCents-source")).toHaveText(/Per borrower/);
  await expect(screen.getByRole("link", { name: "Loan purpose" })).toHaveCount(0);
});

test("ratios are computed read-only with their formulas, and a refused save keeps what was typed", async ({ page }) => {
  await signIn(page, editor(DEALS.empty));
  // Nothing on the page lets a ratio be typed.
  await expect(page.getByRole("textbox", { name: /^(LTV|LTC|DSCR|debt yield|cap rate|yield on cost)\b/i })).toHaveCount(0);
  await expect(page.getByRole("spinbutton")).toHaveCount(0);

  // From the intake: $5,200,000 on a $7,400,000 as-is value, $410,000 NOI.
  await expect(metric(page, "ltv_as_is")).toContainText("70.3%");
  await expect(metric(page, "ltv_as_is")).toContainText("Corin calculation");
  await metric(page, "ltv_as_is").getByText("How this is calculated").click();
  await expect(metric(page, "ltv_as_is")).toContainText("loan ÷ as-is value");
  await expect(metric(page, "debt_yield_in_place")).toContainText("7.9%");
  await expect(metric(page, "dscr_in_place")).toContainText("Needs: assumed rate, assumed amortization");

  // The sizing assumption makes DSCR appear, labelled as an assumption.
  const request = section(page, "Loan request");
  await request.getByLabel("Assumed rate for DSCR sizing (%)").fill("7.25");
  await request.getByLabel("Assumed amortization for DSCR sizing (months)").fill("360");
  await request.getByLabel("Recourse sought").selectOption("full");
  await request.getByLabel("Lien position").selectOption("first");
  await request.getByRole("button", { name: "Save loan request" }).click();
  await expect(request.getByRole("status")).toHaveText("Loan request saved.");
  await expect(metric(page, "dscr_in_place")).toContainText("0.96x");
  await expect(metric(page, "dscr_in_place")).toContainText("an assumption, not a quote");
  await expect(page.locator("#field-assumedRatePct-source")).toHaveText(/Entered$/);

  // A bad value is refused by its label, and the typing stays.
  const value = section(page, "Value");
  await value.getByLabel("As-is value (USD)").fill("about 17 million");
  await value.getByRole("button", { name: "Save value" }).click();
  const alert = value.getByRole("alert");
  await expect(alert).toContainText("Nothing was saved");
  await expect(alert.getByRole("link", { name: "As-is value (USD)" })).toHaveAttribute("href", "#field-asIsValueCents");
  await expect(value.getByLabel("As-is value (USD)")).toHaveValue("about 17 million");

  // Removing the as-is value removes LTV and says what it needs.
  await value.getByLabel("As-is value (USD)").fill("");
  await value.getByRole("button", { name: "Save value" }).click();
  await expect(value.getByRole("status")).toHaveText("Value saved.");
  await expect(metric(page, "ltv_as_is")).toContainText("Needs: as-is value");
  await expect(metric(page, "ltv_as_is")).not.toContainText("%");

  // A missing item links to its field.
  await panel(page).getByRole("link", { name: "Purchase price (acquisition) or as-is value with its source and date" }).first().click();
  await expect(page).toHaveURL(/#field-asIsValueCents$/);
  await expect(page.locator("#field-asIsValueCents")).toBeInViewport();
});

test("only the playbook's sections show: hotel on a hotel deal, construction on a construction deal", async ({ page }) => {
  await signIn(page, editor(DEALS.pipHotel));
  const nav = page.getByRole("navigation", { name: "Submission sections" });
  await expect(section(page, "Hotel")).toBeVisible();
  await expect(nav.getByRole("link", { name: /^Hotel/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Construction", level: 2 })).toHaveCount(0);
  await expectAccessibleAndReflows(page, "hotel editor");

  await page.goto(`${base}${editor(DEALS.ready)}`);
  await expect(panel(page).locator('[data-stage="screen"]')).toContainText("Lender-ready for a soft quote");
  await expect(section(page, "Rehab / capex and reserves")).toBeVisible();
  await expect(page.locator("#field-programDetails\\.rehab\\.budgetCents")).toHaveValue("1260000");

  await page.goto(`${base}${editor(DEALS.townhomes)}`);
  await expect(section(page, "Construction")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Hotel", level: 2 })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Operating financials", level: 2 })).toHaveCount(0);
});

test("the deal page carries the submission card, the Details anchor and no bare send form", async ({ page }) => {
  await signIn(page, `/deals/${DEALS.ready}`);
  const card = section(page, "Lender submission");
  await expect(card).toContainText("Lender-ready for a soft quote");
  await expect(card.getByRole("link", { name: "Prepare lender submission" })).toHaveAttribute("href", editor(DEALS.ready));
  await expect(page.locator("#details")).toBeVisible();
  await expect(page.getByRole("button", { name: "Lock package and request approval" })).toHaveCount(0);
  await expect(section(page, "Lender outreach").getByRole("link", { name: "Preview and request a submission" })).toBeVisible();
});

test("the preview shows the exact email with the broker sentence and the licence line, and says email to lenders is off", async ({ page }) => {
  await signIn(page, `${editor(DEALS.ready)}/preview`);
  await expect(page.getByRole("note").filter({ hasText: "Email to lenders is off." })).toBeVisible();
  await expect(page.getByTestId("email-subject")).toHaveText(/^Loan request: \$8,400,000 bridge \| 42-unit multifamily, Oakland CA \| 68% LTV, 0\.96x DSCR \| Corin Commercial$/);
  const body = page.getByTestId("email-body");
  await expect(body).toContainText("Corin Commercial, Inc. is the broker on this request, not the lender.");
  await expect(body).toContainText("Real estate broker, California Department of Real Estate");
  await expect(body).toContainText("{{SHARE_LINK}}");
  await expect(body).toContainText("Guarantor net worth at or above the loan amount: yes.");
  // No guarantor's name or sponsor dollar figure in the body (they are in the summary behind the link).
  await expect(body).not.toContainText("Demo Guarantor");
  for (const figure of ["$19,400,000", "$2,550,000", "$18,500,000", "$2,400,000"]) await expect(body).not.toContainText(figure);
  const summary = section(page, "The summary");
  await expect(summary.getByRole("heading", { name: "Brindle Example Apartments (demo) — loan request summary" })).toBeVisible();
  await expect(summary).toContainText("$19,400,000");
  await expectAccessibleAndReflows(page, "preview");

  const pdf = await page.request.get(`${base}${editor(DEALS.ready)}/summary.pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
});

test("a request with missing items and no reason is refused with the list; with a reason it waits for a broker", async ({ page }) => {
  await signIn(page, `${editor(DEALS.empty)}/preview`);
  const form = page.getByRole("form", { name: "Request broker approval" });
  await form.getByRole("checkbox", { name: "Sample Private Fund (demo)" }).check();
  await form.getByRole("button", { name: "Request broker approval" }).click();
  const alert = form.getByRole("alert");
  await expect(alert).toContainText(/required items? (is|are) missing for a soft-quote request/);
  await expect(alert.getByRole("list", { name: "Missing items" }).getByRole("link").first()).toBeVisible();

  await form.getByLabel("Reason to send with items missing").fill("Too short");
  await form.getByRole("button", { name: "Request broker approval" }).click();
  await expect(alert).toContainText("Your reason has 9.");

  const reason = "Lender asked for an early look before the appraisal";
  await form.getByLabel("Reason to send with items missing").fill(reason);
  await form.getByRole("button", { name: "Request broker approval" }).click();
  await expect(form.getByRole("status")).toContainText("Requested broker approval for 1 lender. Nothing is sent until a broker approves.");

  await page.goto(`${base}/approvals`);
  const card = page.getByRole("list", { name: "Requests waiting for a decision" }).getByRole("article", { name: /Larkspur Example Terrace \(demo\).*Sample Private Fund/ });
  // The v2 approval carries the stage, the missing items and the reason (and the email and summary hashes).
  await expect(card).toContainText(`Reason to send anyway: ${reason}`);
  await expect(card).toContainText("Asks the lender for screen (soft quote)");
  await expect(card).toContainText(/Required items missing \(\d+\)/);
  await expect(card).toContainText("Stabilized NOI and the months to reach it");
  await expect(card.getByRole("link", { name: "Preview the email and summary" })).toHaveAttribute("href", new RegExp(`/deals/${DEALS.empty}/submission/preview\\?lender=`));

  await page.goto(`${base}/deals/${DEALS.empty}`);
  await expect(section(page, "Lender outreach").getByRole("row", { name: /Sample Private Fund \(demo\)/ })).toContainText("pending approval");

  // The deal page's card links each missing item to its field in the editor.
  const fix = section(page, "Lender submission").locator('[data-stage="screen"]').getByRole("link").first();
  const href = (await fix.getAttribute("href")) ?? "";
  expect(href).toMatch(new RegExp(`^/deals/${DEALS.empty}/submission\\?section=\\w+#(field|section)-`));
  await fix.click();
  await expect(page.locator(`#${href.split("#")[1]!.replace(/\./g, "\\.")}`)).toBeInViewport();
});

test("an analyst reads the submission without forms", async ({ page }) => {
  await signInWithCode(page, editor(DEALS.ready), "analyst@corin.test");
  const setup = page.getByRole("button", { name: "Set up authenticator" });
  await setup.click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim() ?? "";
  await page.getByLabel("Code from your app").fill(totp(secret));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(`${base}${editor(DEALS.ready)}`);
  await expect(page.getByRole("note").filter({ hasText: "You have read access" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Save / })).toHaveCount(0);
  await expect(section(page, "Rehab / capex and reserves")).toContainText("soft-story seismic retrofit");
  await page.goto(`${base}${editor(DEALS.ready)}/preview`);
  await expect(page.getByTestId("email-subject")).toBeVisible();
  await expect(page.getByRole("button", { name: "Request broker approval" })).toHaveCount(0);
});
