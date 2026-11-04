import { expect, type Page } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

/** A qualifier response that stores nothing (no lead id, so no upload step). */
export const QUALIFIER_RESULT = {
  leadId: null,
  uploadToken: null,
  result: {
    program: "HUD 232/223(f) Refinance",
    secondary: "SBA 504",
    flag: "OPTIMAL_FOR_HUD_232",
    indicativeLoan: 3_000_000,
    indicativeRatePct: 6.15,
    term: "35 years",
    recourse: "Non-recourse",
    closeTimeline: "6–9 months",
    callScheduled: false,
    qualified: true,
  },
};

/** Clicks an option styled as a button (a radio or checkbox inside a label) by its visible text. */
export async function chooseOption(page: Page, text: string | RegExp) {
  await page.locator("label").filter({ hasText: text }).first().click();
}

export async function continueStep(page: Page) {
  await page.getByRole("button", { name: /^continue$/i }).click();
}

/** Step 1: pick the asset. Lands on step 2 ("The numbers"). */
export async function pickAsset(page: Page, name: RegExp = /^assisted living$/i) {
  await page.getByRole("button", { name }).click();
  await expect(page.getByRole("heading", { name: /the numbers/i })).toBeFocused();
}

/** Step 2: the numbers for a senior asset. Ends on step 3. */
export async function fillDeal(page: Page) {
  await chooseOption(page, /^refinance$/i);
  await page.getByLabel(/loan amount requested/i).fill("3000000");
  await page.getByLabel(/trailing 12-month noi/i).fill("400000");
  await page.getByLabel(/licensed beds/i).fill("60");
  await page.getByLabel(/^occupancy/i).fill("88");
  await continueStep(page);
  await expect(page.getByRole("heading", { name: /timing and preferences/i })).toBeFocused();
}

/** Step 3: timing. Ends on step 4. */
export async function fillTerms(page: Page) {
  await page.getByLabel(/when do you need to close/i).selectOption("90");
  await chooseOption(page, /^yes$/i);
  await continueStep(page);
  await expect(page.getByRole("heading", { name: /where should an advisor reach you/i })).toBeFocused();
}

export async function fillContact(page: Page, opts: { phone?: string } = {}) {
  await page.getByLabel(/first name/i).fill("Pat");
  await page.getByLabel(/last name/i).fill("Lee");
  await page.getByLabel(/^email/i).fill("pat.lee@example.com");
  if (opts.phone) await page.getByLabel(/mobile phone/i).fill(opts.phone);
}

export async function fillQualifierThroughContact(page: Page, opts: { phone?: string } = {}) {
  await pickAsset(page);
  await fillDeal(page);
  await fillTerms(page);
  await fillContact(page, opts);
}

/** Runs axe-core against the page and returns the serious and critical violations. */
export async function seriousViolations(page: Page, context?: string) {
  // axe measures contrast from computed colors, so text caught mid-fade (tab
  // panel entrance, hydration) reads as low contrast under a loaded parallel run.
  // Turn motion off, then wait until nothing is animating and the active tab
  // panel, with every ancestor, is fully opaque.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(() => {
    if (document.getAnimations().some((a) => a.playState === "running")) return false;
    const panel = document.querySelector('[role="tabpanel"]:not([hidden])');
    for (let el: Element | null = panel; el; el = el.parentElement) {
      if (Number(getComputedStyle(el).opacity) < 1) return false;
    }
    return true;
  });
  await page.addScriptTag({ path: path.resolve(import.meta.dirname, "../node_modules/axe-core/axe.min.js") });
  const results = await page.evaluate(
    async ({ context }) => {
      const axe = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: { id: string; impact: string | null; help: string; nodes: { target: unknown[]; html: string }[] }[] }> } }).axe;
      return axe.run(context ?? document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } });
    },
    { context },
  );
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => ({ target: n.target, html: n.html.slice(0, 160) })) }));
}

/** Saves a screenshot to coverage/e2e/screenshots, and to e2e/screenshots too when E2E_SAVE_SCREENSHOTS=1. */
export async function shot(page: Page, name: string, opts: { fullPage?: boolean } = {}) {
  const dirs = [path.resolve(import.meta.dirname, "../coverage/e2e/screenshots")];
  if (process.env.E2E_SAVE_SCREENSHOTS === "1") dirs.push(path.resolve(import.meta.dirname, "screenshots"));
  for (const dir of dirs) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: opts.fullPage ?? true });
  }
}
