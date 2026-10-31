// Accessibility gate: runs axe-core (WCAG 2.0/2.1/2.2 A and AA rules) against
// the production build in headless Chromium, plus keyboard/behaviour checks for
// the command bar, tabs and ticker. Exits non-zero on any serious or critical
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

// ---- minimal structural types so this file type-checks without playwright ----
type Locator = {
  click(opts?: { timeout?: number }): Promise<void>;
  press(key: string): Promise<void>;
  focus(): Promise<void>;
  count(): Promise<number>;
  first(): Locator;
  isVisible(): Promise<boolean>;
  getAttribute(name: string): Promise<string | null>;
  boundingBox(): Promise<{ width: number; height: number } | null>;
  waitFor(opts?: { state?: string; timeout?: number }): Promise<void>;
};
type Page = {
  goto(url: string, opts?: { waitUntil?: string }): Promise<unknown>;
  addScriptTag(opts: { content: string }): Promise<unknown>;
  evaluate<T>(fn: string | ((arg: never) => T), arg?: unknown): Promise<T>;
  locator(sel: string): Locator;
  getByRole(role: string, opts?: { name?: string | RegExp }): Locator;
  keyboard: { press(key: string): Promise<void>; type(text: string): Promise<void> };
  waitForTimeout(ms: number): Promise<void>;
  setViewportSize(s: { width: number; height: number }): Promise<void>;
  route(url: string | RegExp, handler: (route: Route) => unknown): Promise<void>;
  close(): Promise<void>;
};
type Route = { request(): { method(): string }; fulfill(o: { status: number; contentType: string; body: string }): Promise<void>; fallback(): Promise<void> };
type Context = { newPage(): Promise<Page>; close(): Promise<void> };
type Browser = { newContext(opts?: Record<string, unknown>): Promise<Context>; close(): Promise<void> };
type Playwright = { chromium: { launch(opts?: Record<string, unknown>): Promise<Browser> } };

type AxeNode = { target: string[]; failureSummary?: string; html: string };
type AxeViolation = { id: string; impact: "minor" | "moderate" | "serious" | "critical" | null; help: string; helpUrl: string; nodes: AxeNode[] };
type AxeResults = { violations: AxeViolation[]; passes: unknown[]; incomplete: unknown[] };

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = 4102;
const BASE = process.env.AXE_BASE_URL ?? `http://localhost:${PORT}`;
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

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

    for (const route of ["/", "/express", "/partners"]) {
      await go(page, `${BASE}${route}`);
      scans.push(await scan(page, axeSource, `${route} (desktop)`));
    }

    // Mobile layout.
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mpage = await mobile.newPage();
    for (const route of ["/", "/express", "/partners"]) {
      await go(mpage, `${BASE}${route}`);
      scans.push(await scan(mpage, axeSource, `${route} (mobile 390px)`));
    }
    await mobile.close();

    // Each sizer tab, each partner tab.
    await go(page, `${BASE}/`);
    for (const label of ["Hospitality & Hotels", "Multifamily & CRE"]) {
      await page.getByRole("tab", { name: label }).click();
      await page.waitForTimeout(900); // let entry animations finish; axe samples live colours
      scans.push(await scan(page, axeSource, `/ sizer tab: ${label}`));
    }
    await go(page, `${BASE}/partners`);
    for (const label of [/Referral Brokers/, /Operators/, /Third-Party Vendors/]) {
      await page.getByRole("tab", { name: label }).click();
      await page.waitForTimeout(900);
      scans.push(await scan(page, axeSource, `/partners tab: ${String(label)}`));
    }

    // Command bar open (needs the ask API treated as available).
    await go(page, `${BASE}/`);
    await page.keyboard.press("Control+k");
    await page.getByRole("dialog").waitFor({ state: "visible" });
    scans.push(await scan(page, axeSource, "/ with command bar open"));
    await page.keyboard.press("Escape");

    // ---- behaviour checks ----------------------------------------------------
    // Command bar: focus trap, close button, focus return, Escape.
    await go(page, `${BASE}/`);
    await page.getByRole("button", { name: /^Ask Kubera AI/ }).first().focus();
    await page.keyboard.press("Control+k");
    await page.getByRole("dialog").waitFor({ state: "visible" });
    check("command bar: dialog is modal", (await page.getByRole("dialog").getAttribute("aria-modal")) !== "false");
    check("command bar: input focused on open", (await page.evaluate<string>("document.activeElement?.getAttribute('aria-label') ?? ''")) === "Your question");
    await page.waitForTimeout(500); // dialog scale-in
    const closeBox = await page.getByRole("button", { name: "Close Ask Kubera AI" }).boundingBox();
    check("command bar: close button is at least 44x44", !!closeBox && closeBox.width >= 44 && closeBox.height >= 44, closeBox ? `${closeBox.width}x${closeBox.height}` : "missing");
    check("command bar: conversation is an aria-live polite log", (await page.locator('[role="log"][aria-live="polite"]').count()) === 1);
    check("command bar: page behind is inert", (await page.evaluate<boolean>("document.querySelector('main')?.closest('[inert]') !== null")) === true);
    for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
    check("command bar: focus stays trapped after 12 Tab presses", (await page.evaluate<boolean>("!!document.activeElement?.closest('[role=dialog]')")) === true);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    check("command bar: Escape closes", (await page.getByRole("dialog").count()) === 0);
    check("command bar: focus returns to the opener", (await page.evaluate<string>("document.activeElement?.textContent ?? ''")).includes("Ask Kubera AI"));

    // Command bar: error states are distinct and offer the advisor fallback.
    for (const [status, kind] of [[503, "unavailable"], [429, "rate_limited"], [500, "error"]] as const) {
      const p = await ctx.newPage();
      await p.route(/\/api\/ask$/, (route) =>
        route.request().method() === "POST" ? route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ error: "x" }) }) : route.fallback(),
      );
      await go(p, `${BASE}/`);
      await p.keyboard.press("Control+k");
      await p.getByRole("dialog").waitFor({ state: "visible" });
      await p.keyboard.type("What is HUD 232?");
      await p.keyboard.press("Enter");
      await p.locator(`[data-ask-error="${kind}"]`).waitFor({ timeout: 5_000 });
      const hasFallback = (await p.getByRole("link", { name: "Talk to an advisor" }).count()) > 0;
      check(`command bar: ${status} shows "${kind}" state with advisor fallback`, hasFallback);
      if (status === 503) {
        await p.keyboard.press("Escape");
        await p.waitForTimeout(250);
        check("AI entry points marked data-ask-entry hide after a 503", (await p.locator("[data-ask-entry]:visible").count()) === 0);
      }
      await p.close();
    }

    // Probe-driven hiding: the status probe reports 503 before any question is asked.
    const probed = await ctx.newPage();
    await probed.route(/\/api\/ask$/, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "not configured" }) }));
    await go(probed, `${BASE}/`);
    await probed.waitForTimeout(300);
    check("floating Ask button hidden when /api/ask reports 503", (await probed.locator("button[data-ask-floating]").count()) === 0 || !(await probed.locator("button[data-ask-floating]").first().isVisible()));
    await probed.close();

    // Floating button routes + desktop reveal.
    await go(page, `${BASE}/express`);
    check("floating Ask button absent on /express", (await page.locator("button[data-ask-floating]").count()) === 0);
    await go(page, `${BASE}/partners`);
    check("floating Ask button absent on /partners", (await page.locator("button[data-ask-floating]").count()) === 0);
    await go(page, `${BASE}/`);
    const floating = page.locator("button[data-ask-floating]").first();
    check("floating Ask button hidden on desktop at top of page", !(await floating.isVisible()));
    await page.evaluate("window.scrollTo(0, 1400)");
    await page.waitForTimeout(250);
    check("floating Ask button shown on desktop after scrolling", await floating.isVisible());
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate("window.scrollTo(0, 0)");
    await page.waitForTimeout(250);
    check("floating Ask button visible on mobile at top of page", await floating.isVisible());
    await page.setViewportSize({ width: 1280, height: 900 });

    // Tabs: arrow keys move selection; roles wired.
    await go(page, `${BASE}/`);
    const first = page.getByRole("tab", { name: "Senior Living & Care" });
    await first.focus();
    await page.waitForTimeout(150);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(150);
    check("sizer tabs: ArrowRight selects the next tab", (await page.getByRole("tab", { name: "Hospitality & Hotels" }).getAttribute("aria-selected")) === "true");
    await page.keyboard.press("End");
    await page.waitForTimeout(150);
    check("sizer tabs: End selects the last tab", (await page.getByRole("tab", { name: "Multifamily & CRE" }).getAttribute("aria-selected")) === "true");
    check("sizer tabs: tabpanel is present and labelled", (await page.locator('[role="tabpanel"][aria-labelledby]').count()) === 1);
    await go(page, `${BASE}/partners`);
    await page.getByRole("tab", { name: /Wholesale Lenders/ }).focus();
    await page.waitForTimeout(150);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(300);
    check("partner tabs: ArrowRight selects the next tab", (await page.getByRole("tab", { name: /Referral Brokers/ }).getAttribute("aria-selected")) === "true");
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
