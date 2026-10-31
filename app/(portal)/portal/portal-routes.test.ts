// Borrower portal route handlers against the in-memory desk: magic-link
// redemption, session checks, profile sections (encrypted at rest) and the
// two-step upload.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { memoryDesk } from "@/lib/checklists/fakes";
import { checklistDeps } from "@/lib/checklists/desk";
import { setDeskServices } from "@/lib/checklists/server";
import { createDealChecklist, syncDealPrincipalItems } from "@/lib/checklists/service";
import { CURRENT_CREDIT_AUTH } from "@/lib/principals/consent";
import { PORTAL_COOKIE, issuePortalInvite } from "@/lib/principals/portal";
import { addPrincipal } from "@/lib/principals/service";
import { DEAL_ID } from "@/lib/principals/test-fixtures";
import { POST as redeem } from "./access/redeem/route";
import { POST as profile } from "./api/profile/route";
import { POST as startUpload } from "./api/uploads/route";
import { POST as completeUpload } from "./api/uploads/complete/route";
import { POST as signOut } from "./sign-out/route";

const ORIGIN = "http://localhost:3000";
const NOW = new Date("2026-11-03T12:00:00Z");
let desk: ReturnType<typeof memoryDesk>;
let anaId: string;

async function setup() {
  desk = memoryDesk({ now: () => NOW });
  setDeskServices(desk);
  const pdeps = { principals: desk.principals, keyring: desk.keyring, now: () => NOW };
  await createDealChecklist(checklistDeps(desk), { dealId: DEAL_ID, program: "SBA_7A", createdBy: "broker@k.com" });
  const b = await addPrincipal(pdeps, { dealId: DEAL_ID, kind: "entity", legalName: "Harbor View LLC", roles: ["borrower_entity"] });
  const ana = await addPrincipal(pdeps, { dealId: DEAL_ID, parentId: b.principal.id, kind: "individual", legalName: "Ana Ruiz", roles: ["managing_member"], ownershipPct: 100, email: "ana@example.com" });
  anaId = ana.principal.id;
  await syncDealPrincipalItems(checklistDeps(desk), DEAL_ID);
}

async function signIn(principalId: string | null = anaId): Promise<string> {
  const issued = await issuePortalInvite(desk.invites, { dealId: DEAL_ID, principalId, email: "ana@example.com", issuedBy: "broker@k.com", origin: ORIGIN, now: NOW });
  const token = new URL(issued.url).searchParams.get("token")!;
  const res = await redeem(new Request(`${ORIGIN}/portal/access/redeem`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }) }));
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe(`${ORIGIN}/portal`);
  const cookie = res.headers.get("set-cookie")!;
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/Path=\/portal/);
  return cookie.split(";")[0]!;
}

const post = (handler: (r: Request) => Promise<Response>, path: string, body: unknown, cookie?: string) =>
  handler(new Request(`${ORIGIN}${path}`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));

beforeEach(async () => {
  vi.stubEnv("PORTAL_SESSION_SECRET", "p".repeat(40));
  await setup();
});

afterEach(() => {
  setDeskServices(undefined);
  vi.unstubAllEnvs();
});

describe("portal access", () => {
  it("redeems a link once and refuses forged origins and reused links", async () => {
    const issued = await issuePortalInvite(desk.invites, { dealId: DEAL_ID, principalId: anaId, email: "ana@example.com", issuedBy: "b", origin: ORIGIN, now: NOW });
    const token = new URL(issued.url).searchParams.get("token")!;
    const forged = await redeem(new Request(`${ORIGIN}/portal/access/redeem`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }) }));
    expect(forged.status).toBe(403);
    const ok = await redeem(new Request(`${ORIGIN}/portal/access/redeem`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }) }));
    expect(ok.status).toBe(303);
    const again = await redeem(new Request(`${ORIGIN}/portal/access/redeem`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }) }));
    expect(again.headers.get("location")).toBe(`${ORIGIN}/portal/access?error=used`);
  });

  it("rejects API calls without a session and when the portal is not configured", async () => {
    const res = await post(profile, "/portal/api/profile", { section: "contact", version: 1, data: {} });
    expect(res.status).toBe(401);
    vi.stubEnv("PORTAL_SESSION_SECRET", "");
    expect((await post(profile, "/portal/api/profile", { section: "contact", version: 1, data: {} })).status).toBe(503);
  });

  it("signing out revokes the session", async () => {
    const cookie = await signIn();
    const out = await signOut(new Request(`${ORIGIN}/portal/sign-out`, { method: "POST", headers: { origin: ORIGIN, cookie } }));
    expect(out.status).toBe(303);
    expect(out.headers.get("set-cookie")).toMatch(new RegExp(`${PORTAL_COOKIE}=;`));
    expect((await post(profile, "/portal/api/profile", { section: "contact", version: 1, data: { phone: null, homeAddress: "1 Oak St, Pasadena CA", citizenship: "us_citizen" } }, cookie)).status).toBe(401);
  });
});

describe("portal profile", () => {
  it("saves identity and PFS encrypted, never echoes them, and marks the PFS received", async () => {
    const cookie = await signIn();
    const contact = await post(profile, "/portal/api/profile", { section: "contact", version: 1, data: { phone: "555-0100", homeAddress: "1 Oak St, Pasadena CA", citizenship: "us_citizen" } }, cookie);
    expect(contact.status).toBe(200);
    const id = await post(profile, "/portal/api/profile", { section: "identity", version: 2, data: { ssn: "123-45-6789", dob: "1970-04-01" } }, cookie);
    const body = await id.json();
    expect(id.status).toBe(200);
    expect(body.principal).toMatchObject({ hasSsn: true, hasDob: true, version: 3 });
    expect(JSON.stringify(body)).not.toContain("6789");
    const row = desk.principals.rows.get(anaId)!;
    expect(row.ssnEnc).toMatch(/^pii1\./);
    expect(JSON.stringify(row)).not.toContain("123456789");

    const pfs = { asOf: "2026-10-30", assets: { cash: 500_000, marketableSecurities: 0, retirementAccounts: 0, realEstate: 2_000_000, businessInterests: 0, otherAssets: 0 }, liabilities: { mortgages: 900_000, notesPayable: 0, creditCards: 0, taxesOwed: 0, otherLiabilities: 0 }, contingentLiabilities: { guarantees: 0, legalClaims: 0, other: 0 }, annualIncome: { salary: 200_000, investmentIncome: 0, realEstateIncome: 50_000, otherIncome: 0 } };
    const saved = await post(profile, "/portal/api/profile", { section: "pfs", version: 3, data: pfs }, cookie);
    expect(saved.status).toBe(200);
    expect(JSON.stringify(await saved.json())).not.toContain("500000");
    const item = (await desk.checklists.itemsForDeal(DEAL_ID)).find((i) => i.itemKey === `pfs:${anaId}`)!;
    expect(item.status).toBe("submitted");

    const stale = await post(profile, "/portal/api/profile", { section: "contact", version: 1, data: { phone: null, homeAddress: "2 Elm St, Pasadena CA", citizenship: "us_citizen" } }, cookie);
    expect(stale.status).toBe(409);
  });

  it("validates fields and signs the credit authorization with the matching name", async () => {
    const cookie = await signIn();
    const bad = await post(profile, "/portal/api/profile", { section: "identity", version: 1, data: { ssn: "000-00-0000", dob: "1970-04-01" } }, cookie);
    expect(bad.status).toBe(400);
    expect((await bad.json()).issues).toEqual([{ path: "ssn", message: "Enter a valid 9-digit SSN or ITIN." }]);
    const wrongName = await post(profile, "/portal/api/profile", { section: "credit_authorization", version: 1, data: { signatureName: "Someone Else", textVersion: CURRENT_CREDIT_AUTH, agree: true } }, cookie);
    expect(wrongName.status).toBe(400);
    const signed = await post(profile, "/portal/api/profile", { section: "credit_authorization", version: 1, data: { signatureName: "Ana Ruiz", textVersion: CURRENT_CREDIT_AUTH, agree: true } }, cookie);
    expect(signed.status).toBe(200);
    expect(desk.principals.rows.get(anaId)!.creditAuthorization).toMatchObject({ signatureName: "Ana Ruiz", ip: null, capturedVia: "portal" });
    const answers = { subjectToCriminalCharges: false, incarceratedOrOnProbation: false, delinquentFederalDebt: true, priorGovernmentLoss: false, debarredOrSuspended: false, sbaEmployeeAffiliation: false };
    expect((await post(profile, "/portal/api/profile", { section: "form1919", version: 2, data: { answers, explanation: "Student loan in rehabilitation since 2025." } }, cookie)).status).toBe(200);
    expect(desk.principals.rows.get(anaId)!.form1919Enc).toMatch(/^pii1\./);
  });

  it("deal-contact links cannot edit a principal profile", async () => {
    const cookie = await signIn(null);
    const res = await post(profile, "/portal/api/profile", { section: "contact", version: 1, data: { phone: null, homeAddress: "1 Oak St, Pasadena CA", citizenship: "us_citizen" } }, cookie);
    expect(res.status).toBe(403);
  });
});

describe("portal uploads", () => {
  it("uploads to the signed URL and confirms after checking the bytes", async () => {
    const cookie = await signIn();
    const item = (await desk.checklists.itemsForDeal(DEAL_ID)).find((i) => i.itemKey === "business_tax_returns")!;
    const start = await post(startUpload, "/portal/api/uploads", { itemId: item.id, fileName: "2025 return.pdf", contentType: "application/pdf", sizeBytes: 2048 }, cookie);
    expect(start.status).toBe(201);
    const { fileId, uploadUrl } = await start.json();
    expect(uploadUrl).toMatch(/^https:\/\/storage\.test\/upload\//);
    const file = await desk.checklists.getFile(fileId);
    desk.storage.put(file!.storagePath, "%PDF-1.4 tax return");
    const done = await post(completeUpload, "/portal/api/uploads/complete", { fileId }, cookie);
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ ok: true, item: { status: "submitted" }, file: { status: "uploaded" } });

    const tooBig = await post(startUpload, "/portal/api/uploads", { itemId: item.id, fileName: "x.pdf", contentType: "application/pdf", sizeBytes: 80 * 1024 * 1024 }, cookie);
    expect(tooBig.status).toBe(400);
    const wrongType = await post(startUpload, "/portal/api/uploads", { itemId: item.id, fileName: "x.exe", contentType: "application/x-msdownload", sizeBytes: 10 }, cookie);
    expect(wrongType.status).toBe(400);
    const notJson = await startUpload(new Request(`${ORIGIN}/portal/api/uploads`, { method: "POST", headers: { origin: ORIGIN, "content-type": "text/plain", cookie }, body: "x" }));
    expect(notJson.status).toBe(415);
  });
});
