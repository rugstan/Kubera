import { describe, expect, it, vi } from "vitest";
import { agencySplit, brokerFee, hardMoneyPoints, partnerSplit, summarizeLedger } from "@/lib/deals/ledger";
import { newDeal, setup, T0 } from "@/lib/deals/test-fixtures";
import { buildReports } from "./build";
import { REPORT_CSV_KINDS, csvCell, dollars, reportCsv, toCsv } from "./csv";
import { addDays, daysInclusive, laDate, monthsIn, parseRange, percentile, resolveWindow } from "./dates";
import { DEAL, FIXTURE_NOW, LENDER, reportingFixture } from "./fixtures";
import { feeReport, stageProbabilityBp, weigh } from "./fees";
import { lenderReport } from "./lenders";
import { funnelReport, pipelineReport } from "./pipeline";
import { reconcileFees } from "./reconcile";
import { memoryReportingSource, storeReportingSource } from "./source";
import { DIRECT_SOURCE, proratedSpend, sourceReport } from "./sources";
import { DEFAULT_STALE_DAYS, buildVisits, timeInStageReport } from "./time-in-stage";
import { emptyData } from "./types";

vi.mock("server-only", () => ({}));

const data = reportingFixture();
const window = resolveWindow("90d", FIXTURE_NOW);

describe("dates", () => {
  it("places a timestamp on its Pacific calendar day", () => {
    expect(laDate("2026-11-04T06:59:00Z")).toBe("2026-11-03");
    expect(laDate("2026-11-04T08:00:00Z")).toBe("2026-11-04");
    expect(laDate("2026-11-04")).toBe("2026-11-04");
  });

  it("resolves windows ending today", () => {
    expect(resolveWindow("30d", FIXTURE_NOW)).toMatchObject({ from: "2026-10-06", to: "2026-11-04" });
    expect(resolveWindow("90d", FIXTURE_NOW)).toMatchObject({ from: "2026-08-07", to: "2026-11-04" });
    expect(resolveWindow("365d", FIXTURE_NOW).from).toBe("2025-11-05");
    expect(resolveWindow("ytd", FIXTURE_NOW)).toMatchObject({ from: "2026-01-01", to: "2026-11-04" });
    expect(daysInclusive("2026-08-07", "2026-11-04")).toBe(90);
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(parseRange("nonsense")).toBe("90d");
    expect(parseRange("ytd")).toBe("ytd");
  });

  it("lists every month of a window and computes nearest-rank percentiles", () => {
    expect(monthsIn(window)).toEqual(["2026-08", "2026-09", "2026-10", "2026-11"]);
    expect(monthsIn({ from: "2025-12-15", to: "2026-02-01" })).toEqual(["2025-12", "2026-01", "2026-02"]);
    expect(percentile([1, 2, 4, 5, 8, 10, 12], 50)).toBe(5);
    expect(percentile([1, 2, 4, 5, 8, 10, 12], 90)).toBe(12);
    expect(percentile([], 50)).toBeNull();
  });
});

describe("pipeline by stage", () => {
  const p = pipelineReport(data.deals, window);

  it("counts open deals and requested volume by stage in lifecycle order", () => {
    expect(p.openDeals).toBe(4);
    expect(p.openAmountCents).toBe((9_200_000 + 6_400_000 + 3_000_000 + 8_000_000) * 100);
    expect(p.byStage.map((s) => [s.stage, s.open, s.openAmountCents / 100])).toEqual([
      ["term_sheet", 1, 6_400_000],
      ["firm_commitment", 1, 8_000_000],
      ["lender_underwriting", 1, 9_200_000],
      ["underwriting", 1, 3_000_000],
    ]);
  });

  it("splits by program and counts outcomes settled in the window", () => {
    expect(p.outcomes).toEqual({ won: 2, wonAmountCents: (12_500_000 + 780_000) * 100, lost: 1, withdrawn: 0, winRatePct: 66.7 });
    const hud = p.byProgram.find((r) => r.program === "HUD_232")!;
    expect(hud).toMatchObject({ open: 1, won: 1, openAmountCents: 800_000_000 });
    expect(p.byProgram.map((r) => r.program)).toEqual(["HUD_232", "SBA_504", "PIP_BRIDGE", "AGENCY", "PRIVATE_BRIDGE", "HARD_MONEY"]);
  });

  it("leaves out outcomes before the window", () => {
    expect(pipelineReport(data.deals, resolveWindow("30d", FIXTURE_NOW)).outcomes).toMatchObject({ won: 1, lost: 0 });
  });

  it("treats a deal on hold as open and a deal with no program as unlabeled", () => {
    const held = { ...data.deals[1]!, status: "held_for_counsel", program: null };
    const r = pipelineReport([held], window);
    expect(r.openDeals).toBe(1);
    expect(r.byProgram[0]!.label).toBe("No program set");
  });
});

describe("funnel", () => {
  it("counts the deals opened in the window that reached each milestone", () => {
    const f = funnelReport(data.deals, data.stageEntries, window);
    expect(f.map((r) => [r.stage, r.reached])).toEqual([
      ["intake", 7],
      ["engaged", 7],
      ["packaging", 7],
      ["lender_outreach", 7],
      ["term_sheet", 6],
      ["closing", 2],
      ["closed", 2],
    ]);
    expect(f.find((r) => r.stage === "term_sheet")!.conversionPct).toBe(85.7);
    expect(f.find((r) => r.stage === "closing")!.conversionPct).toBe(33.3);
    expect(f[0]!.conversionPct).toBeNull();
  });

  it("infers earlier stages for a deal with no recorded entries", () => {
    const f = funnelReport([data.deals[2]!], [], window);
    expect(f.find((r) => r.stage === "term_sheet")!.reached).toBe(1);
    expect(f.find((r) => r.stage === "closing")!.reached).toBe(0);
  });
});

describe("time in stage", () => {
  const t = timeInStageReport(data.deals, data.stageEntries, window, FIXTURE_NOW);
  const row = (stage: string) => t.rows.find((r) => r.stage === stage)!;

  it("builds visits from the audit entries and skips outcomes", () => {
    const visits = buildVisits(data.deals, data.stageEntries);
    expect(visits.some((v) => ["closed", "lost", "withdrawn"].includes(v.stage))).toBe(false);
    const sunrise = visits.filter((v) => v.dealId === DEAL.sunrise);
    expect(sunrise).toHaveLength(10);
    expect(sunrise.at(-1)).toMatchObject({ stage: "closing", exitedAt: expect.any(String) });
  });

  it("computes mean, median and 90th percentile of completed visits", () => {
    // engaged -> packaging took 8, 4, 5, 1, 2, 12 and 10 days.
    expect(row("engaged")).toMatchObject({ completed: 7, meanDays: 6, medianDays: 5, p90Days: 12, open: 0 });
    // lender_outreach: Sunrise 16, Harbor 7, Oak 10, Maple 2, Bayview 2, Cedar 16, Delta 14.
    expect(row("lender_outreach")).toMatchObject({ completed: 7, medianDays: 10, p90Days: 16 });
    expect(row("lender_outreach").meanDays).toBe(9.6);
  });

  it("ages the deals sitting in a stage now", () => {
    expect(row("term_sheet")).toMatchObject({ open: 1 });
    expect(row("lender_underwriting")).toMatchObject({ completed: 0, open: 1, oldestOpenDays: 13.1 });
    expect(row("firm_commitment").oldestOpenDays).toBe(7.1);
  });

  const shifted = (dealId: string, days: number) =>
    data.stageEntries.filter((e) => e.dealId === dealId).map((e) => (e.dealId === dealId ? { ...e, at: new Date(Date.parse(e.at) - days * 86_400_000).toISOString() } : e));

  it("flags a deal that has waited longer than twice the stage median", () => {
    // term_sheet visits took 10, 5, 2, 2 and 10 days (median 5), so the threshold is 10 days; nobody is past it today.
    expect(row("term_sheet").medianDays).toBe(5);
    expect(t.aging).toEqual([]);
    // Move Oak Terrace's whole history 30 days earlier: it has now sat in term sheet for 35 days.
    const entries = [...data.stageEntries.filter((e) => e.dealId !== DEAL.oak), ...shifted(DEAL.oak, 30)];
    const deals = data.deals.map((d) => (d.id === DEAL.oak ? { ...d, stageEnteredAt: "2026-09-30T17:00:00.000Z" } : d));
    const aged = timeInStageReport(deals, entries, window, FIXTURE_NOW);
    expect(aged.aging).toMatchObject([{ dealId: DEAL.oak, stage: "term_sheet", days: 35.1, medianDays: 5, thresholdDays: 10 }]);
  });

  it("uses the default threshold when a stage has too little history", () => {
    const only = data.deals.filter((d) => d.id === DEAL.harbor).map((d) => ({ ...d, stageEnteredAt: "2026-09-12T17:00:00.000Z" }));
    const r = timeInStageReport(only, shifted(DEAL.harbor, 40), window, FIXTURE_NOW);
    expect(r.aging[0]).toMatchObject({ stage: "lender_underwriting", days: 53.1, thresholdDays: DEFAULT_STALE_DAYS, medianDays: null });
  });

  it("repairs a deal row that moved without an audit entry", () => {
    const visits = buildVisits([{ ...data.deals[0]!, stage: "closing", stageEnteredAt: "2026-10-20T17:00:00.000Z", status: "active" }], [{ dealId: DEAL.sunrise, stage: "intake", at: "2026-08-10T17:00:00.000Z" }]);
    expect(visits.map((v) => v.stage)).toEqual(["intake", "closing"]);
    expect(visits[0]!.exitedAt).toBe("2026-10-20T17:00:00.000Z");
  });
});

describe("fee report from the ledger", () => {
  const f = feeReport(data.fees, data.deals, window);

  it("totals booked fees in the window", () => {
    // Settled 12.5M + 2M + 1.56M + 0.39M, invoiced 1.5M, earned 8M (cents); the co-broker share is 0.5M.
    expect(f.booked.total).toEqual({ grossCents: 25_950_000, partnerSharesCents: 500_000, netCents: 25_450_000 });
    expect(f.booked.incomeByStatus).toEqual({ settled: 16_450_000, invoiced: 1_500_000, earned: 8_000_000 });
    expect(f.booked.entries).toBe(7);
  });

  it("buckets by month in Pacific time, zero-filled", () => {
    expect(f.booked.byMonth.map((m) => [m.month, m.grossCents, m.partnerSharesCents, m.settledCents])).toEqual([
      ["2026-08", 0, 0, 0],
      ["2026-09", 1_950_000, 0, 1_950_000],
      ["2026-10", 24_000_000, 500_000, 14_500_000],
      ["2026-11", 0, 0, 0],
    ]);
  });

  it("breaks income down by fee type and program", () => {
    expect(f.booked.byKind.map((k) => [k.kind, k.grossCents, k.partnerSharesCents])).toEqual([
      ["broker_fee", 20_500_000, 0],
      ["lender_paid_compensation", 2_390_000, 0],
      ["hard_money_points", 1_560_000, 0],
      ["sba_packaging_fee", 1_500_000, 0],
      ["co_broker_split", 0, 500_000],
    ]);
    expect(f.booked.byProgram.map((p) => [p.program, p.grossCents])).toEqual([
      ["HUD_232", 22_500_000],
      ["SBA_504", 1_500_000],
      ["HARD_MONEY", 1_950_000],
    ].sort((a, b) => (b[1] as number) - (a[1] as number)));
  });

  it("forecasts what is still to come: receivable plus stage-weighted projections", () => {
    // Receivable = invoiced 1.5M + earned 8M. Projected: Harbor 9.2M at 75%, Oak 3.2M at 55%, Bayview 4.5M at 75%, Delta 1M at 90%.
    expect(f.outlook.receivableCents).toBe(9_500_000);
    expect(f.outlook.projectedCents).toBe(17_900_000);
    expect(f.outlook.weightedProjectedCents).toBe(6_900_000 + 1_760_000 + 3_375_000 + 900_000);
    expect(f.outlook.weightedPartnerSharesCents).toBe(440_000);
    expect(f.outlook.expectedGrossCents).toBe(9_500_000 + 12_935_000);
    expect(f.outlook.expectedNetCents).toBe(22_435_000 - 440_000);
    expect(f.outlook.byStage.map((s) => [s.stage, s.deals, s.probabilityPct, s.weightedCents])).toEqual([
      ["term_sheet", 1, 55, 1_760_000],
      ["firm_commitment", 1, 90, 900_000],
      ["lender_underwriting", 1, 75, 6_900_000],
      ["underwriting", 1, 75, 3_375_000],
    ]);
  });

  it("never counts void entries", () => {
    expect(f.voidedCents).toBe(4_500_000);
    expect(f.voidedEntries).toBe(1);
    expect(feeReport(data.fees.filter((x) => x.status === "void"), data.deals, window).booked.total.grossCents).toBe(0);
  });

  it("honors the window for booked fees but not for the outlook", () => {
    const oct = feeReport(data.fees, data.deals, { ...window, from: "2026-10-16", to: "2026-11-04" });
    expect(oct.booked.total.grossCents).toBe(1_500_000 + 8_000_000);
    expect(oct.outlook.receivableCents).toBe(9_500_000);
  });

  it("weights half-up to the cent with integer math", () => {
    expect(weigh(1_001, 5_500)).toBe(551); // 550.55
    expect(weigh(1, 5_000)).toBe(1); // 0.5 rounds up
    expect(weigh(999_999_999_999, 3_333)).toBe(Math.floor((999_999_999_999 * 3_333 + 5_000) / 10_000));
    expect(stageProbabilityBp("closing")).toBe(9_500);
    expect(stageProbabilityBp("some_new_stage")).toBe(5_000);
    expect(stageProbabilityBp(undefined)).toBe(0);
  });
});

describe("reconciliation", () => {
  const f = feeReport(data.fees, data.deals, window);
  const input = { fees: data.fees, invoices: data.invoices, deals: data.deals, window };

  it("reconciles the fee report with the ledger fixtures", () => {
    const r = reconcileFees(f, input);
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.checks.length).toBeGreaterThanOrEqual(15);
  });

  it("catches a report that drifted from the ledger", () => {
    const drifted = structuredClone(f);
    drifted.booked.total.grossCents += 100;
    drifted.outlook.weightedProjectedCents -= 1;
    const r = reconcileFees(drifted, input);
    expect(r.ok).toBe(false);
    expect(r.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual(["Booked income equals the ledger", "Weighted projected income recomputes", "Weighted income by stage adds up"]);
  });

  it("catches an invoice that does not bill the ledger", () => {
    const bad = data.invoices.map((i) => (i.number === "CC-2026-0002" ? { ...i, totalCents: 1_400_000, lines: [{ ...i.lines[0]!, amountCents: 1_400_000 }] } : i));
    const r = reconcileFees(f, { ...input, invoices: bad });
    const check = r.checks.find((c) => c.name.startsWith("Issued invoices"))!;
    expect(check.ok).toBe(false);
    expect(check.detail).toMatch(/CC-2026-0002/);
  });

  it("catches a ledger entry on a deal that is not in the report", () => {
    const r = reconcileFees(f, { ...input, deals: data.deals.filter((d) => d.id !== DEAL.cedar) });
    expect(r.checks.find((c) => c.name === "Every ledger entry belongs to a deal")).toMatchObject({ ok: false, actualCents: 4_500_000 });
  });
});

describe("fee report against the deal desk's own ledger", () => {
  it("matches summarizeLedger for entries written through the store", async () => {
    const { store, now } = setup();
    const a = await newDeal(store, now, { title: "A", program: "HUD_232", loanAmountCents: 1_000_000_000 });
    const b = await newDeal(store, now, { title: "B", program: "AGENCY", loanAmountCents: 500_000_000 });
    const c = await newDeal(store, now, { title: "C", program: "HARD_MONEY", loanAmountCents: 80_000_000 });
    const put = async (e: Parameters<typeof store.insertFeeEntry>[0], status: "projected" | "earned" | "invoiced" | "settled" | "void", earnedOn?: string) => {
      const row = await store.insertFeeEntry(e, "broker:ana", now());
      const steps = { projected: [], earned: ["earned"], invoiced: ["earned", "invoiced"], settled: ["earned", "settled"], void: ["void"] }[status] as ("earned" | "invoiced" | "settled" | "void")[];
      for (const s of steps) await store.updateFeeEntry(row.id, { status: s, ...(s === "earned" && earnedOn ? { earnedOn } : {}), ...(s === "void" ? { voidReason: "deal lost" } : {}) }, "broker:ana", now());
    };
    await put(brokerFee({ dealId: a.id, loanAmountCents: 1_000_000_000, pct: 1 }), "settled", "2026-10-20");
    await put(brokerFee({ dealId: a.id, loanAmountCents: 1_000_000_000, flatCents: 500_000, payer: "lender" }), "earned", "2026-10-25");
    await put(agencySplit({ dealId: b.id, loanAmountCents: 500_000_000, lenderOriginationPct: 1, corinSharePct: 50, lenderName: "L" }), "projected");
    await put(partnerSplit({ dealId: b.id, payee: "co_broker", ofCents: 2_500_000, pct: 20, partnerName: "P" }), "projected");
    for (const e of hardMoneyPoints({ dealId: c.id, loanAmountCents: 80_000_000, brokerPoints: 2, lenderPoints: 2, corinShareOfLenderPointsPct: 25, lenderName: "F" })) await put(e, "settled", "2026-11-02");
    await put(brokerFee({ dealId: c.id, loanAmountCents: 80_000_000, pct: 0.5 }), "void");

    const loaded = await storeReportingSource(store).load();
    const bundle = buildReports(loaded, { range: "ytd", now: new Date(T0.getTime() + 86_400_000) });
    expect(bundle.reconciliation.checks.filter((x) => !x.ok)).toEqual([]);

    // The ledger's own summary, summed over the deals, equals the report's buckets.
    const summaries = await Promise.all([a, b, c].map(async (d) => summarizeLedger(await store.listFeeEntries(d.id))));
    const sum = (f: (s: ReturnType<typeof summarizeLedger>) => number) => summaries.reduce((n, s) => n + f(s), 0);
    expect(bundle.fees.booked.incomeByStatus.settled).toBe(sum((s) => s.byStatus.settled));
    expect(bundle.fees.booked.incomeByStatus.earned).toBe(sum((s) => s.byStatus.earned));
    expect(bundle.fees.outlook.projectedCents).toBe(sum((s) => s.byStatus.projected));
    expect(bundle.fees.booked.total.grossCents + bundle.fees.outlook.projectedCents).toBe(sum((s) => s.grossCents));
    // Hand check: A 10,000,000 cents + 500,000 lender-paid, C 1,600,000 + 400,000 points; B's 2,500,000 is projected.
    expect(bundle.fees.booked.total.grossCents).toBe(10_000_000 + 500_000 + 1_600_000 + 400_000);
    expect(bundle.fees.outlook.projectedCents).toBe(2_500_000);
    expect(bundle.fees.voidedCents).toBe(400_000);
  });
});

describe("lender hit rate", () => {
  const r = lenderReport(data.outreach, data.lenders, data.deals, window);
  const row = (id: string) => r.rows.find((x) => x.lenderId === id)!;

  it("reports sent, answered and term-sheet rates per lender", () => {
    expect(row(LENDER.cambridge)).toMatchObject({ requested: 5, sent: 5, termSheets: 3, declined: 1, awaiting: 1, hitRatePct: 60, responseRatePct: 80, avgResponseDays: 7.3, closedDealsWithTermSheet: 1, lowSample: false });
    expect(row(LENDER.harborBank)).toMatchObject({ requested: 3, stoppedAtGate: 1, sent: 2, termSheets: 1, declined: 1, hitRatePct: 50, responseRatePct: 100, avgResponseDays: 11, lowSample: true });
    expect(row(LENDER.fidelis)).toMatchObject({ requested: 2, stoppedAtGate: 1, sent: 1, termSheets: 1, hitRatePct: 100, closedDealsWithTermSheet: 1 });
  });

  it("totals across lenders and sorts by volume", () => {
    expect(r.rows.map((x) => x.name)).toEqual(["Cambridge Realty Capital", "Harbor Bank", "Fidelis Private Fund"]);
    expect(r.totals).toMatchObject({ requested: 10, stoppedAtGate: 2, sent: 8, termSheets: 5, declined: 2, awaiting: 1, hitRatePct: 62.5, responseRatePct: 87.5 });
  });

  it("only counts packages sent in the window and handles a lender that was never used", () => {
    const narrow = lenderReport(data.outreach, data.lenders, data.deals, { ...window, from: "2026-10-01" });
    expect(narrow.rows.find((x) => x.lenderId === LENDER.fidelis)).toMatchObject({ sent: 0, hitRatePct: null, responseRatePct: null, avgResponseDays: null });
    expect(lenderReport([], data.lenders, data.deals, window).rows).toEqual([]);
  });

  it("names an outreach whose lender is gone", () => {
    const orphan = lenderReport(data.outreach.slice(0, 1), [], data.deals, window);
    expect(orphan.rows[0]!.name).toBe("Unknown lender");
  });
});

describe("lead-source ROI", () => {
  const s = sourceReport({ leads: data.leads, deals: data.deals, fees: data.fees, costs: data.costs, window });
  const row = (src: string) => s.rows.find((r) => r.source === src)!;

  it("follows each source's leads through deals to booked and expected fees", () => {
    expect(row("express_qualifier")).toMatchObject({ leads: 5, deals: 3, won: 1, leadToDealPct: 60, dealToWonPct: 33.3, bookedNetCents: 14_000_000 + 8_000_000, expectedNetCents: 22_000_000 + 1_760_000 - 440_000 + 900_000, spendCents: 60_000 });
    expect(row("google_ads")).toMatchObject({ leads: 4, deals: 2, won: 0, bookedNetCents: 1_500_000, expectedNetCents: 1_500_000 + 6_900_000 });
    expect(row("partner_referral")).toMatchObject({ leads: 1, deals: 1, won: 1, bookedNetCents: 1_950_000, spendRecorded: false, roiPct: null });
  });

  it("prorates spend into the window and computes ROI on booked net", () => {
    // 3,000.00 over Aug 1 - Oct 31 (92 days); 86 of them fall in the window.
    expect(row("google_ads").spendCents).toBe(280_435);
    expect(row("google_ads").roiPct).toBe(Math.round(((1_500_000 - 280_435) / 280_435) * 1000) / 10);
    expect(row("google_ads").costPerLeadCents).toBe(Math.round(280_435 / 4));
    expect(row("google_ads").costPerWonDealCents).toBeNull();
    expect(row("express_qualifier").costPerWonDealCents).toBe(60_000);
  });

  it("counts deals with no lead under their own source", () => {
    expect(row(DIRECT_SOURCE)).toMatchObject({ leads: 0, deals: 1, bookedNetCents: 0, expectedNetCents: 3_375_000 });
  });

  it("totals equal the sum of the rows", () => {
    const sum = (f: (r: (typeof s.rows)[number]) => number) => s.rows.reduce((n, r) => n + f(r), 0);
    expect(s.totals.leads).toBe(sum((r) => r.leads));
    expect(s.totals.deals).toBe(7);
    expect(s.totals.bookedNetCents).toBe(sum((r) => r.bookedNetCents));
    expect(s.totals.spendCents).toBe(sum((r) => r.spendCents));
    // Every booked cent in the cohort is the ledger's booked net on those deals.
    expect(s.totals.bookedNetCents).toBe(25_450_000);
  });

  it("prorates a cost period by days, half-up", () => {
    const cost = { source: "x", periodStart: "2026-10-01", periodEnd: "2026-10-31", spendCents: 31_000 };
    expect(proratedSpend(cost, { from: "2026-10-01", to: "2026-10-31" })).toBe(31_000);
    expect(proratedSpend(cost, { from: "2026-10-16", to: "2026-12-31" })).toBe(16_000);
    expect(proratedSpend(cost, { from: "2026-11-01", to: "2026-12-31" })).toBe(0);
    expect(proratedSpend({ ...cost, spendCents: 100 }, { from: "2026-10-01", to: "2026-10-10" })).toBe(32); // 10/31 of 100 = 32.26
    expect(proratedSpend({ ...cost, spendCents: 1 }, { from: "2026-10-01", to: "2026-10-16" })).toBe(1); // 16/31 rounds up
  });
});

describe("report bundle", () => {
  it("builds every report from one snapshot", () => {
    const b = buildReports(data, { range: "90d", now: FIXTURE_NOW });
    expect(b.window.key).toBe("90d");
    expect(b.reconciliation.ok).toBe(true);
    expect(b.pipeline.openDeals).toBe(4);
    expect(b.generatedAt).toBe(FIXTURE_NOW.toISOString());
  });

  it("works on an empty desk", () => {
    const b = buildReports(emptyData(), { range: "30d", now: FIXTURE_NOW });
    expect(b.pipeline).toMatchObject({ openDeals: 0, byStage: [], outcomes: { winRatePct: null } });
    expect(b.fees.booked.total.grossCents).toBe(0);
    expect(b.lenders.rows).toEqual([]);
    expect(b.sources.rows).toEqual([]);
    expect(b.reconciliation.ok).toBe(true);
  });

  it("shifts the demo fixture to any date without changing the figures", async () => {
    const later = new Date("2027-03-15T20:00:00.000Z");
    const shifted = await memoryReportingSource(reportingFixture(later)).load();
    const b = buildReports(shifted, { range: "90d", now: later });
    expect(b.fees.booked.total).toEqual({ grossCents: 25_950_000, partnerSharesCents: 500_000, netCents: 25_450_000 });
    expect(b.reconciliation.ok).toBe(true);
    expect(b.timeInStage.rows.find((r) => r.stage === "engaged")).toMatchObject({ medianDays: 5 });
  });
});

describe("csv", () => {
  it("escapes quotes, commas and newlines, and neutralizes formulas", () => {
    expect(csvCell('He said "hi", twice')).toBe('"He said ""hi"", twice"');
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell("+1 555")).toBe("'+1 555");
    expect(csvCell("-12.50")).toBe("-12.50");
    expect(csvCell("-cmd")).toBe("'-cmd");
    expect(csvCell("@sum")).toBe("'@sum");
    expect(csvCell(null)).toBe("");
    expect(csvCell(0)).toBe("0");
    expect(toCsv(["a", "b"], [[1, "x"]])).toBe("a,b\r\n1,x\r\n");
  });

  it("formats cents as plain decimals", () => {
    expect(dollars(1_250_050)).toBe("12500.50");
    expect(dollars(5)).toBe("0.05");
    expect(dollars(-1_234)).toBe("-12.34");
  });

  it("exports each report with a dated file name", () => {
    const b = buildReports(data, { range: "90d", now: FIXTURE_NOW });
    for (const kind of REPORT_CSV_KINDS) {
      const { filename, body } = reportCsv(kind, b);
      expect(filename).toMatch(/\.csv$/);
      expect(body.split("\r\n").length).toBeGreaterThan(2);
    }
    const fees = reportCsv("fees", b).body.split("\r\n");
    expect(fees[0]).toBe("Month,Income (USD),Partner shares (USD),Net (USD),Settled income (USD)");
    expect(fees[3]).toBe("2026-10,240000.00,5000.00,235000.00,145000.00");
  });
});
