import { expect, test } from "@playwright/test";
import { mockAskAvailable } from "./helpers";

// The public header must fit at every width: the inline link list only shows
// once there is room for it next to the logo, the Ask pill and the "Size a
// loan" CTA. The AI is mocked as available, as in production, so the Ask pill
// renders and takes its share of the row.
const WIDTHS = [768, 1024, 1180, 1279, 1280, 1536];
const PAGES = ["/", "/financing/senior-living", "/rates", "/about"];

test.describe("public header", () => {
  for (const width of WIDTHS) {
    test(`fits at ${width}px with the AI available`, async ({ page }) => {
      await mockAskAvailable(page);
      await page.setViewportSize({ width, height: 900 });
      for (const path of PAGES) {
        await page.goto(path);
        const nav = page.getByRole("navigation", { name: "Primary" });
        const cta = nav.getByRole("link", { name: "Size a loan" });
        await expect(cta).toBeVisible();
        await expect(nav.getByRole("button", { name: /Ask Kubera AI/ })).toBeVisible();
        const m = await nav.evaluate((el) => {
          const style = getComputedStyle(el);
          const box = el.getBoundingClientRect();
          const right = box.right - Number.parseFloat(style.paddingRight);
          const kids = [...el.children].map((c) => c.getBoundingClientRect()).filter((r) => r.width > 0);
          const overlaps = kids.some((r, i) => i > 0 && r.left < kids[i - 1]!.right);
          return { scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, contentRight: right, lastRight: kids.at(-1)!.right, overlaps };
        });
        expect(m.scrollWidth, `${path}: page is ${m.scrollWidth}px wide at a ${m.innerWidth}px viewport`).toBeLessThanOrEqual(m.innerWidth);
        expect(m.lastRight, `${path}: the header's right group spills out of the nav`).toBeLessThanOrEqual(m.contentRight + 1);
        expect(m.overlaps, `${path}: header items overlap`).toBe(false);
        // The logo stays on one line.
        const logo = page.getByRole("link", { name: "Kubera Commercial home" });
        expect((await logo.boundingBox())?.height ?? 0).toBeLessThanOrEqual(40);
      }
    });
  }
});
