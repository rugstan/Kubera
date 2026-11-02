import { expect, test } from "@playwright/test";
import { DEMO_TOTP_SECRET } from "../lib/auth/demo";
import { totp } from "../lib/auth/totp";
import { gotoHydrated } from "./helpers";

// The assistant is a staff tool: nothing a visitor can read, press or fetch may
// mention AI or offer a way to ask it a question. Staff screens (app/(staff))
// are behind sign-in and are not scanned here.
const AI_WORDING = /\bAI\b|Corin AI|AI-assisted|\bJev\b|routing engine|rules engine/;

const PAGES = ["/", "/financing", "/financing/construction", "/financing/hard-money", "/express", "/rates", "/about", "/contact", "/privacy", "/terms", "/accessibility"];

test.describe("no public AI references", () => {
  for (const path of PAGES) {
    test(`${path} has no AI wording, no assistant entry point and no shortcut`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await gotoHydrated(page, path);

      const body = await page.evaluate(() => document.body.innerText);
      expect(body, `${path}: body text`).not.toMatch(AI_WORDING);
      expect(await page.title(), `${path}: title`).not.toMatch(AI_WORDING);
      const description = (await page.locator('meta[name="description"]').getAttribute("content")) ?? "";
      expect(description, `${path}: meta description`).not.toMatch(AI_WORDING);
      for (const sel of ['meta[property="og:title"]', 'meta[property="og:description"]', 'meta[name="twitter:title"]', 'meta[name="twitter:description"]']) {
        const content = (await page.locator(sel).first().getAttribute("content").catch(() => null)) ?? "";
        expect(content, `${path}: ${sel}`).not.toMatch(AI_WORDING);
      }

      await expect(page.locator("[data-ask-entry]")).toHaveCount(0);
      await expect(page.locator("[data-ask-floating]")).toHaveCount(0);

      // The old command-bar shortcut does nothing.
      for (const combo of ["Control+k", "Meta+k"]) {
        await page.keyboard.press(combo);
        await page.waitForTimeout(150);
        await expect(page.locator('[role="dialog"], dialog[open]'), `${path}: ${combo}`).toHaveCount(0);
      }
      expect(errors).toEqual([]);
    });
  }

  test("every sitemap route has no AI wording in its text, title or share tags", async ({ page, request }) => {
    test.setTimeout(240_000);
    const xml = await (await request.get("/sitemap.xml")).text();
    const paths = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]!).pathname);
    expect(paths.length).toBeGreaterThan(40);
    for (const path of paths) {
      const res = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(res?.status(), path).toBe(200);
      expect(await page.evaluate(() => document.body.innerText), `${path}: body text`).not.toMatch(AI_WORDING);
      expect(await page.title(), `${path}: title`).not.toMatch(AI_WORDING);
      const tags = await page.$$eval(
        'meta[name="description"], meta[property^="og:"], meta[name^="twitter:"]',
        (nodes) => nodes.map((n) => n.getAttribute("content") ?? ""),
      );
      for (const content of tags) expect(content, `${path}: meta`).not.toMatch(AI_WORDING);
      const ld = await page.$$eval('script[type="application/ld+json"]', (nodes) => nodes.map((n) => n.textContent ?? ""));
      for (const block of ld) expect(block, `${path}: JSON-LD`).not.toMatch(AI_WORDING);
    }
  });

  test("llms.txt and the web manifest have no AI wording", async ({ request }) => {
    const llms = await request.get("/llms.txt");
    expect(llms.status()).toBe(200);
    expect(await llms.text()).not.toMatch(/\bAI\b/);

    const manifest = await request.get("/manifest.webmanifest");
    expect(manifest.status()).toBe(200);
    expect(await manifest.text()).not.toMatch(AI_WORDING);
  });

  test("the share image still renders", async ({ request }) => {
    const res = await request.get("/opengraph-image");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
  });

  test("the old AI-use page redirects to the privacy policy", async ({ request }) => {
    const res = await request.get("/privacy/ai", { maxRedirects: 0 });
    expect(res.status()).toBe(308);
    expect(new URL(res.headers()["location"]!, "http://localhost").pathname).toBe("/privacy");
  });
});

test.describe("/api/ask is staff-only", () => {
  // An anonymous caller gets 401 (the e2e server runs the fake identity provider;
  // 503 where staff sign-in is not configured). Never 200, and never a model call.
  const REFUSALS = [401, 403, 503];

  test("an anonymous GET is refused", async ({ request }) => {
    const res = await request.get("/api/ask");
    expect(REFUSALS).toContain(res.status());
    expect(res.headers()["cache-control"]).toContain("no-store");
  });

  test("an anonymous POST is refused", async ({ request }) => {
    const res = await request.post("/api/ask", { data: { message: "What does HUD 232 need?" } });
    expect(REFUSALS).toContain(res.status());
    expect(res.headers()["x-conversation-id"]).toBeUndefined();
  });

  test("an anonymous POST with a captcha-shaped header and a same-origin Origin is still refused", async ({ request, baseURL }) => {
    const res = await request.post("/api/ask", {
      data: { message: "hi" },
      headers: { origin: baseURL ?? "http://localhost", "x-turnstile-token": "anything" },
    });
    expect(REFUSALS).toContain(res.status());
  });
});

test.describe("/api/ask for signed-in staff", () => {
  test("a broker with two-step verification gets past the gate", async ({ page }) => {
    await page.goto("/login");
    test.skip(!(await page.content()).includes('data-auth-provider="fake"'), "needs the fake identity provider (AUTH_PROVIDER=fake)");

    await page.goto("/pipeline");
    await expect(page).toHaveURL(/\/login\?next=/);
    await page.getByLabel("Work email").fill("broker@corin.test");
    await page.getByRole("button", { name: "Email me a code" }).click();
    await expect(page).toHaveURL(/\/login\/verify$/);
    const code = (await page.getByTestId("fake-code").textContent())?.trim() ?? "";
    await page.getByLabel("6-digit code").fill(code);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/mfa\?next=/);

    // Email code alone is not enough: the session is not yet two-step verified.
    expect((await page.request.get("/api/ask")).status()).toBe(403);

    await page.getByLabel("Authenticator code").fill(totp(DEMO_TOTP_SECRET));
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL(/\/pipeline$/);

    // Past the gate. The e2e server has no model key, so the staff probe says so instead of 401/403.
    const res = await page.request.get("/api/ask");
    expect(res.status()).toBe(503);
    expect(await res.json()).toEqual({ error: "The assistant is not configured." });
  });
});
