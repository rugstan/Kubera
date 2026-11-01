// Jev routing for the new boxes: hard money, construction, DSCR investor and
// tiered agency intakes land on the right program, lenders and flags.

import { afterEach, describe, expect, it, vi } from "vitest";
import { NEW_PROGRAM_IDS } from "@/lib/sizing/programs/types";
import { intakeSchema } from "@/lib/validation";
import {
  JEV_REMOTE_MODEL,
  NEW_BOX_ROUTING,
  PROGRAM_FITS,
  decide,
  decideWithRules,
  intakeAssumptions,
  jevDecisionSchema,
  lendersFor,
  publicSummary,
  remoteJevPayload,
  verticalFor,
} from "./jev";
import { checkRoute } from "./routing";

const rates = { fiveYear: 4.0, tenYear: 4.25, sofr30: 4.0, prime: 7.0 };

describe("Jev: hard money intakes", () => {
  const flip = intakeSchema.parse({
    assetType: "RESIDENTIAL_2_4",
    transaction: "HARD_MONEY",
    loanAmount: 500_000,
    noi: 0,
    value: 400_000,
    unitCount: 2,
    hardMoney: { strategy: "FIX_AND_FLIP", rehabBudget: 100_000, arv: 650_000, completedProjects: 6, termMonths: 12, holdMonths: 8 },
  });

  it("routes to the hard money box with private lenders", () => {
    const r = decideWithRules(flip, rates);
    expect(verticalFor(flip)).toBe("HARD_MONEY_PRIVATE");
    expect(r.decision.assetVertical).toBe("HARD_MONEY_PRIVATE");
    expect(r.decision.primaryProgramFit).toBe("HARD_MONEY");
    expect(r.primaryQuote?.loanAmount).toBe(450_000);
    expect(r.decision.recommendedWholesaleLenders).toEqual(["FIDELIS_PRIVATE_FUND", "ROC_CAPITAL"]);
    // No in-place income is expected on a flip: still qualified, 1% advisory fee on 450,000.
    expect(r.decision.leadUrgencyTier).not.toBe("UNQUALIFIED");
    expect(r.decision.estimatedBrokerCommissionUsd).toBe(4_500);
    expect(jevDecisionSchema.safeParse(r.decision).success).toBe(true);
  });

  it("flags a flip whose sale exit loses money", () => {
    const thin = intakeSchema.parse({ ...flip, value: 300_000, loanAmount: 400_000, hardMoney: { strategy: "FIX_AND_FLIP", rehabBudget: 80_000, arv: 420_000, termMonths: 12, holdMonths: 14 } });
    const r = decideWithRules(thin, rates);
    expect(r.decision.sizingOptimizationFlag).toBe("EXIT_SHORTFALL_NEEDS_RESTRUCTURE");
    expect(r.rationale.some((x) => /Sale exit falls short/.test(x))).toBe(true);
  });

  it("does not flag an exit shortfall on a low-LTV flip without an ARV", () => {
    const noArv = intakeSchema.parse({ assetType: "RESIDENTIAL_2_4", transaction: "HARD_MONEY", loanAmount: 400_000, noi: 0, value: 1_000_000, unitCount: 3 });
    const r = decideWithRules(noArv, rates);
    expect(r.primaryQuote?.exit?.kind).toBe("SALE");
    expect(r.decision.sizingOptimizationFlag).not.toBe("EXIT_SHORTFALL_NEEDS_RESTRUCTURE");
    expect(r.rationale.some((x) => /No after-repair value given, so the sale exit was not tested/.test(x))).toBe(true);
    // With an ARV the sale exit is tested as before.
    const withArv = intakeSchema.parse({ ...noArv, hardMoney: { arv: 1_000_000 } });
    expect(decideWithRules(withArv, rates).decision.sizingOptimizationFlag).toBe("EXIT_SHORTFALL_NEEDS_RESTRUCTURE");
  });

  it("sizes a rental hold as a bridge with a refinance exit", () => {
    const rental = intakeSchema.parse({ assetType: "RESIDENTIAL_2_4", transaction: "HARD_MONEY", loanAmount: 500_000, noi: 60_000, value: 800_000, unitCount: 3, hardMoney: { strategy: "RENTAL", arv: 900_000 } });
    const r = decideWithRules(rental, rates);
    expect(r.primaryQuote?.name).toBe("Hard money bridge");
    expect(r.primaryQuote?.exit?.kind).toBe("DSCR_REFINANCE");
  });

  it("notes what it assumed for a bare hard money intake", () => {
    const bare = intakeSchema.parse({ assetType: "COMMERCIAL", transaction: "HARD_MONEY", loanAmount: 1_500_000, noi: 0 });
    expect(intakeAssumptions(bare)).toHaveLength(2);
    const r = decideWithRules(bare, rates);
    expect(r.decision.primaryProgramFit).toBe("HARD_MONEY");
  });
});

describe("Jev: construction intakes", () => {
  const build = intakeSchema.parse({
    assetType: "COMMERCIAL",
    transaction: "CONSTRUCTION",
    loanAmount: 15_000_000,
    noi: 1_650_000,
    construction: { landCost: 3_000_000, hardCosts: 14_000_000, softCosts: 2_500_000, contingencyPct: 5, developerFeePct: 3, gmpContract: true, asCompletedValue: 27_500_000, completedProjects: 5 },
  });

  it("routes ground-up commercial to the construction channels", () => {
    const r = decideWithRules(build, rates);
    expect(r.sizing.quotes.map((q) => q.id)).toEqual(["CONSTRUCTION_BANK", "CONSTRUCTION_DEBT_FUND", "CONSTRUCTION_PRIVATE"]);
    expect(r.decision.primaryProgramFit).toBe("CONSTRUCTION_BANK");
    expect(r.primaryQuote?.loanAmount).toBe(14_531_000);
    expect(r.decision.leadUrgencyTier).toBe("TIER_1_INSTITUTIONAL_HOT");
    expect(r.decision.recommendedWholesaleLenders).toContain("READY_CAPITAL");
  });

  it("adds HUD 221(d)(4) for ground-up multifamily", () => {
    const r = decideWithRules({ ...build, assetType: "MULTIFAMILY", unitCount: 80 }, rates);
    expect(r.sizing.quotes[0]?.id).toBe("HUD_221D4_223F_MULTIFAMILY");
    expect(r.decision.primaryProgramFit).toBe("HUD_221D4_223F_MULTIFAMILY");
  });

  it("estimates the budget when none is given and says so", () => {
    const bare = intakeSchema.parse({ assetType: "MIXED_USE", transaction: "CONSTRUCTION", loanAmount: 6_500_000, noi: 900_000, value: 2_000_000, unitCount: 30 });
    const r = decideWithRules(bare, rates);
    expect(r.rationale[0]).toMatch(/No construction budget/);
    expect(r.sizing.value).toBeGreaterThan(9_000_000);
  });

  it("keeps senior-care and hotel construction on their own boxes", () => {
    const senior = intakeSchema.parse({ assetType: "ASSISTED_LIVING", transaction: "CONSTRUCTION", loanAmount: 12_000_000, noi: 1_600_000, value: 18_000_000, unitCount: 90 });
    expect(decideWithRules(senior, rates).sizing.quotes.some((q) => q.id === "HUD_232_NEW_CONST")).toBe(true);
  });

  // Regression: the qualifier labels the value field "Acquisition or land cost" on a construction
  // deal; Jev used to apply LTC to that land figure as if it were total project cost.
  it("does not size ground-up assisted living on the land cost alone", () => {
    const base = { assetType: "ASSISTED_LIVING", transaction: "CONSTRUCTION", loanAmount: 20_000_000, noi: 2_400_000, unitCount: 120 } as const;
    const withLand = decideWithRules(intakeSchema.parse({ ...base, value: 4_000_000 }), rates);
    const blank = decideWithRules(intakeSchema.parse(base), rates);
    expect(withLand.decision.leadUrgencyTier).not.toBe("UNQUALIFIED");
    expect(withLand.decision.leadUrgencyTier).toBe(blank.decision.leadUrgencyTier);
    expect(withLand.primaryQuote?.loanAmount).toBe(blank.primaryQuote?.loanAmount);
    expect(withLand.primaryQuote?.loanAmount ?? 0).toBeGreaterThan(15_000_000);
    expect(withLand.sizing.quotes.find((q) => q.id === "HUD_232_NEW_CONST")?.loanAmount ?? 0).toBeGreaterThan(15_000_000);
    expect(withLand.rationale.some((l) => /No construction budget/.test(l) && /land/.test(l))).toBe(true);
  });

  it("does not size a ground-up flagged hotel on the land cost alone", () => {
    const base = { assetType: "HOTEL_FLAGGED", transaction: "CONSTRUCTION", loanAmount: 15_000_000, noi: 2_200_000, unitCount: 140, franchiseTier: "PREMIUM_FLAG" } as const;
    const withLand = decideWithRules(intakeSchema.parse({ ...base, value: 3_000_000 }), rates);
    const blank = decideWithRules(intakeSchema.parse(base), rates);
    expect(withLand.decision.leadUrgencyTier).not.toBe("UNQUALIFIED");
    expect(withLand.decision.leadUrgencyTier).toBe(blank.decision.leadUrgencyTier);
    expect(withLand.primaryQuote?.loanAmount ?? 0).toBeGreaterThan(12_000_000);
    expect(withLand.rationale.some((l) => /No construction budget/.test(l))).toBe(true);
  });

  it("uses land plus the budget as total cost when a care construction budget is given", () => {
    const r = decideWithRules(
      intakeSchema.parse({
        assetType: "MEMORY_CARE",
        transaction: "CONSTRUCTION",
        loanAmount: 18_000_000,
        noi: 2_400_000,
        unitCount: 100,
        value: 4_000_000,
        construction: { landCost: 4_000_000, hardCosts: 18_000_000, softCosts: 2_000_000, contingencyPct: 5, developerFeePct: 0 },
      }),
      rates,
    );
    expect(r.sizing.value).toBe(4_000_000 + 18_000_000 + 2_000_000 + 900_000);
    expect(r.rationale.some((l) => /No construction budget/.test(l))).toBe(false);
  });
});

describe("Jev: rentals and agency", () => {
  it("sizes a 2–4 unit rental on the DSCR box", () => {
    const duplex = intakeSchema.parse({
      assetType: "RESIDENTIAL_2_4",
      transaction: "REFINANCE",
      loanAmount: 420_000,
      noi: 30_000,
      value: 700_000,
      unitCount: 2,
      creditBand: "660_699",
      rental: { monthlyRent: 4_000, monthlyTaxesInsuranceHoa: 900 },
    });
    const r = decideWithRules(duplex, rates);
    expect(r.decision.assetVertical).toBe("RESIDENTIAL_INVESTOR");
    expect(r.decision.primaryProgramFit).toBe("DSCR_INVESTOR_2_4");
    expect(r.primaryQuote?.loanAmount).toBe(420_000);
    expect(r.decision.recommendedWholesaleLenders).toContain("ROC_CAPITAL");
  });

  it("quotes Fannie Mae and Freddie Mac separately for stabilized multifamily", () => {
    const mf = intakeSchema.parse({ assetType: "MULTIFAMILY", transaction: "REFINANCE", loanAmount: 8_000_000, noi: 820_000, value: 12_000_000, unitCount: 60, occupancyPct: 95 });
    const r = decideWithRules(mf, rates);
    const ids = r.sizing.quotes.map((q) => q.id);
    expect(ids).toContain("AGENCY_FANNIE_MAE");
    expect(ids).toContain("AGENCY_FREDDIE_MAC");
    expect(ids).not.toContain("AGENCY_FANNIE_FREDDIE");
    expect(r.decision.primaryProgramFit).toMatch(/^AGENCY_|^HUD_/);
    expect(publicSummary({ ...r, engine: "rules", latencyMs: 1 }).program).toBe(r.primaryQuote?.name);
  });
});

describe("Jev schema", () => {
  it("accepts every new program id and routes each to lenders", () => {
    for (const id of NEW_PROGRAM_IDS) {
      expect(PROGRAM_FITS).toContain(id);
      expect(lendersFor(id)).toEqual(NEW_BOX_ROUTING[id]);
    }
    expect(lendersFor("SBA_504_STANDARD")).toContain("TMC_FINANCING_CDC");
    expect(lendersFor("NONE")).toEqual([]);
    expect(lendersFor("toString")).toEqual([]);
  });

  it("validates the new intake fields", () => {
    expect(intakeSchema.safeParse({ assetType: "RESIDENTIAL_2_4", transaction: "HARD_MONEY", loanAmount: 300_000, noi: 0, hardMoney: { termMonths: 48 } }).success).toBe(false);
    expect(intakeSchema.safeParse({ assetType: "COMMERCIAL", transaction: "CONSTRUCTION", loanAmount: 3_000_000, noi: 0, construction: { landCost: 1, hardCosts: 1, contingencyPct: 80 } }).success).toBe(false);
    expect(intakeSchema.safeParse({ assetType: "COMMERCIAL", transaction: "REFINANCE", loanAmount: 3_000_000, noi: 1, creditBand: "800" }).success).toBe(false);
    const ok = intakeSchema.parse({ assetType: "MULTIFAMILY", transaction: "HARD_MONEY", loanAmount: 2_000_000, noi: 0, hardMoney: {} });
    expect(ok.hardMoney).toMatchObject({ strategy: "FIX_AND_FLIP", purpose: "PURCHASE", rehabBudget: 0, termMonths: 12, completedProjects: 0 });
  });
});

describe("Jev: hotel-to-care conversions", () => {
  const TIER_RANK = { TIER_1_INSTITUTIONAL_HOT: 3, TIER_2_QUALIFIED_MIDMARKET: 2, TIER_3_NURTURE: 1, UNQUALIFIED: 0 } as const;
  const base = { assetType: "HOTEL_TO_SENIOR_CONVERSION", transaction: "CONVERSION", loanAmount: 10_000_000, noi: 1_000_000, unitCount: 100, timelineDays: 90 } as const;

  // Regression: a blank value used to be estimated at the multifamily cap rate (5.75%), which
  // sized a bigger loan and a hotter tier than entering the real value.
  it("never sizes a blank value better than an entered one", () => {
    const blank = decideWithRules(intakeSchema.parse(base), rates);
    const entered = decideWithRules(intakeSchema.parse({ ...base, value: 11_000_000 }), rates);
    expect(TIER_RANK[blank.decision.leadUrgencyTier]).toBeLessThanOrEqual(TIER_RANK[entered.decision.leadUrgencyTier]);
    expect(blank.primaryQuote?.loanAmount ?? 0).toBeLessThanOrEqual(entered.primaryQuote?.loanAmount ?? 0);
    expect(blank.decision.requiresImmediateBrokerCall).toBe(false);
    expect(blank.sizing.valueEstimated).toBe(true);
    for (const tier of ["PREMIUM_FLAG", "ECONOMY_FLAG", "BOUTIQUE_INDEPENDENT"] as const) {
      const b = decideWithRules(intakeSchema.parse({ ...base, franchiseTier: tier }), rates);
      const e = decideWithRules(intakeSchema.parse({ ...base, franchiseTier: tier, value: 11_000_000 }), rates);
      expect(TIER_RANK[b.decision.leadUrgencyTier]).toBeLessThanOrEqual(TIER_RANK[e.decision.leadUrgencyTier]);
      expect(b.primaryQuote?.loanAmount ?? 0).toBeLessThanOrEqual(e.primaryQuote?.loanAmount ?? 0);
    }
  });

  it("adds the conversion budget to the estimated value and says the desk needs the price and budget", () => {
    const blank = decideWithRules(intakeSchema.parse({ ...base, pipBudget: 2_000_000 }), rates);
    // $1M NOI at the 10% economy-flag hotel cap rate (no tier given) is a $10M as-is value;
    // plus the $2M budget that is $12M of cost, and 80% LTC sizes $9.6M.
    expect(blank.sizing.value).toBeCloseTo(10_000_000, 0);
    expect(blank.sizing.quotes.find((q) => q.id === "WHITE_LABEL_CRE_BRIDGE")?.loanAmount).toBeCloseTo(9_600_000, 0);
    const line = intakeAssumptions(intakeSchema.parse(base)).find((l) => /No purchase price or value/.test(l));
    expect(line).toMatch(/10\.00% hotel cap rate/);
    expect(line).toMatch(/purchase price and conversion budget/);
    expect(intakeAssumptions(intakeSchema.parse({ ...base, value: 11_000_000 })).some((l) => /No purchase price/.test(l))).toBe(false);
    expect(blank.rationale.some((l) => /No purchase price or value/.test(l))).toBe(true);
  });
});

describe("Jev: remote refinement privacy", () => {
  const intake = intakeSchema.parse({
    assetType: "MULTIFAMILY",
    transaction: "PURCHASE",
    loanAmount: 5_000_000,
    noi: 600_000,
    value: 8_000_000,
    unitCount: 60,
    notes: "My SSN is 123-45-6789, DOB 01/02/1970, acct # 000123456789. Call me at 415-555-0100.",
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("never sends the free-text notes or a restricted value to the remote endpoint", async () => {
    vi.stubEnv("JEV_API_URL", "https://jev.example.test/decide");
    vi.stubEnv("JEV_API_KEY", "k");
    const local = decideWithRules(intake, rates);
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ output: local.decision }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const r = await decide(intake, rates);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = String(fetchMock.mock.calls[0]![1].body);
    expect(body).not.toContain("123-45-6789");
    expect(body).not.toContain("01/02/1970");
    expect(body).not.toContain("000123456789");
    expect(body).not.toContain("415-555-0100");
    const sent = JSON.parse(body) as { input: Record<string, unknown> };
    expect(sent.input).not.toHaveProperty("notes");
    expect(sent.input).toMatchObject({ assetType: "MULTIFAMILY", loanAmount: 5_000_000 });
    expect(r.engine).toBe("jev-remote");
  });

  it("routes the remote payload through the model routing guard", () => {
    const payload = remoteJevPayload(intake, decideWithRules(intake, rates).decision);
    expect(payload).not.toBeNull();
    expect(payload!.input).not.toHaveProperty("notes");
    expect(checkRoute({ model: JEV_REMOTE_MODEL, provider: "jev", purpose: "lead_scoring", payload }).allowed).toBe(true);
    // The raw intake, restricted notes included, would not pass the guard.
    expect(checkRoute({ model: JEV_REMOTE_MODEL, provider: "jev", purpose: "lead_scoring", payload: { input: intake } }).allowed).toBe(false);
  });

  it("skips the remote call when no endpoint is configured", async () => {
    vi.stubEnv("JEV_API_URL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const r = await decide(intake, rates);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.engine).toBe("rules");
  });
});
