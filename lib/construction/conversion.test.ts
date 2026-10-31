import { describe, expect, it } from "vitest";
import { buildTakeoutDeal, computeLeaseUpMetrics, defaultHudCostCertStatus, defaultTakeoutPath, evaluateTakeout, suggestTakeoutPrograms } from "./conversion";
import type { ConstructionConversion, ConstructionProject, LeaseUpSnapshot } from "./types";

const snap = (asOf: string, leased: number, occupied: number, noi: number | null = null): LeaseUpSnapshot => ({
  id: `s_${asOf}`,
  createdAt: `${asOf}T00:00:00Z`,
  conversionId: "c1",
  asOf,
  unitsLeased: leased,
  unitsOccupied: occupied,
  avgMonthlyRent: null,
  noiT3Annualized: noi,
});

const now = new Date("2026-11-04T18:00:00Z");

describe("computeLeaseUpMetrics", () => {
  it("reports an empty, stale view without snapshots", () => {
    expect(computeLeaseUpMetrics([], 100, now)).toMatchObject({ asOf: null, occupancyPct: 0, stabilized: false, stale: true });
  });

  it("computes occupancy, leased share and absorption pace", () => {
    const m = computeLeaseUpMetrics([snap("2026-08-01", 20, 10), snap("2026-10-01", 80, 62)], 100, now);
    expect(m.occupancyPct).toBe(62);
    expect(m.leasedPct).toBe(80);
    expect(m.absorptionPerMonth).toBe(29.9);
    expect(m.stabilized).toBe(false);
    expect(m.stale).toBe(false);
  });

  it("projects when sustained occupancy would be reached at the current pace", () => {
    const m = computeLeaseUpMetrics([snap("2026-08-01", 20, 10), snap("2026-10-01", 80, 62)], 100, now);
    // 28 more occupied units at ~29.9/month is about 29 days, plus the 90-day hold.
    expect(m.projectedStabilizationDate).toBe("2027-01-28");
  });

  it("is stabilized after 90 days at or above 90% occupancy", () => {
    const m = computeLeaseUpMetrics([snap("2026-06-01", 95, 85), snap("2026-07-15", 96, 91), snap("2026-09-01", 97, 93), snap("2026-10-20", 97, 94)], 100, now);
    expect(m.stabilizedSince).toBe("2026-07-15");
    expect(m.daysAtThreshold).toBe(97);
    expect(m.stabilized).toBe(true);
  });

  it("does not count a run that dipped below the threshold", () => {
    const m = computeLeaseUpMetrics([snap("2026-06-01", 95, 92), snap("2026-08-01", 90, 88), snap("2026-10-20", 95, 92)], 100, now);
    expect(m.stabilizedSince).toBe("2026-10-20");
    expect(m.stabilized).toBe(false);
  });

  it("needs more than one snapshot to call a property stabilized", () => {
    expect(computeLeaseUpMetrics([snap("2026-10-20", 95, 95)], 100, now).stabilized).toBe(false);
  });

  it("marks data older than 45 days stale", () => {
    expect(computeLeaseUpMetrics([snap("2026-09-01", 50, 40)], 100, now).stale).toBe(true);
  });
});

describe("defaults", () => {
  it("converts HUD new construction in place and refinances everything else", () => {
    expect(defaultTakeoutPath("HUD_221D4")).toBe("hud_conversion");
    expect(defaultTakeoutPath("HUD_232_NEW_CONSTRUCTION")).toBe("hud_conversion");
    expect(defaultTakeoutPath("BANK_CONSTRUCTION")).toBe("refinance");
    expect(defaultHudCostCertStatus("HUD_221D4")).toBe("not_started");
    expect(defaultHudCostCertStatus("PRIVATE_CONSTRUCTION")).toBe("not_applicable");
  });

  it("suggests take-out programs by asset", () => {
    expect(suggestTakeoutPrograms("MULTIFAMILY")).toEqual(["HUD_221D4_223F_MULTIFAMILY", "AGENCY_FANNIE_FREDDIE", "BANK_LIFE_CO"]);
    expect(suggestTakeoutPrograms("SENIOR_HOUSING")[0]).toBe("HUD_232_223F");
    expect(suggestTakeoutPrograms("HOTEL")[0]).toBe("HOSPITALITY_CMBS_NON_RECOURSE");
  });
});

const project = (over: Partial<ConstructionProject> = {}): ConstructionProject => ({
  id: "p1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  dealId: null,
  leadId: null,
  name: "Harbor View",
  program: "BANK_CONSTRUCTION",
  assetType: "MULTIFAMILY",
  phase: "conversion",
  propertyAddress: "100 Harbor Way",
  city: "Long Beach",
  state: "CA",
  zip: "90802",
  units: 100,
  seismicZone: true,
  newConstruction: true,
  generalContractorName: null,
  generalContractorLicense: null,
  notes: null,
  ...over,
});

const conversion = (over: Partial<ConstructionConversion> = {}): ConstructionConversion => ({
  id: "c1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  projectId: "p1",
  coDate: "2026-05-01",
  unitsTotal: 100,
  loanMaturityDate: null,
  extensionDeadline: null,
  takeoutPath: "refinance",
  hudCostCertStatus: "not_applicable",
  hudCostCertSubmittedAt: null,
  hudCostCertApprovedAt: null,
  payoffStatus: "not_scheduled",
  payoffTargetDate: null,
  payoffConfirmedAt: null,
  notes: null,
  ...over,
});

const stable = [snap("2026-07-15", 96, 91), snap("2026-10-20", 97, 94, 4_200_000)];
const metricsFor = (snaps: LeaseUpSnapshot[]) => computeLeaseUpMetrics(snaps, 100, now);

describe("evaluateTakeout", () => {
  it("triggers on stabilized occupancy", () => {
    const e = evaluateTakeout({ project: project(), conversion: conversion(), metrics: metricsFor(stable), now });
    expect(e).toMatchObject({ applicable: true, triggered: true, reasons: ["stabilized_occupancy"] });
    expect(e.suggestedPrograms).toContain("AGENCY_FANNIE_FREDDIE");
  });

  it("triggers on the maturity runway even before stabilization", () => {
    const e = evaluateTakeout({ project: project(), conversion: conversion({ loanMaturityDate: "2027-03-15" }), metrics: metricsFor([snap("2026-10-20", 40, 30)]), now });
    expect(e.reasons).toEqual(["maturity_runway"]);
    expect(e.notes.join(" ")).toContain("matures in 131 days");
  });

  it("triggers on an approaching extension deadline and reports both reasons", () => {
    const e = evaluateTakeout({ project: project(), conversion: conversion({ loanMaturityDate: "2026-12-30", extensionDeadline: "2026-11-30" }), metrics: metricsFor(stable), now });
    expect(e.reasons).toEqual(["stabilized_occupancy", "maturity_runway", "extension_deadline"]);
  });

  it("does not trigger when nothing is close", () => {
    const e = evaluateTakeout({ project: project(), conversion: conversion({ loanMaturityDate: "2028-01-01" }), metrics: metricsFor([snap("2026-10-20", 40, 30)]), now });
    expect(e).toMatchObject({ applicable: true, triggered: false, reasons: [] });
  });

  it("never triggers before closing or after payoff", () => {
    expect(evaluateTakeout({ project: project({ phase: "pre_closing" }), conversion: conversion(), metrics: metricsFor(stable), now }).triggered).toBe(false);
    const paid = evaluateTakeout({ project: project(), conversion: conversion({ payoffStatus: "payoff_confirmed" }), metrics: metricsFor(stable), now });
    expect(paid).toMatchObject({ applicable: false, triggered: false });
    expect(evaluateTakeout({ project: project({ phase: "taken_out" }), conversion: conversion(), metrics: metricsFor(stable), now }).triggered).toBe(false);
  });

  it("does not trigger a refinance for HUD loans that convert in place", () => {
    const e = evaluateTakeout({
      project: project({ program: "HUD_221D4" }),
      conversion: conversion({ takeoutPath: "hud_conversion", hudCostCertStatus: "approved" }),
      metrics: metricsFor(stable),
      now,
    });
    expect(e).toMatchObject({ applicable: false, triggered: false });
    expect(e.notes[0]).toContain("converts in place");
  });
});

describe("buildTakeoutDeal", () => {
  it("carries property facts and an idempotency key, with no money fields", () => {
    const m = metricsFor(stable);
    const deal = buildTakeoutDeal({ project: project({ dealId: "d1" }), takeoutId: "tko_1", suggestedPrograms: ["AGENCY_FANNIE_FREDDIE"], reasons: ["stabilized_occupancy"], metrics: m, latestSnapshot: stable.at(-1) });
    expect(deal).toMatchObject({
      idempotencyKey: "construction-takeout:tko_1",
      sourceDealId: "d1",
      loanPurpose: "refinance",
      occupancyPct: 94,
      noiT3Annualized: 4_200_000,
      units: 100,
    });
    expect(deal.name).toBe("Harbor View: take-out refinance");
    expect(Object.keys(deal).join(" ")).not.toMatch(/draw|disburse|escrow|trust/i);
  });
});
