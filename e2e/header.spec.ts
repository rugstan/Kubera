import { expect, test } from "@playwright/test";

// The public header must fit at every width: the link list only shows once
// there is room for it (1024px), and the "Get loan options" CTA is on screen at
// all of them. 320px is the WCAG 1.4.10 Reflow benchmark; 390 is a common phone.
const WIDTHS = [320, 360, 390, 393, 768, 1024, 1180, 1280, 1536];
const PAGES = ["/", "/financing/senior-living", "/rates", "/about"];

test.describe("public header", () => {
  for (const width of WIDTHS) {
    test(`fits at ${width}px and keeps the primary CTA on screen`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const path of PAGES) {
        await page.goto(path);
        const nav = page.getByRole("navigation", { name: "Primary" });

        const cta = nav.locator("[data-header-cta=primary]");
        await expect(cta, `${path}: primary CTA`).toBeVisible();
        await expect(cta).toHaveAttribute("href", "/express");
        // The label shortens below 360px; the accessible name always matches what is shown (WCAG 2.5.3).
        const visibleLabel = width < 360 ? "Get options" : "Get loan options";
        // innerText skips the span hidden by CSS; textContent would read both labels.
        await expect(cta).toHaveText(visibleLabel, { useInnerText: true });
        await expect(cta).toHaveAccessibleName(visibleLabel);

        const sizer = nav.locator("[data-header-cta=sizer]");
        if (width >= 640) {
          await expect(sizer, `${path}: Size my loan`).toBeVisible();
          await expect(sizer).toHaveAttribute("href", "/#sizer");
        } else {
          await expect(sizer).toBeHidden();
        }

        const m = await nav.evaluate((el) => {
          const style = getComputedStyle(el);
          const right = el.getBoundingClientRect().right - Number.parseFloat(style.paddingRight);
          const visible = (nodes: Element[]) => nodes.map((c) => c.getBoundingClientRect()).filter((r) => r.width > 0);
          const overlapping = (rects: DOMRect[]) =>
            [...rects].sort((a, b) => a.left - b.left).some((r, i, all) => i > 0 && r.left < all[i - 1]!.right - 0.5);
          const kids = visible([...el.children]);
          const group = el.lastElementChild!;
          const cta = el.querySelector("[data-header-cta=primary]")!.getBoundingClientRect();
          return {
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
            contentRight: right,
            lastRight: kids.at(-1)!.right,
            overlaps: overlapping(kids),
            groupOverlaps: overlapping(visible([...group.children])),
            cta: { left: cta.left, right: cta.right, height: cta.height },
            navHeight: el.getBoundingClientRect().height,
          };
        });
        expect(m.scrollWidth, `${path}: page is ${m.scrollWidth}px wide at a ${m.innerWidth}px viewport`).toBeLessThanOrEqual(m.innerWidth);
        expect(m.lastRight, `${path}: the header's right group spills out of the nav`).toBeLessThanOrEqual(m.contentRight + 1);
        expect(m.overlaps, `${path}: header items overlap`).toBe(false);
        expect(m.groupOverlaps, `${path}: right-hand controls overlap`).toBe(false);
        expect(m.cta.left, `${path}: CTA is cut off on the left`).toBeGreaterThanOrEqual(0);
        expect(m.cta.right, `${path}: CTA is cut off on the right`).toBeLessThanOrEqual(m.innerWidth);
        expect(m.navHeight).toBeLessThanOrEqual(48);
        // 36px phone tap target.
        if (width < 768) expect(m.cta.height, `${path}: CTA tap target`).toBeGreaterThanOrEqual(36);

        // The logo stays on one line.
        const logo = page.getByRole("link", { name: "Corin Commercial home" });
        expect((await logo.boundingBox())?.height ?? 0).toBeLessThanOrEqual(40);
      }
    });
  }

  // The page-wide removal of the assistant (floating button, Cmd/Ctrl+K) is covered by the
  // ai workstream's specs; this checks the header and its menus only.
  for (const width of [1280, 390]) {
    test(`has no Ask entry point in the header or its menus at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      const header = page.locator("header").first();
      await expect(header.locator("[data-ask-entry]")).toHaveCount(0);
      await expect(header.getByText(/Ask Corin|⌘K/)).toHaveCount(0);
      await expect(header.getByRole("button", { name: /\bask\b/i })).toHaveCount(0);

      // Open whichever menu this width has and check its entries too.
      const nav = page.getByRole("navigation", { name: "Primary" });
      await (width >= 1024 ? nav.getByRole("button", { name: "Financing" }) : nav.getByRole("button", { name: /open menu/i })).click();
      await expect(header.locator("[data-ask-entry]")).toHaveCount(0);
      await expect(header.getByText(/Ask Corin|⌘K/)).toHaveCount(0);
    });
  }
});
