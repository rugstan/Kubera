import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import { gotoHydrated } from "./helpers";

const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
type Violation = { id: string; impact: string | null; nodes: { target: string[] }[] };

/** Serious or critical axe violations inside the sizer section. */
async function sizerViolations(page: Page): Promise<string[]> {
  // axe's target-size rule counts a control as obscured when the sticky header
  // happens to sit over it at the current scroll position, which depends on where
  // the last click scrolled. Scan from one fixed position, the sizer's top edge
  // (scroll-padding keeps it clear of the header), so results depend on the layout only.
  await page.locator("#sizer").evaluate((el) => el.scrollIntoView({ block: "start", behavior: "instant" }));
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

  test("at 390px all five tabs show in menu order with no sideways scroll", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoHydrated(page, "/");
    const list = page.locator("#sizer").getByRole("tablist").first();
    const tabs = list.getByRole("tab");
    await expect(tabs).toHaveText(["Senior living", "Hotels", "Multifamily", "Construction", "Hard money"]);
    for (const tab of await tabs.all()) {
      const box = (await tab.boundingBox())!;
      expect(box.x, await tab.innerText()).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, await tab.innerText()).toBeLessThanOrEqual(390);
    }
    expect(await list.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  });

  for (const [family, name] of [
    ["construction", "Construction"],
    ["hard-money", "Hard money"],
    ["hotels", "Hotels"],
  ] as const) {
    test(`a program page's ?sizer=${family} link opens the ${name} tab`, async ({ page }) => {
      await gotoHydrated(page, `/?sizer=${family}#sizer`);
      await expect(page.locator("#sizer").getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
    });
  }

  test("an unknown ?sizer= value keeps the default tab", async ({ page }) => {
    await gotoHydrated(page, "/?sizer=nope#sizer");
    await expect(page.locator("#sizer").getByRole("tab", { name: "Senior living", exact: true })).toHaveAttribute("aria-selected", "true");
  });

  for (const width of [1280, 390]) {
    test(`an ineligible "Not a fit" card keeps AA contrast at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await gotoHydrated(page, "/");
      const sizer = page.locator("#sizer");
      // The default inputs fit every program; non-recourse only rules out SBA 504.
      await sizer.getByRole("switch", { name: /^non-recourse only/i }).click();
      const card = sizer.getByRole("article", { name: /sba 504/i }).first();
      await expect(card).toContainText("Not a fit");
      // Marked by fill and outline, never by fading the text.
      expect(await card.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
      expect(await sizerViolations(page)).toEqual([]);
    });
  }

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
