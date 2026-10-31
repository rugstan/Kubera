import { describe, expect, it } from "vitest";
import { principalObligations } from "@/lib/principals/requirements";
import { sampleChart } from "@/lib/principals/test-fixtures";
import { conditionsBlockingClosing, overdueConditions, transitionCondition, type Condition } from "./conditions";
import { evaluateCslb } from "./cslb";
import { checklistReadiness, instantiateItems, isStale, outstandingForBorrower, RETIRED_REASON, syncPrincipalItems, transitionItem, type NewChecklistItem } from "./engine";
import { hmMetrics, hmUnderwritingSchema } from "./hm-underwriting";
import { CHECKLIST_TEMPLATES } from "./templates";
import type { DealChecklistItem } from "./types";
import { uploadRequestSchema } from "./uploads";

const NOW = new Date("2026-11-03T12:00:00Z");
const DEAL = "11111111-1111-4111-8111-111111111111";
let seq = 0;
const asItem = (n: NewChecklistItem, over: Partial<DealChecklistItem> = {}): DealChecklistItem => ({ ...n, id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`, checklistId: "c1", version: 1, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), ...over });

describe("instantiating a checklist", () => {
  it("expands per-principal items for each principal that owes them", () => {
    const s = sampleChart();
    const ob = principalObligations(["SBA_7A"], s.all);
    const items = instantiateItems(CHECKLIST_TEMPLATES.SBA_7A, DEAL, ob);
    const pfs = items.filter((i) => i.templateKey === "pfs");
    expect(pfs.map((i) => i.title)).toEqual(["Personal financial statement (SBA Form 413) — Ana Ruiz", "Personal financial statement (SBA Form 413) — Ben Ode", "Personal financial statement (SBA Form 413) — Cal Pine"]);
    expect(pfs[0]!.itemKey).toBe(`pfs:${s.ana.id}`);
    expect(items.filter((i) => i.templateKey === "form_1919")).toHaveLength(4); // three 20%+ owners and the managing-member entity
    expect(items.find((i) => i.itemKey === "entity_formation")).toMatchObject({ status: "requested", principalId: null, required: true });
    expect(new Set(items.map((i) => i.itemKey)).size).toBe(items.length);
    // Without principals the per-principal items simply wait.
    expect(instantiateItems(CHECKLIST_TEMPLATES.SBA_7A, DEAL).some((i) => i.principalId)).toBe(false);
  });

  it("syncs per-principal items when the chart changes without discarding work", () => {
    const s = sampleChart();
    const t = CHECKLIST_TEMPLATES.BRIDGE;
    const initial = instantiateItems(t, DEAL, principalObligations(["BRIDGE"], s.all)).map((i) => asItem(i));
    // Ben submits his PFS, then sells down to 5%: his untouched items retire, the submitted one stays.
    const benPfs = initial.find((i) => i.itemKey === `pfs:${s.ben.id}`)!;
    benPfs.status = "submitted";
    const sponsor = { ...s.sponsor };
    const benSmall = { ...s.ben, ownershipPct: 5 };
    const sync = syncPrincipalItems(t, DEAL, initial, principalObligations(["BRIDGE"], [s.borrower, sponsor, s.ana, benSmall, s.cal, s.dee]));
    expect(sync.add).toEqual([]);
    expect(sync.retire.every((i) => i.principalId === s.ben.id && i.status === "requested")).toBe(true);
    expect(sync.retire.some((i) => i.id === benPfs.id)).toBe(false);
    // Dee becomes a named guarantor: her items are added.
    const sync2 = syncPrincipalItems(t, DEAL, initial, principalObligations(["BRIDGE"], [...s.all.filter((p) => p.id !== s.dee.id), { ...s.dee, isGuarantor: true }]));
    expect(sync2.add.map((i) => i.templateKey).sort()).toEqual(["credit_authorization", "government_id", "guaranty", "pfs", "reo_schedule", "sponsor_resume"]);
    // A retired instance comes back when owed again.
    const retired = initial.map((i) => (i.principalId === s.ben.id && i.status === "requested" ? { ...i, status: "not_applicable" as const, waivedReason: RETIRED_REASON } : i));
    expect(syncPrincipalItems(t, DEAL, retired, principalObligations(["BRIDGE"], s.all)).revive.length).toBeGreaterThan(0);
  });
});

describe("item transitions", () => {
  const base = () => asItem(instantiateItems(CHECKLIST_TEMPLATES.AGENCY_MULTIFAMILY, DEAL).find((i) => i.itemKey === "rent_roll_certified")!);

  it("lets borrowers submit only their own items", () => {
    const item = base();
    expect(transitionItem(item, { to: "submitted", actor: { kind: "borrower", principalId: null, email: "b@x.com" }, now: NOW })).toEqual({ status: "submitted", submittedAt: NOW.toISOString() });
    expect(() => transitionItem(item, { to: "accepted", actor: { kind: "borrower", principalId: null, email: "b@x.com" }, now: NOW })).toThrow(/only submit/);
    expect(() => transitionItem({ ...item, responsible: "lender" }, { to: "submitted", actor: { kind: "borrower", principalId: null, email: "b@x.com" }, now: NOW })).toThrow(/not one you provide/);
    expect(() => transitionItem({ ...item, principalId: "p1" }, { to: "submitted", actor: { kind: "borrower", principalId: "p2", email: "b@x.com" }, now: NOW })).toThrow(/another principal/);
    expect(() => transitionItem({ ...item, status: "accepted" }, { to: "submitted", actor: { kind: "borrower", principalId: null, email: "b@x.com" }, now: NOW })).toThrow(/already with your advisor/);
    expect(() => transitionItem(item, { to: "accepted", actor: { kind: "system", id: "x" }, now: NOW })).toThrow(/Only staff/);
  });

  it("requires a document date on dated items, a note to reject and a reason to waive", () => {
    const staff = { kind: "staff" as const, id: "broker@k.com" };
    const item = { ...base(), status: "submitted" as const };
    expect(() => transitionItem(item, { to: "accepted", actor: staff, now: NOW })).toThrow(/document date/);
    expect(() => transitionItem(item, { to: "accepted", actor: staff, documentDate: "2027-01-01", now: NOW })).toThrow(/future/);
    expect(transitionItem(item, { to: "accepted", actor: staff, documentDate: "2026-10-20", now: NOW })).toMatchObject({ status: "accepted", documentDate: "2026-10-20", reviewedBy: "broker@k.com" });
    expect(() => transitionItem(item, { to: "rejected", actor: staff, now: NOW })).toThrow(/what to fix/);
    expect(() => transitionItem(item, { to: "waived", actor: staff, note: "no", now: NOW })).toThrow(/reason/);
    expect(transitionItem(item, { to: "waived", actor: staff, note: "Lender waived the certified rent roll for this loan.", now: NOW })).toMatchObject({ status: "waived" });
    expect(() => transitionItem({ ...item, status: "waived" }, { to: "accepted", actor: staff, now: NOW })).toThrow(/Cannot move/);
  });
});

describe("closing readiness", () => {
  it("blocks on missing, stale and unverified items and passes once everything is satisfied", () => {
    const items = instantiateItems(CHECKLIST_TEMPLATES.CONSTRUCTION, DEAL).map((i) => asItem(i));
    const r0 = checklistReadiness(items, { now: NOW });
    expect(r0.ready).toBe(false);
    expect(r0.requiredSatisfied).toBe(0);
    const done = items.map((i) => (i.required ? { ...i, status: "accepted" as const, documentDate: "2026-10-30", reviewedBy: "b" } : i));
    const r1 = checklistReadiness(done, { now: NOW });
    expect(r1.blocking).toEqual([{ itemId: expect.any(String), title: "General contractor license (CSLB)", reason: "Contractor license not verified active on CSLB." }]);
    const verified = done.map((i) =>
      i.lookup === "cslb_license"
        ? { ...i, verification: evaluateCslb({ licenseNumber: "1012345", businessName: "Build Co", status: "active", classifications: ["B"], expiresOn: "2028-01-31", bondOnFile: true, workersCompOnFile: true }, { now: NOW, checkedBy: "b", source: "cslb_manual" }) }
        : i,
    );
    expect(checklistReadiness(verified, { now: NOW })).toMatchObject({ ready: true, percent: 100 });
    // Six months later the dated reports are stale for a closing then.
    const later = checklistReadiness(verified, { now: NOW, closingDate: new Date("2027-06-01T00:00:00Z") });
    expect(later.ready).toBe(false);
    expect(later.blocking.every((b) => /Out of date at closing/.test(b.reason))).toBe(true);
    expect(isStale(verified.find((i) => i.recencyDays)!, new Date("2027-06-01T00:00:00Z"))).toBe(true);
  });

  it("lists what the borrower still owes, required first", () => {
    const items = instantiateItems(CHECKLIST_TEMPLATES.BRIDGE, DEAL).map((i) => asItem(i));
    const out = outstandingForBorrower(items);
    expect(out.every((i) => i.responsible === "borrower")).toBe(true);
    expect(out[0]!.required).toBe(true);
    expect(out.at(-1)!.required).toBe(false);
  });
});

describe("CSLB verification", () => {
  it("lists every problem with the license", () => {
    const v = evaluateCslb({ licenseNumber: "999", businessName: "Bad Co", status: "suspended", classifications: ["C-10"], expiresOn: "2026-12-01", bondOnFile: false, workersCompOnFile: true }, { now: NOW, checkedBy: "b", source: "cslb_manual", closingDate: new Date("2027-01-15T00:00:00Z") });
    expect(v.satisfied).toBe(false);
    expect(v.problems).toEqual(["License status is suspended.", "No general contractor classification (A or B).", "No contractor bond on file.", "License expires 2026-12-01, before closing."]);
  });
});

describe("conditions", () => {
  const c = (over: Partial<Condition> = {}): Condition => ({ id: "c", dealId: DEAL, source: "lender", lenderName: "Pacific Bank", timing: "prior_to_closing", description: "Updated rent roll", status: "open", responsible: "borrower", dueDate: "2026-11-01", checklistItemId: null, notes: null, clearedBy: null, clearedAt: null, waiverReason: null, waiverEvidence: null, createdBy: "b", version: 1, createdAt: "", updatedAt: "", ...over });

  it("only the imposing party can waive", () => {
    expect(() => transitionCondition(c(), { to: "waived", staffId: "b", note: "Not needed", now: NOW })).toThrow(/written waiver/);
    expect(transitionCondition(c(), { to: "waived", staffId: "b", note: "Lender waived", waiverEvidence: "Email from J. Lee 2026-11-02", now: NOW })).toMatchObject({ status: "waived", waiverEvidence: "Email from J. Lee 2026-11-02" });
    expect(transitionCondition(c({ source: "kubera" }), { to: "waived", staffId: "b", note: "Internal check done elsewhere", now: NOW })).toMatchObject({ status: "waived" });
    expect(() => transitionCondition(c({ status: "cleared" }), { to: "waived", staffId: "b", note: "x", now: NOW })).toThrow(/Cannot move/);
  });

  it("blocks closing until pre-closing conditions are done; post-closing is the lender's", () => {
    const list = [c(), c({ id: "2", status: "cleared" }), c({ id: "3", timing: "post_closing" }), c({ id: "4", status: "waived" })];
    expect(conditionsBlockingClosing(list).map((x) => x.id)).toEqual(["c"]);
    expect(overdueConditions(list, NOW).map((x) => x.id)).toEqual(["c", "3"]);
  });
});

describe("hard money underwriting", () => {
  const file = hmUnderwritingSchema.parse({
    dealId: DEAL,
    strategy: "FIX_AND_FLIP",
    purpose: "PURCHASE",
    purchasePrice: 400_000,
    asIsValue: 420_000,
    arv: 700_000,
    arvSource: "comparable_sales",
    requestedLoanAmount: 450_000,
    contingencyPct: 10,
    scopeOfWork: [
      { category: "kitchen_bath", description: "Two kitchens, three baths", cost: 90_000, weeks: 8, licensedTrade: true },
      { category: "roof", description: "Tear-off and re-roof", cost: 30_000, weeks: 2 },
      { category: "permits_fees", description: "Permits", cost: 5_000 },
    ],
    trackRecord: [
      { address: "1 A St", strategy: "fix_and_flip", purchaseDate: "2024-01-10", purchasePrice: 300_000, rehabCost: 60_000, exitDate: "2024-08-01", exitType: "sold", exitValue: 480_000, role: "sponsor", verified: true },
      { address: "2 B St", strategy: "fix_and_flip", purchaseDate: "2025-02-01", purchasePrice: 350_000, rehabCost: 70_000, exitDate: "2025-09-01", exitType: "sold", exitValue: 520_000, role: "sponsor", verified: false },
      { address: "3 C St", strategy: "fix_and_flip", purchaseDate: "2019-01-01", purchasePrice: 200_000, rehabCost: 40_000, exitDate: "2019-06-01", exitType: "sold", exitValue: 300_000, role: "sponsor", verified: true },
    ],
    exitPlan: { type: "sale", targetMonths: 9, expectedSalePrice: 700_000 },
  });

  it("computes cost basis, leverage and the sponsor tier from verified recent projects", () => {
    const m = hmMetrics(file, NOW);
    expect(m).toMatchObject({ rehabBudget: 125_000, contingency: 12_500, totalCost: 537_500, completedProjects: 2, verifiedProjects: 1, tier: "EMERGING", needsLicensedContractor: true, rehabWeeks: 10 });
    expect(m.ltc).toBeCloseTo(0.8372, 4);
    expect(m.ltarv).toBeCloseTo(0.6429, 4);
    expect(m.limits).toEqual({ maxLtc: 0.85, maxLtarv: 0.7 });
    expect(m.maxLoan).toBe(456_000);
    expect(m.flags).toEqual(["1 track-record project(s) not yet verified (closing statements or deeds)."]);
  });

  it("flags leverage above the grid and an exit that does not work", () => {
    const m = hmMetrics({ ...file, requestedLoanAmount: 560_000, arv: 560_000, exitPlan: { type: "sale", targetMonths: 2 }, trackRecord: [] }, NOW);
    expect(m.tier).toBe("NEW");
    expect(m.flags.join(" ")).toMatch(/Loan-to-cost .* above the 80% limit/);
    expect(m.flags.join(" ")).toMatch(/Loan-to-ARV .* above the 65% limit/);
    expect(m.flags.join(" ")).toMatch(/Rehab schedule runs past the planned exit/);
    expect(m.flags.join(" ")).toMatch(/sale margin/);
    const refi = hmMetrics({ ...file, exitPlan: { type: "refinance", targetMonths: 12, refinanceLoanAmount: 300_000 } }, NOW);
    expect(refi.flags.join(" ")).toMatch(/no take-out program/);
    expect(refi.flags.join(" ")).toMatch(/does not repay this loan/);
  });
});

describe("uploads", () => {
  it("validates type and size before the vault is asked for an upload URL", () => {
    expect(uploadRequestSchema.safeParse({ itemId: DEAL, fileName: "rr.pdf", contentType: "application/zip", sizeBytes: 10 }).success).toBe(false);
    expect(uploadRequestSchema.safeParse({ itemId: DEAL, fileName: "rr.pdf", contentType: "application/pdf", sizeBytes: 60 * 1024 * 1024 }).success).toBe(false);
    expect(uploadRequestSchema.safeParse({ itemId: DEAL, fileName: "rr.pdf", contentType: "application/pdf", sizeBytes: 1024 }).success).toBe(true);
  });
});
