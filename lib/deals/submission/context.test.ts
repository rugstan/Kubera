import { afterEach, describe, expect, it, vi } from "vitest";
import { createDealChecklist } from "@/lib/checklists/service";
import { MemoryChecklistStore } from "@/lib/checklists/store";
import { MemoryConstructionStore } from "@/lib/construction/store";
import { addPrincipal, updatePrincipal } from "@/lib/principals/service";
import { MemoryPrincipalStore } from "@/lib/principals/store";
import type { Pfs } from "@/lib/principals/types";
import { createKeyring } from "@/lib/privacy/crypto";
import { MemoryDealHoldStore, MemoryScreeningStore } from "@/lib/screening/store";
import { MemorySpreadStore, type NewSpread } from "@/lib/spreads/store";
import { MemoryDealDeskStore } from "../store";
import type { DealProgram } from "../types";
import {
  constructionSourceFromStore,
  loadSubmissionContext,
  loanBackers,
  propertyAddressOf,
  staticLeadIntakeSource,
  sumGuarantorTotals,
  type SubmissionContextDeps,
} from "./context";
import { MemorySubmissionStore } from "./store";
import { submissionFixture } from "./test-fixtures";

const NOW = new Date("2026-11-20T17:00:00.000Z");
const KEY = createKeyring({ version: 1, key: Buffer.alloc(32, 0x21) });
const LEAD = "4ead0000-0000-4000-8000-000000000001";

afterEach(() => vi.restoreAllMocks());

const pfs = (cash: number, securities: number, realEstate: number, mortgages: number, asOf = "2026-10-15"): Pfs => ({
  asOf,
  assets: { cash, marketableSecurities: securities, retirementAccounts: 500_000, realEstate, businessInterests: 0, otherAssets: 0 },
  liabilities: { mortgages, notesPayable: 0, creditCards: 0, taxesOwed: 0, otherLiabilities: 0 },
  contingentLiabilities: { guarantees: 0, legalClaims: 0, other: 0 },
  annualIncome: { salary: 0, investmentIncome: 0, realEstateIncome: 0, otherIncome: 0 },
});

type Desk = Awaited<ReturnType<typeof desk>>;

async function desk(opts: { program?: DealProgram; leadId?: string | null } = {}) {
  const deals = new MemoryDealDeskStore();
  const deal = await deals.createDeal(
    { title: "Brindlewood Court", program: opts.program ?? "PRIVATE_BRIDGE", stage: "packaging", stageTemplateVersion: 1, leadId: opts.leadId === undefined ? LEAD : opts.leadId, borrowerName: "Brindlewood Court Partners LLC", propertyAddress: "4100 Brindlewood Court, Oakland, CA 94611", propertyState: "CA", loanAmountCents: 840_000_000 },
    "broker:ana",
    NOW,
  );
  const checklist = { checklists: new MemoryChecklistStore(), principals: new MemoryPrincipalStore(), holds: new MemoryDealHoldStore(), screenings: new MemoryScreeningStore() };
  const spreads = new MemorySpreadStore();
  const construction = new MemoryConstructionStore();
  const submission = new MemorySubmissionStore();
  const lookups: unknown[] = [];
  const leads = new Map([[LEAD, { intake: submissionFixture("bridge").intake as unknown, createdAt: "2026-09-08T16:20:00.000Z" }]]);
  const deps: SubmissionContextDeps = {
    store: deals,
    checklist,
    keyring: KEY,
    now: () => NOW,
    vaultDocuments: async (leadId) => (leadId === LEAD ? [{ id: "d0c00000-0000-4000-8000-000000000001", kind: "T12", fileName: "T-12 through Sep 2026.pdf", createdAt: "2026-10-03T17:00:00.000Z" }] : []),
    submission: {
      store: submission,
      leads: staticLeadIntakeSource(leads),
      spreads,
      construction: constructionSourceFromStore(construction),
      propertyFacts: {
        async lookup(address, apn) {
          lookups.push({ address, apn });
          return { id: "fac70000-0000-4000-8000-000000000001", apn: "048A-7012-015-00", county: "Alameda", floodZone: "X", yearBuilt: 1972, fetchedAt: "2026-10-01T15:00:00.000Z" };
        },
      },
    },
  };
  return { deal, deps, deals, checklist, spreads, construction, submission, leads, lookups };
}

async function addSponsors(d: Desk, opts: { guarantors?: boolean; key?: typeof KEY } = {}) {
  const pdeps = { principals: d.checklist.principals, keyring: opts.key ?? KEY, now: () => NOW };
  const entity = await addPrincipal(pdeps, { dealId: d.deal.id, kind: "entity", legalName: "Brindlewood Court Partners LLC", roles: ["borrower_entity"], formationState: "CA" });
  const roles = opts.guarantors === false ? (["managing_member"] as const) : (["managing_member", "guarantor"] as const);
  const a = await addPrincipal(
    pdeps,
    { dealId: d.deal.id, parentId: entity.principal.id, kind: "individual", legalName: "Rowan Ellingsworth", roles: [...roles], ownershipPct: 60, email: "rowan@example.com", phone: "415-555-0100", homeAddress: "1 Private Lane, Oakland", citizenship: "us_citizen" },
    { pfs: pfs(1_000_000, 600_000, 14_000_000, 3_000_000), ssn: "123-45-6789" },
  );
  const b = await addPrincipal(
    pdeps,
    { dealId: d.deal.id, parentId: entity.principal.id, kind: "individual", legalName: "Jules Marrowind", roles: opts.guarantors === false ? ["member"] : ["member", "guarantor"], ownershipPct: 40 },
    { pfs: pfs(500_000, 450_000, 8_000_000, 2_000_000, "2026-09-01") },
  );
  await updatePrincipal(pdeps, a.principal.id, a.principal.version, {
    reoSchedule: [{ address: "12 Example Way, Oakland CA", propertyType: "Multifamily", ownershipPct: 50, status: "owned", marketValue: 4_000_000, loanBalance: 2_000_000, monthlyDebtService: 12_000, annualNoi: 260_000, inDefault: false }],
  });
  return { entity: entity.principal, a: a.principal, b: b.principal };
}

describe("loadSubmissionContext", () => {
  it("returns null for a deal that does not exist", async () => {
    const d = await desk();
    expect(await loadSubmissionContext(d.deps, "00000000-0000-4000-8000-000000000999")).toBeNull();
  });

  it("degrades when no desk is configured, and fails closed on sanctions holds", async () => {
    const d = await desk();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = (await loadSubmissionContext({ ...d.deps, checklist: null, submission: { store: d.submission, leads: null, spreads: null, construction: null, propertyFacts: null } }, d.deal.id))!;
    expect(ctx).toMatchObject({ profile: null, sponsor: null, intake: null, intakeReceivedAt: null, spreads: null, spreadBundleKinds: [], principals: [], guarantorTotals: null, reoSummary: null, hardMoney: null, construction: null, propertyFacts: null, checklistItems: [] });
    expect(ctx.spreadFigures).toEqual({ globalCashFlow: null, constructionBudget: null, hotelStr: null, quotes: null });
    expect(ctx.openHolds).toHaveLength(1);
    expect(ctx.openHolds[0]).toMatch(/not configured/);
    expect(ctx.vaultDocuments).toHaveLength(1);
    expect(ctx.now).toEqual(NOW);
    expect(warn).not.toHaveBeenCalled();
  });

  it("carries the profile, sponsor, intake, vault documents, property facts and checklist items", async () => {
    const d = await desk();
    const fx = submissionFixture("bridge");
    const { id: _i, dealId: _d, createdAt: _c, createdBy: _cb, updatedAt: _u, updatedBy: _ub, recordVersion: _v, ...fields } = fx.profile!;
    await d.submission.upsertProfile(d.deal.id, null, fields, "broker:ana", NOW);
    await d.submission.upsertSponsor(d.deal.id, null, { creditBand: "740_PLUS", yearsExperience: 14 }, "broker:ana", NOW);
    await createDealChecklist(d.checklist, { dealId: d.deal.id, program: "BRIDGE", createdBy: "broker:ana" });
    const ctx = (await loadSubmissionContext(d.deps, d.deal.id))!;
    expect(ctx.profile!.purpose).toBe("acquisition");
    expect(ctx.sponsor).toMatchObject({ creditBand: "740_PLUS", yearsExperience: 14 });
    expect(ctx.intake).toMatchObject({ assetType: "MULTIFAMILY", noi: 750_000, notes: "" });
    expect(ctx.intakeReceivedAt).toBe("2026-09-08T16:20:00.000Z");
    expect(ctx.vaultDocuments.map((v) => v.kind)).toEqual(["T12"]);
    expect(ctx.propertyFacts).toMatchObject({ apn: "048A-7012-015-00", yearBuilt: 1972 });
    expect(d.lookups).toEqual([{ address: { line1: "4100 Brindlewood Court", city: "Oakland", state: "CA", zip: "94611" }, apn: "048A-7012-015-00" }]);
    expect(ctx.checklistItems.length).toBeGreaterThan(5);
    expect(Object.keys(ctx.checklistItems[0]!).sort()).toEqual(["category", "docKind", "documentDate", "id", "itemKey", "principalId", "required", "stage", "status", "templateKey", "title"]);
    expect(ctx.openHolds).toEqual([]);
  });

  it("leaves out an intake that no longer parses", async () => {
    const d = await desk();
    d.leads.set(LEAD, { intake: { assetType: "CASTLE" }, createdAt: "2026-09-08T16:20:00.000Z" });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = (await loadSubmissionContext(d.deps, d.deal.id))!;
    expect(ctx.intake).toBeNull();
    expect(ctx.intakeReceivedAt).toBeNull();
  });

  it("narrows principals, computes what each owes and sums the guarantors' PFS totals in cents", async () => {
    const d = await desk();
    const { a, b } = await addSponsors(d);
    const ctx = (await loadSubmissionContext(d.deps, d.deal.id))!;
    expect(ctx.principals).toHaveLength(3);
    const keys = ["effectivePct", "formationState", "hasCreditAuthorization", "hasForm1919", "hasHud2530", "hasPfs", "hasReoSchedule", "id", "isGuarantor", "kind", "legalName", "owes", "ownershipPct", "parentId", "pfsAsOf", "roles", "title"];
    for (const p of ctx.principals) expect(Object.keys(p).sort()).toEqual(keys);
    const blob = JSON.stringify(ctx);
    for (const secret of ["rowan@example.com", "415-555-0100", "1 Private Lane", "us_citizen", "123456789", "pii1."]) expect(blob).not.toContain(secret);
    const ra = ctx.principals.find((p) => p.id === a.id)!;
    expect(ra).toMatchObject({ effectivePct: 60, hasPfs: true, hasReoSchedule: true });
    expect(ra.owes).toEqual(expect.arrayContaining(["guaranty", "pfs", "reo_schedule"]));
    // Net worth: assets − liabilities; liquidity: cash + securities (retirement excluded), summed.
    expect(ctx.guarantorTotals).toEqual({
      netWorthCents: (1_000_000 + 600_000 + 500_000 + 14_000_000 - 3_000_000 + 500_000 + 450_000 + 500_000 + 8_000_000 - 2_000_000) * 100,
      liquidityCents: (1_600_000 + 950_000) * 100,
      pfsCount: 2,
      guarantorCount: 2,
      oldestPfsAsOf: "2026-09-01",
    });
    expect(ctx.reoSummary).toMatchObject({ properties: 1, marketValue: 2_000_000, debt: 1_000_000 });
    expect(ctx.principals.find((p) => p.id === b.id)!.hasReoSchedule).toBe(false);
  });

  it("on a program with no guaranty (HUD) sums the key principals", async () => {
    const d = await desk({ program: "HUD_MULTIFAMILY" });
    await addSponsors(d, { guarantors: false });
    const ctx = (await loadSubmissionContext(d.deps, d.deal.id))!;
    expect(ctx.principals.some((p) => p.owes.includes("guaranty"))).toBe(false);
    expect(ctx.guarantorTotals).toMatchObject({ pfsCount: 2, guarantorCount: 2 });
  });

  it("leaves the totals out, without failing or logging names, when a PFS cannot be opened", async () => {
    const d = await desk();
    await addSponsors(d, { key: createKeyring({ version: 1, key: Buffer.alloc(32, 0x55) }) });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = (await loadSubmissionContext(d.deps, d.deal.id))!;
    expect(ctx.guarantorTotals).toBeNull();
    expect(ctx.principals).toHaveLength(3);
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/Rowan|Jules|Ellingsworth/);
  });

  it("lists open sanctions holds, and turns an unreadable hold list into a hard stop", async () => {
    const d = await desk();
    await d.checklist.holds.open({ dealId: d.deal.id, reason: "sanctions_potential_match", sourceKind: "screening", sourceId: "s1", detail: "Possible OFAC match on a principal", createdBy: "system" }, NOW);
    expect((await loadSubmissionContext(d.deps, d.deal.id))!.openHolds).toEqual(["Possible OFAC match on a principal"]);
    vi.spyOn(d.checklist.holds, "active").mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = (await loadSubmissionContext(d.deps, d.deal.id))!;
    expect(ctx.openHolds).toHaveLength(1);
    expect(ctx.openHolds[0]).toMatch(/could not be checked/);
  });

  it("degrades one failing reader without losing the others", async () => {
    const d = await desk();
    vi.spyOn(d.spreads, "latest").mockRejectedValue(new Error("spreads offline"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = (await loadSubmissionContext(d.deps, d.deal.id))!;
    expect(ctx.spreads).toBeNull();
    expect(ctx.intake).not.toBeNull();
    expect(warn.mock.calls.flat().join(" ")).toMatch(/saved spreads unavailable: spreads offline/);
  });

  it("reads the construction project, its reports and the newest license check", async () => {
    const d = await desk({ program: "CONSTRUCTION" });
    const project = await d.construction.insertProject({ dealId: d.deal.id, leadId: null, name: "Copperfinch", program: "DEBT_FUND_CONSTRUCTION", assetType: "MULTIFAMILY", propertyAddress: "2250 Larkmoor St", city: "Sacramento", state: "CA", zip: "95811", units: 64, seismicZone: true, newConstruction: true, generalContractorName: "Saltbridge Builders Inc.", generalContractorLicense: "1094372", notes: null }, NOW);
    await d.construction.insertProject({ dealId: null, leadId: null, name: "Other", program: "DEBT_FUND_CONSTRUCTION", assetType: "MULTIFAMILY", propertyAddress: null, city: null, state: null, zip: null, units: 10, seismicZone: false, newConstruction: true, generalContractorName: null, generalContractorLicense: null, notes: null }, NOW);
    const check = (status: "clear" | "issues", at: string) => ({ projectId: project.id, licenseNumber: "1094372", contractorName: "Saltbridge Builders Inc.", status, issues: [], snapshot: null, checkedAt: at, checkedBy: "broker:ana" });
    await d.construction.insertLicenseCheck(check("issues", "2026-10-01T17:00:00.000Z") as never, NOW);
    await d.construction.insertLicenseCheck(check("clear", "2026-10-21T17:00:00.000Z") as never, NOW);
    const ctx = (await loadSubmissionContext(d.deps, d.deal.id))!;
    expect(ctx.construction!.project.id).toBe(project.id);
    expect(ctx.construction!.licenseCheck!.status).toBe("clear");
    expect(ctx.construction!.reports).toEqual([]);
  });
});

describe("saved spreads", () => {
  const subject = (dealId: string) => ({ dealId, leadId: null });
  const row = (dealId: string, kind: NewSpread["kind"], results: unknown, lenderProfile: NewSpread["lenderProfile"] = null): NewSpread => ({ ...subject(dealId), kind, lenderProfile, sourceExtractionIds: [], inputs: {}, results, flags: [], createdBy: "spreads" });
  const noi = (profile: string, reported: number, underwritten: number) => ({ profile, reportedNoi: reported, underwrittenNoi: underwritten, reportedEgi: 1_410_000, underwrittenEgi: 1_379_000, reportedOpex: 645_000, underwrittenOpex: 645_000 });

  it("shows the playbook's lender profile, lists the saved kinds and reads the extra figures", async () => {
    const d = await desk();
    const id = d.deal.id;
    await d.spreads.insert(row(id, "operating_statement", noi("AGENCY", 765_000, 750_000), "AGENCY"));
    const bridge = await d.spreads.insert(row(id, "operating_statement", noi("BRIDGE", 765_000, 734_000), "BRIDGE"));
    await d.spreads.insert(row(id, "rent_roll", { physicalOccupancy: 0.88, units: 42 }));
    const gcf = await d.spreads.insert(row(id, "global_cash_flow", { globalDscr: 2.18, businessDscr: 2.41 }));
    await d.spreads.insert(row(id, "construction_budget", { totals: { land: 1, hard: 2, soft: 3, contingency: 4, developerFee: 5, financing: 6, reserves: 7, total: 28 } }));
    await d.spreads.insert(row(id, "hotel_str", { ttm: { occupancy: 0.784, adr: 152, revpar: 119.17, rgi: 108.4 }, lastMonth: "2026-10" }));
    await d.spreads.insert(row(id, "quotes", { noi: { profile: "AGENCY", noi: 750_000 }, quotes: [{ lender: "X", loanAmount: 8_400_000, dscr: 1.2, debtYield: 0.09, ltv: 0.7 }] }, "AGENCY"));
    await d.spreads.insert(row(id, "deal_summary", { quoteNoi: { profile: "AGENCY", noi: 750_000 }, kinds: ["operating_statement", "operating_statement", "rent_roll", "global_cash_flow", "construction_budget", "hotel_str", "quotes"] }));
    const ctx = (await loadSubmissionContext(d.deps, id))!;
    expect(ctx.spreads).toMatchObject({ profile: "BRIDGE", noiCents: 76_500_000, underwrittenNoiCents: 73_400_000, occupancyPct: 88, units: 42 });
    expect(ctx.spreads!.sourceSpreadIds[1]).toBe(bridge.id);
    expect(ctx.spreadBundleKinds).toEqual(["operating_statement", "quotes", "global_cash_flow", "hotel_str", "rent_roll", "construction_budget", "deal_summary"]);
    expect(ctx.spreadFigures.globalCashFlow).toEqual({ spreadId: gcf.id, asOf: gcf.createdAt.slice(0, 10), globalDscr: 2.18, businessDscr: 2.41 });
    expect(ctx.spreadFigures.constructionBudget).toMatchObject({ budget: { landCents: 100, hardCents: 200, softCents: 300, contingencyCents: 400, developerFeeCents: 500, financingCents: 600, reservesCents: 700 }, totalCents: 2800 });
    expect(ctx.spreadFigures.hotelStr).toMatchObject({ occupancyPct: 78.4, adrCents: 15_200, revparCents: 11_917, revparIndex: 108.4, lastMonth: "2026-10" });
    // Saved quotes keep the loan constant, not the rate and amortization, so none is usable as "DSCR at the quoted terms".
    expect(ctx.spreadFigures.quotes).toBeNull();
  });

  it("falls back to the lead's spreads, and reads quote rows that carry their terms", async () => {
    const d = await desk();
    const lead = { dealId: null, leadId: LEAD };
    await d.spreads.insert({ ...lead, kind: "quotes", lenderProfile: null, sourceExtractionIds: [], inputs: {}, results: { quotes: [{ lender: "Q", loanAmount: 8_400_000, ratePct: 6.5, amortYears: 30, dscr: 1.18, debtYield: 0.0874, ltv: null }] }, flags: [], createdBy: "s" });
    await d.spreads.insert({ ...lead, kind: "deal_summary", lenderProfile: null, sourceExtractionIds: [], inputs: {}, results: { quoteNoi: null, kinds: ["quotes"] }, flags: [], createdBy: "s" });
    const ctx = (await loadSubmissionContext(d.deps, d.deal.id))!;
    expect(ctx.spreads).not.toBeNull();
    expect(ctx.spreadFigures.quotes!.rows).toEqual([{ lender: "Q", loanAmountCents: 840_000_000, ratePct: 6.5, amortYears: 30, dscr: 1.18, debtYieldPct: 8.74, ltvPct: null }]);
  });
});

describe("helpers", () => {
  it("parses the deal address for the property-facts cache", () => {
    expect(propertyAddressOf({ propertyAddress: "4100 Brindlewood Court, Oakland, CA 94611", propertyState: "CA" }, null)).toEqual({ line1: "4100 Brindlewood Court", city: "Oakland", state: "CA", zip: "94611" });
    expect(propertyAddressOf({ propertyAddress: "100 Example Way, Sacramento", propertyState: null }, { city: null, postalCode: "95811" })).toEqual({ line1: "100 Example Way", city: "Sacramento", zip: "95811" });
    expect(propertyAddressOf({ propertyAddress: "88 Hollowcrest Way", propertyState: "ca" }, { city: "San Jose", postalCode: null })).toEqual({ line1: "88 Hollowcrest Way", city: "San Jose", state: "CA" });
    expect(propertyAddressOf({ propertyAddress: null, propertyState: "CA" }, null)).toBeNull();
  });

  it("backs the loan with guarantors, or key principals only where no program has a guaranty", () => {
    const fx = submissionFixture("bridge").principals;
    expect(loanBackers(fx, ["BRIDGE"]).map((p) => p.kind)).toEqual(["individual", "individual"]);
    const hud = submissionFixture("hud_multifamily").principals;
    expect(loanBackers(hud, ["HUD_MULTIFAMILY_223F"]).length).toBe(hud.filter((p) => p.kind === "individual").length);
    expect(loanBackers(hud.map((p) => ({ ...p, owes: p.owes.filter((o) => o !== "guaranty") })), ["BRIDGE"])).toEqual([]);
  });

  it("sums only backers with a PFS and returns null when none has one", () => {
    const fx = submissionFixture("bridge").principals;
    const backers = loanBackers(fx, ["BRIDGE"]);
    expect(sumGuarantorTotals(backers, [])).toBeNull();
    expect(sumGuarantorTotals(backers, [{ principalId: backers[0]!.id, netWorth: 12_100_000.4, liquidity: 1_600_000, asOf: "2026-10-15" }, { principalId: "someone-else", netWorth: 1, liquidity: 1, asOf: "2020-01-01" }])).toEqual({
      netWorthCents: 1_210_000_040,
      liquidityCents: 160_000_000,
      pfsCount: 1,
      guarantorCount: 2,
      oldestPfsAsOf: "2026-10-15",
    });
  });
});
