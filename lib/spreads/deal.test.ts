import { describe, expect, it } from "vitest";
import { intakeSchema, type Intake } from "@/lib/validation";
import { buildSpreadBundle, latestAccepted } from "./deal";
import { intakeFromSpreads, profileForIntake, resizeWithSpreads } from "./jev";
import { MemoryExtractionStore } from "@/lib/agents/documents/store";
import { recalculateSpreads } from "./service";
import { MemorySpreadStore, saveSpreadBundle } from "./store";
import { goldenRecord } from "./test-fixtures";

const DEAL = "11111111-1111-4111-8111-111111111111";

describe("spread bundle from a deal's extractions", () => {
  const t12 = goldenRecord("t12-annual-csv");
  const rr = goldenRecord("rent-roll-csv");
  const ts = goldenRecord("term-sheet-letter");
  const review = goldenRecord("pfs-mismatch-xlsx"); // needs_review: must not feed a spread

  it("uses only accepted extractions, latest first", () => {
    const older = goldenRecord("t12-monthly-xlsx", { created_at: "2026-01-01T00:00:00.000Z" });
    const by = latestAccepted([older, t12, review]);
    expect(by.T12?.[0]?.id).toBe(t12.id);
    expect(by.PFS).toBeUndefined();
  });

  it("normalizes NOI per profile, tests term sheets at the most conservative NOI, and links sources", () => {
    const b = buildSpreadBundle([t12, rr, ts, review], { asset: "multifamily", value: 20_000_000, asOf: "2026-10-31" });
    // Units for reserves come from the rent roll (10), not the context.
    expect(b.operating.AGENCY?.lines.find((l) => l.key === "replacementReserves")?.underwritten).toBe(10_000);
    expect(Object.keys(b.operating).sort()).toEqual(["AGENCY", "BANK", "BRIDGE", "CMBS", "HUD", "SBA"]);
    const minNoi = Math.min(...Object.values(b.operating).map((o) => o!.underwrittenNoi));
    expect(b.quoteNoi?.noi).toBe(minNoi);
    expect(b.quotes).toHaveLength(1);
    expect(b.quotes[0]).toMatchObject({ lender: "Pacific Coast Bank", loanAmount: 12_500_000, ltv: 0.625 });
    expect(b.rentRoll?.units).toBe(10);
    expect(b.sources).toMatchObject({ operating: [t12.id], rentRoll: [rr.id], quotes: [ts.id] });
    expect(b.globalCashFlow).toBeNull();
  });

  it("runs SBA global cash flow from the guarantors' PFS", () => {
    const pfs = goldenRecord("pfs-413-csv");
    const b = buildSpreadBundle([pfs], {
      asset: "hotel",
      asOf: "2026-10-31",
      sba: { business: { netIncome: 400_000, depreciation: 150_000, amortization: 10_000, interestExpense: 90_000, nonRecurringAddBacks: 25_000 }, businessDebtService: { existing: 100_000, proposed: 350_000 } },
    });
    expect(b.globalCashFlow?.globalDscr).toBe(1.6282);
    expect(b.sources.globalCashFlow).toEqual([pfs.id]);
  });

  it("saves one versioned row per spread and bumps the version on recalculation", async () => {
    const store = new MemorySpreadStore();
    const b = buildSpreadBundle([t12, rr, goldenRecord("budget-lines-csv")], { asset: "multifamily", asOf: "2026-10-31", profiles: ["AGENCY", "HUD"] });
    const first = await saveSpreadBundle(store, { dealId: DEAL, leadId: null }, b, { inputs: { asOf: "2026-10-31" }, createdBy: "analyst@kubera" });
    expect(first.map((r) => `${r.kind}:${r.lenderProfile ?? ""}`).sort()).toEqual([
      "construction_budget:",
      "deal_summary:",
      "operating_statement:AGENCY",
      "operating_statement:HUD",
      "rent_roll:",
    ]);
    expect(first.every((r) => r.version === 1)).toBe(true);
    await saveSpreadBundle(store, { dealId: DEAL, leadId: null }, b, { inputs: {}, createdBy: "analyst@kubera" });
    expect((await store.latest({ dealId: DEAL, leadId: null }, "operating_statement", "AGENCY"))?.version).toBe(2);
    await expect(saveSpreadBundle(store, { dealId: null, leadId: null }, b, { inputs: {}, createdBy: "x" })).rejects.toThrow(/deal or a lead/);
  });
});

describe("Jev re-sizing on document-backed numbers", () => {
  const intake: Intake = intakeSchema.parse({
    assetType: "MULTIFAMILY",
    transaction: "REFINANCE",
    loanAmount: 7_000_000,
    noi: 650_000,
    value: 10_000_000,
    unitCount: 0,
    occupancyPct: 95,
    timelineDays: 90,
    nonRecourseOnly: false,
    green: false,
    ownerOperator: true,
    notes: "",
    source: "website",
  });

  it("picks the lender profile from the program family", () => {
    expect(profileForIntake(intake)).toBe("AGENCY");
    expect(profileForIntake({ ...intake, assetType: "SNF" })).toBe("HUD");
    expect(profileForIntake({ ...intake, assetType: "HOTEL_FLAGGED" })).toBe("CMBS");
    expect(profileForIntake({ ...intake, transaction: "HARD_MONEY" })).toBe("BRIDGE");
  });

  it("replaces self-reported NOI, occupancy and units with the spreads and re-sizes lower", () => {
    const b = buildSpreadBundle([goldenRecord("t12-annual-csv"), goldenRecord("rent-roll-csv")], { asset: "multifamily", asOf: "2026-10-31" });
    const { intake: next, changes } = intakeFromSpreads(intake, b);
    expect(next.noi).toBe(535_792);
    expect(next.occupancyPct).toBe(80);
    expect(next.unitCount).toBe(10);
    expect(changes.map((c) => c.field)).toEqual(["noi", "occupancyPct", "unitCount"]);
    const r = resizeWithSpreads(intake, b);
    expect(r.primaryLoanAfter).not.toBeNull();
    expect(r.primaryLoanAfter!).toBeLessThan(r.primaryLoanBefore!);
    expect(r.rationale[0]).toMatch(/Re-sized on documents: noi from T-12 normalized \(AGENCY\)/);
  });

  it("feeds a construction budget into a construction intake", () => {
    const b = buildSpreadBundle([goldenRecord("budget-summary-xlsx")], { asset: "multifamily", asOf: "2026-10-31" });
    const { intake: next } = intakeFromSpreads({ ...intake, transaction: "CONSTRUCTION", noi: 900_000 }, b);
    expect(next.construction).toMatchObject({ landCost: 2_000_000, hardCosts: 8_000_000, softCosts: 1_200_000, contingencyPct: 10, developerFeePct: 5, gmpContract: true });
  });
});

describe("recalculateSpreads service", () => {
  it("loads a deal's extractions, skips ones in review and saves versioned spreads", async () => {
    const extractions = new MemoryExtractionStore();
    for (const id of ["t12-annual-csv", "rent-roll-csv", "pfs-mismatch-xlsx"]) {
      const rec = goldenRecord(id, { deal_id: DEAL });
      await extractions.insert({ ...rec });
    }
    const spreads = new MemorySpreadStore();
    const { bundle, saved } = await recalculateSpreads(
      { extractions, spreads },
      { dealId: DEAL, leadId: null },
      { asset: "multifamily", asOf: "2026-10-31", profiles: ["AGENCY"] },
      "analyst@kubera",
    );
    expect(bundle.operating.AGENCY?.underwrittenNoi).toBe(535_792);
    expect(bundle.globalCashFlow).toBeNull();
    expect(saved.map((s) => s.kind).sort()).toEqual(["deal_summary", "operating_statement", "rent_roll"]);
    expect(saved[0]!.inputs).toMatchObject({ asset: "multifamily", quoteCount: 0, sba: false });
  });
});
