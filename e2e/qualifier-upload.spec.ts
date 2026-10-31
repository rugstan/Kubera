import { expect, test, type Page } from "@playwright/test";
import { QUALIFIER_RESULT as RESULT, fillQualifierThroughContact } from "./forms-helpers";
import { gotoHydrated, mockJsonApi } from "./helpers";

// The express qualifier's document step: mint (POST /api/documents), PUT to the
// signed quarantine URL, then finalize (POST /api/documents/finalize) with the
// minted upload token. A file only shows as uploaded once finalize accepts it.

const LEAD_ID = "6f1b5c1e-2a8e-4c39-9a55-3d3c1b7f2a10";
const LEAD_TOKEN = "t".repeat(43);
const DOCUMENT_ID = "0d2f6a3e-8b1c-4f5d-9e7a-1c2b3d4e5f60";
const UPLOAD_TOKEN = "u".repeat(64);
const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");

type Calls = { mint: unknown[]; put: number; finalize: unknown[] };

async function mockUploadRoutes(page: Page, finalize: { status: number; body: unknown }): Promise<Calls> {
  const calls: Calls = { mint: [], put: 0, finalize: [] };
  await page.route("**/api/documents", async (route) => {
    calls.mint.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ documentId: DOCUMENT_ID, uploadUrl: "/__e2e/quarantine-upload", uploadToken: UPLOAD_TOKEN }),
    });
  });
  await page.route("**/__e2e/quarantine-upload", async (route) => {
    expect(route.request().method()).toBe("PUT");
    calls.put += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ Key: "quarantine/x" }) });
  });
  await page.route("**/api/documents/finalize", async (route) => {
    calls.finalize.push({ body: route.request().postDataJSON(), contentType: route.request().headers()["content-type"] });
    await route.fulfill({ status: finalize.status, contentType: "application/json", body: JSON.stringify(finalize.body) });
  });
  return calls;
}

async function openUploadStep(page: Page) {
  await mockJsonApi(page, "/api/qualify", { body: { ...RESULT, leadId: LEAD_ID, uploadToken: LEAD_TOKEN } });
  await gotoHydrated(page, "/express");
  await fillQualifierThroughContact(page);
  await page.getByRole("button", { name: /see my indicative structure/i }).click();
  await expect(page.getByRole("combobox", { name: /document type/i })).toBeVisible();
}

test.describe("express qualifier document upload", () => {
  test("sends sizeBytes, finalizes with the minted token, and only then marks the file uploaded", async ({ page }) => {
    const calls = await mockUploadRoutes(page, { status: 200, body: { documentId: DOCUMENT_ID, status: "quarantined" } });
    await openUploadStep(page);

    await page.locator('input[type="file"]').setInputFiles({ name: "t12.pdf", mimeType: "application/pdf", buffer: PDF });

    await expect(page.getByRole("listitem").filter({ hasText: "T-12 P&L: t12.pdf" })).toBeVisible();
    expect(calls.mint).toHaveLength(1);
    expect(calls.mint[0]).toMatchObject({ leadId: LEAD_ID, token: LEAD_TOKEN, kind: "T12", fileName: "t12.pdf", contentType: "application/pdf", sizeBytes: PDF.length });
    expect(calls.put).toBe(1);
    expect(calls.finalize).toEqual([{ body: { documentId: DOCUMENT_ID, token: UPLOAD_TOKEN }, contentType: "application/json" }]);
  });

  test("shows the server's finalize error and no check mark when the file is rejected", async ({ page }) => {
    const message = "This file's contents don't match its type. Upload the original PDF.";
    const calls = await mockUploadRoutes(page, { status: 422, body: { error: message, code: "content_mismatch" } });
    await openUploadStep(page);

    await page.locator('input[type="file"]').setInputFiles({ name: "t12.pdf", mimeType: "application/pdf", buffer: PDF });

    await expect(page.getByRole("status").filter({ hasText: message })).toBeVisible();
    expect(calls.finalize).toHaveLength(1);
    await expect(page.getByRole("listitem").filter({ hasText: "t12.pdf" })).toHaveCount(0);
  });
});
