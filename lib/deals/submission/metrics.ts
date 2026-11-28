// Computed metrics for the submission (spec 3.5). Pure functions over the
// SubmissionContext; ratios are never typed by staff.
//
// Rules every metric keeps:
//   - A missing input gives `value: null` and names it in `missing` ("as-is
//     value"). Nothing is guessed, defaulted, interpolated or read as 0.
//   - In-place and stabilized figures are never mixed in one metric: each has
//     its own row and its `basis` says which it is.
//   - Every input carries its FieldSource (a profile value with no entry is
//     "entered" by the row's updatedBy, spec 3.4); a metric's own provenance
//     is its formula.
//   - Hard money and fix & flip figures come from the hard money file's
//     hmMetrics (lib/checklists/hm-underwriting.ts), not recomputed.
//   - Sponsor dollars live in SponsorStrength, outside Metric[], so the email
//     builder can never receive them as a metric.
//
// Units: cents, percent 0-100, ratios as plain numbers (METRIC_UNITS).

import { guarantorCovenants, type PfsSummary } from "@/lib/principals/financials";
import { debtConstant } from "@/lib/sizing/finance";
import { HARD_MONEY } from "@/lib/sizing/programs/assumptions";
import type { SpreadKind } from "@/lib/spreads/store";
import { defaultPlaybook, HARD_MONEY_FILE_PLAYBOOKS, isIncomeProperty, playbookTrancheSource } from "./playbooks";
import {
  GUARANTOR_COVENANT_DEFAULTS,
  METRIC_UNITS,
  metricKeys,
  NOI_MISMATCH_WARN_PCT,
  PFS_MAX_AGE_DAYS,
  type FieldSource,
  type FieldSourceKey,
  type Metric,
  type MetricBasis,
  type MetricInput,
  type MetricKey,
  type SizeUnit,
  type SponsorStrength,
  type SubmissionContext,
  type SubmissionMetrics,
  type SubmissionPlaybook,
  type SubmissionProfile,
} from "./types";

// ---------------------------------------------------------------------------
// Small helpers (exported for prefill.ts and the UI)

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const toCents = (dollars: number | null | undefined) => (num(dollars) === null ? null : Math.round(dollars! * 100));

/** The FieldSource of a stored profile value: its field_sources entry, else "entered" by the row's last editor (spec 3.4). Null when no value is stored. */
export function fieldSourceOf(profile: SubmissionProfile | null, field: FieldSourceKey, value: unknown): FieldSource | null {
  if (!profile || value === null || value === undefined) return null;
  return profile.fieldSources[field] ?? { source: "entered", by: profile.updatedBy ?? profile.createdBy, at: profile.updatedAt };
}

/** sourceSpreadIds order in lib/spreads/workflow.ts packageSpreadsFromSaved (absent kinds are skipped). */
const PACKAGE_SPREAD_ORDER: readonly SpreadKind[] = ["deal_summary", "operating_statement", "rent_roll", "senior_census", "hotel_str"];

/** The saved spread id behind a package figure of `kind` (the bundle's deal_summary id when that kind is not listed). */
export function spreadIdFor(ctx: Pick<SubmissionContext, "spreads" | "spreadBundleKinds">, kind: SpreadKind): string | null {
  const ids = ctx.spreads?.sourceSpreadIds ?? [];
  const present = PACKAGE_SPREAD_ORDER.filter((k) => k === "deal_summary" || ctx.spreadBundleKinds.includes(k));
  const i = present.indexOf(kind);
  return (i >= 0 ? ids[i] : undefined) ?? ids[0] ?? null;
}

/** A FieldSource for a figure read from a saved spread. */
export function spreadSource(ref: string | null, asOf: string | null): FieldSource | null {
  if (!ref) return null;
  return { source: "spread", ref, ...(asOf ? { asOf } : {}), at: asOf ? `${asOf}T00:00:00.000Z` : new Date(0).toISOString() };
}

/** The metric with `key`, if computed. */
export function metricOf(m: SubmissionMetrics | Metric[], key: MetricKey): Metric | undefined {
  return (Array.isArray(m) ? m : m.metrics).find((x) => x.key === key);
}

const COUNT_UNITS: readonly SizeUnit[] = ["units", "keys", "beds", "pads", "lots"];
const UNIT_NOUN: Record<SizeUnit, string> = { units: "unit", keys: "key", beds: "bed", pads: "pad", lots: "lot", sf: "SF", acres: "acre" };

const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const pctText = (n: number) => `${Number(n.toFixed(3))}%`;
const years = (months: number) => (months % 12 === 0 ? `${months / 12}` : (months / 12).toFixed(1));

/** Precision a metric value is kept at (formatting is the caller's). */
function roundFor(key: MetricKey, v: number): number {
  switch (METRIC_UNITS[key]) {
    case "cents":
      return Math.round(v);
    case "pct":
      return Math.round(v * 100) / 100;
    case "x":
      return Math.round(v * 1000) / 1000;
    default:
      return Math.round(v * 10) / 10;
  }
}

type Calc = { inputs: MetricInput[]; value: number | null; missing: string[] };

/**
 * Applies `f` when every input has a value and every input at a `positive`
 * index is above zero (a zero denominator is reported, not divided by).
 */
function calc(inputs: MetricInput[], f: (...v: number[]) => number, positive: readonly number[] = []): Calc {
  const missing = inputs.filter((i) => i.value === null).map((i) => i.label);
  for (const idx of positive) {
    const i = inputs[idx];
    if (i && i.value !== null && i.value <= 0) missing.push(`${i.label} above zero`);
  }
  if (missing.length) return { inputs, value: null, missing };
  const v = f(...inputs.map((i) => i.value!));
  return { inputs, value: Number.isFinite(v) ? v : null, missing: Number.isFinite(v) ? [] : ["inputs that give a finite result"] };
}

function metric(key: MetricKey, label: string, basis: MetricBasis, formula: string, c: Calc, note?: string): Metric {
  return { key, label, value: c.value === null ? null : roundFor(key, c.value), unit: METRIC_UNITS[key], basis, formula, inputs: c.inputs, missing: c.missing, ...(note ? { note } : {}) };
}

const sum = (xs: readonly { amountCents: number }[]) => xs.reduce((s, x) => s + x.amountCents, 0);
const DEBT_SOURCES = new Set(["senior_loan", "subordinate_debt", "c_pace", "seller_credit"]);

// ---------------------------------------------------------------------------
// The metric set

const STABILIZED_PLAYBOOKS: readonly SubmissionPlaybook[] = ["construction", "bridge", "hotel_pip_bridge", "mezz_pref", "c_pace"];
const YIELD_ON_COST_PLAYBOOKS: readonly SubmissionPlaybook[] = ["construction", "bridge", "hotel_pip_bridge", "mezz_pref"];
const HOTEL_PLAYBOOKS: readonly SubmissionPlaybook[] = ["hotel_cmbs", "hotel_pip_bridge"];

export function computeSubmissionMetrics(ctx: SubmissionContext): SubmissionMetrics {
  const { deal, profile: p, spreads, hardMoney: hm } = ctx;
  const playbook = p?.playbook ?? defaultPlaybook(deal.program);
  const hmPlaybook = HARD_MONEY_FILE_PLAYBOOKS.includes(playbook);
  const stack = playbook === "mezz_pref" || playbook === "c_pace";
  const income = isIncomeProperty(playbook, p ? { sizeCount: p.sizeCount, sizeUnit: p.sizeUnit } : null);
  const pd = p?.programDetails ?? {};
  const out: Metric[] = [];
  const warnings: string[] = [];

  // Inputs -------------------------------------------------------------------
  const prof = <K extends keyof SubmissionProfile & FieldSourceKey>(field: K, label: string): MetricInput => {
    const value = num(p?.[field]);
    return { field, label, value, source: fieldSourceOf(p, field, value) };
  };
  const detail = (field: FieldSourceKey, label: string, raw: unknown): MetricInput => {
    const value = num(raw);
    return { field, label, value, source: fieldSourceOf(p, field, value) };
  };
  const loan: MetricInput = { field: "deal.loanAmountCents", label: "loan amount", value: num(deal.loanAmountCents), source: null };
  const hmSource: FieldSource | null = hm ? { source: "record", record: "hm_underwriting", ref: hm.id, at: hm.updatedAt } : null;
  const hmIn = (field: string, label: string, dollars: number | null | undefined): MetricInput => ({ field: `hardMoney.${field}`, label, value: toCents(dollars), source: hmSource });

  const asIs = prof("asIsValueCents", "as-is value");
  const price = prof("purchasePriceCents", "purchase price");
  const stabValue = prof("stabilizedValueCents", "stabilized value");
  const noiStab = prof("noiStabilizedCents", "stabilized NOI");
  const rate = prof("assumedRatePct", "assumed rate");
  const amort = prof("assumedAmortMonths", "assumed amortization");
  const acquisition = p?.purpose === "acquisition";

  // In-place NOI: the profile's (with its own source), else the spread's reported NOI.
  const noiIn: MetricInput =
    p?.noiInPlaceCents != null
      ? prof("noiInPlaceCents", "in-place NOI")
      : { field: "spread.operating_statement", label: "in-place NOI", value: num(spreads?.noiCents), source: spreadSource(spreadIdFor(ctx, "operating_statement"), spreads?.asOf ?? null) };

  // Total uses: the sources-and-uses lines; construction falls back to the budget spread, then the budget section.
  const uses = p?.uses ?? [];
  const budget = pd.construction?.budget;
  const totalUses: MetricInput = uses.length
    ? { field: "uses", label: "total uses", value: sum(uses), source: fieldSourceOf(p, "uses", uses) }
    : playbook === "construction" && ctx.spreadFigures.constructionBudget
      ? { field: "spread.construction_budget", label: "total project cost", value: ctx.spreadFigures.constructionBudget.totalCents, source: spreadSource(ctx.spreadFigures.constructionBudget.spreadId, ctx.spreadFigures.constructionBudget.asOf) }
      : playbook === "construction" && budget
        ? detail("programDetails.construction.budget", "total project cost", Object.values(budget).reduce((s, v) => s + v, 0))
        : { field: "uses", label: "total uses", value: null, source: null };

  // The debt a lender tests: this loan, or on mezz / C-PACE the senior loan plus this one.
  const senior = detail("programDetails.capitalStack.seniorAmountCents", "senior loan amount", pd.capitalStack?.seniorAmountCents);
  const debt = stack ? [senior, loan] : [loan];
  const debtSum = (...v: number[]) => v.slice(0, debt.length).reduce((s, x) => s + x, 0);
  const combined = (label: string) => (stack ? `Combined ${label}` : label.charAt(0).toUpperCase() + label.slice(1));
  const debtWord = stack ? "(senior loan + this loan)" : "loan";

  // Leverage -------------------------------------------------------------------
  if (hmPlaybook && hm) {
    // The deal's loan (the one the email and summary print) against the file's values and cost, so a
    // file sized for another loan never puts a ratio for a different loan in front of a lender.
    out.push(
      metric("ltv_as_is", "LTV (as-is)", "in_place", "loan ÷ as-is value (hard money file)", calc([loan, hmIn("asIsValue", "as-is value", hm.asIsValue)], (l, v) => (l / v) * 100, [1])),
      metric("ltarv", "LTARV", "stabilized", "loan ÷ after-repair value (hard money file)", calc([loan, hmIn("arv", "after-repair value", hm.arv)], (l, v) => (l / v) * 100, [1])),
      metric("ltc", "LTC", "cost", "loan ÷ (purchase price or as-is value + rehab budget + contingency), hard money file", calc([loan, hmIn("totalCost", "total project cost", hm.metrics.totalCost)], (l, c) => (l / c) * 100, [1])),
    );
    if (num(deal.loanAmountCents) !== null && toCents(hm.requestedLoanAmount) !== deal.loanAmountCents) {
      warnings.push(`The hard money file's requested loan (${money(toCents(hm.requestedLoanAmount)!)}) is not the deal's loan amount (${money(deal.loanAmountCents!)}). LTV, LTC and LTARV here use the deal's loan against the file's values and cost; update the file so its tier limits are tested on the same loan.`);
    }
    // One as-is value and purchase price: the profile's must agree with the file's (readiness requires it).
    const fileAsIs = toCents(hm.asIsValue);
    const filePrice = toCents(hm.purchasePrice);
    if (p?.asIsValueCents != null && p.asIsValueCents !== fileAsIs) warnings.push(`The as-is value on the profile (${money(p.asIsValueCents)}) is not the hard money file's (${money(fileAsIs!)}); the email and the ratios use the file's. Make them agree.`);
    if (p?.purchasePriceCents != null && p.purchasePriceCents !== filePrice) warnings.push(`The purchase price on the profile (${money(p.purchasePriceCents)}) is not the hard money file's (${money(filePrice!)}); the email and the ratios use the file's. Make them agree.`);
  } else if (hmPlaybook) {
    out.push(
      metric("ltv_as_is", "LTV (as-is)", "in_place", "loan ÷ as-is value", calc([loan, asIs], (l, v) => (l / v) * 100, [1])),
      metric("ltarv", "LTARV", "stabilized", "loan ÷ after-repair value", calc([loan, { ...stabValue, label: "after-repair value" }], (l, v) => (l / v) * 100, [1])),
      metric("ltc", "LTC", "cost", "loan ÷ total uses", calc([loan, totalUses], (l, c) => (l / c) * 100, [1])),
    );
  } else if (!stack) {
    if (playbook !== "construction") {
      out.push(
        asIs.value === null && acquisition
          ? metric("ltv_as_is", "Loan to purchase price", "in_place", "loan ÷ purchase price", calc([loan, price], (l, v) => (l / v) * 100, [1]), "No as-is value is entered, so the purchase price is used.")
          : metric("ltv_as_is", "LTV (as-is)", "in_place", "loan ÷ as-is value", calc([loan, asIs], (l, v) => (l / v) * 100, [1])),
      );
    }
    if (acquisition || p?.purpose === "construction" || p?.purpose === "renovation" || playbook === "construction") {
      out.push(metric("ltc", "LTC", "cost", `loan ÷ ${totalUses.label}`, calc([loan, totalUses], (l, c) => (l / c) * 100, [1])));
    }
  } else {
    const value = asIs.value === null && acquisition ? price : asIs;
    out.push(metric("combined_ltv", "Combined LTV", "in_place", `(senior loan + this loan) ÷ ${value.label}`, calc([senior, loan, value], (s, l, v) => ((s + l) / v) * 100, [2])));
    if (playbook === "mezz_pref") out.push(metric("combined_ltc", "Combined LTC", "cost", "(senior loan + this loan) ÷ total uses", calc([senior, loan, totalUses], (s, l, c) => ((s + l) / c) * 100, [2])));
  }
  const stabilizedRelevant = !hmPlaybook && (STABILIZED_PLAYBOOKS.includes(playbook) || p?.stabilizedValueCents != null || p?.noiStabilizedCents != null);
  if (!hmPlaybook && (STABILIZED_PLAYBOOKS.includes(playbook) || p?.stabilizedValueCents != null)) {
    out.push(metric("ltv_stabilized", stack ? "Combined LTV (stabilized)" : "LTV (stabilized)", "stabilized", `${debtWord} ÷ stabilized value`, calc([...debt, stabValue], (...v) => (debtSum(...v) / v[v.length - 1]!) * 100, [debt.length])));
  }

  // Income -----------------------------------------------------------------------
  const annualDebtService = (...v: number[]) => {
    // v: [senior?, loan, ratePct, amortMonths, (seniorRatePct)]
    if (stack) {
      const [s, l, r, m, sr] = v as [number, number, number, number, number];
      return s * debtConstant(sr, m / 12) + l * debtConstant(r, m / 12);
    }
    const [l, r, m] = v as [number, number, number];
    return l * debtConstant(r, m / 12);
  };
  const seniorRate = detail("programDetails.capitalStack.seniorRatePct", "senior loan rate", pd.capitalStack?.seniorRatePct);
  const dsInputs = stack ? [senior, loan, rate, amort, seniorRate] : [loan, rate, amort];
  const dsNote = () => {
    if (rate.value === null || amort.value === null) return undefined;
    const sched = `${years(amort.value)}-year amortization`;
    return stack
      ? `Senior loan at its ${seniorRate.value === null ? "stated" : pctText(seniorRate.value)} rate and this loan at an assumed ${pctText(rate.value)}, both on a ${sched}; an assumption, not a quote.`
      : `At an assumed ${pctText(rate.value)} rate and ${sched}; an assumption, not a quote.`;
  };

  if (income) {
    out.push(metric("debt_yield_in_place", combined("debt yield (in place)"), "in_place", `in-place NOI ÷ ${debtWord}`, calc([noiIn, ...debt], (n, ...d) => (n / d.reduce((s, x) => s + x, 0)) * 100, debt.map((_, i) => i + 1))));
    out.push(metric("dscr_in_place", combined("DSCR (in place)"), "in_place", "in-place NOI ÷ annual debt service at the assumed rate and amortization", calc([noiIn, ...dsInputs], (n, ...rest) => n / annualDebtService(...rest), [1]), dsNote()));
    const capBase = acquisition && price.value !== null ? price : asIs;
    out.push(metric("cap_rate", "Cap rate (in place)", "in_place", `in-place NOI ÷ ${capBase.label}`, calc([noiIn, capBase], (n, v) => (n / v) * 100, [1])));
    const uw = spreads?.underwrittenNoiCents ?? null;
    out.push(
      metric(
        "noi_underwritten",
        "Underwritten NOI (Corin normalization)",
        "in_place",
        "T-12 normalized to the lender profile's vacancy, reserves and expense floors (saved spread)",
        calc([{ field: "spread.operating_statement", label: "saved operating-statement spread", value: num(uw), source: spreadSource(spreadIdFor(ctx, "operating_statement"), spreads?.asOf ?? null) }], (n) => n),
        spreads?.profile ? `Corin's normalization for the ${spreads.profile} lender profile; each lender underwrites its own NOI.` : undefined,
      ),
    );
    // NOI mismatch: a typed NOI and the T-12 spread's reported NOI (like for like) more than NOI_MISMATCH_WARN_PCT apart.
    const typed = num(p?.noiInPlaceCents);
    const reported = num(spreads?.noiCents);
    if (typed !== null && reported !== null && reported !== 0 && (Math.abs(typed - reported) / Math.abs(reported)) * 100 > NOI_MISMATCH_WARN_PCT) {
      const gap = (Math.abs(typed - reported) / Math.abs(reported)) * 100;
      warnings.push(`The in-place NOI on the profile (${money(typed)}) differs from the T-12 spread's reported NOI (${money(reported)}) by ${gap.toFixed(1)}%. Check which is right; the summary shows the document figure first.`);
    }
  }
  if (stabilizedRelevant && (income || playbook === "construction" || p?.noiStabilizedCents != null)) {
    out.push(metric("debt_yield_stabilized", combined("debt yield (stabilized)"), "stabilized", `stabilized NOI ÷ ${debtWord}`, calc([noiStab, ...debt], (n, ...d) => (n / d.reduce((s, x) => s + x, 0)) * 100, debt.map((_, i) => i + 1))));
    out.push(metric("dscr_stabilized", combined("DSCR (stabilized)"), "stabilized", "stabilized NOI ÷ annual debt service at the assumed rate and amortization", calc([noiStab, ...dsInputs], (n, ...rest) => n / annualDebtService(...rest), [1]), dsNote()));
  }
  const quotes = ctx.spreadFigures.quotes;
  if (quotes?.rows.length) {
    const q = [...quotes.rows].sort((a, b) => a.dscr - b.dscr)[0]!;
    const qs = spreadSource(quotes.spreadId, quotes.asOf);
    out.push(
      metric(
        "dscr_quoted",
        "DSCR at a quoted lender's terms",
        "in_place",
        "underwritten NOI ÷ annual debt service at the quote's rate and amortization (saved quote spread)",
        calc(
          [
            { field: "spread.quotes.loanAmountCents", label: "quoted loan", value: q.loanAmountCents, source: qs },
            { field: "spread.quotes.ratePct", label: "quoted rate", value: q.ratePct, source: qs },
            { field: "spread.quotes.amortYears", label: "quoted amortization (years)", value: q.amortYears, source: qs },
          ],
          () => q.dscr,
        ),
        `The lowest DSCR among ${quotes.rows.length} reviewed quote(s): ${pctText(q.ratePct)} rate, ${q.amortYears === 0 ? "interest-only" : `${q.amortYears}-year amortization`}; a quote, not a commitment.`,
      ),
    );
  }

  // DSCR rental (rent ÷ PITIA) ----------------------------------------------------
  if (playbook === "dscr_rental") {
    const r = pd.rental ?? {};
    const lease = num(r.monthlyRentCents);
    const market = num(r.marketRentCents);
    const useMarket = market !== null && (lease === null || market < lease);
    const rent: MetricInput = useMarket ? detail("programDetails.rental.marketRentCents", "monthly rent (lower of lease and market)", market) : detail("programDetails.rental.monthlyRentCents", "monthly rent (lower of lease and market)", lease);
    const taxes = detail("programDetails.rental.monthlyTaxesCents", "monthly property taxes", r.monthlyTaxesCents);
    const insurance = detail("programDetails.rental.monthlyInsuranceCents", "monthly insurance", r.monthlyInsuranceCents);
    const hoa = detail("programDetails.rental.monthlyHoaCents", "monthly HOA dues (0 if none)", r.monthlyHoaCents);
    const pitia = (l: number, rt: number, m: number, t: number, i: number, h: number) => (l * debtConstant(rt, m / 12)) / 12 + t + i + h;
    const rentNote = lease !== null && market !== null ? `Rent is the lower of the lease rent and the market rent (${useMarket ? "market" : "lease"}).` : "";
    const note = [rentNote, dsNote()].filter(Boolean).join(" ") || undefined;
    out.push(metric("dscr_rental", "DSCR (rent ÷ PITIA)", "in_place", "monthly rent ÷ (principal and interest at the assumed terms + taxes + insurance + HOA)", calc([rent, loan, rate, amort, taxes, insurance, hoa], (re, ...rest) => re / pitia(...(rest as [number, number, number, number, number, number])), [1]), note));
    out.push(metric("pitia_monthly", "PITIA (monthly)", "na", "principal and interest at the assumed terms + taxes + insurance + HOA", calc([loan, rate, amort, taxes, insurance, hoa], (...v) => pitia(...(v as [number, number, number, number, number, number]))), dsNote()));
  }

  // SBA ---------------------------------------------------------------------------------
  if (playbook === "sba_7a" || playbook === "sba_504") {
    const g = ctx.spreadFigures.globalCashFlow;
    out.push(metric("global_dscr", "Global DSCR", "in_place", "business and guarantor cash flow ÷ all debt service (saved global cash flow spread, read as is)", calc([{ field: "spread.global_cash_flow", label: "global cash flow spread", value: g?.globalDscr ?? null, source: spreadSource(g?.spreadId ?? null, g?.asOf ?? null) }], (x) => x)));
  }

  if (YIELD_ON_COST_PLAYBOOKS.includes(playbook)) {
    out.push(metric("yield_on_cost", "Yield on cost", "stabilized", `stabilized NOI ÷ ${totalUses.label}`, calc([noiStab, totalUses], (n, c) => (n / c) * 100, [1])));
  }

  // Hotel ---------------------------------------------------------------------------------
  if (HOTEL_PLAYBOOKS.includes(playbook)) {
    const str = ctx.spreadFigures.hotelStr;
    const strSrc = spreadSource(str?.spreadId ?? null, str?.asOf ?? null);
    const fromStr = (field: string, label: string, v: number | null | undefined): MetricInput => ({ field: `spread.hotel_str.${field}`, label, value: num(v), source: strSrc });
    const strFormula = (what: string) => (str ? `${what}, trailing twelve months through ${str.lastMonth} (STR spread)` : `${what}, as entered`);
    const hotel = pd.hotel ?? {};
    out.push(
      metric("hotel_occupancy", "Occupancy", "in_place", strFormula("rooms sold ÷ rooms available"), calc([str ? fromStr("occupancyPct", "occupancy", str.occupancyPct) : prof("occupancyPct", "occupancy")], (x) => x)),
      metric("hotel_adr", "ADR", "in_place", strFormula("room revenue ÷ rooms sold"), calc([str ? fromStr("adrCents", "ADR", str.adrCents) : detail("programDetails.hotel.adrCents", "ADR", hotel.adrCents)], (x) => x)),
      metric("hotel_revpar", "RevPAR", "in_place", strFormula("room revenue ÷ rooms available"), calc([str ? fromStr("revparCents", "RevPAR", str.revparCents) : detail("programDetails.hotel.revparCents", "RevPAR", hotel.revparCents)], (x) => x)),
      metric("revpar_index", "RevPAR index (RGI)", "in_place", strFormula("RevPAR ÷ comp-set RevPAR × 100"), calc([str?.revparIndex != null ? fromStr("revparIndex", "RevPAR index", str.revparIndex) : detail("programDetails.hotel.revparIndex", "RevPAR index", hotel.revparIndex)], (x) => x)),
    );
    if (hotel.pip?.required !== false) {
      const keys = p?.sizeUnit === "keys" ? prof("sizeCount", "keys") : { field: "sizeCount", label: "keys", value: null, source: null };
      out.push(metric("pip_per_key", "PIP cost per key", "na", "PIP budget ÷ keys", calc([detail("programDetails.hotel.pip", "PIP budget", hotel.pip?.budgetCents), keys], (b, k) => b / k, [1])));
    }
  }

  // Hard money / fix & flip (hmMetrics, reused) -------------------------------------------
  if (hmPlaybook) {
    const fileIn = (field: string, label: string, v: number | null): MetricInput => ({ field: `hardMoney.${field}`, label, value: v, source: hmSource });
    if (playbook === "fix_flip" || hm?.exitPlan.type === "sale") {
      const salePrice = hm ? (hm.exitPlan.expectedSalePrice ?? hm.arv) : null;
      out.push(
        metric(
          "flip_margin",
          "Projected sale margin",
          "stabilized",
          `(sale price × (1 − ${HARD_MONEY.sellingCostPct * 100}% selling costs) − total project cost) ÷ sale price (hard money file)`,
          calc([fileIn("expectedSalePrice", "expected sale price", toCents(salePrice)), fileIn("totalCost", "total project cost", toCents(hm?.metrics.totalCost))], (s, c) => ((s * (1 - HARD_MONEY.sellingCostPct) - c) / s) * 100, [0]),
          hm ? `Lenders look for at least ${HARD_MONEY.minFlipMarginPct * 100}%.` : undefined,
        ),
      );
    }
    out.push(
      metric("rehab_weeks", "Rehab schedule", "na", "sum of the scope-of-work lines' weeks (hard money file)", calc([fileIn("rehabWeeks", "hard money file scope of work", hm ? hm.metrics.rehabWeeks : null)], (x) => x)),
      metric(
        "verified_projects_36m",
        "Verified projects, last 36 months",
        "na",
        "completed sponsor or co-sponsor projects exited in the last 36 months with closing statements or deeds (hard money file)",
        calc([fileIn("verifiedProjects", "hard money file track record", hm ? hm.metrics.verifiedProjects : null)], (x) => x),
        hm ? `Sponsor tier on the hard money grid: ${hm.metrics.tier.toLowerCase()}.` : undefined,
      ),
    );
  }

  // Per unit / per SF ------------------------------------------------------------------------
  const unit = p?.sizeUnit ?? null;
  if (unit === null || COUNT_UNITS.includes(unit)) {
    const noun = unit ? UNIT_NOUN[unit] : "unit";
    const count = prof("sizeCount", unit ? `${noun} count` : "size (units, keys or beds)");
    out.push(metric("loan_per_unit", `Loan per ${noun}`, "na", `loan ÷ ${noun}s`, calc([loan, count], (l, c) => l / c, [1])));
    if (acquisition) out.push(metric("price_per_unit", `Price per ${noun}`, "na", `purchase price ÷ ${noun}s`, calc([price, count], (v, c) => v / c, [1])));
  }
  if (p?.rentableSf != null || unit === "sf") {
    const sf = p?.rentableSf != null ? prof("rentableSf", "rentable SF") : prof("sizeCount", "rentable SF");
    out.push(metric("loan_per_sf", "Loan per SF", "na", "loan ÷ rentable SF", calc([loan, sf], (l, s) => l / s, [1])));
  }

  // Capital ------------------------------------------------------------------------------------
  const sources = p?.sources ?? [];
  const srcIn: MetricInput = { field: "sources", label: "sources", value: sources.length ? sum(sources) : null, source: fieldSourceOf(p, "sources", sources.length ? sources : null) };
  const debtIn: MetricInput = { field: "sources", label: "debt sources", value: sources.length ? sum(sources.filter((s) => DEBT_SOURCES.has(s.kind))) : null, source: srcIn.source };
  const usesIn: MetricInput = { field: "uses", label: "uses", value: uses.length ? sum(uses) : null, source: fieldSourceOf(p, "uses", uses.length ? uses : null) };
  out.push(
    metric("equity", "Equity", "cost", "total uses − debt sources (senior, subordinate, C-PACE, seller credit)", calc([usesIn, debtIn], (u, d) => u - d)),
    metric("equity_share", "Equity share of cost", "cost", "(total uses − debt sources) ÷ total uses", calc([usesIn, debtIn], (u, d) => ((u - d) / u) * 100, [0])),
    metric("sources_minus_uses", "Sources minus uses", "na", "total sources − total uses (0 = balanced)", calc([srcIn, usesIn], (s, u) => s - u)),
  );
  if (srcIn.value !== null && usesIn.value !== null && srcIn.value !== usesIn.value) {
    warnings.push(`Sources (${money(srcIn.value)}) and uses (${money(usesIn.value)}) do not balance: ${srcIn.value > usesIn.value ? "sources exceed uses" : "uses exceed sources"} by ${money(Math.abs(srcIn.value - usesIn.value))}.`);
  }
  if (sources.length && loan.value !== null) {
    const kind = playbookTrancheSource[playbook];
    const line = sum(sources.filter((s) => s.kind === kind));
    if (line !== loan.value) warnings.push(`The ${kind.replace(/_/g, " ")} line (${money(line)}) is not the loan amount (${money(loan.value)}).`);
  }

  // Sponsor strength (outside Metric[]) ------------------------------------------------------
  const sponsorStrength = strengthOf(ctx);
  if (sponsorStrength?.basis === "pfs" && sponsorStrength.asOf) {
    const age = Math.floor((ctx.now.getTime() - Date.parse(`${sponsorStrength.asOf}T00:00:00Z`)) / 86_400_000);
    if (age > PFS_MAX_AGE_DAYS) warnings.push(`The oldest personal financial statement is dated ${sponsorStrength.asOf}, more than ${PFS_MAX_AGE_DAYS} days ago; lenders ask for a current one.`);
  }

  const order = new Map(metricKeys.map((k, i) => [k, i]));
  out.sort((a, b) => order.get(a.key)! - order.get(b.key)!);
  return { metrics: out, sponsorStrength, warnings };
}

/**
 * Guarantor strength (spec 3.5 "Guarantor covenants"): the summed PFS totals
 * when any backer's PFS is on file, else the sponsor's stated figures, else
 * null. The covenant test is lib/principals/financials.ts guarantorCovenants
 * at GUARANTOR_COVENANT_DEFAULTS (VERIFY).
 */
export function strengthOf(ctx: Pick<SubmissionContext, "deal" | "sponsor" | "guarantorTotals" | "principals">): SponsorStrength | null {
  const loan = num(ctx.deal.loanAmountCents);
  const t = ctx.guarantorTotals;
  const s = ctx.sponsor;
  let base: Omit<SponsorStrength, "covenants">;
  if (t) {
    base = { basis: "pfs", asOf: t.oldestPfsAsOf, netWorthCents: t.netWorthCents, liquidityCents: t.liquidityCents, guarantorCount: t.guarantorCount, pfsCount: t.pfsCount };
  } else if (s && (s.statedNetWorthCents !== null || s.statedLiquidityCents !== null)) {
    const guarantors = ctx.principals.filter((x) => !x.roles.includes("borrower_entity") && (x.isGuarantor || x.roles.includes("guarantor") || x.owes.includes("guaranty"))).length;
    base = { basis: "stated", asOf: s.statedAsOf, netWorthCents: s.statedNetWorthCents, liquidityCents: s.statedLiquidityCents, guarantorCount: guarantors, pfsCount: 0 };
  } else {
    return null;
  }
  const { netWorthMultiple, liquidityPct } = GUARANTOR_COVENANT_DEFAULTS;
  // guarantorCovenants reads only netWorth and liquidity from the summary.
  const test = loan === null ? null : guarantorCovenants({ netWorth: base.netWorthCents ?? 0, liquidity: base.liquidityCents ?? 0 } as PfsSummary, loan, { netWorthMultiple, liquidityPct });
  return {
    ...base,
    covenants: {
      netWorthMultiple,
      liquidityPct,
      requiredNetWorthCents: test ? Math.round(test.requiredNetWorth) : null,
      requiredLiquidityCents: test ? Math.round(test.requiredLiquidity) : null,
      netWorthOk: test && base.netWorthCents !== null ? test.netWorthOk : null,
      liquidityOk: test && base.liquidityCents !== null ? test.liquidityOk : null,
    },
  };
}
