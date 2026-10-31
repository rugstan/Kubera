import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import { gotoHydrated } from "./helpers";

// Borrower portal and staff deal desk (WS-U) on the env-free build: no
// Supabase, no portal secret, no staff token. Every page must render, stay
// closed, and pass axe at desktop and phone widths.
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
type Violation = { id: string; impact: string | null; nodes: { target: string[] }[] };

async function expectAccessible(page: Page) {
  await page.addScriptTag({ path: axePath });
  const violations = await page.evaluate<Violation[], string[]>(
    async (tags) =>
      (
        await (window as unknown as { axe: { run: (ctx: Document, opts: unknown) => Promise<{ violations: Violation[] }> } }).axe.run(document, {
          runOnly: { type: "tag", values: tags },
          resultTypes: ["violations"],
        })
      ).violations,
    AXE_TAGS,
  );
  const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  expect(blocking).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("borrower portal", () => {
  for (const width of [1280, 390]) {
    test(`signed-out portal is accessible at ${width}px and never indexed`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await gotoHydrated(page, "/portal");
      await expect(page.getByRole("heading", { level: 1, name: "Borrower portal" })).toBeVisible();
      await expect(page.getByRole("heading", { name: /sign in with your secure link/i })).toBeVisible();
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      await expect(page.getByText(/Real estate broker, California Department of Real Estate/)).toBeVisible();
      await expectAccessible(page);
    });
  }

  test("a malformed link explains what to do", async ({ page }) => {
    await gotoHydrated(page, "/portal/access?token=nope");
    await expect(page.getByText(/This link is not valid/)).toBeVisible();
    await expect(page.getByRole("button", { name: /continue/i })).toHaveCount(0);
  });

  test("a well-formed link waits for a click (mail scanners cannot use it) and reports an unavailable portal", async ({ page }) => {
    await gotoHydrated(page, `/portal/access?token=${"A".repeat(43)}`);
    const button = page.getByRole("button", { name: /continue to the portal/i });
    await expect(button).toBeVisible();
    await expectAccessible(page);
    await button.click();
    await expect(page).toHaveURL(/\/portal\?state=unavailable$/);
    // During the server-action redirect a transient copy of the page can briefly
    // coexist with the settled one; assert on the settled main content, once.
    const alert = page.locator("#main-content").getByRole("alert").filter({ hasText: "The portal is not available right now" });
    await expect(alert).toHaveCount(1);
    await expect(alert).toBeVisible();
  });

  test("the profile page asks for a new link without a session", async ({ page }) => {
    await gotoHydrated(page, "/portal/profile");
    await expect(page.getByText("Your session has ended.")).toBeVisible();
  });

  test("portal APIs refuse requests without a session", async ({ request, baseURL }) => {
    const res = await request.post("/portal/api/uploads", { headers: { origin: baseURL!, "content-type": "application/json" }, data: { itemId: "00000000-0000-4000-8000-000000000000", fileName: "a.pdf", contentType: "application/pdf", sizeBytes: 10 } });
    expect([401, 503]).toContain(res.status());
  });
});

test.describe("staff deal desk", () => {
  for (const width of [1280, 390]) {
    test(`stays closed without staff sign-in at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await gotoHydrated(page, "/checklists");
      // The (staff) layout sends signed-out visitors to staff sign-in.
      await expect(page).toHaveURL((url) => url.pathname === "/login" && url.searchParams.get("next") === "/checklists");
      await expect(page.getByRole("heading", { level: 1, name: "Deal checklists" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /create/i })).toHaveCount(0);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      await expectAccessible(page);
    });
  }

  test("a deal page shows nothing without sign-in", async ({ page }) => {
    await gotoHydrated(page, "/checklists/deal?id=11111111-1111-4111-8111-111111111111");
    await expect(page).toHaveURL((url) => url.pathname === "/login" && url.searchParams.get("next") === "/checklists/deal?id=11111111-1111-4111-8111-111111111111");
    await expect(page.getByText(/principals and ownership/i)).toHaveCount(0);
  });
});
