// The one-page deal summary a lender sees behind the share link (spec 5.5):
// the same facts as the email, with exact figures, their sources, and how
// every Corin calculation was made. Deterministic: the same context and
// metrics give the same spec (and the same SHA-256), and the as-of date
// follows the data, not the clock, so a second lender next week gets the same
// locked package version.
//
// Rules (spec 6): a value that is missing produces no row (never "N/A", never
// an estimate); every figure row names its source; stabilized and in-place
// figures never share a row; staff-typed text passes checkSummaryCopy; Corin
// is the broker, not the lender.

import { createHash } from "node:crypto";
import { REPORT_LABELS } from "@/lib/construction/types";
import { checkSummaryCopy } from "@/lib/agents/lenders/package";
import { ROLE_LABEL } from "@/lib/principals/types";
import { licenseLine, site } from "@/lib/site";
import { PLAYBOOK_LABELS, programDetailKeysFor } from "./playbooks";
import { assertEmailSafe } from "./redaction";
import { RECEIVED_STATUSES, playbookOf } from "./requirements";
import {
  CONSENT_STATUS_LABELS,
  CONSTRUCTION_CONTRACT_LABELS,
  CREDIT_BAND_LABELS,
  CREDIT_EVENT_LABELS,
  ENTITLEMENT_STATUS_LABELS,
  EXIT_STRATEGY_LABELS,
  HUD_SECTION_LABELS,
  LEASE_STATUS_LABELS,
  LIEN_POSITION_LABELS,
  LOAN_PURPOSE_LABELS,
  MARKET_RENT_SOURCE_LABELS,
  NOI_BASIS_LABELS,
  PERMIT_STATUS_LABELS,
  PLANS_STAGE_LABELS,
  RATE_TYPE_LABELS,
  RECOURSE_LABELS,
  SIZE_UNIT_LABELS,
  SOURCE_KIND_LABELS,
  SUBMISSION_ASSET_TYPE_LABELS,
  TENANCY_LABELS,
  TRANCHE_KIND_LABELS,
  USE_KIND_LABELS,
  VALUE_SOURCE_LABELS,
  creditEventKinds,
  type DealSummaryRow,
  type DealSummarySection,
  type DealSummarySpec,
  type FieldSource,
  type IsoDate,
  type Metric,
  type MetricKey,
  type ProgramDetailKey,
  type SponsorStrength,
  type SubmissionContext,
  type SubmissionMetrics,
  type SubmissionProfile,
  type TargetStage,
} from "./types";

export const SUMMARY_TEMPLATE_VERSION = "deal-summary-v1";

/** What the lender is asked for, by target stage. */
export const STAGE_ASK: Record<TargetStage, string> = { screen: "A soft quote", term_sheet: "A term sheet", underwrite: "Full underwriting" };

// ---------------------------------------------------------------------------
// Formatting (shared with email.ts so a number reads the same everywhere)

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const group = (n: number) => String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const trimFixed = (n: number, digits: number) => String(Number(n.toFixed(digits)));

export const fmt = {
  /** "$8,400,000"; amounts under $1,000 keep cents when they have them ("$119.17"). */
  usd(cents: number): string {
    const sign = cents < 0 ? "-" : "";
    const abs = Math.abs(cents);
    if (abs < 100_000 && abs % 100 !== 0) return `${sign}$${(abs / 100).toFixed(2)}`;
    return `${sign}$${group(abs / 100)}`;
  },
  /** "$8.4M", "$650K", "$1.25B". */
  usdCompact(cents: number): string {
    const d = Math.abs(cents) / 100;
    const sign = cents < 0 ? "-" : "";
    if (d >= 1e9) return `${sign}$${trimFixed(d / 1e9, 2)}B`;
    if (d >= 1e6) return `${sign}$${trimFixed(d / 1e6, 2)}M`;
    if (d >= 1e3) return `${sign}$${trimFixed(d / 1e3, 0)}K`;
    return `${sign}$${group(d)}`;
  },
  /** One decimal, trailing ".0" dropped: "68%", "9.1%". */
  pct(n: number): string {
    return `${trimFixed(n, 1)}%`;
  },
  x(n: number): string {
    return `${n.toFixed(2)}x`;
  },
  /** Interest rates keep up to three decimals: "8.75%", "5.125%". */
  rate(n: number): string {
    return `${trimFixed(n, 3)}%`;
  },
  /** Grouped, up to two decimals: "1,234", "108.4", "0.92". */
  count(n: number): string {
    const [int, dec] = trimFixed(Math.abs(n), 2).split(".");
    return `${n < 0 ? "-" : ""}${group(Number(int))}${dec ? `.${dec}` : ""}`;
  },
  /** "January 15, 2027" from "2027-01-15" or a timestamp. */
  date(iso: string): string {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return `${MONTHS[(m ?? 1) - 1]} ${d}, ${y}`;
  },
  /** "September 2026". */
  monthYear(iso: string): string {
    const [y, m] = iso.slice(0, 10).split("-").map(Number);
    return `${MONTHS[(m ?? 1) - 1]} ${y}`;
  },
  months(n: number): string {
    return `${group(n)} month${n === 1 ? "" : "s"}`;
  },
  /** "30-year amortization" or "18-month amortization". */
  amortization(months: number): string {
    return months % 12 === 0 ? `${months / 12}-year amortization` : `${months}-month amortization`;
  },
  yesNo(b: boolean): string {
    return b ? "Yes" : "No";
  },
};

/** A metric's value in its unit; null when the metric has no value. */
export function formatMetricValue(m: Pick<Metric, "value" | "unit">): string | null {
  if (m.value === null) return null;
  switch (m.unit) {
    case "pct":
      return fmt.pct(m.value);
    case "x":
      return fmt.x(m.value);
    case "cents":
      return fmt.usd(m.value);
    case "count":
      return fmt.count(m.value);
    case "months":
      return fmt.months(m.value);
    case "weeks":
      return `${group(m.value)} week${m.value === 1 ? "" : "s"}`;
  }
}

export function metricOf(metrics: SubmissionMetrics | readonly Metric[], key: MetricKey): Metric | null {
  const list = Array.isArray(metrics) ? (metrics as readonly Metric[]) : (metrics as SubmissionMetrics).metrics;
  const m = list.find((x) => x.key === key);
  return m && m.value !== null ? m : null;
}

/** The size phrase: "42-unit multifamily", "86,000 SF retail", "132-key hotel (flagged)". */
export function sizePhrase(p: Pick<SubmissionProfile, "sizeCount" | "sizeUnit" | "assetType">): string | null {
  const asset = p.assetType ? SUBMISSION_ASSET_TYPE_LABELS[p.assetType] : null;
  const assetLower = asset ? asset.charAt(0).toLowerCase() + asset.slice(1) : null;
  if (p.sizeCount === null || p.sizeUnit === null) return assetLower;
  const n = p.sizeCount;
  let size: string;
  if (p.sizeUnit === "sf") size = `${group(n)} SF`;
  else if (p.sizeUnit === "acres") size = `${fmt.count(n)}-acre`;
  else size = `${group(n)}-${SIZE_UNIT_LABELS[p.sizeUnit].replace(/s$/, "")}`;
  if (!assetLower) return size;
  // "2–4 unit residential" / "1–4 unit house" already carry a unit count; drop it.
  const asset2 = p.sizeUnit === "units" ? assetLower.replace(/^\d–\d unit /, "") : assetLower;
  return `${size} ${asset2}`;
}

// ---------------------------------------------------------------------------
// Sources

const DOC_KIND_LABELS: Record<string, string> = {
  T12: "T-12",
  RENT_ROLL: "rent roll",
  CENSUS: "census",
  STR_REPORT: "STR report",
  FRANCHISE_AGREEMENT: "franchise agreement",
  PIP_BUDGET: "PIP budget",
  PFS: "financial statement",
  TAX_RETURN: "tax returns",
  APPRAISAL: "appraisal",
};
const RECORD_LABELS = { principals: "the org chart", hm_underwriting: "the hard money file", construction_projects: "the construction project" } as const;

export const SOURCE_ENTERED = "Entered by Corin";
export const SOURCE_DEAL = "Deal record";
export const SOURCE_SPONSOR = "Stated by the sponsor";
export const SOURCE_CALCULATED = "Corin calculation";

/** The short source tag for a stored value (spec 3.4): "From T-12 · September 30, 2026", "Per borrower". */
export function sourceLabel(src: FieldSource | null | undefined, ctx?: Pick<SubmissionContext, "vaultDocuments">): string {
  if (!src) return SOURCE_ENTERED;
  switch (src.source) {
    case "entered":
      return SOURCE_ENTERED;
    case "borrower":
      return "Per borrower";
    case "document": {
      const doc = ctx?.vaultDocuments.find((d) => d.id === src.ref);
      const name = doc ? (DOC_KIND_LABELS[doc.kind] ?? doc.fileName.replace(/\.[a-z0-9]{2,5}$/i, "")) : "document";
      return `From ${name}${src.asOf ? ` · ${fmt.date(src.asOf)}` : ""}`;
    }
    case "spread":
      return `From Corin spread${src.asOf ? ` · ${fmt.date(src.asOf)}` : ""}`;
    case "record":
      return `From ${RECORD_LABELS[src.record]}`;
    case "public_record":
      return "Public record";
  }
}

function fieldSource(ctx: SubmissionContext, key: string): FieldSource | null {
  return (ctx.profile?.fieldSources as Record<string, FieldSource | undefined> | undefined)?.[key] ?? null;
}

// ---------------------------------------------------------------------------
// Builder

type Row = DealSummaryRow;
const row = (label: string, value: string | null | undefined, source?: string): Row[] => (value === null || value === undefined || value === "" ? [] : [{ label, value, ...(source ? { source } : {}) }]);
const section = (title: string, parts: { rows?: Row[]; paragraphs?: string[]; table?: DealSummarySection["table"] }): DealSummarySection[] => {
  const s: DealSummarySection = { title };
  if (parts.rows?.length) s.rows = parts.rows;
  if (parts.paragraphs?.length) s.paragraphs = parts.paragraphs;
  if (parts.table?.rows.length) s.table = parts.table;
  return s.rows || s.paragraphs || s.table ? [s] : [];
};
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Staff-typed strings the summary prints (checkSummaryCopy runs on all of them). */
export function staffTypedText(ctx: SubmissionContext): string[] {
  const p = ctx.profile;
  const s = ctx.sponsor;
  const out: (string | null | undefined)[] = [ctx.deal.title, ctx.deal.borrowerName];
  if (p) {
    out.push(p.propertyName, p.closeDriver, p.prepayPreference, p.existingLender, p.cashOutUse, p.zoning, p.businessPlan, p.exitDetail, ...p.highlights, ...p.risks.flatMap((r) => [r.risk, r.mitigant]));
    out.push(...p.sources.map((l) => l.note), ...p.uses.map((l) => l.note));
    const d = p.programDetails;
    out.push(d.rehab?.scopeSummary, d.sba?.businessName, d.sba?.equityInjectionSource, d.sba?.cdcName, d.hotel?.brand, d.agency?.affordabilityNote, ...(d.agency?.unitMix ?? []).map((u) => u.type));
    out.push(d.hud?.operatorName, d.hud?.payorMixNote, d.hud?.surveyHistoryNote, d.capitalStack?.seniorLender, d.capitalStack?.programJurisdiction, ...(d.tenancy?.topTenants ?? []).map((t) => t.name));
  }
  if (s) out.push(s.experienceSummary, s.portfolioSizeNote, s.managementCompany, ...creditEventKinds.map((k) => s.creditEvents[k]?.explanation));
  return out.filter((t): t is string => typeof t === "string" && t.trim().length > 0);
}

/** The latest updated_at among the deal, profile, sponsor, spreads and linked records; never the clock. */
export function summaryAsOf(ctx: SubmissionContext): IsoDate {
  const dates = [
    ctx.deal.updatedAt,
    ctx.profile?.updatedAt,
    ctx.sponsor?.updatedAt,
    ctx.spreads?.asOf,
    ctx.hardMoney?.updatedAt,
    ctx.construction?.project.updatedAt,
    ...(ctx.construction?.reports ?? []).map((r) => r.updatedAt),
    ...ctx.principals.map((p) => p.pfsAsOf),
  ].filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d));
  return dates.map((d) => d.slice(0, 10)).sort().at(-1) ?? ctx.deal.createdAt.slice(0, 10);
}

export type SummaryOptions = {
  /** Labels of unmet required items at the target stage (readiness.ts); "Not yet in hand". */
  openItems?: readonly string[];
  advisor?: { name: string; email: string; dreLicense?: string | null } | null;
};

/** Headline metrics per playbook (spec 5.3), the summary tiles' and the email subject's; each entry lists alternatives in order. */
export function headlineMetricKeys(playbook: ReturnType<typeof playbookOf>): MetricKey[][] {
  switch (playbook) {
    case "bridge":
    case "bank":
    case "dscr_rental":
    case "agency":
    case "hud_multifamily":
    case "hud_232":
      return [["ltv_as_is"], [playbook === "dscr_rental" ? "dscr_rental" : "dscr_in_place"]];
    case "cmbs":
    case "hotel_cmbs":
    case "life_company":
      return [["ltv_as_is"], ["debt_yield_in_place"]];
    case "construction":
      return [["ltc"], ["yield_on_cost"]];
    case "hard_money":
    case "fix_flip":
      return [["ltc"], ["ltarv"]];
    case "sba_7a":
    case "sba_504":
      return [["ltv_as_is"], ["global_dscr"]];
    case "hotel_pip_bridge":
      return [["ltv_as_is", "ltc"], ["debt_yield_in_place"]];
    case "mezz_pref":
    case "c_pace":
      return [["combined_ltv", "combined_ltc"]];
  }
}

/** Short headline label for a metric ("LTV", "DSCR"); "Loan to price" when LTV rests on the purchase price. */
export function headlineLabel(m: Metric): string {
  const onPrice = m.key === "ltv_as_is" && m.inputs.some((i) => i.field === "purchasePriceCents");
  const labels: Partial<Record<MetricKey, string>> = {
    ltv_as_is: onPrice ? "Loan to price" : "LTV",
    ltv_stabilized: "LTV (stabilized)",
    ltarv: "LTARV",
    ltc: "LTC",
    combined_ltv: "Combined LTV",
    combined_ltc: "Combined LTC",
    debt_yield_in_place: "Debt yield",
    debt_yield_stabilized: "Debt yield (stabilized)",
    dscr_in_place: "DSCR",
    dscr_rental: "DSCR",
    global_dscr: "Global DSCR",
    yield_on_cost: "Yield on cost",
    cap_rate: "Cap rate",
  };
  return labels[m.key] ?? m.label;
}

function pickHeadline(playbook: ReturnType<typeof playbookOf>, metrics: SubmissionMetrics, loanCents: number | null, occupancy: number | null): { label: string; value: string }[] {
  const tiles: { label: string; value: string }[] = [];
  if (loanCents !== null && loanCents > 0) tiles.push({ label: "Loan request", value: fmt.usd(loanCents) });
  const used = new Set<MetricKey>();
  const push = (m: Metric | null) => {
    if (!m || used.has(m.key) || tiles.length >= 6) return;
    used.add(m.key);
    tiles.push({ label: headlineLabel(m), value: formatMetricValue(m)! });
  };
  for (const alternatives of headlineMetricKeys(playbook)) push(alternatives.map((k) => metricOf(metrics, k)).find(Boolean) ?? null);
  for (const k of ["ltv_as_is", "ltc", "dscr_in_place", "debt_yield_in_place", "ltarv", "yield_on_cost"] as const) {
    if (tiles.length >= 5) break;
    push(metricOf(metrics, k));
  }
  if (occupancy !== null && tiles.length < 6) tiles.push({ label: "Occupancy", value: fmt.pct(occupancy) });
  return tiles;
}

const PROGRAM_METRICS: ReadonlySet<MetricKey> = new Set(["hotel_occupancy", "hotel_adr", "hotel_revpar", "revpar_index", "pip_per_key", "flip_margin", "rehab_weeks", "verified_projects_36m", "pitia_monthly", "dscr_rental", "global_dscr", "combined_ltv", "combined_ltc", "equity", "equity_share", "sources_minus_uses"]);

function metricRow(m: Metric | null): Row[] {
  if (!m) return [];
  const value = formatMetricValue(m)!;
  return row(m.label, m.note ? `${value} (${m.note})` : value, SOURCE_CALCULATED);
}

/** A metric input's value, by the unit its field name carries (Cents, Pct, Months). */
function formatInputValue(field: string, value: number): string {
  const key = field.split(".").at(-1) ?? field;
  if (/Cents$/.test(key) || key === "uses" || key === "sources") return fmt.usd(value);
  if (/Pct$/.test(key)) return fmt.pct(value);
  if (/Months$/.test(key)) return fmt.months(value);
  return fmt.count(value);
}

function strengthRows(strength: SponsorStrength | null, label: "Guarantor" | "Key principal"): Row[] {
  if (!strength) return [];
  const src = strength.basis === "pfs" ? `From ${strength.pfsCount} personal financial statement${strength.pfsCount === 1 ? "" : "s"}${strength.asOf ? `, oldest dated ${fmt.date(strength.asOf)}` : ""}` : `${SOURCE_SPONSOR}${strength.asOf ? ` on ${fmt.date(strength.asOf)}` : ""}`;
  const c = strength.covenants;
  const liqPct = c.liquidityPct <= 1 ? c.liquidityPct * 100 : c.liquidityPct;
  const multiple = c.netWorthMultiple === 1 ? "the loan amount" : `${trimFixed(c.netWorthMultiple, 2)}x the loan amount`;
  return [
    ...row(`Combined ${lower(label)} net worth`, strength.netWorthCents !== null ? fmt.usd(strength.netWorthCents) : null, src),
    ...row(`Combined ${lower(label)} liquidity`, strength.liquidityCents !== null ? fmt.usd(strength.liquidityCents) : null, src),
    ...row(`Net worth at or above ${multiple}`, c.netWorthOk === null ? null : fmt.yesNo(c.netWorthOk), SOURCE_CALCULATED),
    ...row(`Liquidity at or above ${trimFixed(liqPct, 1)}% of the loan`, c.liquidityOk === null ? null : fmt.yesNo(c.liquidityOk), SOURCE_CALCULATED),
  ];
}

function programSection(key: ProgramDetailKey, ctx: SubmissionContext, metrics: SubmissionMetrics): DealSummarySection[] {
  const p = ctx.profile!;
  const d = p.programDetails;
  const src = (field: string) => sourceLabel(fieldSource(ctx, `programDetails.${key}.${field}`), ctx);
  const money = (c: number | undefined) => (c === undefined ? null : fmt.usd(c));
  const date = (s: string | undefined) => (s ? fmt.date(s) : null);
  switch (key) {
    case "construction": {
      const c = d.construction;
      if (!c) return [];
      const proj = ctx.construction?.project ?? null;
      const lic = ctx.construction?.licenseCheck ?? null;
      const budget = ctx.spreadFigures.constructionBudget?.budget ?? c.budget;
      const budgetSrc = ctx.spreadFigures.constructionBudget ? `From Corin spread · ${fmt.date(ctx.spreadFigures.constructionBudget.asOf)}` : src("budget");
      const lines: [string, number][] = budget
        ? (
            [
              ["Land", budget.landCents],
              ["Hard costs", budget.hardCents],
              ["Soft costs", budget.softCents],
              ["Contingency", budget.contingencyCents],
              ["Developer fee", budget.developerFeeCents],
              ["Financing costs", budget.financingCents],
              ["Reserves requested of the lender", budget.reservesCents],
            ] as [string, number][]
          ).filter(([, v]) => v > 0)
        : [];
      return section("Construction", {
        rows: [
          ...row("Units to build", c.unitsToBuild !== undefined ? group(c.unitsToBuild) : null, src("unitsToBuild")),
          ...row("Gross SF", c.grossSf !== undefined ? group(c.grossSf) : null, src("grossSf")),
          ...row("Construction period", c.constructionMonths !== undefined ? fmt.months(c.constructionMonths) : null, src("constructionMonths")),
          ...row("Lease-up or sell-out", c.leaseUpMonths !== undefined ? fmt.months(c.leaseUpMonths) : null, src("leaseUpMonths")),
          ...row("Entitlements", c.entitlementStatus ? ENTITLEMENT_STATUS_LABELS[c.entitlementStatus] : null, src("entitlementStatus")),
          ...row("Building permits", c.permitStatus ? PERMIT_STATUS_LABELS[c.permitStatus] : null, src("permitStatus")),
          ...row("Plans", c.plansStage ? PLANS_STAGE_LABELS[c.plansStage] : null, src("plansStage")),
          ...row("Contract", c.contractType ? CONSTRUCTION_CONTRACT_LABELS[c.contractType] : null, src("contractType")),
          ...row("General contractor", proj?.generalContractorName ? `${proj.generalContractorName}${proj.generalContractorLicense ? `, CSLB #${proj.generalContractorLicense}` : ""}` : null, "From the construction project"),
          ...row("CSLB license check", lic ? `${lic.status === "clear" ? "Clear" : lic.status.replace(/_/g, " ")} (${fmt.date(lic.checkedAt)})` : null, "CSLB public record"),
          ...row("Sponsor equity in to date", money(c.equityInToDateCents), src("equityInToDateCents")),
          ...row("Completion guaranty offered", c.completionGuaranty === undefined ? null : fmt.yesNo(c.completionGuaranty), src("completionGuaranty")),
          ...row("Ground-up projects completed by the sponsor", c.groundUpProjectsCompleted !== undefined ? group(c.groundUpProjectsCompleted) : null, src("groundUpProjectsCompleted")),
          ...metricRow(metricOf(metrics, "yield_on_cost")),
        ],
        table: lines.length ? { head: ["Budget line", `Amount (${budgetSrc})`], rows: [...lines.map(([l, v]) => [l, fmt.usd(v)]), ["Total", fmt.usd(lines.reduce((s, [, v]) => s + v, 0))]] } : undefined,
      });
    }
    case "rehab": {
      const x = d.rehab;
      if (!x) return [];
      const rr = x.reservesRequested;
      return section("Renovation and reserves requested", {
        rows: [
          ...row("Renovation budget", money(x.budgetCents), src("budgetCents")),
          ...row("Renovation period", x.months !== undefined ? fmt.months(x.months) : null, src("months")),
          ...row("Interest reserve requested", money(rr?.interestCents), src("reservesRequested")),
          ...row("Capex reserve requested", money(rr?.capexCents), src("reservesRequested")),
          ...row("Leasing reserve requested", money(rr?.leasingCents), src("reservesRequested")),
        ],
        paragraphs: x.scopeSummary ? [`Scope: ${x.scopeSummary}`] : [],
      });
    }
    case "rental": {
      const x = d.rental;
      if (!x) return [];
      return section("Rent and PITIA", {
        rows: [
          ...row("Monthly rent (leases)", money(x.monthlyRentCents), src("monthlyRentCents")),
          ...row("Monthly market rent", money(x.marketRentCents), x.marketRentSource ? MARKET_RENT_SOURCE_LABELS[x.marketRentSource] : src("marketRentCents")),
          ...row("Monthly taxes", money(x.monthlyTaxesCents), src("monthlyTaxesCents")),
          ...row("Monthly insurance", money(x.monthlyInsuranceCents), src("monthlyInsuranceCents")),
          ...row("Monthly HOA", x.monthlyHoaCents ? fmt.usd(x.monthlyHoaCents) : null, src("monthlyHoaCents")),
          ...metricRow(metricOf(metrics, "pitia_monthly")),
          ...metricRow(metricOf(metrics, "dscr_rental")),
          ...row("Lease status", x.leaseStatus ? LEASE_STATUS_LABELS[x.leaseStatus] : null, src("leaseStatus")),
          ...row("Earliest lease end", date(x.earliestLeaseEnd), src("earliestLeaseEnd")),
          ...row("Reserves after closing", x.reservesMonths !== undefined ? `${x.reservesMonths} months of PITIA` : null, src("reservesMonths")),
        ],
      });
    }
    case "sba": {
      const x = d.sba;
      if (!x) return [];
      const flags = ([["Franchise", x.franchise], ["Change of ownership", x.changeOfOwnership], ["Affiliates", x.affiliates]] as const).filter(([, v]) => typeof v === "boolean");
      return section("Operating business", {
        rows: [
          ...row("Business", x.businessName, src("businessName")),
          ...row("NAICS", x.naics, src("naics")),
          ...row("Years in business", x.yearsInBusiness !== undefined ? group(x.yearsInBusiness) : null, src("yearsInBusiness")),
          ...row("Employees", x.employees !== undefined ? group(x.employees) : null, src("employees")),
          ...row("Owner-occupied share", p.ownerOccupiedPct !== null ? fmt.pct(p.ownerOccupiedPct) : null, sourceLabel(fieldSource(ctx, "ownerOccupiedPct"), ctx)),
          ...row("Business revenue (annual)", money(x.businessRevenueCents), src("businessRevenueCents")),
          ...row("Business EBITDA (annual)", money(x.businessEbitdaCents), src("businessEbitdaCents")),
          ...row("Existing business debt service (annual)", money(x.existingBusinessDebtServiceCents), src("existingBusinessDebtServiceCents")),
          ...metricRow(metricOf(metrics, "global_dscr")),
          ...row("Equity injection", money(x.equityInjectionCents), src("equityInjectionCents")),
          ...row("Source of the injection", x.equityInjectionSource, src("equityInjectionSource")),
          ...flags.map(([label, v]) => ({ label, value: fmt.yesNo(v as boolean), source: src(label === "Franchise" ? "franchise" : label === "Affiliates" ? "affiliates" : "changeOfOwnership") })),
          ...row("Certified development company", x.cdcName, src("cdcName")),
          ...row("Jobs created or retained", x.jobsCreated !== undefined ? group(x.jobsCreated) : null, src("jobsCreated")),
        ],
      });
    }
    case "hotel": {
      const x = d.hotel;
      if (!x) return [];
      const pip = x.pip;
      return section("Hotel", {
        rows: [
          ...row("Keys", p.sizeUnit === "keys" && p.sizeCount !== null ? group(p.sizeCount) : null, sourceLabel(fieldSource(ctx, "sizeCount"), ctx)),
          ...row("Brand", x.brand, src("brand")),
          ...row("Franchise expires", date(x.franchiseExpiry), src("franchiseExpiry")),
          ...row("Management company", ctx.sponsor?.managementCompany, SOURCE_SPONSOR),
          ...metricRow(metricOf(metrics, "hotel_occupancy")),
          ...metricRow(metricOf(metrics, "hotel_adr")),
          ...metricRow(metricOf(metrics, "hotel_revpar")),
          ...metricRow(metricOf(metrics, "revpar_index")),
          ...row("FF&E reserve", x.ffeReservePct !== undefined ? `${fmt.pct(x.ffeReservePct)} of revenue` : null, src("ffeReservePct")),
          ...row("PIP required by the brand", pip ? fmt.yesNo(pip.required) : null, src("pip")),
          ...row("PIP budget", pip?.required ? money(pip.budgetCents) : null, src("pip")),
          ...metricRow(pip?.required ? metricOf(metrics, "pip_per_key") : null),
          ...row("PIP deadline", pip?.required ? date(pip.deadline) : null, src("pip")),
          ...row("Brand has signed off on the PIP scope", pip?.required && pip.brandApproved !== undefined ? fmt.yesNo(pip.brandApproved) : null, src("pip")),
        ],
      });
    }
    case "tenancy": {
      const x = d.tenancy;
      if (!x) return [];
      return section("Tenancy and rollover", {
        rows: [
          ...row("Rent rolling inside the requested term", x.rolloverPctWithinTerm !== undefined ? fmt.pct(x.rolloverPctWithinTerm) : null, src("rolloverPctWithinTerm")),
          ...row("Weighted average lease term remaining", x.walMonths !== undefined ? fmt.months(x.walMonths) : null, src("walMonths")),
        ],
        table: x.topTenants?.length ? { head: ["Top tenants", "Share of rent", "Lease ends"], rows: x.topTenants.map((t) => [t.name, fmt.pct(t.sharePct), fmt.date(t.leaseEnd)]) } : undefined,
      });
    }
    case "agency": {
      const x = d.agency;
      if (!x) return [];
      return section("Agency", {
        rows: [
          ...row("Physical occupancy", p.occupancyPct !== null ? fmt.pct(p.occupancyPct) : null, sourceLabel(fieldSource(ctx, "occupancyPct"), ctx)),
          ...row("Economic occupancy", x.economicOccupancyPct !== undefined ? fmt.pct(x.economicOccupancyPct) : null, src("economicOccupancyPct")),
          ...row("Student or senior concentration", x.studentOrSeniorPct !== undefined ? fmt.pct(x.studentOrSeniorPct) : null, src("studentOrSeniorPct")),
        ],
        paragraphs: x.affordabilityNote ? [`Affordability and rent regulation: ${x.affordabilityNote}`] : [],
        table: x.unitMix?.length ? { head: ["Unit type", "Units", "Average rent"], rows: x.unitMix.map((u) => [u.type, group(u.count), fmt.usd(u.avgRentCents)]) } : undefined,
      });
    }
    case "hud": {
      const x = d.hud;
      if (!x) return [];
      return section("HUD", {
        rows: [
          ...row("Program", x.section ? HUD_SECTION_LABELS[x.section] : null, src("section")),
          ...row("Repairs from the capital needs assessment", money(x.repairsCents), src("repairsCents")),
          ...row("Existing FHA number", x.existingFhaNumber, src("existingFhaNumber")),
          ...row("Principals with prior HUD participation", x.priorHudParticipation === undefined ? null : fmt.yesNo(x.priorHudParticipation), src("priorHudParticipation")),
          ...row("Licensed beds", x.licensedBeds !== undefined ? group(x.licensedBeds) : null, src("licensedBeds")),
          ...row("Operator", x.operatorName, src("operatorName")),
        ],
        paragraphs: [...(x.payorMixNote ? [`Payor mix: ${x.payorMixNote}`] : []), ...(x.surveyHistoryNote ? [`Survey history: ${x.surveyHistoryNote}`] : [])],
      });
    }
    case "capitalStack": {
      const x = d.capitalStack;
      if (!x) return [];
      const status = playbookOf(ctx) === "c_pace" ? x.consentStatus : x.intercreditorStatus;
      return section("Capital stack", {
        rows: [
          ...row("Senior lender", x.seniorLender, src("seniorLender")),
          ...row("Senior loan", money(x.seniorAmountCents), src("seniorAmountCents")),
          ...row("Senior rate", x.seniorRatePct !== undefined ? fmt.rate(x.seniorRatePct) : null, src("seniorRatePct")),
          ...row("Senior maturity", date(x.seniorMaturity), src("seniorMaturity")),
          ...row("Senior loan allows subordinate financing", x.seniorAllowsSubordinate === undefined ? null : fmt.yesNo(x.seniorAllowsSubordinate), src("seniorAllowsSubordinate")),
          ...row("This request", x.thisTrancheKind && ctx.deal.loanAmountCents ? `${TRANCHE_KIND_LABELS[x.thisTrancheKind]}, ${fmt.usd(ctx.deal.loanAmountCents)}` : null, SOURCE_DEAL),
          ...row(playbookOf(ctx) === "c_pace" ? "Mortgage holder's consent" : "Intercreditor agreement", status ? CONSENT_STATUS_LABELS[status] : null, src(playbookOf(ctx) === "c_pace" ? "consentStatus" : "intercreditorStatus")),
          ...row("Eligible improvements", money(x.eligibleImprovementsCents), src("eligibleImprovementsCents")),
          ...row("C-PACE program", x.programJurisdiction, src("programJurisdiction")),
          ...metricRow(metricOf(metrics, "combined_ltv")),
          ...metricRow(metricOf(metrics, "combined_ltc")),
        ],
      });
    }
  }
}

function hardMoneySection(ctx: SubmissionContext, metrics: SubmissionMetrics): DealSummarySection[] {
  const hm = ctx.hardMoney;
  if (!hm) return [];
  const src = "From the hard money file";
  const c = (dollars: number) => fmt.usd(Math.round(dollars * 100));
  const exit = hm.exitPlan;
  return section("Hard money file", {
    rows: [
      ...row("Purchase price", c(hm.purchasePrice), src),
      ...row("As-is value", c(hm.asIsValue), src),
      ...row("After-repair value", `${c(hm.arv)} (${VALUE_SOURCE_LABELS[hm.arvSource]})`, src),
      ...row("Rehab budget", c(hm.metrics.rehabBudget), src),
      ...row("Contingency", `${c(hm.metrics.contingency)} (${fmt.pct(hm.contingencyPct)} of rehab)`, src),
      ...row("Total cost", c(hm.metrics.totalCost), src),
      ...metricRow(metricOf(metrics, "rehab_weeks")),
      ...metricRow(metricOf(metrics, "verified_projects_36m")),
      ...row("Completed projects in the last 36 months", group(hm.metrics.completedProjects), src),
      ...metricRow(metricOf(metrics, "flip_margin")),
      ...row(
        "Exit plan",
        exit.type === "sale"
          ? `Sale in about ${fmt.months(exit.targetMonths)}${exit.expectedSalePrice !== undefined ? ` at ${c(exit.expectedSalePrice)}` : ""}`
          : `Refinance in about ${fmt.months(exit.targetMonths)}${exit.refinanceProgram ? ` into a ${lower(exit.refinanceProgram)}` : ""}${exit.refinanceLoanAmount !== undefined ? ` of about ${c(exit.refinanceLoanAmount)}` : ""}`,
        src,
      ),
    ],
    table: hm.scopeOfWork.length ? { head: ["Scope of work", "Cost", "Weeks"], rows: hm.scopeOfWork.map((l) => [l.description, c(l.cost), l.weeks !== undefined ? group(l.weeks) : ""]) } : undefined,
  });
}

function reportsOnHand(ctx: SubmissionContext): Row[] {
  const out: Row[] = [];
  const seen = new Set<string>();
  for (const r of ctx.construction?.reports ?? []) {
    if (r.status !== "accepted" && r.status !== "delivered") continue;
    const when = r.deliveredAt ?? r.acceptedAt;
    seen.add(REPORT_LABELS[r.reportType].toLowerCase());
    out.push(...row(REPORT_LABELS[r.reportType], when ? `Delivered ${fmt.date(when)}` : "On hand", r.vendorName ? `Vendor: ${r.vendorName}` : "Construction report record"));
  }
  for (const i of ctx.checklistItems) {
    if (i.category !== "third_party" || !RECEIVED_STATUSES.includes(i.status) || i.status === "not_applicable" || i.status === "waived") continue;
    if (seen.has(i.title.toLowerCase())) continue;
    seen.add(i.title.toLowerCase());
    out.push(...row(i.title, i.documentDate ? `Dated ${fmt.date(i.documentDate)}` : "On hand", "Deal checklist"));
  }
  for (const d of ctx.vaultDocuments) {
    if (d.kind !== "APPRAISAL" || seen.has("appraisal")) continue;
    seen.add("appraisal");
    const asOf = ctx.profile?.asIsValueSource === "appraisal" ? ctx.profile.asIsValueAsOf : null;
    out.push(...row("Appraisal", asOf ? `Value as of ${fmt.date(asOf)}` : "On hand", "Vault document"));
  }
  return out;
}

/**
 * The locked one-page summary for a target stage. Throws PackageCopyError on
 * overclaiming staff copy and EmailSafetyError on a restricted identifier.
 */
export function buildDealSummary(ctx: SubmissionContext, metrics: SubmissionMetrics, stage: TargetStage, opts: SummaryOptions = {}): DealSummarySpec {
  const typed = staffTypedText(ctx);
  checkSummaryCopy(typed);
  // Behind the link the summary may carry names and exact sponsor figures, but never an identifier typed into free text.
  assertEmailSafe(typed.join("\n"));
  const deal = ctx.deal;
  const p = ctx.profile;
  const playbook = playbookOf(ctx);
  const asOf = summaryAsOf(ctx);
  const loan = deal.loanAmountCents !== null && deal.loanAmountCents > 0 ? deal.loanAmountCents : null;
  const fs = (k: string) => sourceLabel(fieldSource(ctx, k), ctx);
  const sections: DealSummarySection[] = [];

  // Request ----------------------------------------------------------------------
  const structure = p
    ? [
        p.requestedTermMonths !== null ? `${group(p.requestedTermMonths)}-month term` : null,
        // A null amortization is interest-only for the whole term (when a term or IO period was entered).
        p.requestedAmortMonths === null ? (p.requestedTermMonths !== null || p.requestedIoMonths !== null ? "interest-only" : null) : `${p.requestedIoMonths ? `${fmt.months(p.requestedIoMonths)} interest-only, then ` : ""}${fmt.amortization(p.requestedAmortMonths)}`,
        p.rateType ? lower(RATE_TYPE_LABELS[p.rateType]) : null,
      ].filter(Boolean)
    : [];
  sections.push(
    ...section("Request", {
      rows: [
        ...row("Loan request", loan !== null ? fmt.usd(loan) : null, SOURCE_DEAL),
        ...row("Program", PLAYBOOK_LABELS[playbook], SOURCE_DEAL),
        ...row("Asking for", STAGE_ASK[stage], SOURCE_DEAL),
        ...row("Borrower", deal.borrowerName, SOURCE_DEAL),
        ...(p
          ? [
              ...row("Purpose", p.purpose ? LOAN_PURPOSE_LABELS[p.purpose] : null, fs("purpose")),
              ...row("Lien position", p.lienPosition ? LIEN_POSITION_LABELS[p.lienPosition] : null, fs("lienPosition")),
              ...row("Recourse sought", p.recourse ? RECOURSE_LABELS[p.recourse] : null, fs("recourse")),
              ...row("Structure", structure.length ? structure.join(", ") : null, fs("requestedTermMonths")),
              ...row("Target closing", p.targetCloseDate ? `${fmt.date(p.targetCloseDate)}${p.closeDriver ? ` (${p.closeDriver})` : ""}` : null, fs("targetCloseDate")),
              ...row("Prepayment preference", p.prepayPreference, fs("prepayPreference")),
              ...row(
                "Existing debt",
                p.existingDebtCents !== null ? [fmt.usd(p.existingDebtCents), p.existingLender ? `with ${p.existingLender}` : null, p.existingRatePct !== null ? `at ${fmt.rate(p.existingRatePct)}` : null, p.existingMaturityDate ? `matures ${fmt.date(p.existingMaturityDate)}` : null].filter(Boolean).join(" ") : null,
                fs("existingDebtCents"),
              ),
              ...row("Cash out", p.cashOutCents ? `${fmt.usd(p.cashOutCents)}${p.cashOutUse ? `: ${p.cashOutUse}` : ""}` : null, fs("cashOutCents")),
              ...row("Sizing assumption", p.assumedRatePct !== null && p.assumedAmortMonths !== null ? `${fmt.rate(p.assumedRatePct)} rate, ${fmt.amortization(p.assumedAmortMonths)} (an assumption, not a quote)` : null, fs("assumedRatePct")),
            ]
          : []),
      ],
    }),
  );

  // Property -------------------------------------------------------------------------
  if (p) {
    const address = [deal.propertyAddress, deal.propertyState && !deal.propertyAddress?.includes(deal.propertyState) ? deal.propertyState : null].filter(Boolean).join(", ");
    sections.push(
      ...section("Property", {
        rows: [
          ...row("Property", p.propertyName, fs("propertyName")),
          ...row("Address", address || null, SOURCE_DEAL),
          ...row(p.county ? "County and APN" : "APN", p.county || p.apn ? [p.county ? `${p.county} County` : null, p.apn ? `APN ${p.apn}` : null].filter(Boolean).join(" · ") : null, fs(p.apn ? "apn" : "county")),
          ...row("Type and size", sizePhrase(p), fs("sizeCount")),
          ...row("Rentable SF", p.rentableSf !== null && p.sizeUnit !== "sf" ? group(p.rentableSf) : null, fs("rentableSf")),
          ...row("Land", p.landAcres !== null ? `${fmt.count(p.landAcres)} acres` : null, fs("landAcres")),
          ...row("Built", p.yearBuilt !== null ? `${p.yearBuilt}${p.yearRenovated !== null ? `, renovated ${p.yearRenovated}` : ""}` : p.yearRenovated !== null ? `Renovated ${p.yearRenovated}` : null, fs(p.yearBuilt !== null ? "yearBuilt" : "yearRenovated")),
          ...row("Tenancy", p.tenancy ? TENANCY_LABELS[p.tenancy] : null, fs("tenancy")),
          ...row("Occupancy", p.occupancyPct !== null ? `${fmt.pct(p.occupancyPct)}${p.occupancyAsOf ? ` as of ${fmt.date(p.occupancyAsOf)}` : ""}` : null, fs("occupancyPct")),
          ...row("Owner-occupied", p.ownerOccupiedPct !== null && !p.programDetails.sba ? fmt.pct(p.ownerOccupiedPct) : null, fs("ownerOccupiedPct")),
          ...row("Zoning", p.zoning, fs("zoning")),
          ...row("Flood zone", p.floodZone, fs("floodZone")),
          ...row("Rent control", p.rentControl === null ? null : fmt.yesNo(p.rentControl), fs("rentControl")),
          ...row("Seismic zone", p.seismicZone === null ? null : fmt.yesNo(p.seismicZone), fs("seismicZone")),
        ],
      }),
    );

    // Value and financials --------------------------------------------------------------
    const financialMetrics = metrics.metrics.filter((m) => m.value !== null && !PROGRAM_METRICS.has(m.key)).flatMap((m) => metricRow(m));
    sections.push(
      ...section("Value and financials", {
        rows: [
          ...row("Purchase price", p.purchasePriceCents !== null ? `${fmt.usd(p.purchasePriceCents)}${p.purchaseCloseDate ? `, closing ${fmt.date(p.purchaseCloseDate)}` : ""}` : null, fs("purchasePriceCents")),
          ...row("As-is value", p.asIsValueCents !== null ? `${fmt.usd(p.asIsValueCents)}${p.asIsValueSource ? ` (${VALUE_SOURCE_LABELS[p.asIsValueSource]}${p.asIsValueAsOf ? `, ${fmt.date(p.asIsValueAsOf)}` : ""})` : ""}` : null, fs("asIsValueCents")),
          ...row(ctx.hardMoney ? "After-repair value" : "Stabilized value", p.stabilizedValueCents !== null ? `${fmt.usd(p.stabilizedValueCents)}${p.stabilizedValueSource ? ` (${VALUE_SOURCE_LABELS[p.stabilizedValueSource]})` : ""}` : null, fs("stabilizedValueCents")),
          ...row("Revenue (annual)", p.revenueCents !== null ? fmt.usd(p.revenueCents) : null, fs("revenueCents")),
          ...row("Operating expenses (annual)", p.expensesCents !== null ? fmt.usd(p.expensesCents) : null, fs("expensesCents")),
          ...row(
            "NOI in place",
            p.noiInPlaceCents !== null ? `${fmt.usd(p.noiInPlaceCents)}${p.noiBasis ? ` (${lower(NOI_BASIS_LABELS[p.noiBasis])}${p.noiPeriodEnd ? ` through ${fmt.date(p.noiPeriodEnd)}` : ""})` : ""}` : null,
            fs("noiInPlaceCents"),
          ),
          ...row("NOI stabilized (pro forma)", p.noiStabilizedCents !== null ? `${fmt.usd(p.noiStabilizedCents)}${p.stabilizationMonths !== null ? ` in about ${fmt.months(p.stabilizationMonths)}` : ""}` : null, fs("noiStabilizedCents")),
          ...financialMetrics,
        ],
      }),
    );
  }

  // Sponsor -----------------------------------------------------------------------------
  const s = ctx.sponsor;
  const keyPrincipalLabel = playbook === "hud_232" || playbook === "hud_multifamily" ? "Key principal" : "Guarantor";
  const entity = ctx.principals.find((x) => x.roles.includes("borrower_entity"));
  const backers = ctx.principals.filter((x) => x.kind === "individual" && (x.isGuarantor || x.roles.includes("guarantor") || x.roles.includes("key_principal") || x.owes.includes("pfs")));
  const reo = ctx.reoSummary;
  const events = s ? creditEventKinds.filter((k) => s.creditEvents[k]?.occurred) : [];
  const answered = s ? creditEventKinds.every((k) => typeof s.creditEvents[k]?.occurred === "boolean") : false;
  sections.push(
    ...section("Sponsor", {
      rows: [
        ...row("Borrowing entity", entity ? `${entity.legalName}${entity.formationState ? ` (${entity.formationState})` : ""}` : null, "From the org chart"),
        ...row(`${keyPrincipalLabel}s`, backers.length ? backers.map((b) => `${b.legalName} (${b.title ?? b.roles.map((r) => ROLE_LABEL[r]).join(", ")}${b.ownershipPct !== null ? `, ${fmt.pct(b.ownershipPct)}` : ""})`).join("; ") : null, "From the org chart"),
        ...row("Years of experience", s?.yearsExperience != null ? group(s.yearsExperience) : null, SOURCE_SPONSOR),
        ...row("Similar projects", s?.similarProjectsCount != null ? group(s.similarProjectsCount) : null, SOURCE_SPONSOR),
        ...row("Portfolio", s?.portfolioSizeNote ?? (s?.portfolioCount != null ? `${group(s.portfolioCount)} properties` : null), SOURCE_SPONSOR),
        ...row(
          "Real estate owned",
          reo && reo.properties > 0
            ? [`${group(reo.properties)} properties`, `${fmt.usd(Math.round(reo.marketValue * 100))} value`, `${fmt.usd(Math.round(reo.debt * 100))} debt`, reo.dscr !== null ? `${fmt.x(reo.dscr)} DSCR` : null, reo.maturingWithin24Months ? `${reo.maturingWithin24Months} loan${reo.maturingWithin24Months === 1 ? "" : "s"} maturing within 24 months` : null]
                .filter(Boolean)
                .join("; ")
            : null,
          "From the schedules of real estate owned",
        ),
        ...strengthRows(metrics.sponsorStrength, keyPrincipalLabel),
        ...row("Credit", s?.creditBand && s.creditBand !== "NOT_PROVIDED" ? `${CREDIT_BAND_LABELS[s.creditBand]} (self-reported band)` : null, SOURCE_SPONSOR),
        ...row("Credit events", s && answered ? (events.length ? events.map((k) => CREDIT_EVENT_LABELS[k]).join("; ") : "None reported (bankruptcy, foreclosure, judgments, litigation)") : null, SOURCE_SPONSOR),
        ...row("Management", s?.managementCompany, SOURCE_SPONSOR),
      ],
      paragraphs: [...(s?.experienceSummary ? [s.experienceSummary] : []), ...events.flatMap((k) => (s!.creditEvents[k]?.explanation ? [`${CREDIT_EVENT_LABELS[k]}: ${s!.creditEvents[k]!.explanation}`] : []))],
    }),
  );

  if (p) {
    // Plan and exit --------------------------------------------------------------------------
    const exitLine = p.exitStrategy && p.exitStrategy !== "not_applicable" ? `Exit: ${lower(EXIT_STRATEGY_LABELS[p.exitStrategy])}${p.exitMonths !== null && p.exitStrategy !== "hold_to_maturity" ? ` in about ${fmt.months(p.exitMonths)}` : ""}.` : null;
    sections.push(
      ...section("Plan and exit", {
        paragraphs: [...(p.businessPlan ? [p.businessPlan] : []), ...(exitLine || p.exitDetail ? [[exitLine, p.exitDetail].filter(Boolean).join(" ")] : []), ...p.highlights.map((h) => `• ${h}`)],
      }),
    );

    // Sources and uses ----------------------------------------------------------------------
    const srcRows = p.sources.map((l) => [`${SOURCE_KIND_LABELS[l.kind]}${l.note ? ` (${l.note})` : ""}`, fmt.usd(l.amountCents)]);
    const useRows = p.uses.map((l) => [`${USE_KIND_LABELS[l.kind]}${l.note ? ` (${l.note})` : ""}`, fmt.usd(l.amountCents)]);
    if (srcRows.length || useRows.length) {
      const n = Math.max(srcRows.length, useRows.length);
      const rows = Array.from({ length: n }, (_, i) => [...(srcRows[i] ?? ["", ""]), ...(useRows[i] ?? ["", ""])]);
      rows.push(["Total sources", srcRows.length ? fmt.usd(p.sources.reduce((a, l) => a + l.amountCents, 0)) : "", "Total uses", useRows.length ? fmt.usd(p.uses.reduce((a, l) => a + l.amountCents, 0)) : ""]);
      sections.push(...section("Sources and uses", { table: { head: ["Sources", "Amount", "Uses", "Amount"], rows }, rows: [...metricRow(metricOf(metrics, "equity")), ...metricRow(metricOf(metrics, "equity_share"))] }));
    }

    // Program sections --------------------------------------------------------------------------
    for (const key of programDetailKeysFor(playbook, p)) sections.push(...programSection(key, ctx, metrics));
  }
  sections.push(...hardMoneySection(ctx, metrics));

  // Reports, issues, open items, method, about -----------------------------------------------
  sections.push(...section("Third-party reports on hand", { rows: reportsOnHand(ctx) }));
  if (p) sections.push(...section("Known issues and mitigants", { paragraphs: p.risks.filter((x) => x.risk.trim()).map((x) => `• ${x.risk}. Mitigant: ${x.mitigant}`) }));
  const openItems = [...(opts.openItems ?? [])];
  sections.push(...section("Not yet in hand", { paragraphs: openItems.map((l) => `• ${l}`) }));

  const metricNotes = metrics.metrics
    .filter((m) => m.value !== null)
    .map((m) => ({
      key: m.key,
      formula: m.note ? `${m.formula} (${m.note})` : m.formula,
      inputs: m.inputs.map((i) => `${i.label}: ${i.value === null ? "missing" : formatInputValue(i.field, i.value)} (${i.source ? sourceLabel(i.source, ctx) : i.field.startsWith("deal.") ? SOURCE_DEAL : SOURCE_ENTERED})`),
    }));
  sections.push(
    ...section("How these figures were calculated", {
      // The formulas, compactly; each input's value and source is on its own row above (and in metricNotes).
      paragraphs: metricNotes.length
        ? [
            metricNotes.map((n) => `${metrics.metrics.find((m) => m.key === n.key)!.label}: ${n.formula}.`).join(" "),
            "Corin calculates every ratio from the inputs shown with their sources; none is typed. A figure marked Per borrower is as the borrower stated it and is not yet verified by a document. Stabilized and pro forma figures are labeled as such.",
          ]
        : [],
    }),
  );
  sections.push({
    title: "About this request",
    paragraphs: [
      `${site.legalName} is the broker on this request, not the lender. Figures come from the borrower's documents and Corin's calculations as labeled; the lender performs its own underwriting and makes every credit decision. This summary is a request for terms, not a commitment by any party.`,
      ...(opts.advisor ? [`Advisor: ${opts.advisor.name} (${opts.advisor.email}${opts.advisor.dreLicense ? `, DRE ${opts.advisor.dreLicense}` : ""}).`] : []),
      "Confidential: for the addressed institution's credit review only. Please do not forward.",
    ],
  });

  const spec: DealSummarySpec = {
    templateVersion: SUMMARY_TEMPLATE_VERSION,
    title: `${deal.title} — loan request summary`,
    subtitle: `Prepared ${fmt.date(asOf)} by ${site.legalName} for lender review`,
    asOf,
    headline: pickHeadline(playbook, metrics, loan, p?.occupancyPct ?? null),
    sections,
    metricNotes,
    openItems,
    footer: licenseLine(),
  };
  return spec;
}

/** Every string in the spec, for checks and tests. */
export function summaryText(spec: DealSummarySpec): string {
  const parts: string[] = [spec.title, spec.subtitle, ...spec.headline.flatMap((h) => [h.label, h.value])];
  for (const s of spec.sections) {
    parts.push(s.title, ...(s.rows ?? []).flatMap((r) => [r.label, r.value, r.source ?? ""]), ...(s.paragraphs ?? []), ...(s.table ? [...s.table.head, ...s.table.rows.flat()] : []));
  }
  parts.push(spec.footer);
  return parts.join("\n");
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]));
  return v;
}

/** SHA-256 (hex) of the spec in canonical JSON (sorted keys): deal_summaries.spec_sha256 and the approval payload's summarySha256. */
export function summarySpecSha256(spec: DealSummarySpec): string {
  return createHash("sha256").update(JSON.stringify(canonical(spec))).digest("hex");
}
