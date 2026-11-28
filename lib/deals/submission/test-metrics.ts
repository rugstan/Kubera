// TEST ONLY. A small stand-in for computeSubmissionMetrics (metrics.ts, owned
// by the data builder) so the readiness, summary, email and send tests can run
// against the shared fixtures before the real module lands. It follows the
// formulas in spec 3.5 closely enough for those tests; it is not the source
// of any figure a lender sees. Production code never imports this file.

import { HARD_MONEY } from "@/lib/sizing/programs/assumptions";
import { GUARANTOR_COVENANT_DEFAULTS, METRIC_UNITS, type FieldSource, type Metric, type MetricBasis, type MetricInput, type MetricKey, type SponsorStrength, type SubmissionContext, type SubmissionMetrics } from "./types";

const DEBT_SOURCES = new Set(["senior_loan", "subordinate_debt", "c_pace"]);

function annualDebtService(principalCents: number, ratePct: number, amortMonths: number): number {
  const r = ratePct / 1200;
  const monthly = r === 0 ? principalCents / amortMonths : (principalCents * r) / (1 - (1 + r) ** -amortMonths);
  return monthly * 12;
}

export function stubSubmissionMetrics(ctx: SubmissionContext): SubmissionMetrics {
  const p = ctx.profile;
  const loan = ctx.deal.loanAmountCents;
  const src = (field: string): FieldSource | null => (p?.fieldSources as Record<string, FieldSource | undefined> | undefined)?.[field] ?? null;
  const input = (field: string, label: string, value: number | null | undefined): MetricInput => ({ field, label, value: value ?? null, source: field.startsWith("deal.") ? null : src(field) });
  const out: Metric[] = [];
  const add = (key: MetricKey, label: string, basis: MetricBasis, formula: string, inputs: MetricInput[], compute: (v: number[]) => number, note?: string) => {
    const values = inputs.map((i) => i.value);
    let value: number | null = values.every((v) => v !== null) ? compute(values as number[]) : null;
    if (value !== null && !Number.isFinite(value)) value = null;
    out.push({ key, label, value, unit: METRIC_UNITS[key], basis, formula, inputs, missing: inputs.filter((i) => i.value === null).map((i) => i.label), ...(note ? { note } : {}) });
  };
  const loanIn = input("deal.loanAmountCents", "loan amount", loan);
  const sum = (lines: readonly { amountCents: number }[] | undefined) => (lines?.length ? lines.reduce((s, l) => s + l.amountCents, 0) : null);
  const uses = sum(p?.uses);
  const stack = p?.programDetails.capitalStack;
  const combined = p?.playbook === "mezz_pref" || p?.playbook === "c_pace";
  const debt = combined && stack?.seniorAmountCents !== undefined && loan !== null ? stack.seniorAmountCents + loan : loan;
  const debtIn = combined ? input("programDetails.capitalStack.seniorAmountCents", "senior plus this loan", debt) : loanIn;

  // Leverage
  if (p?.asIsValueCents == null && p?.purpose === "acquisition" && p.purchasePriceCents !== null) {
    add("ltv_as_is", "Loan to purchase price", "in_place", "loan ÷ purchase price", [loanIn, input("purchasePriceCents", "purchase price", p.purchasePriceCents)], ([l, v]) => (l! / v!) * 100);
  } else {
    add("ltv_as_is", "LTV (as-is)", "in_place", "loan ÷ as-is value", [loanIn, input("asIsValueCents", "as-is value", p?.asIsValueCents)], ([l, v]) => (l! / v!) * 100);
  }
  if (ctx.hardMoney) {
    add("ltarv", "Loan to after-repair value", "stabilized", "loan ÷ after-repair value", [loanIn, input("hardMoney.arv", "after-repair value", ctx.hardMoney.arv * 100)], ([l, v]) => (l! / v!) * 100);
  } else if (p?.stabilizedValueCents != null) {
    add("ltv_stabilized", "LTV (stabilized)", "stabilized", "loan ÷ stabilized value", [loanIn, input("stabilizedValueCents", "stabilized value", p.stabilizedValueCents)], ([l, v]) => (l! / v!) * 100);
  }
  add("ltc", "LTC", "cost", "loan ÷ total cost", [loanIn, input("uses", "total cost", uses)], ([l, c]) => (l! / c!) * 100);
  if (combined) {
    const value = p?.asIsValueCents ?? p?.purchasePriceCents ?? null;
    add("combined_ltv", "Combined LTV", "in_place", "(senior + this loan) ÷ value", [debtIn, input(p?.asIsValueCents != null ? "asIsValueCents" : "purchasePriceCents", "value", value)], ([d, v]) => (d! / v!) * 100);
    if (p?.playbook === "mezz_pref") add("combined_ltc", "Combined LTC", "cost", "(senior + this loan) ÷ total cost", [debtIn, input("uses", "total cost", uses)], ([d, c]) => (d! / c!) * 100);
  }

  // Income
  add("debt_yield_in_place", "Debt yield (in place)", "in_place", "NOI in place ÷ loan", [input("noiInPlaceCents", "NOI in place", p?.noiInPlaceCents), debtIn], ([n, d]) => (n! / d!) * 100);
  if (p?.noiStabilizedCents != null) add("debt_yield_stabilized", "Debt yield (stabilized)", "stabilized", "stabilized NOI ÷ loan", [input("noiStabilizedCents", "stabilized NOI", p.noiStabilizedCents), debtIn], ([n, d]) => (n! / d!) * 100);
  const rate = p?.assumedRatePct ?? null;
  const amort = p?.assumedAmortMonths ?? null;
  const note = rate !== null && amort !== null ? `at an assumed ${rate}% / ${Math.round(amort / 12)}-year amortization; not a quote` : undefined;
  // Combined debt (mezz, C-PACE): the senior portion at its own rate, this loan at the assumed rate.
  const senior = combined ? (stack?.seniorAmountCents ?? 0) : 0;
  const seniorRate = stack?.seniorRatePct ?? null;
  const ads = (d: number, r: number, a: number) => (senior && seniorRate !== null ? annualDebtService(senior, seniorRate, a) + annualDebtService(d - senior, r, a) : annualDebtService(d, r, a));
  add("dscr_in_place", "DSCR (in place)", "in_place", "NOI in place ÷ annual debt service at assumed terms", [input("noiInPlaceCents", "NOI in place", p?.noiInPlaceCents), debtIn, input("assumedRatePct", "assumed rate", rate), input("assumedAmortMonths", "assumed amortization", amort)], ([n, d, r, a]) => n! / ads(d!, r!, a!), note);
  if (p?.noiStabilizedCents != null) add("dscr_stabilized", "DSCR (stabilized)", "stabilized", "stabilized NOI ÷ annual debt service at assumed terms", [input("noiStabilizedCents", "stabilized NOI", p.noiStabilizedCents), debtIn, input("assumedRatePct", "assumed rate", rate), input("assumedAmortMonths", "assumed amortization", amort)], ([n, d, r, a]) => n! / ads(d!, r!, a!), note);
  const rental = p?.programDetails.rental;
  if (rental) {
    const rent = rental.monthlyRentCents !== undefined && rental.marketRentCents !== undefined ? Math.min(rental.monthlyRentCents, rental.marketRentCents) : (rental.monthlyRentCents ?? rental.marketRentCents ?? null);
    const pitiaInputs = [loanIn, input("assumedRatePct", "assumed rate", rate), input("assumedAmortMonths", "assumed amortization", amort), input("programDetails.rental.monthlyTaxesCents", "monthly taxes", rental.monthlyTaxesCents), input("programDetails.rental.monthlyInsuranceCents", "monthly insurance", rental.monthlyInsuranceCents)];
    const pitia = ([l, r, a, t, i]: number[]) => ads(l!, r!, a!) / 12 + t! + i! + (rental.monthlyHoaCents ?? 0);
    add("pitia_monthly", "PITIA (monthly)", "in_place", "principal and interest at assumed terms + taxes + insurance + HOA", pitiaInputs, pitia, note);
    add("dscr_rental", "DSCR (rental)", "in_place", "lower of lease and market rent ÷ PITIA", [input("programDetails.rental.monthlyRentCents", "monthly rent", rent), ...pitiaInputs], ([rent0, ...rest]) => rent0! / pitia(rest), note);
  }
  if (ctx.spreadFigures.globalCashFlow) add("global_dscr", "Global DSCR", "in_place", "global cash flow ÷ global debt service (spread)", [input("spread.global_cash_flow", "global DSCR", ctx.spreadFigures.globalCashFlow.globalDscr)], ([g]) => g!);
  const basisValue = p?.purchasePriceCents ?? p?.asIsValueCents ?? null;
  add("cap_rate", "Cap rate", "in_place", "NOI in place ÷ purchase price or as-is value", [input("noiInPlaceCents", "NOI in place", p?.noiInPlaceCents), input(p?.purchasePriceCents != null ? "purchasePriceCents" : "asIsValueCents", "price or value", basisValue)], ([n, v]) => (n! / v!) * 100);
  if (p?.noiStabilizedCents != null) add("yield_on_cost", "Yield on cost", "stabilized", "stabilized NOI ÷ total cost", [input("noiStabilizedCents", "stabilized NOI", p.noiStabilizedCents), input("uses", "total cost", uses)], ([n, c]) => (n! / c!) * 100);
  if (ctx.spreads?.underwrittenNoiCents != null) add("noi_underwritten", "Underwritten NOI (Corin normalization)", "in_place", "lender-normalized NOI from the operating-statement spread", [input("spread.operating_statement", "underwritten NOI", ctx.spreads.underwrittenNoiCents)], ([n]) => n!);

  // Per unit
  const perUnit = p?.sizeUnit === "units" || p?.sizeUnit === "keys" || p?.sizeUnit === "beds";
  if (perUnit) {
    add("loan_per_unit", "Loan per unit", "na", "loan ÷ units", [loanIn, input("sizeCount", "units", p?.sizeCount)], ([l, n]) => l! / n!);
    if (p?.purchasePriceCents != null) add("price_per_unit", "Price per unit", "na", "purchase price ÷ units", [input("purchasePriceCents", "purchase price", p.purchasePriceCents), input("sizeCount", "units", p.sizeCount)], ([v, n]) => v! / n!);
  }
  if (p?.rentableSf) add("loan_per_sf", "Loan per SF", "na", "loan ÷ rentable SF", [loanIn, input("rentableSf", "rentable SF", p.rentableSf)], ([l, n]) => l! / n!);

  // Capital
  const debtSources = p?.sources.length ? p.sources.filter((s) => DEBT_SOURCES.has(s.kind)).reduce((s, l) => s + l.amountCents, 0) : null;
  add("equity", "Equity", "cost", "total uses − debt sources", [input("uses", "total uses", uses), input("sources", "debt sources", debtSources)], ([u, d]) => u! - d!);
  add("equity_share", "Equity share", "cost", "equity ÷ total uses", [input("uses", "total uses", uses), input("sources", "debt sources", debtSources)], ([u, d]) => ((u! - d!) / u!) * 100);
  add("sources_minus_uses", "Sources − uses", "na", "Σ sources − Σ uses", [input("sources", "total sources", sum(p?.sources)), input("uses", "total uses", uses)], ([s, u]) => s! - u!);

  // Hotel
  const hotel = p?.programDetails.hotel;
  const str = ctx.spreadFigures.hotelStr;
  if (hotel || str) {
    add("hotel_occupancy", "Occupancy (trailing 12)", "in_place", "STR / operating statement", [input("spread.hotel_str", "occupancy", str?.occupancyPct ?? p?.occupancyPct)], ([v]) => v!);
    add("hotel_adr", "ADR", "in_place", "STR / operating statement", [input("programDetails.hotel.adrCents", "ADR", str?.adrCents ?? hotel?.adrCents)], ([v]) => v!);
    add("hotel_revpar", "RevPAR", "in_place", "STR / operating statement", [input("programDetails.hotel.revparCents", "RevPAR", str?.revparCents ?? hotel?.revparCents)], ([v]) => v!);
    add("revpar_index", "RevPAR index", "in_place", "RevPAR ÷ competitive set RevPAR × 100", [input("programDetails.hotel.revparIndex", "RevPAR index", str?.revparIndex ?? hotel?.revparIndex)], ([v]) => v!);
    if (hotel?.pip?.budgetCents !== undefined) add("pip_per_key", "PIP per key", "na", "PIP budget ÷ keys", [input("programDetails.hotel.pip", "PIP budget", hotel.pip.budgetCents), input("sizeCount", "keys", p?.sizeCount)], ([b, k]) => b! / k!);
  }

  // Hard money
  const hm = ctx.hardMoney;
  if (hm) {
    if (hm.exitPlan.type === "sale") {
      const price = (hm.exitPlan.expectedSalePrice ?? hm.arv) * 100;
      add("flip_margin", "Projected sale margin", "stabilized", "(sale price after selling costs − total cost) ÷ sale price", [input("hardMoney.exitPlan.expectedSalePrice", "sale price", price), input("hardMoney.totalCost", "total cost", hm.metrics.totalCost * 100)], ([pr, c]) => ((pr! * (1 - HARD_MONEY.sellingCostPct) - c!) / pr!) * 100);
    }
    add("rehab_weeks", "Rehab schedule", "na", "Σ scope-line weeks", [input("hardMoney.scopeOfWork", "rehab weeks", hm.metrics.rehabWeeks)], ([w]) => w!);
    add("verified_projects_36m", "Verified projects (last 36 months)", "na", "verified completed projects in the hard money file", [input("hardMoney.trackRecord", "verified projects", hm.metrics.verifiedProjects)], ([n]) => n!);
  }

  // Sponsor strength (kept out of Metric[])
  let sponsorStrength: SponsorStrength | null = null;
  const t = ctx.guarantorTotals;
  const s = ctx.sponsor;
  const nw = t ? t.netWorthCents : (s?.statedNetWorthCents ?? null);
  const liq = t ? t.liquidityCents : (s?.statedLiquidityCents ?? null);
  if (t || (s && (nw !== null || liq !== null))) {
    const { netWorthMultiple, liquidityPct } = GUARANTOR_COVENANT_DEFAULTS;
    const reqNw = loan !== null ? loan * netWorthMultiple : null;
    const reqLiq = loan !== null ? loan * liquidityPct : null;
    sponsorStrength = {
      basis: t ? "pfs" : "stated",
      asOf: t ? t.oldestPfsAsOf : (s?.statedAsOf ?? null),
      netWorthCents: nw,
      liquidityCents: liq,
      guarantorCount: t?.guarantorCount ?? 0,
      pfsCount: t?.pfsCount ?? 0,
      covenants: {
        netWorthMultiple,
        liquidityPct,
        requiredNetWorthCents: reqNw,
        requiredLiquidityCents: reqLiq,
        netWorthOk: nw !== null && reqNw !== null ? nw >= reqNw : null,
        liquidityOk: liq !== null && reqLiq !== null ? liq >= reqLiq : null,
      },
    };
  }
  return { metrics: out, sponsorStrength, warnings: [] };
}
