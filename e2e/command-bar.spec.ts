import { expect, test } from "@playwright/test";
import { gotoHydrated } from "./helpers";

test.describe("command bar (Ctrl/Cmd+K)", () => {
  test("opens with the keyboard shortcut, focuses the question box and closes on Escape", async ({ page }) => {
    await gotoHydrated(page, "/");
    const dialog = page.getByRole("dialog", { name: /ask kubera ai/i });
    await expect(dialog).toBeHidden();

    await page.keyboard.press("Control+k");
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("textbox", { name: /your question/i })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("toggles with the shortcut and opens from the visible Ask button", async ({ page }) => {
    await gotoHydrated(page, "/");
    const dialog = page.getByRole("dialog", { name: /ask kubera ai/i });

    await page.keyboard.press("Control+k");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Control+k");
    await expect(dialog).toBeHidden();

    await page.getByRole("button", { name: /ask kubera ai/i }).first().click();
    await expect(dialog).toBeVisible();
  });

  test("sends a question as JSON and renders the streamed answer", async ({ page }) => {
    let contentType: string | undefined;
    await page.route("**/api/ask", async (route) => {
      contentType = route.request().headers()["content-type"];
      await route.fulfill({ status: 200, contentType: "text/plain; charset=utf-8", body: "HUD 232 is a long-term, fixed-rate, non-recourse program." });
    });
    await gotoHydrated(page, "/");
    await page.keyboard.press("Control+k");
    await page.getByRole("textbox", { name: /your question/i }).fill("What is HUD 232?");
    await page.keyboard.press("Enter");

    await expect(page.getByText("HUD 232 is a long-term, fixed-rate, non-recourse program.")).toBeVisible();
    expect(contentType).toContain("application/json");
  });

  test("shows a readable error when the AI is unavailable (no API key configured)", async ({ page }) => {
    await gotoHydrated(page, "/");
    await page.keyboard.press("Control+k");
    await page.getByRole("textbox", { name: /your question/i }).fill("What is HUD 232?");
    await page.keyboard.press("Enter");
    // The real route answers 503 when ANTHROPIC_API_KEY is unset; the UI must not hang or crash.
    await expect(page.getByRole("dialog").getByText(/unavailable|not configured|try again|advisor/i).first()).toBeVisible();
  });
});
