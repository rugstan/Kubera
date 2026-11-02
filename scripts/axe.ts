// Accessibility gate: runs axe-core (WCAG 2.0/2.1/2.2 A and AA rules) against
// the production build in headless Chromium, plus keyboard/behaviour checks for
// the tabs, ticker and skip link. Exits non-zero on any serious or critical
// violation or failed behaviour check, and records the run in
// docs/a11y/axe-results.md.
//
// Usage:
//   npm run build && npm run a11y            # starts `next start -p 4102` itself
//   AXE_BASE_URL=http://localhost:3999 npm run a11y   # use a server you started
//
// Playwright is resolved from the project, or from the global install that the
// build image ships; Chromium is the preinstalled one (no `playwright install`).

import { spawn, execSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { totp } from "../lib/auth/totp.ts";

// ---- minimal structural types so this file type-checks without playwright ----
type Locator = {
  click(opts?: { timeout?: number }): Promise<void>;
  press(key: string): Promise<void>;
  focus(): Promise<void>;
  count(): Promise<number>;
  first(): Locator;
  last(): Locator;
  isVisible(): Promise<boolean>;
  getAttribute(name: string): Promise<string | null>;
  boundingBox(): Promise<{ width: number; height: number } | null>;
  waitFor(opts?: { state?: string; timeout?: number }): Promise<void>;
  fill(value: string): Promise<void>;
  textContent(): Promise<string | null>;
};
type Page = {
  goto(url: string, opts?: { waitUntil?: string }): Promise<unknown>;
  addScriptTag(opts: { content: string }): Promise<unknown>;
  evaluate<T>(fn: string | ((arg: never) => T), arg?: unknown): Promise<T>;
  locator(sel: string): Locator;
  getByRole(role: string, opts?: { name?: string | RegExp }): Locator;
  getByLabel(text: string | RegExp): Locator;
  getByTestId(id: string): Locator;
  waitForURL(url: string | RegExp, opts?: { timeout?: number }): Promise<void>;
  keyboard: { press(key: string): Promise<void>; type(text: string): Promise<void> };
  waitForTimeout(ms: number): Promise<void>;
  setViewportSize(s: { width: number; height: number }): Promise<void>;
  route(url: string | RegExp, handler: (route: Route) => unknown): Promise<void>;
  close(): Promise<void>;
};
type Route = { request(): { method(): string }; fulfill(o: { status: number; contentType: string; body: string }): Promise<void>; fallback(): Promise<void> };
type Context = { newPage(): Promise<Page>; route(url: string | RegExp, handler: (route: Route) => unknown): Promise<void>; close(): Promise<void> };
type Browser = { newContext(opts?: Record<string, unknown>): Promise<Context>; close(): Promise<void> };
type Playwright = { chromium: { launch(opts?: Record<string, unknown>): Promise<Browser> } };

type AxeNode = { target: string[]; failureSummary?: string; html: string };
type AxeViolation = { id: string; impact: "minor" | "moderate" | "serious" | "critical" | null; help: string; helpUrl: string; nodes: AxeNode[] };
type AxeResults = { violations: AxeViolation[]; passes: unknown[]; incomplete: unknown[] };

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = 4102;
const BASE = process.env.AXE_BASE_URL ?? `http://localhost:${PORT}`;
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
/** Every page scanned at desktop and mobile widths, legal pages included. */
const SCAN_ROUTES = [
  "/",
  "/express",
  "/rates",
  "/login",
  "/portal",
  "/partners",
  "/privacy",
  "/terms",
  "/licensing",
  "/accessibility",
  "/about",
  "/team",
  "/contact",
  "/track-record",
  "/structures",
  "/structures/memory-care-bridge-to-hud",
  "/financing",
  "/financing/senior-living",
  "/financing/construction",
  "/financing/hard-money",
  "/financing/hud-232",
] as const;
/** The demo broker in lib/auth/demo.ts (fake identity provider only). */
const DEMO_BROKER_EMAIL = "broker@kubera.test";
const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

function loadPlaywright(): Playwright {
  const req = createRequire(import.meta.url);
  const candidates = ["playwright", "playwright-core"];
  for (const name of candidates) {
    try {
      return req(name) as Playwright;
    } catch {
      // try next
    }
  }
  try {
    const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
    return createRequire(path.join(globalRoot, "x.js"))("playwright") as Playwright;
  } catch {
    throw new Error("Playwright not found. Install @playwright/test or a global playwright.");
  }
}

async function waitForServer(url: string, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Server did not start at ${url}`);
}

/** Navigate and give React time to hydrate (the app streams; networkidle never settles behind some proxies). */
async function go(page: Page, url: string) {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(1_200);
}

type Scan = { name: string; violations: AxeViolation[] };
type Check = { name: string; ok: boolean; detail?: string };

async function scan(page: Page, axeSource: string, name: string): Promise<Scan> {
  await page.addScriptTag({ content: axeSource });
  const results = await page.evaluate<AxeResults>(
    `axe.run(document, { runOnly: { type: "tag", values: ${JSON.stringify(AXE_TAGS)} }, resultTypes: ["violations"] })`,
  );
  return { name, violations: results.violations };
}

async function main() {
  const axePath = path.join(ROOT, "node_modules/axe-core/axe.min.js");
  if (!existsSync(axePath)) throw new Error("node_modules/axe-core not found");
  const axeSource = readFileSync(axePath, "utf8");

  let server: ChildProcess | null = null;
  if (!process.env.AXE_BASE_URL) {
    const busy = await fetch(`${BASE}/`).then(
      () => true,
      () => false,
    );
    if (busy) throw new Error(`Port ${PORT} is already serving something; stop it or set AXE_BASE_URL.`);
    server = spawn(path.join(ROOT, "node_modules/.bin/next"), ["start", "-p", String(PORT)], { cwd: ROOT, stdio: "ignore", detached: true });
  }
  const stop = () => {
    // `next start` forks next-server; signal the whole process group so no orphan keeps the port.
    if (server?.pid && !server.killed) {
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch {
        server.kill("SIGTERM");
      }
    }
  };
  process.on("exit", stop);
  process.on("SIGINT", () => {
    stop();
    process.exit(130);
  });

  const scans: Scan[] = [];
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

  try {
    await waitForServer(`${BASE}/`);
    const pw = loadPlaywright();
    const browser = await pw.chromium.launch();

    // ---- axe scans -----------------------------------------------------------
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();

    for (const route of SCAN_ROUTES) {
      await go(page, `${BASE}${route}`);
      scans.push(await scan(page, axeSource, `${route} (desktop)`));
    }

    // Mobile layout.
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mpage = await mobile.newPage();
    for (const route of SCAN_ROUTES) {
      await go(mpage, `${BASE}${route}`);
      scans.push(await scan(mpage, axeSource, `${route} (mobile 390px)`));
    }
    await mobile.close();

    // Staff pipeline. With the fake identity provider (AUTH_PROVIDER=fake, as
    // the e2e server runs) the scan signs in as the demo broker with an email
    // code and TOTP; otherwise /pipeline is the sign-in redirect.
    const fake = (await (await fetch(`${BASE}/login`)).text()).includes('data-auth-provider="fake"');
    const staff = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const spage = await staff.newPage();
    if (fake) {
      await go(spage, `${BASE}/pipeline`);
      await spage.getByLabel("Work email").fill(DEMO_BROKER_EMAIL);
      await spage.getByRole("button", { name: "Email me a code" }).click();
      await spage.waitForURL(/\/login\/verify$/);
      const code = ((await spage.getByTestId("fake-code").textContent()) ?? "").trim();
      await spage.getByLabel("6-digit code").fill(code);
      await spage.getByRole("button", { name: "Sign in" }).click();
      await spage.waitForURL(/\/mfa\?next=/);
      await spage.getByLabel("Authenticator code").fill(totp(DEMO_TOTP_SECRET));
      await spage.getByRole("button", { name: "Verify" }).click();
      await spage.waitForURL(/\/pipeline$/);
      await spage.getByRole("table", { name: /Deal pipeline/ }).waitFor({ state: "visible" });
    }
    const pipelineLabel = fake ? "/pipeline (signed in)" : "/pipeline (signed out: sign-in page)";
    await go(spage, `${BASE}/pipeline`);
    scans.push(await scan(spage, axeSource, `${pipelineLabel} (desktop)`));
    await spage.setViewportSize({ width: 390, height: 844 });
    await go(spage, `${BASE}/pipeline`);
    scans.push(await scan(spage, axeSource, `${pipelineLabel} (mobile 390px)`));
    await staff.close();

    // Each sizer tab, each partner tab.
    await go(page, `${BASE}/`);
    for (const label of ["Hotels", "Multifamily", "Construction", "Hard money"]) {
      await page.getByRole("tab", { name: label }).click();
      await page.waitForTimeout(900); // let entry animations finish; axe samples live colours
      scans.push(await scan(page, axeSource, `/ sizer tab: ${label}`));
    }
    // Ineligible quote cards. The default inputs fit every program, so turn on
    // "Non-recourse only", which rules out SBA 504, and scan the "Not a fit" card.
    await go(page, `${BASE}/`);
    await page.getByRole("switch", { name: /^Non-recourse only/ }).click();
    await page.waitForTimeout(900);
    check("sizer: non-recourse only shows a Not a fit card", (await page.locator('#sizer article:has-text("Not a fit")').count()) > 0);
    scans.push(await scan(page, axeSource, "/ sizer: ineligible quote card"));
    await go(page, `${BASE}/partners`);
    for (const label of [/Referral brokers/i, /Operators/i, /Third-party vendors/i]) {
      await page.getByRole("tab", { name: label }).click();
      await page.waitForTimeout(900);
      scans.push(await scan(page, axeSource, `/partners tab: ${String(label)}`));
    }

    // ---- behaviour checks ----------------------------------------------------
    // The public site has no assistant: no entry points, and the old shortcut opens nothing.
    await go(page, `${BASE}/`);
    check("no assistant entry points on the page", (await page.locator("[data-ask-entry], [data-ask-floating]").count()) === 0);
    await page.keyboard.press("Control+k");
    await page.waitForTimeout(300);
    check("Ctrl+K opens no dialog", (await page.getByRole("dialog").count()) === 0);

    // Tabs: arrow keys move selection; roles wired.
    await go(page, `${BASE}/`);
    const first = page.getByRole("tab", { name: "Senior living" });
    await first.focus();
    await page.waitForTimeout(150);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(150);
    check("sizer tabs: ArrowRight selects the next tab", (await page.getByRole("tab", { name: "Hotels" }).getAttribute("aria-selected")) === "true");
    await page.keyboard.press("End");
    await page.waitForTimeout(150);
    const lastSizerTab = page.locator('#sizer [role="tablist"] [role="tab"]').last();
    check("sizer tabs: End selects the last tab", (await lastSizerTab.getAttribute("aria-selected")) === "true");
    check("sizer tabs: tabpanel is present and labelled", (await page.locator('[role="tabpanel"][aria-labelledby]').count()) === 1);
    await go(page, `${BASE}/partners`);
    await page.getByRole("tab", { name: /Wholesale lenders/i }).focus();
    await page.waitForTimeout(150);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(300);
    check("partner tabs: ArrowRight selects the next tab", (await page.getByRole("tab", { name: /Referral brokers/i }).getAttribute("aria-selected")) === "true");
    await go(page, `${BASE}/partners#operator`);
    await page.waitForTimeout(300);
    check("partner tabs: #operator deep link selects Operators", (await page.getByRole("tab", { name: /Operators/ }).getAttribute("aria-selected")) === "true");

    // Ticker.
    await go(page, `${BASE}/`);
    const pause = page.getByRole("button", { name: "Pause rates ticker" });
    if ((await pause.count()) > 0) {
      await pause.click();
      check("ticker: pause button stops the animation", (await page.evaluate<string>("getComputedStyle(document.querySelector('.ticker-track')).animationPlayState")) === "paused");
      check("ticker: button flips to play", (await page.getByRole("button", { name: "Play rates ticker" }).count()) === 1);
      check("ticker: duplicate set is aria-hidden", (await page.locator(".ticker-dup[aria-hidden]").count()) === 1);
    } else {
      check("ticker: pause button present", false, "rate ticker not rendered");
    }

    // Skip link.
    await go(page, `${BASE}/`);
    await page.keyboard.press("Tab");
    check("skip link: is the first tab stop", (await page.evaluate<string>("document.activeElement?.textContent ?? ''")).includes("Skip to main content"));
    await page.keyboard.press("Enter");
    check("skip link: moves focus into <main>", (await page.evaluate<string>("document.activeElement?.tagName ?? ''")) === "MAIN");

    // SSR content visible: no opacity:0 in the server HTML for reveal wrappers.
    const html = await (await fetch(`${BASE}/`)).text();
    check("SSR HTML: reveal wrappers are not hidden (no inline opacity:0)", !/class="reveal[^"]*"[^>]*style="[^"]*opacity:\s*0/.test(html));
    check("SSR HTML has reveal wrappers", html.includes('class="reveal'));
    await ctx.close();

    // Reduced motion: ticker scrolls instead of animating; reveal never animates.
    const rm = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    const rpage = await rm.newPage();
    await go(rpage, `${BASE}/`);
    check("reduced motion: ticker animation off", (await rpage.evaluate<string>("getComputedStyle(document.querySelector('.ticker-track')).animationName")) === "none");
    check("reduced motion: ticker row is scrollable", (await rpage.evaluate<string>("getComputedStyle(document.querySelector('.ticker-scroller')).overflowX")) === "auto");
    check("reduced motion: duplicate set removed", (await rpage.evaluate<string>("getComputedStyle(document.querySelector('.ticker-dup')).display")) === "none");
    check("reduced motion: reveal wrappers have no animation", (await rpage.evaluate<string>("getComputedStyle(document.querySelector('.reveal')).animationName")) === "none");
    scans.push(await scan(rpage, axeSource, "/ (prefers-reduced-motion)"));
    await rm.close();
    await browser.close();
  } finally {
    stop();
  }

  // ---- report ----------------------------------------------------------------
  const blocking = scans.flatMap((s) => s.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => ({ scan: s.name, v })));
  const minor = scans.flatMap((s) => s.violations.filter((v) => v.impact !== "serious" && v.impact !== "critical").map((v) => ({ scan: s.name, v })));
  const failedChecks = checks.filter((c) => !c.ok);

  const lines: string[] = [];
  lines.push("# Accessibility results", "");
  lines.push(`Generated by \`npm run a11y\` (scripts/axe.ts) on ${new Date().toISOString().slice(0, 10)} against the production build.`);
  lines.push(`Rules: axe-core ${JSON.parse(readFileSync(path.join(ROOT, "node_modules/axe-core/package.json"), "utf8")).version}, tags ${AXE_TAGS.join(", ")}.`, "");
  lines.push("## axe-core scans", "", "| Scan | Serious/critical | Moderate/minor |", "| --- | --- | --- |");
  for (const s of scans) {
    const b = s.violations.filter((v) => v.impact === "serious" || v.impact === "critical").length;
    lines.push(`| ${s.name} | ${b} | ${s.violations.length - b} |`);
  }
  lines.push("", `**Serious or critical violations: ${blocking.length}**`, "");
  if (blocking.length || minor.length) {
    lines.push("## Violations", "");
    for (const { scan: sc, v } of [...blocking, ...minor]) {
      lines.push(`- [${v.impact}] ${sc}: \`${v.id}\` ${v.help}`);
      for (const n of v.nodes.slice(0, 3)) lines.push(`  - \`${n.target.join(" ")}\``);
    }
    lines.push("");
  }
  lines.push("## Behaviour checks", "", "| Check | Result |", "| --- | --- |");
  for (const c of checks) lines.push(`| ${c.name} | ${c.ok ? "pass" : `FAIL${c.detail ? ` (${c.detail})` : ""}`} |`);
  lines.push("");
  mkdirSync(path.join(ROOT, "docs/a11y"), { recursive: true });
  writeFileSync(path.join(ROOT, "docs/a11y/axe-results.md"), lines.join("\n"));

  console.log(lines.join("\n"));
  if (blocking.length || failedChecks.length) {
    console.error(`\nFAILED: ${blocking.length} serious/critical violation(s), ${failedChecks.length} failed check(s)`);
    process.exit(1);
  }
  console.log("\nOK: 0 serious/critical violations; all behaviour checks passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
