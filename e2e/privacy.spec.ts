import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";
import { gotoHydrated, mockJsonApi } from "./helpers";

// /privacy: the privacy policy, its automated-tools disclosures and the privacy request form (#request).
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
type Violation = { id: string; impact: string | null; nodes: { target: string[] }[] };

test.describe("Privacy policy page", () => {
  for (const width of [1280, 390]) {
    test(`has no serious or critical axe violations at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await gotoHydrated(page, "/privacy");
      await expect(page.getByRole("heading", { level: 1, name: "Privacy policy" })).toBeVisible();
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

  test("keeps the automated-tools disclosures and the request form on the page", async ({ page }) => {
    await gotoHydrated(page, "/privacy");
    await expect(page.locator("#automated-tools")).toHaveText("Automated tools");
    await expect(page.locator("#automated-tools ~ ul").first()).toContainText("No automated tool makes a credit decision");
    await expect(page.locator("#request")).toHaveText("Make a request online");
    await expect(page.getByRole("button", { name: /send request/i })).toBeVisible();
    await expect(page.getByText("former Ask feature").first()).toBeVisible();
  });

  test("shows the notice at collection before the submit button", async ({ page }) => {
    await gotoHydrated(page, "/privacy");
    const notice = page.locator('[data-notice-at-collection="privacy_request"]');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("to verify your identity and respond to your privacy request");
    const [noticeBox, submitBox] = await Promise.all([notice.boundingBox(), page.getByRole("button", { name: /send request/i }).boundingBox()]);
    expect(noticeBox!.y).toBeLessThan(submitBox!.y);
  });

  test("validates the request form and moves focus to the first problem", async ({ page }) => {
    await gotoHydrated(page, "/privacy");
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
    await gotoHydrated(page, "/privacy");
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
    await gotoHydrated(page, "/privacy");
    await page.getByLabel(/full name/i).fill("Pat Lee");
    await page.getByLabel(/email you used/i).fill("pat@example.com");
    await page.getByRole("checkbox", { name: /i confirm this request/i }).check();
    await page.getByRole("button", { name: /send request/i }).click();
    await expect(page.getByText(/privacy@corincommercial\.com/).first()).toBeVisible();
    await expect(page.getByText(/can.t take requests online/i)).toBeVisible();
  });
});

test.describe("Privacy policy request methods", () => {
  test("lists at least two ways to make a CCPA request", async ({ page }) => {
    await gotoHydrated(page, "/privacy");
    const methods = page.locator("[data-privacy-request-methods] > li");
    expect(await methods.count()).toBeGreaterThanOrEqual(2);
    await expect(methods.filter({ has: page.locator('a[href="#request"]') })).toHaveCount(1);
    await expect(methods.filter({ has: page.locator('a[href="mailto:privacy@corincommercial.com"]') })).toHaveCount(1);
  });
});

test.describe("Retired AI-use page", () => {
  test("/privacy/ai permanently redirects to the privacy policy", async ({ request }) => {
    const res = await request.get("/privacy/ai", { maxRedirects: 0 });
    expect(res.status()).toBe(308);
    const location = res.headers()["location"];
    expect(new URL(location!, "http://localhost").pathname).toBe("/privacy");
  });

  test("an old /privacy/ai#request link lands on the request form", async ({ page }) => {
    await gotoHydrated(page, "/privacy/ai#request");
    expect(new URL(page.url()).pathname).toBe("/privacy");
    expect(new URL(page.url()).hash).toBe("#request");
    await expect(page.getByRole("button", { name: /send request/i })).toBeVisible();
  });
});
