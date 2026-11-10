import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { DEMO_TOTP_SECRET } from "../lib/auth/demo";
import { totp } from "../lib/auth/totp";
import { seriousViolations } from "./forms-helpers";

// Signed-in deal desk, checklists and screening, construction desk, lender
// matching and the borrower portal (WS-T/U/AA/M) against the fake identity
// provider and the in-memory demo desks (lib/deals/demo.ts). The demo deals
// carry the demo pipeline's ids, so every /pipeline row opens a working deal.
//
// Runs its own `next start` on the suite's build (port E2E_PORT + 4) with
// AUTH_PROVIDER=fake and stops it afterwards: the sign-ins stay out of the
// shared server's rate limit and the in-memory desks start fresh. No e-sign,
// mail or CSLB credentials are set, so every outbound action waits in the
// demo approvals queue and nothing is sent.

test.describe.configure({ mode: "serial" });

const DEALS = {
  hotel: "10000000-0000-4000-8000-000000000002",
  seniorLiving: "10000000-0000-4000-8000-000000000001",
  memoryCare: "10000000-0000-4000-8000-000000000005",
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
  const port = Number(process.env.E2E_DESKS_PORT ?? mainPort + 4);
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

async function signIn(page: Page, next: string, email = "broker@corin.test") {
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
  await expect(page).toHaveURL((url) => url.pathname === next.split("?")[0]);
}

/** No serious or critical axe violations, and no sideways page scroll at a 390px viewport (WCAG 1.4.10). */
async function expectAccessibleAndReflows(page: Page, label: string) {
  expect(await seriousViolations(page), `${label}: axe`).toEqual([]);
  const width = page.viewportSize()?.width ?? 0;
  await page.setViewportSize({ width: 390, height: 900 });
  const { scrollWidth, innerWidth, widest } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    // The innermost elements past the right edge, to name the culprit when the check fails.
    widest: [...document.querySelectorAll("body *")]
      .filter((e) => e.getBoundingClientRect().right > window.innerWidth + 0.5 && !e.closest("[role=region][tabindex]"))
      .slice(-3)
      .map((e) => `${e.tagName.toLowerCase()} "${(e.textContent ?? "").trim().slice(0, 40)}"`),
  }));
  expect(scrollWidth, `${label}: page is ${scrollWidth}px wide at a ${innerWidth}px viewport (${widest.join("; ")})`).toBeLessThanOrEqual(innerWidth);
  expect(await seriousViolations(page), `${label}: axe at 390px`).toEqual([]);
  if (width && width !== 390) await page.setViewportSize({ width, height: 900 });
}

const notice = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
/** A deal-desk card by its h2 title. */
const section = (page: Page, title: string) => page.locator("section").filter({ has: page.getByRole("heading", { name: title, level: 2, exact: true }) });
/** Adds a principal on the checklist desk (the borrower entity first, then its owners). */
async function addPrincipal(page: Page, p: { name: string; kind: "individual" | "entity"; role: string; parent?: string; pct?: string; email?: string }) {
  await page.getByText("Add a principal", { exact: true }).click();
  await page.locator("#pr-name").fill(p.name);
  await page.locator("#pr-kind").selectOption(p.kind);
  if (p.parent) await page.locator("#pr-parent").selectOption({ label: p.parent });
  await page.getByRole("group", { name: "Roles" }).getByLabel(p.role, { exact: true }).check();
  if (p.pct) await page.locator("#pr-pct").fill(p.pct);
  if (p.email) await page.locator("#pr-email").fill(p.email);
  await page.getByRole("button", { name: "Add principal" }).click();
  await expect(notice(page, `${p.name} added`)).toBeVisible();
}
/** The stage badge next to the deal's h1. */
const stageBadge = (page: Page, label: string) => page.getByRole("heading", { level: 1 }).locator("..").getByText(label, { exact: true });

test("every pipeline row opens a working deal page", async ({ page }) => {
  await signIn(page, "/pipeline");
  await page.getByRole("link", { name: "Coastal Ground-up Townhomes (demo)" }).first().click();
  await expect(page).toHaveURL(`${base}/deals/${DEALS.townhomes}`);
  await expect(page.getByRole("heading", { name: "Coastal Ground-up Townhomes (demo)", level: 1 })).toBeVisible();
  await expect(page.getByText("Deal desk storage is not configured")).toHaveCount(0);

  await page.goto(`${base}/deals`);
  const pipeline = page.getByRole("region", { name: /Table: Deal/ });
  for (const name of ["Sunrise Senior Living (demo)", "Harbor Inn (demo)", "Valley Memory Care (demo)", "Cedar Court Refinance (demo)"]) await expect(pipeline.getByRole("link", { name })).toBeVisible();
  await expectAccessibleAndReflows(page, "/deals");
});

test("a broker advances a deal's stage and generates SBA Form 159 from the ledger", async ({ page }) => {
  await signIn(page, `/deals/${DEALS.townhomes}`);
  const stage = section(page, "Stage");
  await expect(stage.getByText("Sanctions holds:")).toContainText("None");
  await stage.getByRole("button", { name: "Packaging started" }).click();
  await expect(notice(page, "Moved to packaging.")).toBeVisible();
  await expect(stageBadge(page, "Packaging")).toBeVisible();
  await expectAccessibleAndReflows(page, "deal detail");

  // SBA 504: Form 159 is built from the fee ledger and waits for broker approval before it is sent.
  await page.goto(`${base}/deals/${DEALS.hotel}`);
  await expect(page.getByRole("heading", { name: "Harbor Inn (demo)", level: 1 })).toBeVisible();
  const form159 = section(page, "SBA Form 159");
  await expect(form159.getByText("Not generated yet.")).toBeVisible();
  const comp = page.locator("form").filter({ hasText: "Add compensation" });
  await comp.getByLabel("Type").selectOption("sba_packaging");
  await comp.getByLabel("Amount (USD)").fill("5,000");
  await comp.getByRole("button", { name: "Record (projected)" }).click();
  await expect(page.getByRole("cell", { name: /SBA application packaging fee/ }).first()).toBeVisible();
  await form159.getByLabel("SBA lender").fill("Example Community Bank (demo)");
  await form159.getByRole("button", { name: "Generate from ledger" }).click();
  await expect(notice(page, /Form 159 v1 generated from the ledger/)).toBeVisible({ timeout: 15_000 });
  const row = section(page, "SBA Form 159").getByRole("row", { name: /v1/ });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.getByRole("link", { name: "PDF" })).toHaveAttribute("href", new RegExp(`/deals/${DEALS.hotel}/form-159/`));
  await expectAccessibleAndReflows(page, "deal with Form 159");
});

test("a broker records the loan's broker-of-record file and the gate H closing reason clears", async ({ page }) => {
  const gateH = "Record the loan's broker-of-record file (lender, category, note rate, collateral and broker-of-record elements) before closing.";
  await signIn(page, `/deals/${DEALS.seniorLiving}`);
  const stage = section(page, "Stage");
  // Fails closed, and says so once (not a second time in other words).
  await expect(stage.getByText(gateH, { exact: true })).toHaveCount(1);
  const modifications = section(page, "Forbearance, extension and modification");
  await expect(modifications.getByRole("link", { name: "broker-of-record file" })).toBeVisible();

  const bor = section(page, "Broker-of-record file");
  await expect(bor.getByText(gateH, { exact: true })).toBeVisible();
  await bor.getByRole("textbox", { name: /^Lender\b(?! category)/ }).fill("Example Community Bank (demo)");
  await bor.getByLabel("Lender category").selectOption("STATE_BANK");
  await bor.getByLabel("Category evidence").fill("demo://charter/example-bank");
  await bor.getByLabel("Originator on the note").fill("Example Community Bank (demo)");
  await bor.getByLabel("Deed of trust beneficiary").fill("Example Community Bank (demo)");
  await bor.getByRole("textbox", { name: "Loan date", exact: true }).fill("2026-12-15");
  await bor.getByRole("spinbutton", { name: "Note rate (%)", exact: true }).fill("6.25");
  await bor.getByLabel("Fed discount rate (%)").fill("4.5");
  await bor.getByRole("textbox", { name: "APN", exact: true }).fill("001-002-003");
  await bor.getByRole("spinbutton", { name: "Lien position", exact: true }).fill("1");
  await bor.getByRole("combobox", { name: "Corin acts for", exact: true }).selectOption("borrower");
  await bor.getByLabel("Corin compensation (USD)").fill("92500");
  await bor.getByLabel("Negotiation reference").fill("term-sheet-v2");
  await bor.getByRole("textbox", { name: "Negotiation summary", exact: true }).fill("Negotiated rate and IO period");
  await bor.getByLabel("Business-purpose certification on file").check();
  await bor.getByRole("button", { name: "Record broker-of-record file" }).click();
  await expect(notice(page, "Broker-of-record file recorded.")).toBeVisible();

  // Gate H is evaluated now: the evidenced bank is an exempt category, and the missing-file reason is gone.
  await expect(section(page, "Broker-of-record file").getByText("lender exempt", { exact: true })).toBeVisible();
  await expect(section(page, "Stage").getByText(gateH, { exact: true })).toHaveCount(0);
  await expect(section(page, "Stage").getByText("No deal moves to closing without a signed MLDS (RE 882) on file.")).toBeVisible();
  await expect(section(page, "Forbearance, extension and modification").getByRole("button", { name: "Submit for gate H" })).toBeVisible();
  await expectAccessibleAndReflows(page, "deal with broker-of-record file");
});

test("checklist items and conditions move, and a sanctions match puts the deal on hold", async ({ page }) => {
  // Long multi-desk flow (about 17s on an idle machine); give it headroom under parallel load.
  test.slow();
  await signIn(page, "/checklists");
  await page.getByLabel("Deal id").fill(DEALS.memoryCare);
  await page.getByLabel("Program").selectOption("BRIDGE");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(new RegExp(`/checklists/deal\\?id=${DEALS.memoryCare}`));
  await expect(notice(page, "Checklist created.")).toBeVisible();

  // Mark the first item received.
  const item = page.locator('li[id^="item-"]').first();
  const title = (await item.getByRole("heading", { level: 4 }).textContent())?.trim() ?? "";
  await item.getByLabel("Change to").selectOption("submitted");
  await item.getByRole("button", { name: "Update" }).click();
  await expect(notice(page, "Item updated.")).toBeVisible();
  await expect(page.locator('li[id^="item-"]').filter({ has: page.getByRole("heading", { level: 4, name: title }) }).first().getByText("Received", { exact: true })).toBeVisible();

  // A pre-closing condition set by the lender of record.
  await page.getByText("Add a condition").click();
  await page.getByLabel("Condition", { exact: true }).fill("Updated rent roll dated within 30 days of closing");
  await page.getByLabel("Set by", { exact: true }).selectOption("lender");
  await page.getByLabel("Lender of record (if set by lender)").fill("Sample Private Fund (demo)");
  await page.getByRole("button", { name: "Add condition" }).click();
  const condition = page.locator("li").filter({ has: page.getByText("Updated rent roll dated within 30 days of closing", { exact: true }) });
  await expect(condition.getByText("open", { exact: true })).toBeVisible();
  // The broker clears it once the lender of record accepts the document.
  await condition.getByLabel("Change to").selectOption("cleared");
  await condition.getByRole("button", { name: "Update" }).click();
  await expect(page.locator("li").filter({ has: page.getByText("Updated rent roll dated within 30 days of closing", { exact: true }) }).getByText("cleared", { exact: true })).toBeVisible();
  await expectAccessibleAndReflows(page, "checklist desk");

  // A principal whose name is on the (invented) demo sanctions list.
  await addPrincipal(page, { name: "Valley Care Example LLC", kind: "entity", role: "Borrower" });
  await addPrincipal(page, { name: "Blocked Example Person", kind: "individual", role: "Managing member", parent: "Valley Care Example LLC", pct: "100" });
  await page.getByRole("button", { name: "Run screening" }).click();
  await expect(page.getByRole("heading", { name: "On hold", level: 2 })).toBeVisible();
  await expectAccessibleAndReflows(page, "checklist desk on hold");

  // The deal desk shows the OFAC hold and offers only the exit events.
  await page.goto(`${base}/deals/${DEALS.memoryCare}`);
  const banner = page.getByRole("alert").filter({ hasText: "This deal is on hold" });
  await expect(banner).toBeVisible();
  await section(page, "Stage").getByRole("button", { name: "Engagement / fee agreement signed" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /^On hold:/ })).toBeVisible();
  await expect(stageBadge(page, "Intake")).toBeVisible();
  await expectAccessibleAndReflows(page, "deal on hold");
});

test("a construction report order waits for broker approval and the CSLB check runs", async ({ page }) => {
  await signIn(page, "/construction/new");
  await page.getByLabel("Project name").fill("Coastal Townhomes (demo)");
  await page.getByLabel("City").fill("Ventura");
  await page.getByLabel("State").fill("CA");
  await page.getByLabel("Deal id").fill(DEALS.townhomes);
  await page.getByLabel("General contractor").fill("Example Builders Inc (demo)");
  await page.getByLabel("CSLB license number").fill("1000001");
  await expectAccessibleAndReflows(page, "new construction project");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: "Coastal Townhomes (demo)", level: 1 })).toBeVisible();

  const order = page.locator("details").filter({ hasText: "Order from a vendor" }).first();
  await order.getByText("Order from a vendor").click();
  await order.getByRole("textbox", { name: /^Vendor\b(?! email| file)/ }).fill("Example Appraisal Co (demo)");
  await order.getByLabel("Vendor email").fill("orders@appraisal.example");
  await order.getByRole("button", { name: "Send to broker approval" }).click();
  // Nothing is ordered until a broker approves it in the approvals queue.
  const ordered = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Check approval status" }) }).first();
  await expect(ordered.getByText("Waiting for broker approval", { exact: true })).toBeVisible();
  await expect(ordered.getByText("Example Appraisal Co (demo)")).toBeVisible();
  await ordered.getByRole("button", { name: "Check approval status" }).click();
  await expect(ordered.getByRole("status")).toHaveText("Still waiting for a broker");
  await page.goto(`${base}/approvals`);
  await expect(page.getByRole("list", { name: "Requests waiting for a decision" }).getByRole("article", { name: /Example Appraisal Co \(demo\)/ })).toBeVisible();
  await page.goBack();

  await page.getByRole("button", { name: "Check with CSLB" }).click();
  await expect(page.getByText("Example Builders Inc (demo)").first()).toBeVisible();
  await expect(page.getByText("ACTIVE").first()).toBeVisible();
  await expectAccessibleAndReflows(page, "construction project");
});

test("a broker adds a credit box, approves it, and the deal matches it", async ({ page }) => {
  await signIn(page, "/lenders/boxes/new");
  await page.getByLabel("Label").fill("SBA 504 hotels, California (demo)");
  await page.getByLabel("Panel lender").selectOption({ label: "Example Community Bank (demo)" });
  await page.getByRole("group", { name: "Programs" }).getByLabel("SBA 504").check();
  await page.getByRole("textbox", { name: /^States/ }).fill("CA");
  await page.getByLabel("Minimum loan (USD)").fill("1,000,000");
  await page.getByLabel("Maximum loan (USD)").fill("20,000,000");
  await expectAccessibleAndReflows(page, "new credit box");
  await page.getByRole("button", { name: "Create credit box" }).click();
  await expect(page.getByRole("heading", { name: "SBA 504 hotels, California (demo)", level: 1 })).toBeVisible();
  await expect(notice(page, /waiting for broker review/)).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("approved", { exact: true }).first()).toBeVisible();

  await page.goto(`${base}/lenders/deals/${DEALS.hotel}`);
  await expect(page.getByRole("heading", { name: "Harbor Inn (demo)", level: 1 })).toBeVisible();
  const ranked = section(page, "Ranked lenders");
  await expect(ranked.getByRole("checkbox", { name: "Submit to Example Community Bank (demo)" })).toBeVisible();
  await expectAccessibleAndReflows(page, "lender match");

  await page.goto(`${base}/lenders`);
  await expect(page.getByRole("link", { name: "SBA 504 hotels, California (demo)" })).toBeVisible();
  await expectAccessibleAndReflows(page, "credit boxes");

  // The Lender panel's loan-type filter, on each box's linked lender.
  await page.goto(`${base}/lenders?type=sba`);
  await expect(page.getByRole("link", { name: "SBA 504 hotels, California (demo)" })).toBeVisible();
  await page.goto(`${base}/lenders?type=dscr`);
  await expect(page.getByRole("link", { name: "SBA 504 hotels, California (demo)" })).toHaveCount(0);
  await expect(page.getByText("No credit boxes match these filters.")).toBeVisible();
});

const BANK_LENDER = "20000000-0000-4000-8000-000000000001";

test("a broker completes a lender's contact info, contacts and account numbers, which stay masked", async ({ page }) => {
  await signIn(page, "/deals/lenders");
  await page.getByRole("link", { name: "Example Community Bank (demo)", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Example Community Bank (demo)", level: 1 })).toBeVisible();

  // The header verifies appetite and split, and says so next to the contact-info badges.
  await page.getByRole("button", { name: "Appetite and split verified today" }).click();
  await expect(notice(page, "Verification date updated.")).toBeVisible();
  await expect(page.getByText(/^Appetite and split verified [A-Z][a-z]{2} \d/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Verified today", exact: true })).toHaveCount(0);

  const info = section(page, "Contact info");
  await info.getByText("Edit contact info").click();
  // A validation error names the field by its label, takes focus and keeps everything typed.
  await info.getByLabel("Main phone").fill("call me");
  await info.getByLabel("Website").fill("https://bank.example/lending");
  await info.getByRole("button", { name: "Save contact info" }).click();
  const infoError = info.getByRole("alert").filter({ hasText: /^Main phone: Enter a phone number/ });
  await expect(infoError).toBeVisible();
  await expect(infoError).toBeFocused();
  await expect(info.getByLabel("Main phone")).toHaveValue("call me");
  await expect(info.getByLabel("Website")).toHaveValue("https://bank.example/lending");
  await info.getByLabel("Main phone").fill("(310) 555-0142");
  await info.getByRole("button", { name: "Save contact info" }).click();
  await expect(notice(page, "Contact info saved.")).toBeVisible();
  await expect(section(page, "Contact info").locator('a[href="tel:+13105550142"]')).toBeVisible();

  const contacts = section(page, "Contacts");
  const add = contacts.getByRole("form", { name: "Add a contact" });
  await add.getByRole("textbox", { name: "Full name" }).fill("Riley Chen (demo)");
  await add.getByLabel("Role").selectOption({ label: "Underwriter" });
  await add.getByRole("textbox", { name: "Email" }).fill("riley@bank.example");
  await add.getByLabel("Make primary contact").check();
  await add.getByRole("button", { name: "Add contact" }).click();
  await expect(notice(page, "Contact added.")).toBeVisible();
  const riley = section(page, "Contacts").getByRole("row").filter({ hasText: "Riley Chen (demo)" });
  await expect(riley.getByText("Primary", { exact: true })).toBeVisible();
  // Each row's buttons name their contact.
  await expect(riley.getByRole("button", { name: "Verified today: Riley Chen (demo)" })).toBeVisible();
  await expect(riley.getByRole("button", { name: "Mark as left: Riley Chen (demo)" })).toBeVisible();
  // A successful add clears the form for the next contact.
  await expect(add.getByRole("textbox", { name: "Full name" })).toHaveValue("");

  const accounts = section(page, "Account numbers");
  const addAccount = accounts.getByRole("form", { name: "Add an account number" });
  await addAccount.getByRole("combobox", { name: /^Type/ }).selectOption({ label: "Account number at lender" });
  await addAccount.getByRole("textbox", { name: "Label" }).fill("Servicing account");
  await addAccount.getByRole("textbox", { name: "Account number" }).fill("123-45-6789");
  await addAccount.getByRole("button", { name: "Save account number" }).click();
  await expect(addAccount.getByRole("alert")).toHaveText(/^Account number: This looks like a card number or SSN/);
  await expect(addAccount.getByRole("textbox", { name: "Label" })).toHaveValue("Servicing account");
  await addAccount.getByRole("textbox", { name: "Account number" }).fill("SVC-0099887766");
  await addAccount.getByRole("button", { name: "Save account number" }).click();
  await expect(notice(page, "Account number saved.")).toBeVisible();
  await expect(addAccount.getByRole("textbox", { name: "Account number" })).toHaveValue("");
  await expect(section(page, "Account numbers").getByText("7766")).toBeVisible();
  // The broker is not the designated officer: no reveal.
  await expect(page.getByRole("button", { name: /Reveal/ })).toHaveCount(0);

  expect(page.url()).not.toContain("0099887766");
  const html = await (await page.request.get(page.url())).text();
  expect(html).not.toContain("SVC-0099887766");
  expect(html).not.toContain("0099887766");
  expect(html).not.toMatch(/pii1\.\d/);
  await expectAccessibleAndReflows(page, "lender detail");

  await page.goto(`${base}/deals/lenders`);
  const row = section(page, "Panel").getByRole("row").filter({ has: page.getByRole("link", { name: "Example Community Bank (demo)", exact: true }) });
  await expect(row).toContainText("Riley Chen (demo)");
});

test("an administrator reveals an account number, and it is masked again", async ({ page }) => {
  await signIn(page, `/deals/lenders/${BANK_LENDER}`, "admin@corin.test");
  const accounts = section(page, "Account numbers");
  // The live region is there, empty, before the reveal, so filling it is announced.
  const live = accounts.locator("output[aria-live=polite]").first();
  await expect(live).toBeAttached();
  await expect(live).toHaveText("");
  // Keyboard: Reveal moves focus to Hide, Hide moves it back to Reveal.
  await accounts.getByRole("button", { name: "Reveal Broker ID" }).focus();
  await page.keyboard.press("Enter");
  await expect(accounts.getByText("DEMO-BRK-48210937")).toBeVisible();
  await expect(live).toHaveText("DEMO-BRK-48210937");
  await expect(accounts.getByRole("button", { name: "Hide Broker ID" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(accounts.getByText("DEMO-BRK-48210937")).toHaveCount(0);
  await expect(accounts.getByRole("button", { name: "Reveal Broker ID" })).toBeFocused();
  expect(page.url()).not.toContain("DEMO-BRK");

  // At 390px the revealed number is readable without scrolling the table sideways.
  await page.setViewportSize({ width: 390, height: 900 });
  await accounts.getByRole("button", { name: "Reveal Broker ID" }).click();
  const value = accounts.getByText("DEMO-BRK-48210937");
  await expect(value).toBeVisible();
  const region = (await accounts.getByRole("region", { name: "Lender account numbers" }).boundingBox())!;
  const box = (await value.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(region.x + region.width + 0.5);
  await accounts.getByRole("button", { name: "Hide Broker ID" }).click();
  await page.setViewportSize({ width: 1280, height: 720 });
  await expectAccessibleAndReflows(page, "lender detail (admin)");
});

test("a broker filters the lender panel by loan type, and the filtered view is a shareable URL", async ({ page }) => {
  await signIn(page, "/deals/lenders");
  const panel = section(page, "Panel");
  const chips = panel.getByRole("group", { name: "Loan type" });
  const row = (name: string) => panel.getByRole("row").filter({ has: page.getByRole("link", { name, exact: true }) });
  const apply = () => panel.getByRole("button", { name: "Show lenders" }).click();
  for (const n of ["Example Community Bank (demo)", "Sample Private Fund (demo)", "Sample DSCR Lender (demo)"]) await expect(row(n)).toHaveCount(1);
  await expect(row("Sample Private Fund (demo)")).toContainText("Private money");

  // OR within loan types
  await chips.getByRole("checkbox", { name: /^DSCR \(investor rental\)/ }).check();
  await chips.getByRole("checkbox", { name: /^Bridge/ }).check();
  await apply();
  await expect(page).toHaveURL(/[?&]type=bridge&type=dscr/);
  await expect(row("Sample Private Fund (demo)")).toHaveCount(1);
  await expect(row("Sample DSCR Lender (demo)")).toHaveCount(1);
  await expect(row("Example Community Bank (demo)")).toHaveCount(0);
  await expect(panel.getByText(/Showing 1–2 of 2 lenders/)).toBeVisible();

  // AND: no demo lender does both, and the empty state offers a way out
  await panel.getByRole("radio", { name: "All selected types" }).check();
  await apply();
  await expect(panel.getByRole("status").filter({ hasText: "No lenders match these filters." })).toBeVisible();
  await panel.getByRole("link", { name: "Match any selected loan type instead" }).click();
  await expect(row("Sample DSCR Lender (demo)")).toHaveCount(1);

  // The URL is the state
  await page.goto(page.url());
  await expect(chips.getByRole("checkbox", { name: /^Bridge/ })).toBeChecked();
  await expect(chips.getByRole("checkbox", { name: /^Construction/ })).not.toBeChecked();

  // Remove one applied filter
  await panel.getByRole("link", { name: "Remove filter: Bridge" }).click();
  await expect(row("Sample Private Fund (demo)")).toHaveCount(0);
  await expect(chips.getByRole("checkbox", { name: /^Bridge/ })).not.toBeChecked();

  // Active only, search, sort
  await page.goto(`${base}/deals/lenders`);
  await panel.getByLabel("Active lenders only").check();
  await apply();
  await expect(row("Sample DSCR Lender (demo)")).toHaveCount(0);
  await page.goto(`${base}/deals/lenders?q=fund`);
  await expect(row("Sample Private Fund (demo)")).toHaveCount(1);
  await expect(row("Example Community Bank (demo)")).toHaveCount(0);
  await page.goto(`${base}/deals/lenders?sort=added`);
  await expect(panel.getByRole("row").nth(1)).toContainText("Sample DSCR Lender (demo)");

  // A row action keeps the filtered view
  await page.goto(`${base}/deals/lenders?type=construction`);
  await row("Example Community Bank (demo)").getByRole("button", { name: "Verified today" }).click();
  await expect(notice(page, "Verification date updated.")).toBeVisible();
  await expect(page).toHaveURL(/[?&]type=construction/);

  // The URL is the whole state: a filtered link opened fresh shows those rows and ticks, and the form is a GET.
  await page.goto(`${base}/deals/lenders?type=dscr`);
  await expect(row("Sample DSCR Lender (demo)")).toHaveCount(1);
  await expect(row("Sample Private Fund (demo)")).toHaveCount(0);
  await expect(chips.getByRole("checkbox", { name: /^DSCR \(investor rental\)/ })).toBeChecked();
  const form = panel.getByRole("search", { name: "Find lenders" });
  await expect(form).toHaveAttribute("action", "/deals/lenders");
  expect(await form.getAttribute("method")).not.toBe("post");

  // Keyboard: applying filters, or removing one, moves focus to the results summary instead of <body>.
  await page.goto(`${base}/deals/lenders`);
  await chips.getByRole("checkbox", { name: /^Bridge/ }).check();
  await panel.getByRole("button", { name: "Show lenders" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/[?&]type=bridge/);
  await expect(page.locator("#lender-results")).toBeFocused();
  await panel.getByRole("link", { name: "Remove filter: Bridge" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`${base}/deals/lenders`);
  await expect(page.locator("#lender-results")).toBeFocused();

  // Loan amounts: the CRE shorthand applies, and one that cannot be read is said so and kept.
  await page.goto(`${base}/deals/lenders?amount=2.5MM`);
  await expect(panel.getByRole("link", { name: "Remove filter: Fits a $2,500,000.00 loan" })).toBeVisible();
  await page.goto(`${base}/deals/lenders?amount=about%202%20million`);
  await expect(notice(page, "Couldn’t read the loan amount “about 2 million”, so every loan size is shown.")).toBeVisible();
  await expect(panel.getByLabel("Loan amount (USD)")).toHaveValue("about 2 million");

  // At 390px the chips wrap several to a row, a skip link reaches the results, and badges do not break mid-word.
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`${base}/deals/lenders`);
  const chipRows = await chips.locator("label").evaluateAll((labels) => new Set(labels.map((l) => Math.round(l.getBoundingClientRect().top))).size);
  expect(chipRows).toBeLessThanOrEqual(9);
  const badge = row("Sample DSCR Lender (demo)").getByText("No email on file");
  expect((await badge.boundingBox())!.height).toBeLessThan(30);
  await panel.getByRole("link", { name: "Skip to results" }).click();
  await expect(page.locator("#lender-results")).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.goto(`${base}/deals/lenders?type=bridge&type=dscr`);
  await expectAccessibleAndReflows(page, "lender panel filters");
});

test("a broker edits a lender's loan types on its page", async ({ page }) => {
  await signIn(page, "/deals/lenders/20000000-0000-4000-8000-000000000002");
  const types = section(page, "Loan types");
  await types.getByText("Edit loan types").click();
  await types.getByRole("checkbox", { name: "Mezzanine / pref equity" }).check();
  await types.getByRole("button", { name: "Save loan types" }).click();
  await expect(notice(page, "Loan types saved.")).toBeVisible();
  await expect(types.getByRole("list", { name: "Loan types" })).toContainText("Mezz / pref");
  await expect(types.getByText(/^Suggested from/)).toBeVisible();
  await types.getByRole("button", { name: "Use the suggested loan types" }).click();
  await expect(notice(page, "Loan types set from the suggestions.")).toBeVisible();
  await expect(types.getByRole("list", { name: "Loan types" })).not.toContainText("Mezz / pref");
  await expectAccessibleAndReflows(page, "lender loan types");
});

test("a principal opens a portal link and saves their profile", async ({ page, browser }) => {
  await signIn(page, "/checklists");
  await page.getByLabel("Deal id").fill(DEALS.seniorLiving);
  await page.getByLabel("Program").selectOption("HUD_232_223F");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(notice(page, "Checklist created.")).toBeVisible();
  await addPrincipal(page, { name: "Sunrise Care Example LLC", kind: "entity", role: "Borrower" });
  await addPrincipal(page, { name: "Pat Example", kind: "individual", role: "Managing member", parent: "Sunrise Care Example LLC", pct: "100", email: "pat@borrower.example" });

  await page.locator("#inv-principal").selectOption({ label: "Pat Example (pat@borrower.example)" });
  await page.locator("#inv-email").fill("pat@borrower.example");
  await page.getByRole("button", { name: "Create link" }).click();
  const link = page.getByLabel("Portal link (single use)");
  await expect(link).toBeVisible();
  const url = new URL(await link.inputValue());

  // The borrower opens the link in their own browser.
  const borrower = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const portal = await borrower.newPage();
  await portal.goto(`${base}${url.pathname}${url.search}`);
  await portal.getByRole("button", { name: /continue to the portal/i }).click();
  await expect(portal).toHaveURL(`${base}/portal`);
  await expect(portal.getByRole("heading", { level: 1 })).toBeVisible();
  await expectAccessibleAndReflows(portal, "portal home");

  await portal.goto(`${base}/portal/profile`);
  const contact = portal.getByRole("region", { name: "Contact and residence" });
  await contact.getByLabel("Citizenship (required)").selectOption("us_citizen");
  await contact.getByLabel("Home address (required)").fill("1 Example Lane, Sacramento, CA 95814");
  await contact.getByRole("button", { name: "Save" }).click();
  await expect(contact.getByRole("status")).toHaveText("Saved.");
  await expectAccessibleAndReflows(portal, "portal profile");

  // The saved address survives a reload.
  await portal.reload();
  await expect(portal.getByRole("region", { name: "Contact and residence" }).getByLabel("Home address (required)")).toHaveValue("1 Example Lane, Sacramento, CA 95814");
  await borrower.close();
});

test("staff file unmatched inbound mail to a deal, which sends its attachments to the vault, and dismiss the rest", async ({ page }) => {
  await signIn(page, "/documents/mail");
  const queue = page.getByRole("list", { name: "Messages waiting for review" });
  const docs = queue.getByRole("article", { name: "T-12 and rent roll for the Harbor Inn" });
  const deals = queue.getByRole("article", { name: "Re: refinance question" });
  await expect(docs).toBeVisible();
  await expect(docs.getByText("No matching deal or lead")).toBeVisible();
  await expect(docs.getByText("held in quarantine")).toHaveCount(2);
  await expect(deals.getByText("Matched only through a CC address")).toBeVisible();
  await expectAccessibleAndReflows(page, "/documents/mail");

  await docs.getByLabel("Deal reference, deal ID or lead ID").fill("CC-10000000");
  await docs.getByRole("button", { name: "File message" }).click();
  await expect(notice(page, "2 attachments were added to the vault")).toBeVisible();
  await expect(queue.getByRole("article", { name: "T-12 and rent roll for the Harbor Inn" })).toHaveCount(0);

  await deals.getByRole("button", { name: "Dismiss" }).click();
  await expect(notice(page, "Message dismissed.")).toBeVisible();
  await expect(page.getByText("Nothing is waiting for review.")).toBeVisible();
});
