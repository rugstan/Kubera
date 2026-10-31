import { expect, test } from "@playwright/test";
import { gotoHydrated, mockAskAvailable } from "./helpers";

test.describe("command bar (Ctrl/Cmd+K)", () => {
  test("opens with the keyboard shortcut, focuses the question box and closes on Escape", async ({ page }) => {
    await mockAskAvailable(page);
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
    await mockAskAvailable(page);
    await gotoHydrated(page, "/");
    const dialog = page.getByRole("dialog", { name: /ask kubera ai/i });

    await page.keyboard.press("Control+k");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Control+k");
    await expect(dialog).toBeHidden();

    await page.getByRole("button", { name: /ask kubera ai/i }).first().click();
    await expect(dialog).toBeVisible();
  });

  test("sends only the new message as JSON and renders the streamed answer", async ({ page }) => {
    const posts: { contentType: string | undefined; body: Record<string, unknown> }[] = [];
    await page.route("**/api/ask", async (route) => {
      const req = route.request();
      if (req.method() === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ available: true }) });
        return;
      }
      posts.push({ contentType: req.headers()["content-type"], body: req.postDataJSON() });
      await route.fulfill({
        status: 200,
        contentType: "text/plain; charset=utf-8",
        headers: { "x-conversation-id": "6f1c1d2e-8d3b-4b5e-9a51-1f2e3d4c5b6a" },
        body: "HUD 232 is a long-term, fixed-rate, non-recourse program.",
      });
    });
    await gotoHydrated(page, "/");
    await page.keyboard.press("Control+k");
    await page.getByRole("textbox", { name: /your question/i }).fill("What is HUD 232?");
    await page.keyboard.press("Enter");

    await expect(page.getByText("HUD 232 is a long-term, fixed-rate, non-recourse program.")).toBeVisible();
    expect(posts[0]?.contentType).toContain("application/json");
    // The server owns the transcript: no client-supplied history.
    expect(posts[0]?.body).toMatchObject({ message: "What is HUD 232?", mode: "chat" });
    expect(posts[0]?.body).not.toHaveProperty("messages");

    // The follow-up turn carries the conversation id from the response header.
    await page.getByRole("textbox", { name: /your question/i }).fill("And the max LTV?");
    await page.keyboard.press("Enter");
    await expect.poll(() => posts.length).toBe(2);
    expect(posts[1]?.body).toMatchObject({ conversationId: "6f1c1d2e-8d3b-4b5e-9a51-1f2e3d4c5b6a", message: "And the max LTV?" });
  });

  test("shows a readable error when a question fails because the AI is unavailable", async ({ page }) => {
    await mockAskAvailable(page);
    await gotoHydrated(page, "/");
    await page.keyboard.press("Control+k");
    await page.getByRole("textbox", { name: /your question/i }).fill("What is HUD 232?");
    await page.keyboard.press("Enter");
    // The real POST answers 503 when ANTHROPIC_API_KEY is unset; the UI must not hang or crash.
    await expect(page.getByRole("dialog").getByText(/unavailable|not configured|try again|advisor/i).first()).toBeVisible();
  });

  test("hides every AI entry point when the backend reports it is not configured", async ({ page }) => {
    // No mock: the real GET /api/ask answers 503 without a model key.
    await gotoHydrated(page, "/");
    await expect(page.locator("html")).toHaveAttribute("data-ask", "off");
    await expect(page.getByRole("button", { name: /ask kubera ai/i })).toHaveCount(0);
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("dialog", { name: /ask kubera ai/i })).toBeHidden();
  });
});
