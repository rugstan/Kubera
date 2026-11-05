import { expect, test } from "@playwright/test";

// The owner asked for every public page to use the full page width. Each page
// frames its header and main sections in the site container
// (components/site/PageContainer.tsx, marked `data-page-container`): 1280px at
// most with 32px gutters, so 1216px of content at 1440px. Long text keeps a
// readable measure inside it through columns, not a narrow page.
//
// One loop over every route in the sitemap: 1440x900 for the width, then 320px
// for WCAG 1.4.10 reflow. Images, fonts and media are skipped (their boxes are
// sized by the markup), so the loop only pays for HTML, CSS and scripts.

const DESKTOP = { width: 1440, height: 900 };
const MIN_CONTAINER = 1150;

test("every sitemap page spans the site container at 1440px and has no sideways scroll at 320px", async ({ page, request }) => {
  test.setTimeout(300_000);
  const xml = await (await request.get("/sitemap.xml")).text();
  const paths = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]!).pathname);
  expect(paths.length).toBeGreaterThan(40);
  for (const path of ["/", "/financing", "/financing/fix-and-flip", "/about", "/privacy", "/rates", "/contact", "/express", "/glossary"]) expect(paths).toContain(path);

  await page.route("**/*", (route) => (["image", "font", "media"].includes(route.request().resourceType()) ? route.abort() : route.continue()));

  for (const path of paths) {
    await page.setViewportSize(DESKTOP);
    const res = await page.goto(path, { waitUntil: "domcontentloaded" });
    expect(res?.status(), path).toBe(200);

    const desktop = await page.evaluate(() => {
      const main = document.querySelector("main");
      const containers = [...(main?.querySelectorAll<HTMLElement>("[data-page-container]") ?? [])].map((el) => {
        const r = el.getBoundingClientRect();
        return { width: Math.round(r.width), left: Math.round(r.left), tag: el.tagName.toLowerCase() };
      });
      const h1 = document.querySelector("main h1");
      return {
        viewport: document.documentElement.clientWidth,
        containers,
        h1InContainer: Boolean(h1?.closest("[data-page-container]")),
        mainWidth: Math.round(main?.getBoundingClientRect().width ?? 0),
      };
    });
    expect.soft(desktop.containers.length, `${path}: no site container in <main>`).toBeGreaterThan(0);
    expect.soft(desktop.h1InContainer, `${path}: the H1 is not in the site container`).toBe(true);
    for (const c of desktop.containers) {
      expect.soft(c.width, `${path}: a ${c.tag} container is ${c.width}px wide at 1440px`).toBeGreaterThanOrEqual(MIN_CONTAINER);
      // Centred: equal margins either side.
      expect.soft(Math.abs(c.left - (desktop.viewport - c.width - c.left)), `${path}: container is off centre`).toBeLessThanOrEqual(1);
    }

    await page.setViewportSize({ width: 320, height: 640 });
    const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect.soft(scroll, `${path}: page is ${scroll}px wide at a ${client}px viewport`).toBeLessThanOrEqual(client);
  }
});
