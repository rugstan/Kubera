import type { Page } from "@playwright/test";

/** Navigates and waits until the page has hydrated so click and key handlers are attached. */
export async function gotoHydrated(page: Page, url: string): Promise<void> {
  await page.goto(url);
  // Redirecting pages (e.g. the staff sign-in redirect) swap documents mid-load;
  // wait for the final document so the hydration check never sees a null body.
  await page.waitForLoadState("load");
  await page.waitForLoadState("networkidle");
  // "networkidle" can fire before React finishes hydrating on a loaded machine;
  // React tags each hydrated host node with an internal __reactFiber$ key.
  await page.waitForFunction(() => !!document.body && Object.keys(document.body).some((k) => k.startsWith("__reactFiber$")));
}

/** Captures JSON bodies POSTed to an API path while answering with a canned response. */
export async function mockJsonApi(page: Page, path: string, response: { status?: number; body: unknown }) {
  const calls: { body: unknown; contentType: string | undefined }[] = [];
  await page.route(`**${path}`, async (route) => {
    const req = route.request();
    calls.push({ body: req.postDataJSON(), contentType: req.headers()["content-type"] });
    await route.fulfill({ status: response.status ?? 200, contentType: "application/json", body: JSON.stringify(response.body) });
  });
  return calls;
}
