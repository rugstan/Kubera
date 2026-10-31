import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import { gotoHydrated } from "./helpers";

const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
type Violation = { id: string; impact: string | null; nodes: { target: string[] }[] };

/** Serious or critical axe violations inside the sizer section. */
async function sizerViolations(page: Page): Promise<string[]> {
  await page.addScriptTag({ path: axePath });
  const violations = await page.evaluate<Violation[], string[]>(
    async (tags) =>
      (await (window as unknown as { axe: { run: (ctx: Element | null, opts: unknown) => Promise<{ violations: Violation[] }> } }).axe.run(document.querySelector("#sizer"), { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] })).violations,
    AXE_TAGS,
  );
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

// The hard money and construction tabs (WS-X) render quotes from the shared
// sizing library and react to input changes.

test.describe("sizer: hard money and construction tabs", () => {
  test("hard money tab quotes a fix-and-flip loan with its exit test", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await gotoHydrated(page, "/");
    const sizer = page.locator("#sizer");
    const tab = sizer.getByRole("tab", { name: /hard money/i });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");

    const card = sizer.getByRole("article", { name: /hard money \(fix-and-flip\) quote/i });
    await expect(card).toBeVisible();
    await expect(card.getByText("Sale exit")).toBeVisible();
    await expect(card.getByText(/the private lender funds at closing and is the lender of record/i)).toBeVisible();

    // Switching to a bridge brings in the refinance exit inputs.
    await sizer.getByRole("button", { name: "Bridge / hold" }).click();
    await expect(sizer.getByRole("article", { name: /hard money bridge quote/i })).toBeVisible();
    await expect(sizer.getByLabel("Gross monthly rent")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("construction tab shows three lender channels with a capital stack", async ({ page }) => {
    await gotoHydrated(page, "/");
    const sizer = page.locator("#sizer");
    await sizer.getByRole("tab", { name: /construction/i }).click();

    for (const name of [/bank construction loan quote/i, /debt fund construction quote/i, /private construction quote/i]) {
      await expect(sizer.getByRole("article", { name })).toBeVisible();
    }
    const bank = sizer.getByRole("article", { name: /bank construction loan quote/i });
    await expect(bank.getByRole("region", { name: "Capital stack" })).toBeVisible();
    await expect(bank.getByText(/take-out test/i)).toBeVisible();
  });

  test("tabs stay keyboard reachable with arrow keys across all five", async ({ page }) => {
    await gotoHydrated(page, "/");
    const tabs = page.locator("#sizer").getByRole("tablist").first().getByRole("tab");
    await expect(tabs).toHaveCount(5);
    await tabs.first().focus();
    await expect(tabs.first()).toBeFocused();
    for (let i = 1; i < 5; i++) {
      await page.keyboard.press("ArrowRight");
      await expect(tabs.nth(i)).toBeFocused();
      await expect(tabs.nth(i)).toHaveAttribute("aria-selected", "true");
    }
  });

  for (const width of [1280, 390]) {
    test(`multifamily, hard money and construction tabs have no serious or critical axe violations at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await gotoHydrated(page, "/");
      const sizer = page.locator("#sizer");
      for (const name of [/multifamily/i, /hard money/i, /construction/i]) {
        await sizer.getByRole("tab", { name }).click();
        // Open every collapsed group and detail so hidden content is scanned too.
        await sizer.locator("details:not([open]) > summary").evaluateAll((els) => els.forEach((el) => (el as HTMLElement).click()));
        expect(await sizerViolations(page)).toEqual([]);
      }
      // No horizontal page scroll at phone width.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
