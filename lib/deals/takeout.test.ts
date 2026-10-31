// The construction desk's take-out trigger opens a real deal-desk deal: the
// production DealCreator (lib/deals/takeout.ts) on the deal desk store,
// registered by lib/construction/server.ts when Supabase is configured.
import { afterEach, describe, expect, it, vi } from "vitest";
import { addLeaseUpSnapshot, createProject, createTakeoutDeal, updateConversion } from "@/lib/construction/service";
import { makeDeps, projectInput } from "@/lib/construction/test-fixtures";
import { MemoryDealDeskStore } from "./store";
import { dealDeskTakeoutCreator, takeoutDealProgram } from "./takeout";
import { clockAt } from "./test-fixtures";

vi.mock("server-only", () => ({}));

const conv = (over: Record<string, unknown> = {}) => ({ unitsTotal: "120", coDate: "", loanMaturityDate: "", extensionDeadline: "", payoffTargetDate: "", ...over });
const snapshot = (asOf: string, leased: number, occupied: number) => ({ asOf, unitsLeased: String(leased), unitsOccupied: String(occupied) });

async function triggeredProject(deals: ReturnType<typeof dealDeskTakeoutCreator>) {
  const deps = { ...makeDeps(), deals };
  const project = await createProject(deps, "broker@kubera.test", projectInput({ name: "Harbor View", generalContractorLicense: "", state: "CA" }));
  await deps.store.updateProject(project.id, { phase: "under_construction" }, deps.now());
  await updateConversion(deps, "a", project.id, conv({ coDate: "2026-05-01", loanMaturityDate: "2027-02-01" }));
  await addLeaseUpSnapshot(deps, "a", project.id, snapshot("2026-07-01", 115, 110));
  await addLeaseUpSnapshot(deps, "a", project.id, snapshot("2026-10-15", 117, 114));
  return { deps, project };
}

describe("take-out deal creator (deal desk)", () => {
  it("maps suggested take-out programs to deal-desk stage templates", () => {
    expect(takeoutDealProgram(["HUD_221D4_223F_MULTIFAMILY", "AGENCY_FANNIE_FREDDIE"])).toBe("HUD_MULTIFAMILY");
    expect(takeoutDealProgram(["HUD_232_223F"])).toBe("HUD_232");
    expect(takeoutDealProgram(["AGENCY_FANNIE_FREDDIE"])).toBe("AGENCY");
    expect(takeoutDealProgram(["HOSPITALITY_CMBS_NON_RECOURSE"])).toBe("HOTEL_CMBS");
    expect(takeoutDealProgram([])).toBe("BANK_LIFE_CO");
  });

  it("opens the refinance deal at intake on the mapped template, once per take-out", async () => {
    const store = new MemoryDealDeskStore();
    const { now } = clockAt();
    const { deps, project } = await triggeredProject(dealDeskTakeoutCreator({ store, now }));
    const takeout = await createTakeoutDeal(deps, "broker@kubera.test", project.id);
    expect(takeout).toMatchObject({ status: "deal_created", newDealId: expect.any(String) });

    const deal = (await store.getDeal(takeout.newDealId!))!;
    expect(deal).toMatchObject({
      title: "Harbor View: take-out refinance",
      stage: "intake",
      status: "active",
      collateralRealProperty: true,
      propertyState: "CA",
      originKey: `construction-takeout:${takeout.id}`,
    });
    expect(deal.program).toBe(takeoutDealProgram(takeout.suggestedPrograms));
    expect(deal.loanAmountCents).toBeNull();

    // A retry (second click, or a crash between opening the deal and recording it) returns the same deal.
    const creator = dealDeskTakeoutCreator({ store, now });
    const again = await creator.createDeal({ idempotencyKey: `construction-takeout:${takeout.id}`, name: "x", sourceProjectId: project.id, sourceDealId: null, leadId: null, loanPurpose: "refinance", assetType: "MULTIFAMILY", suggestedPrograms: [], propertyAddress: null, city: null, state: null, zip: null, units: null, occupancyPct: null, noiT3Annualized: null, notes: "" });
    expect(again.dealId).toBe(deal.id);
    expect(await store.listDeals()).toHaveLength(1);
  });

  it("carries the borrower, owner and lead over from the construction deal", async () => {
    const store = new MemoryDealDeskStore();
    const { now } = clockAt();
    const source = await store.createDeal({ title: "Harbor View construction", program: "CONSTRUCTION", stage: "closed", stageTemplateVersion: 1, borrowerName: "Harbor View LLC", ownerId: "u-1", leadId: "3f9a12bc-0000-4000-8000-000000000001" }, "a", now());
    const creator = dealDeskTakeoutCreator({ store, now });
    const { dealId } = await creator.createDeal({ idempotencyKey: "construction-takeout:t1", name: "Harbor View: take-out refinance", sourceProjectId: "p1", sourceDealId: source.id, leadId: null, loanPurpose: "refinance", assetType: "MULTIFAMILY", suggestedPrograms: ["AGENCY_FANNIE_FREDDIE"], propertyAddress: "1 Harbor Way", city: "Oxnard", state: "CA", zip: "93030", units: 120, occupancyPct: 95, noiT3Annualized: null, notes: "" });
    expect(await store.getDeal(dealId)).toMatchObject({ program: "AGENCY", borrowerName: "Harbor View LLC", ownerId: "u-1", leadId: source.leadId, propertyAddress: "1 Harbor Way, Oxnard, CA 93030" });
  });
});

describe("construction server wiring", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/supabase/server");
    vi.resetModules();
  });

  it("registers the deal-desk creator by default when Supabase is configured", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({ supabaseAdmin: () => ({ from: () => ({}) }), DOCUMENT_BUCKET: "deal-documents" }));
    const server = await import("@/lib/construction/server");
    const { MemoryConstructionStore } = await import("@/lib/construction/store");
    server.configureConstruction({ store: new MemoryConstructionStore() });
    const deps = server.getConstructionDeps();
    expect(deps?.deals).not.toBeNull();
    expect(deps?.deals?.constructor.name).not.toBe("FakeDealCreator");
  });

  it("has no creator without Supabase", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({ supabaseAdmin: () => null, DOCUMENT_BUCKET: "deal-documents" }));
    const server = await import("@/lib/construction/server");
    const { MemoryConstructionStore } = await import("@/lib/construction/store");
    server.configureConstruction({ store: new MemoryConstructionStore() });
    expect(server.getConstructionDeps()?.deals).toBeNull();
  });
});
