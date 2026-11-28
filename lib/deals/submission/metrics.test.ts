import { describe, expect, it } from "vitest";
import { hmMetrics } from "@/lib/checklists/hm-underwriting";
import { computeSubmissionMetrics, fieldSourceOf, metricOf, spreadIdFor, strengthOf } from "./metrics";
import { allSubmissionFixtures, emptyProfileContext, emptySubmissionContext, submissionFixture } from "./test-fixtures";
import { METRIC_UNITS, metricKeys, submissionPlaybooks, type Metric, type MetricKey, type SubmissionContext } from "./types";

/** Monthly payment per dollar, written out (not lib/sizing/finance), for hand-checked DSCRs. */
const monthlyPerDollar = (ratePct: number, years: number) => {
  const r = ratePct / 100 / 12;
  return r / (1 - (1 + r) ** -(years * 12));
};
const value = (ctx: SubmissionContext, key: MetricKey) => metricOf(computeSubmissionMetrics(ctx), key)?.value;
const get = (ctx: SubmissionContext, key: MetricKey) => metricOf(computeSubmissionMetrics(ctx), key)!;

describe("hand-checked figures", () => {
  it("bridge: LTV, stabilized LTV, LTC, debt yield, DSCR at the assumed terms, cap rate and yield on cost", () => {
    const ctx = submissionFixture("bridge");
    // Loan $8,400,000; as-is $12,350,000; stabilized $16,000,000; uses $14,088,000; NOI $765,000 → $1,020,000; 8.75% / 30 years.
    expect(value(ctx, "ltv_as_is")).toBeCloseTo((8_400_000 / 12_350_000) * 100, 2);
    expect(value(ctx, "ltv_stabilized")).toBeCloseTo(52.5, 6);
    expect(value(ctx, "ltc")).toBeCloseTo((8_400_000 / 14_088_000) * 100, 2);
    expect(value(ctx, "debt_yield_in_place")).toBeCloseTo((765_000 / 8_400_000) * 100, 2);
    expect(value(ctx, "debt_yield_stabilized")).toBeCloseTo((1_020_000 / 8_400_000) * 100, 2);
    const ds = 8_400_000 * monthlyPerDollar(8.75, 30) * 12;
    expect(value(ctx, "dscr_in_place")).toBeCloseTo(765_000 / ds, 3);
    expect(value(ctx, "dscr_stabilized")).toBeCloseTo(1_020_000 / ds, 3);
    expect(value(ctx, "cap_rate")).toBeCloseTo((765_000 / 12_000_000) * 100, 2);
    expect(value(ctx, "yield_on_cost")).toBeCloseTo((1_020_000 / 14_088_000) * 100, 2);
    expect(value(ctx, "noi_underwritten")).toBe(73_400_000);
    expect(value(ctx, "loan_per_unit")).toBe(20_000_000);
    expect(value(ctx, "price_per_unit")).toBe(Math.round(1_200_000_000 / 42));
    expect(value(ctx, "equity")).toBe(568_800_000);
    expect(value(ctx, "sources_minus_uses")).toBe(0);
  });

  it("DSCR carries the assumed terms and says it is not a quote", () => {
    const m = get(submissionFixture("bridge"), "dscr_in_place");
    expect(m.note).toBe("At an assumed 8.75% rate and 30-year amortization; an assumption, not a quote.");
    expect(m.inputs.map((i) => i.field)).toEqual(["noiInPlaceCents", "deal.loanAmountCents", "assumedRatePct", "assumedAmortMonths"]);
  });

  it("rental DSCR uses the lower of lease and market rent over PITIA at the assumed terms", () => {
    const ctx = submissionFixture("dscr_rental");
    // Lease $6,100 < market $6,400; $650,000 at 7.5% / 30 years; taxes $1,083, insurance $310, HOA $0.
    const pitia = 650_000 * monthlyPerDollar(7.5, 30) + 1_083 + 310 + 0;
    expect(value(ctx, "pitia_monthly")).toBe(Math.round(pitia * 100));
    expect(value(ctx, "dscr_rental")).toBeCloseTo(6_100 / pitia, 3);
    expect(get(ctx, "dscr_rental").inputs[0]).toMatchObject({ field: "programDetails.rental.monthlyRentCents", value: 610_000, source: { source: "borrower" } });
    ctx.profile!.programDetails.rental!.marketRentCents = 580_000;
    expect(value(ctx, "dscr_rental")).toBeCloseTo(5_800 / pitia, 3);
    expect(get(ctx, "dscr_rental").inputs[0]!.field).toBe("programDetails.rental.marketRentCents");
    delete ctx.profile!.programDetails.rental!.monthlyHoaCents;
    expect(get(ctx, "dscr_rental")).toMatchObject({ value: null, missing: ["monthly HOA dues (0 if none)"] });
  });

  it("mezzanine: combined LTV and LTC on the senior loan plus this loan; combined debt yield", () => {
    const ctx = submissionFixture("mezz_pref");
    // Senior $25,200,000 + mezz $3,600,000 = $28,800,000; price $36,000,000; uses $42,000,000; NOI $1,890,000.
    expect(value(ctx, "combined_ltv")).toBeCloseTo(80, 6);
    expect(value(ctx, "combined_ltc")).toBeCloseTo((28_800_000 / 42_000_000) * 100, 2);
    expect(get(ctx, "debt_yield_in_place")).toMatchObject({ label: "Combined debt yield (in place)" });
    expect(value(ctx, "debt_yield_in_place")).toBeCloseTo((1_890_000 / 28_800_000) * 100, 2);
    expect(get(ctx, "dscr_in_place").note).toMatch(/Senior loan at its 8.25% rate and this loan at an assumed 12.5%/);
    expect(metricOf(computeSubmissionMetrics(ctx), "ltv_as_is")).toBeUndefined();
  });

  it("C-PACE: combined LTV with the existing mortgage", () => {
    expect(value(submissionFixture("c_pace"), "combined_ltv")).toBeCloseTo(((9_400_000 + 3_100_000) / 18_600_000) * 100, 2);
  });

  it("construction: LTC on total uses, falling back to the budget spread when no uses are entered", () => {
    const ctx = submissionFixture("construction");
    expect(value(ctx, "ltc")).toBeCloseTo(65, 6);
    expect(value(ctx, "yield_on_cost")).toBeCloseTo(6.2, 6);
    expect(metricOf(computeSubmissionMetrics(ctx), "ltv_as_is")).toBeUndefined();
    ctx.profile!.uses = [];
    const ltc = get(ctx, "ltc");
    expect(ltc.value).toBeCloseTo(65, 6);
    expect(ltc.inputs[1]).toMatchObject({ field: "spread.construction_budget", source: { source: "spread", ref: ctx.spreadFigures.constructionBudget!.spreadId } });
    ctx.spreadFigures.constructionBudget = null;
    expect(get(ctx, "ltc").inputs[1]!.field).toBe("programDetails.construction.budget");
    expect(value(ctx, "ltc")).toBeCloseTo(65, 6);
  });

  it("SBA reads global DSCR from the saved spread, not a recomputation", () => {
    const ctx = submissionFixture("sba_7a");
    expect(get(ctx, "global_dscr")).toMatchObject({ value: 2.18, inputs: [{ field: "spread.global_cash_flow", source: { source: "spread", ref: ctx.spreadFigures.globalCashFlow!.spreadId } }] });
  });

  it("hotel figures come from the STR spread when saved, else from the hotel section", () => {
    const ctx = submissionFixture("hotel_pip_bridge");
    expect(value(ctx, "hotel_adr")).toBe(11_850);
    expect(value(ctx, "revpar_index")).toBe(82);
    expect(get(ctx, "hotel_revpar").formula).toMatch(/through 2026-10 \(STR spread\)/);
    expect(value(ctx, "pip_per_key")).toBe(Math.round(245_000_000 / 98));
    ctx.spreadFigures.hotelStr = null;
    ctx.profile!.programDetails.hotel = { ...ctx.profile!.programDetails.hotel, adrCents: 12_000 };
    expect(get(ctx, "hotel_adr")).toMatchObject({ value: 12_000, inputs: [{ field: "programDetails.hotel.adrCents" }] });
    ctx.profile!.programDetails.hotel!.pip = { required: false };
    expect(metricOf(computeSubmissionMetrics(ctx), "pip_per_key")).toBeUndefined();
  });
});

describe("hard money and fix & flip reuse hmMetrics", () => {
  it.each(["hard_money", "fix_flip"] as const)("%s LTV, LTC, LTARV, weeks and verified projects equal the file's hmMetrics", (pb) => {
    const ctx = submissionFixture(pb);
    const hm = ctx.hardMoney!;
    const fresh = hmMetrics(hm, ctx.now);
    expect(fresh).toEqual(hm.metrics);
    expect(value(ctx, "ltv_as_is")).toBeCloseTo(fresh.asIsLtv * 100, 6);
    expect(value(ctx, "ltc")).toBeCloseTo(fresh.ltc * 100, 6);
    expect(value(ctx, "ltarv")).toBeCloseTo(fresh.ltarv * 100, 6);
    expect(value(ctx, "rehab_weeks")).toBe(fresh.rehabWeeks);
    expect(value(ctx, "verified_projects_36m")).toBe(fresh.verifiedProjects);
    expect(get(ctx, "verified_projects_36m").note).toContain(fresh.tier.toLowerCase());
    expect(get(ctx, "ltarv").inputs.every((i) => i.source?.source === "record")).toBe(true);
  });

  it("fix & flip margin uses the file's total cost and the grid's selling costs", () => {
    const ctx = submissionFixture("fix_flip");
    const hm = ctx.hardMoney!;
    const price = hm.exitPlan.expectedSalePrice!;
    expect(value(ctx, "flip_margin")).toBeCloseTo(((price * 0.94 - hm.metrics.totalCost) / price) * 100, 2);
    expect(metricOf(computeSubmissionMetrics(submissionFixture("hard_money")), "flip_margin")).toBeUndefined();
  });

  it("warns when the file's requested loan is not the deal's loan amount", () => {
    const ctx = submissionFixture("hard_money");
    ctx.deal.loanAmountCents = 150_000_000;
    expect(computeSubmissionMetrics(ctx).warnings.join(" ")).toMatch(/requested loan \(\$1,600,000\) is not the deal's loan amount \(\$1,500,000\)/);
  });

  it("without a file, LTARV is the loan over the stabilized value and the file-only figures need the file", () => {
    const ctx = submissionFixture("fix_flip");
    ctx.hardMoney = null;
    expect(value(ctx, "ltarv")).toBeCloseTo((800_000 / 1_195_000) * 100, 2);
    expect(get(ctx, "rehab_weeks")).toMatchObject({ value: null, missing: ["hard money file scope of work"] });
  });
});

describe("missing inputs", () => {
  it("give a null value and name what is needed, never a guess", () => {
    const ctx = submissionFixture("bridge");
    ctx.profile!.asIsValueCents = null;
    ctx.profile!.purpose = "refinance";
    expect(get(ctx, "ltv_as_is")).toMatchObject({ label: "LTV (as-is)", value: null, missing: ["as-is value"] });
    ctx.profile!.assumedRatePct = null;
    expect(get(ctx, "dscr_in_place")).toMatchObject({ value: null, missing: ["assumed rate"] });
    expect(get(ctx, "dscr_in_place").note).toBeUndefined();
    ctx.deal.loanAmountCents = null;
    expect(get(ctx, "debt_yield_in_place").missing).toEqual(["loan amount"]);
  });

  it("an acquisition with no as-is value uses the purchase price, labelled as such", () => {
    const ctx = submissionFixture("bridge");
    ctx.profile!.asIsValueCents = null;
    expect(get(ctx, "ltv_as_is")).toMatchObject({ label: "Loan to purchase price", formula: "loan ÷ purchase price" });
    expect(value(ctx, "ltv_as_is")).toBeCloseTo(70, 6);
  });

  it("a zero denominator is reported, not divided by", () => {
    const ctx = submissionFixture("bridge");
    ctx.profile!.asIsValueCents = 0;
    expect(get(ctx, "ltv_as_is")).toMatchObject({ value: null, missing: ["as-is value above zero"] });
  });

  it.each(submissionPlaybooks)("%s with an empty profile has no value in any metric", (pb) => {
    const m = computeSubmissionMetrics(emptyProfileContext(pb));
    expect(m.metrics.length).toBeGreaterThan(0);
    for (const x of m.metrics) {
      expect(x.value, `${pb} ${x.key}`).toBeNull();
      expect(x.missing.length, `${pb} ${x.key}`).toBeGreaterThan(0);
      expect(x.note ?? "", `${pb} ${x.key}`).not.toMatch(/\d/);
    }
    expect(m.sponsorStrength).toBeNull();
    expect(m.warnings).toEqual([]);
  });

  it("a deal with no profile at all still computes (every value null)", () => {
    const m = computeSubmissionMetrics(emptySubmissionContext("CONSTRUCTION"));
    expect(m.metrics.every((x) => x.value === null)).toBe(true);
  });
});

describe("in-place and stabilized never mix", () => {
  const STABILIZED_FIELDS = ["noiStabilizedCents", "stabilizedValueCents", "hardMoney.arv", "hardMoney.expectedSalePrice"];
  const IN_PLACE_FIELDS = ["noiInPlaceCents", "spread.operating_statement", "asIsValueCents", "hardMoney.asIsValue"];
  it.each(allSubmissionFixtures())("%s", (_pb, ctx) => {
    for (const m of computeSubmissionMetrics(ctx).metrics) {
      const fields = m.inputs.map((i) => i.field);
      if (m.basis === "in_place") expect(fields.filter((f) => STABILIZED_FIELDS.includes(f)), m.key).toEqual([]);
      if (m.basis === "stabilized") expect(fields.filter((f) => IN_PLACE_FIELDS.includes(f)), m.key).toEqual([]);
    }
  });
});

describe("shape", () => {
  it.each(allSubmissionFixtures())("%s: one row per key, in metricKeys order, with the fixed unit and a formula", (_pb, ctx) => {
    const ms: Metric[] = computeSubmissionMetrics(ctx).metrics;
    const keys = ms.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual([...keys].sort((a, b) => metricKeys.indexOf(a) - metricKeys.indexOf(b)));
    for (const m of ms) {
      expect(m.unit).toBe(METRIC_UNITS[m.key]);
      expect(m.formula.length).toBeGreaterThan(5);
      expect(m.value === null || Number.isFinite(m.value)).toBe(true);
    }
  });

  it("inputs carry their source: documents, spreads, records, or entered by the last editor", () => {
    const ctx = submissionFixture("bridge");
    const t12 = ctx.vaultDocuments.find((d) => d.kind === "T12")!;
    expect(get(ctx, "debt_yield_in_place").inputs[0]!.source).toMatchObject({ source: "document", ref: t12.id, asOf: "2026-09-30" });
    expect(get(ctx, "ltv_as_is").inputs[1]!.source).toEqual({ source: "entered", by: ctx.profile!.updatedBy, at: ctx.profile!.updatedAt });
    expect(get(ctx, "ltv_as_is").inputs[0]!.source).toBeNull();
    ctx.profile!.noiInPlaceCents = null;
    expect(get(ctx, "debt_yield_in_place").inputs[0]).toMatchObject({ field: "spread.operating_statement", value: 76_500_000, source: { source: "spread", ref: spreadIdFor(ctx, "operating_statement") } });
  });

  it("finds the spread id behind each package figure", () => {
    const ctx = submissionFixture("hotel_cmbs");
    const [summary, operating, str] = ctx.spreads!.sourceSpreadIds;
    expect(spreadIdFor(ctx, "deal_summary")).toBe(summary);
    expect(spreadIdFor(ctx, "operating_statement")).toBe(operating);
    expect(spreadIdFor(ctx, "hotel_str")).toBe(str);
    expect(spreadIdFor(ctx, "rent_roll")).toBe(summary);
    expect(fieldSourceOf(ctx.profile, "zoning", null)).toBeNull();
  });
});

describe("warnings", () => {
  it("flags a typed NOI more than 2% away from the T-12 spread's reported NOI", () => {
    const ctx = submissionFixture("bridge");
    expect(computeSubmissionMetrics(ctx).warnings).toEqual([]);
    ctx.profile!.noiInPlaceCents = 77_800_000; // 1.7% above $765,000: no warning
    expect(computeSubmissionMetrics(ctx).warnings).toEqual([]);
    ctx.profile!.noiInPlaceCents = 79_000_000; // 3.3% above
    const w = computeSubmissionMetrics(ctx).warnings;
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/\(\$790,000\) differs from the T-12 spread's reported NOI \(\$765,000\) by 3\.3%/);
  });

  it("flags unbalanced sources and uses, a loan line that is not the loan, and a stale PFS", () => {
    const ctx = submissionFixture("bridge");
    ctx.profile!.sources[0]!.amountCents = 830_000_000;
    ctx.guarantorTotals!.oldestPfsAsOf = "2026-07-01";
    const w = computeSubmissionMetrics(ctx).warnings.join("\n");
    expect(w).toMatch(/uses exceed sources by \$100,000/);
    expect(w).toMatch(/senior loan line \(\$8,300,000\) is not the loan amount \(\$8,400,000\)/);
    expect(w).toMatch(/dated 2026-07-01, more than 90 days ago/);
    const mezz = submissionFixture("mezz_pref");
    expect(computeSubmissionMetrics(mezz).warnings).toEqual([]);
  });
});

describe("sponsor strength", () => {
  it("uses the PFS totals over the stated figures, with the covenant tests", () => {
    const ctx = submissionFixture("bridge");
    const s = computeSubmissionMetrics(ctx).sponsorStrength!;
    expect(s).toMatchObject({ basis: "pfs", asOf: "2026-10-15", netWorthCents: ctx.guarantorTotals!.netWorthCents, liquidityCents: ctx.guarantorTotals!.liquidityCents, pfsCount: 2, guarantorCount: 2 });
    expect(s.netWorthCents).not.toBe(ctx.sponsor!.statedNetWorthCents);
    expect(s.covenants).toEqual({ netWorthMultiple: 1, liquidityPct: 0.1, requiredNetWorthCents: 840_000_000, requiredLiquidityCents: 84_000_000, netWorthOk: true, liquidityOk: true });
  });

  it("falls back to the stated figures, and reports a failed covenant", () => {
    const ctx = submissionFixture("bridge");
    ctx.guarantorTotals = null;
    ctx.sponsor!.statedLiquidityCents = 50_000_000;
    const s = strengthOf(ctx)!;
    expect(s).toMatchObject({ basis: "stated", asOf: "2026-09-30", netWorthCents: ctx.sponsor!.statedNetWorthCents, liquidityCents: 50_000_000, pfsCount: 0, guarantorCount: 2 });
    expect(s.covenants).toMatchObject({ netWorthOk: true, liquidityOk: false });
  });

  it("is null with no figures, and leaves a covenant unknown when a figure or the loan is missing", () => {
    const ctx = submissionFixture("bridge");
    ctx.guarantorTotals = null;
    ctx.sponsor!.statedLiquidityCents = null;
    expect(strengthOf(ctx)!.covenants).toMatchObject({ netWorthOk: true, liquidityOk: null });
    ctx.deal.loanAmountCents = null;
    expect(strengthOf(ctx)!.covenants).toMatchObject({ requiredNetWorthCents: null, netWorthOk: null, liquidityOk: null });
    ctx.sponsor!.statedNetWorthCents = null;
    expect(strengthOf(ctx)).toBeNull();
  });

  it("never puts a sponsor figure in Metric[]", () => {
    for (const [, ctx] of allSubmissionFixtures()) {
      const blob = JSON.stringify(computeSubmissionMetrics(ctx).metrics);
      const whole = (n: number) => new RegExp(`(?<![\\d.])${n}(?![\\d])`);
      expect(blob).not.toMatch(whole(ctx.guarantorTotals!.netWorthCents));
      expect(blob).not.toMatch(whole(ctx.guarantorTotals!.liquidityCents));
    }
  });
});

describe("quoted DSCR", () => {
  it("shows the lowest DSCR among reviewed quotes, with its terms", () => {
    const ctx = submissionFixture("bank");
    expect(metricOf(computeSubmissionMetrics(ctx), "dscr_quoted")).toBeUndefined();
    ctx.spreadFigures.quotes = {
      spreadId: "q",
      asOf: "2026-10-20",
      rows: [
        { lender: "A", loanAmountCents: 455_000_000, ratePct: 6.5, amortYears: 25, dscr: 1.31, debtYieldPct: 10.3, ltvPct: 70 },
        { lender: "B", loanAmountCents: 455_000_000, ratePct: 7.1, amortYears: 25, dscr: 1.22, debtYieldPct: 10.3, ltvPct: 70 },
      ],
    };
    const m = get(ctx, "dscr_quoted");
    expect(m.value).toBe(1.22);
    expect(m.note).toMatch(/7\.1% rate, 25-year amortization/);
    expect(m.note).not.toMatch(/\bB\b/);
  });
});
