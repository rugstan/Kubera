import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";
import { gotoHydrated, mockJsonApi } from "./helpers";

// /privacy/ai: the AI-use page and the privacy request form (WS-Y).
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
type Violation = { id: string; impact: string | null; nodes: { target: string[] }[] };

test.describe("AI use page", () => {
  for (const width of [1280, 390]) {
    test(`has no serious or critical axe violations at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await gotoHydrated(page, "/privacy/ai");
      await expect(page.getByRole("heading", { level: 1, name: /ai use and your choices/i })).toBeVisible();
      await expect(page.locator("[data-draft-notice]")).toBeVisible();
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
      // No horizontal page scroll on phones.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test("validates the request form and moves focus to the first problem", async ({ page }) => {
    await gotoHydrated(page, "/privacy/ai");
    await page.getByRole("button", { name: /send request/i }).click();
    const name = page.getByLabel(/full name/i);
    await expect(name).toBeFocused();
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("Enter your name.")).toBeVisible();
  });

  test("sends a deletion request and confirms", async ({ page }) => {
    const calls = await mockJsonApi(page, "/api/privacy/request", {
      status: 201,
      body: { ok: true, reference: "6f1b5c1e-2a8e-4c39-9a55-3d3c1b7f2a10", status: "pending_verification", respondBy: "2027-01-04", message: "We received your request. We will respond by 2027-01-04." },
    });
    await gotoHydrated(page, "/privacy/ai");
    await page.getByRole("radio", { name: /delete my information/i }).check();
    await page.getByLabel(/full name/i).fill("Pat Lee");
    await page.getByLabel(/email you used/i).fill("pat@example.com");
    await page.getByRole("checkbox", { name: /i confirm this request/i }).check();
    await page.getByRole("button", { name: /send request/i }).click();

    await expect(page.getByText("Request received")).toBeVisible();
    await expect(page.getByText(/6f1b5c1e/)).toBeVisible();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.contentType).toContain("application/json");
    expect(calls[0]!.body).toMatchObject({ type: "deletion", name: "Pat Lee", email: "pat@example.com", relationship: "self", attest: true });
  });

  test("falls back to the privacy email when requests cannot be stored", async ({ page }) => {
    // Real API, env-free build: Supabase is unset, so the route answers 503.
    await gotoHydrated(page, "/privacy/ai");
    await page.getByLabel(/full name/i).fill("Pat Lee");
    await page.getByLabel(/email you used/i).fill("pat@example.com");
    await page.getByRole("checkbox", { name: /i confirm this request/i }).check();
    await page.getByRole("button", { name: /send request/i }).click();
    await expect(page.getByText(/privacy@kuberacommercial\.com/).first()).toBeVisible();
    await expect(page.getByText(/can.t take requests online/i)).toBeVisible();
  });
});
