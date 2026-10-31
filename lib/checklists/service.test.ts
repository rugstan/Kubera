// End-to-end desk flow with in-memory stores: checklist from template,
// principals and the chart, portal links and uploads, conditions, screening
// holds and the closing gate.
import { describe, expect, it } from "vitest";
import { decodeSession, encodeSession, hashToken, issuePortalInvite, PortalLinkError, redeemPortalLink, verifySession } from "@/lib/principals/portal";
import { addPrincipal, updatePrincipal } from "@/lib/principals/service";
import { DEAL_ID } from "@/lib/principals/test-fixtures";
import { dispositionScreening, screenDeal } from "@/lib/screening/service";
import { memoryDesk } from "./fakes";
import { checklistDeps } from "./desk";
import { addCondition, completePortalUpload, createDealChecklist, dealClosingGate, markCapturedInPortal, moveCondition, moveItem, recordContractorLicense, saveHmUnderwriting, startPortalUpload, syncDealPrincipalItems } from "./service";
import { DuplicateChecklistError } from "./store";

const NOW = new Date("2026-11-03T12:00:00Z");
const staff = { kind: "staff" as const, id: "broker@kuberacommercial.com" };
const broker = { id: "u1", email: "broker@kuberacommercial.com", name: "B", role: "broker" as const, dreLicense: null };

async function dealWithPrincipals(sanctions = [{ entryId: "SDN-1", name: "Ivan Petrov", kind: "individual" as const }]) {
  const desk = memoryDesk({ sanctions, now: () => NOW });
  const deps = checklistDeps(desk);
  const pdeps = { principals: desk.principals, keyring: desk.keyring, now: () => NOW };
  const created = await createDealChecklist(deps, { dealId: DEAL_ID, program: "BRIDGE", createdBy: "broker@kuberacommercial.com" });
  const b = await addPrincipal(pdeps, { dealId: DEAL_ID, kind: "entity", legalName: "Harbor View LLC", roles: ["borrower_entity"], formationState: "CA" });
  const ana = await addPrincipal(pdeps, { dealId: DEAL_ID, parentId: b.principal.id, kind: "individual", legalName: "Ana Ruiz", roles: ["managing_member"], ownershipPct: 70, email: "ana@example.com" });
  const ivan = await addPrincipal(pdeps, { dealId: DEAL_ID, parentId: b.principal.id, kind: "individual", legalName: "Ivan Petrov", roles: ["member"], ownershipPct: 30 });
  return { desk, deps, pdeps, created, b: b.principal, ana: ana.principal, ivan: ivan.principal };
}

describe("deal checklist desk", () => {
  it("creates one checklist per program and adds per-principal items as the chart fills in", async () => {
    const { deps, created, ana, ivan } = await dealWithPrincipals();
    expect(created.checklist).toMatchObject({ program: "BRIDGE", templateVersion: "2026.11.1" });
    expect(created.items.some((i) => i.principalId)).toBe(false);
    await expect(createDealChecklist(deps, { dealId: DEAL_ID, program: "BRIDGE", createdBy: "x" })).rejects.toThrow(DuplicateChecklistError);
    const sync = await syncDealPrincipalItems(deps, DEAL_ID);
    expect(sync.added).toBe(12); // six key-principal items each for Ana (control, 70%) and Ivan (30% ≥ 25%)
    const items = await deps.checklists.itemsForDeal(DEAL_ID);
    expect(items.filter((i) => i.principalId === ana.id).map((i) => i.templateKey).sort()).toEqual(["credit_authorization", "government_id", "guaranty", "pfs", "reo_schedule", "sponsor_resume"]);
    expect(items.filter((i) => i.principalId === ivan.id)).toHaveLength(6);
    expect((await syncDealPrincipalItems(deps, DEAL_ID)).added).toBe(0);
  });

  it("retires a principal's untouched items when they no longer owe them", async () => {
    const { deps, pdeps, ivan } = await dealWithPrincipals();
    await syncDealPrincipalItems(deps, DEAL_ID);
    await updatePrincipal(pdeps, ivan.id, 1, { ownershipPct: 10 });
    const sync = await syncDealPrincipalItems(deps, DEAL_ID);
    expect(sync.retired).toBe(6);
    const items = (await deps.checklists.itemsForDeal(DEAL_ID)).filter((i) => i.principalId === ivan.id);
    expect(items.every((i) => i.status === "not_applicable")).toBe(true);
    await updatePrincipal(pdeps, ivan.id, 2, { ownershipPct: 30 });
    expect((await syncDealPrincipalItems(deps, DEAL_ID)).revived).toBe(6);
  });

  it("takes a portal upload end to end and rejects a file whose bytes lie about its type", async () => {
    const { desk, deps } = await dealWithPrincipals();
    const items = await deps.checklists.itemsForDeal(DEAL_ID);
    const t12 = items.find((i) => i.itemKey === "t12")!;
    const scope = { dealId: DEAL_ID, principalId: null, email: "ana@example.com" };
    const started = await startPortalUpload(deps, scope, { itemId: t12.id, fileName: "T-12 Oct.pdf", contentType: "application/pdf", sizeBytes: 12_345 });
    expect(started.file).toMatchObject({ status: "pending_upload", uploadedBy: "ana@example.com" });
    expect(started.file.storagePath).toMatch(new RegExp(`^deals/${DEAL_ID}/checklist/${t12.id}/[0-9a-f-]{36}-T-12-Oct\\.pdf$`));
    await expect(completePortalUpload(deps, scope, started.file.id)).rejects.toThrow(/did not receive/);
    desk.storage.put(started.file.storagePath, "%PDF-1.7 ...");
    const done = await completePortalUpload(deps, scope, started.file.id);
    expect(done.file.status).toBe("uploaded");
    expect(done.item.status).toBe("submitted");
    await expect(completePortalUpload(deps, scope, started.file.id)).rejects.toThrow(/already completed/);
    // Another deal's session cannot see this upload.
    await expect(completePortalUpload(deps, { ...scope, dealId: "22222222-2222-4222-8222-222222222222" }, started.file.id)).rejects.toThrow(/not found/);

    const rr = items.find((i) => i.itemKey === "rent_roll")!;
    const fake = await startPortalUpload(deps, scope, { itemId: rr.id, fileName: "rr.pdf", contentType: "application/pdf", sizeBytes: 100 });
    desk.storage.put(fake.file.storagePath, "MZ this is an executable");
    await expect(completePortalUpload(deps, scope, fake.file.id)).rejects.toThrow(/does not look like/);
    expect(desk.storage.removed).toEqual([fake.file.storagePath]);
    expect((await deps.checklists.getFile(fake.file.id))!.status).toBe("rejected");

    // Lender-side items cannot be uploaded from the portal.
    const appraisal = items.find((i) => i.itemKey === "appraisal")!;
    await expect(startPortalUpload(deps, scope, { itemId: appraisal.id, fileName: "a.pdf", contentType: "application/pdf", sizeBytes: 1 })).rejects.toThrow(/not uploaded through the portal/);
    await expect(startPortalUpload({ ...deps, storage: null }, scope, { itemId: t12.id, fileName: "a.pdf", contentType: "application/pdf", sizeBytes: 1 })).rejects.toThrow(/not available/);
  });

  it("an OFAC hit holds the deal; clearing it and finishing the file makes it ready to close", async () => {
    const { desk, deps, ana, ivan } = await dealWithPrincipals();
    await syncDealPrincipalItems(deps, DEAL_ID);
    const sdeps = { client: desk.sanctions, screenings: desk.screenings, holds: desk.holds, principals: desk.principals, keyring: desk.keyring, now: () => NOW };
    const { records } = await screenDeal(sdeps, { dealId: DEAL_ID, purpose: "initial", requestedBy: broker.email });
    let gate = await dealClosingGate(deps, DEAL_ID);
    expect(gate.held).toBe(true);
    expect(gate.ready).toBe(false);
    expect(gate.reasons.join("\n")).toMatch(/On hold: Possible sanctions match for Ivan Petrov/);

    // Finish every required item and verify the condition path.
    for (const item of await deps.checklists.itemsForDeal(DEAL_ID)) {
      if (!item.required) continue;
      await moveItem(deps, { itemId: item.id, expectedVersion: item.version, to: "accepted", actor: staff, documentDate: "2026-10-28" });
    }
    const cond = await addCondition(deps, { dealId: DEAL_ID, source: "lender", lenderName: "Bay Bridge Capital", timing: "prior_to_closing", description: "Evidence of builder's risk binder", responsible: "borrower" }, broker.email);
    gate = await dealClosingGate(deps, DEAL_ID);
    expect(gate.openConditions.map((c) => c.id)).toEqual([cond.id]);
    await moveCondition(deps, { conditionId: cond.id, expectedVersion: 1, to: "cleared", staffEmail: broker.email });

    const hit = records.find((r) => r.principalId === ivan.id)!;
    await dispositionScreening(sdeps, { screeningId: hit.id, to: "false_positive", reviewer: broker, note: "Different date of birth and nationality from SDN-1." });
    gate = await dealClosingGate(deps, DEAL_ID);
    expect(gate.held).toBe(false);
    expect(gate.reasons).toEqual([]);
    expect(gate.ready).toBe(true);
    // Rescreen window: the same file closing a month later must be rescreened.
    const later = await dealClosingGate(deps, DEAL_ID, new Date("2026-12-10T00:00:00Z"));
    expect(later.ready).toBe(false);
    expect(later.reasons.some((r) => /Rescreen before closing/.test(r))).toBe(true);
    expect(ana.id).toBeTruthy();
  });

  it("requires a CSLB check before accepting a contractor license item", async () => {
    const desk = memoryDesk({ now: () => NOW });
    const deps = checklistDeps(desk);
    const { items } = await createDealChecklist(deps, { dealId: DEAL_ID, program: "CONSTRUCTION", createdBy: "b" });
    const gc = items.find((i) => i.lookup === "cslb_license")!;
    await expect(moveItem(deps, { itemId: gc.id, expectedVersion: 1, to: "accepted", actor: staff })).rejects.toThrow(/Verify the contractor's license/);
    const verified = await recordContractorLicense(deps, { itemId: gc.id, expectedVersion: 1, staffEmail: broker.email, verification: { licenseNumber: "1012345", businessName: "Build Co", status: "active", classifications: ["B"], expiresOn: "2028-01-31", bondOnFile: true, workersCompOnFile: true } });
    expect(verified.verification).toMatchObject({ satisfied: true, checkedBy: broker.email, source: "cslb_manual" });
    const accepted = await moveItem(deps, { itemId: gc.id, expectedVersion: verified.version, to: "accepted", actor: staff });
    expect(accepted.status).toBe("accepted");
    await expect(moveItem(deps, { itemId: gc.id, expectedVersion: 1, to: "requested", actor: staff })).rejects.toThrow(/changed since you loaded/);
  });

  it("marks portal-captured exhibits received for the principal", async () => {
    const { deps, ana } = await dealWithPrincipals();
    await syncDealPrincipalItems(deps, DEAL_ID);
    expect(await markCapturedInPortal(deps, DEAL_ID, ana.id, ["pfs", "reo_schedule"])).toBe(2);
    const items = (await deps.checklists.itemsForDeal(DEAL_ID)).filter((i) => i.principalId === ana.id);
    expect(items.filter((i) => i.status === "submitted").map((i) => i.templateKey).sort()).toEqual(["pfs", "reo_schedule"]);
  });

  it("saves the hard money file with computed metrics and optimistic versions", async () => {
    const desk = memoryDesk({ now: () => NOW });
    const deps = checklistDeps(desk);
    const input = { dealId: DEAL_ID, strategy: "BRIDGE" as const, purpose: "REFINANCE" as const, purchasePrice: 0, asIsValue: 1_000_000, arv: 1_300_000, arvSource: "appraisal" as const, requestedLoanAmount: 800_000, contingencyPct: 10, scopeOfWork: [], trackRecord: [], exitPlan: { type: "refinance" as const, targetMonths: 18, refinanceProgram: "DSCR 5+ units", refinanceLoanAmount: 900_000 } };
    const v1 = await saveHmUnderwriting(deps, input, broker.email, null);
    expect(v1.metrics).toMatchObject({ tier: "NEW", asIsLtv: 0.8 });
    await expect(saveHmUnderwriting(deps, input, broker.email, null)).rejects.toThrow(/changed by someone else/);
    const v2 = await saveHmUnderwriting(deps, { ...input, requestedLoanAmount: 750_000 }, broker.email, 1);
    expect(v2.version).toBe(2);
    await expect(saveHmUnderwriting(deps, { ...input, arv: -1 }, broker.email, 2)).rejects.toThrow(/arv/);
  });
});

describe("borrower portal links", () => {
  const SECRET = "s".repeat(40);

  it("issues a single-use, expiring link that starts a session tied to the invite", async () => {
    const desk = memoryDesk();
    const issued = await issuePortalInvite(desk.invites, { dealId: DEAL_ID, principalId: null, email: "Ana@Example.com", issuedBy: broker.email, origin: "https://kuberacommercial.com/", now: NOW }, { gate: desk.gate });
    const token = new URL(issued.url).searchParams.get("token")!;
    expect(issued.url).toMatch(/^https:\/\/kuberacommercial\.com\/portal\/access\?token=/);
    expect(issued.invite.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(desk.invites.rows.get(issued.invite.id))).not.toContain(token);
    // The invitation email waits for a broker's approval (the gate is pending here).
    expect(issued.email).toBe("pending");
    expect(desk.gate.requests[0]).toMatchObject({ kind: "email", templateId: "portal_invite", idempotencyKey: `email:portal_invite:${issued.invite.id}` });

    const session = await redeemPortalLink(desk.invites, token, NOW);
    expect(session).toMatchObject({ dealId: DEAL_ID, email: "ana@example.com", principalId: null });
    await expect(redeemPortalLink(desk.invites, token, NOW)).rejects.toMatchObject({ code: "used" });

    const cookie = encodeSession(session, SECRET);
    expect(await verifySession(desk.invites, cookie, SECRET, NOW)).toEqual(session);
    expect(decodeSession(cookie, "x".repeat(40), NOW)).toBeNull();
    expect(decodeSession(cookie.replace(/.$/, (c) => (c === "A" ? "B" : "A")), SECRET, NOW)).toBeNull();
    expect(await verifySession(desk.invites, cookie, SECRET, new Date(NOW.getTime() + 9 * 3_600_000))).toBeNull();
    await desk.invites.revoke(issued.invite.id, NOW);
    expect(await verifySession(desk.invites, cookie, SECRET, NOW)).toBeNull();
  });

  it("rejects expired, revoked and malformed links", async () => {
    const desk = memoryDesk();
    const a = await issuePortalInvite(desk.invites, { dealId: DEAL_ID, principalId: null, email: "a@x.com", issuedBy: "b", origin: "https://k.test", now: NOW, ttlHours: 1 });
    const tokenA = new URL(a.url).searchParams.get("token")!;
    await expect(redeemPortalLink(desk.invites, tokenA, new Date(NOW.getTime() + 2 * 3_600_000))).rejects.toMatchObject({ code: "expired" });
    const b = await issuePortalInvite(desk.invites, { dealId: DEAL_ID, principalId: null, email: "a@x.com", issuedBy: "b", origin: "https://k.test", now: NOW });
    await desk.invites.revoke(b.invite.id, NOW);
    await expect(redeemPortalLink(desk.invites, new URL(b.url).searchParams.get("token")!, NOW)).rejects.toMatchObject({ code: "revoked" });
    await expect(redeemPortalLink(desk.invites, "short", NOW)).rejects.toBeInstanceOf(PortalLinkError);
    await expect(redeemPortalLink(desk.invites, "A".repeat(43), NOW)).rejects.toMatchObject({ code: "invalid" });
  });
});
