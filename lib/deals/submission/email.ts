// The lender email (spec 5.3): an executive summary a lender can answer from,
// built from the same facts and metrics as the locked deal summary. Plain text
// (the mailer derives the HTML). Deterministic: the same facts give the same
// bytes, and the broker approves exactly these bytes (their SHA-256 is in the
// approval payload).
//
// Rules: a line whose value is missing is omitted, never "N/A" and never an
// estimate; every figure carries a short source tag; numbers are formatted
// with separators so the body never holds nine digits in a row; the share
// link and its expiry are placeholders filled only after approval. Personal
// financial data never appears: the builder reads EmailFacts, which has no
// field for it, then assertEmailSafe checks the text (spec 5.4).

import { createHash } from "node:crypto";
import { checkSummaryCopy } from "@/lib/agents/lenders/package";
import { REPORT_LABELS } from "@/lib/construction/types";
import { licenseLine, site } from "@/lib/site";
import { LENDER_LOAN_TYPE_LABELS } from "../loan-types";
import type { LenderPanelEntry, PackageItem } from "../types";
import { PLAYBOOK_SHORT_LABELS, defaultPlaybook, playbookLoanTypes } from "./playbooks";
import { assertEmailSafe, guarantorCovenantLine, type EmailSafetyOptions } from "./redaction";
import { RECEIVED_STATUSES } from "./requirements";
import { fmt, formatMetricValue, headlineLabel, headlineMetricKeys, metricOf, sizePhrase } from "./summary";
import {
  CONSENT_STATUS_LABELS,
  CONSTRUCTION_CONTRACT_LABELS,
  CREDIT_BAND_LABELS,
  EMAIL_PLACEHOLDERS,
  ENTITLEMENT_STATUS_LABELS,
  EXIT_STRATEGY_LABELS,
  HUD_SECTION_LABELS,
  LEASE_STATUS_LABELS,
  LIEN_POSITION_LABELS,
  LOAN_PURPOSE_LABELS,
  MARKET_RENT_SOURCE_LABELS,
  NOI_BASIS_LABELS,
  PERMIT_STATUS_LABELS,
  RATE_TYPE_LABELS,
  RECOURSE_LABELS,
  SOURCE_KIND_LABELS,
  TRANCHE_KIND_LABELS,
  USE_KIND_LABELS,
  VALUE_SOURCE_LABELS,
  blankSubmissionProfileFields,
  creditEventKinds,
  type EmailAdvisor,
  type EmailFacts,
  type EmailHardMoneyFacts,
  type EmailLender,
  type EmailSponsorFacts,
  type FieldSource,
  type IsoDate,
  type LenderFit,
  type Metric,
  type SubmissionContext,
  type SubmissionMetrics,
  type SubmissionPlaybook,
  type SubmissionProfile,
  type TargetStage,
} from "./types";

/** Bumped whenever the rendered layout or wording changes (golden files pin it). */
export const EMAIL_TEMPLATE_VERSION = "lender-email-v1";

export type LenderEmail = { subject: string; text: string; sha256: string };

/** SHA-256 (hex) of the UTF-8 bytes of the approved text (with placeholders). */
export function emailSha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The recipient as the email sees it: the primary contact's first name greets; otherwise "Hello". */
export function emailLenderFrom(lender: Pick<LenderPanelEntry, "id" | "name" | "loanTypes" | "minLoanCents" | "maxLoanCents" | "states" | "assetTypes" | "contactName">): EmailLender {
  const first = lender.contactName?.trim().split(/\s+/)[0] ?? null;
  return { id: lender.id, name: lender.name, loanTypes: lender.loanTypes, minLoanCents: lender.minLoanCents, maxLoanCents: lender.maxLoanCents, states: lender.states, assetTypes: lender.assetTypes, contactFirstName: first || null };
}

// ---------------------------------------------------------------------------
// Facts

export type LenderEmailInput = {
  ctx: SubmissionContext;
  metrics: SubmissionMetrics;
  stage: TargetStage;
  lender: EmailLender;
  fit: LenderFit;
  /** The locked manifest (or, for a preview, the documents staff picked), the deal summary included. */
  documents: readonly Pick<PackageItem, "documentId" | "label" | "kind">[];
  /** Labels of the required items not yet met at the stage (readiness.ts). */
  notYetInHand: readonly string[];
  advisor: EmailAdvisor;
};

/** EmailFacts plus what source tags need: the kind of each vault document a value came from. */
export type EmailRenderFacts = EmailFacts & { documentKinds?: Readonly<Record<string, string>> };

const KIND_ORDER = ["DEAL_SUMMARY", "EXECUTIVE_SUMMARY", "T12", "RENT_ROLL", "CENSUS", "STR_REPORT", "APPRAISAL", "FRANCHISE_AGREEMENT", "PIP_BUDGET", "OTHER", "PFS", "TAX_RETURN"];
const kindRank = (k: string) => {
  const i = KIND_ORDER.indexOf(k);
  return i === -1 ? KIND_ORDER.indexOf("OTHER") : i;
};

function blankProfile(ctx: SubmissionContext): SubmissionProfile {
  return { id: "", dealId: ctx.deal.id, createdAt: ctx.deal.createdAt, createdBy: "", updatedAt: ctx.deal.updatedAt, updatedBy: null, recordVersion: 0, ...blankSubmissionProfileFields(defaultPlaybook(ctx.deal.program)) };
}

function hardMoneyFacts(ctx: SubmissionContext): EmailHardMoneyFacts | null {
  const hm = ctx.hardMoney;
  if (!hm) return null;
  const c = (d: number) => Math.round(d * 100);
  return {
    strategy: hm.strategy,
    purchasePriceCents: c(hm.purchasePrice),
    asIsValueCents: c(hm.asIsValue),
    arvCents: c(hm.arv),
    arvSource: hm.arvSource,
    rehabBudgetCents: c(hm.metrics.rehabBudget),
    rehabWeeks: hm.metrics.rehabWeeks,
    verifiedProjects36m: hm.metrics.verifiedProjects,
    exit: { type: hm.exitPlan.type, targetMonths: hm.exitPlan.targetMonths, refinanceProgram: hm.exitPlan.refinanceProgram ?? null },
  };
}

function sponsorFacts(ctx: SubmissionContext, metrics: SubmissionMetrics): EmailSponsorFacts | null {
  const s = ctx.sponsor;
  const entity = ctx.principals.find((p) => p.roles.includes("borrower_entity")) ?? null;
  const name = ctx.deal.borrowerName ?? entity?.legalName ?? null;
  if (!s && !name) return null;
  const mode = s?.emailFinancialsMode ?? "covenant_only";
  const answers = s ? creditEventKinds.map((k) => s.creditEvents[k]?.occurred) : [];
  const creditEventsReported = answers.some((a) => a === true) ? true : answers.length && answers.every((a) => a === false) ? false : null;
  return {
    experienceSummary: s?.experienceSummary ?? null,
    yearsExperience: s?.yearsExperience ?? null,
    similarProjectsCount: s?.similarProjectsCount ?? null,
    portfolioCount: s?.portfolioCount ?? null,
    portfolioSizeNote: s?.portfolioSizeNote ?? null,
    managementCompany: s?.managementCompany ?? null,
    creditBand: s?.creditBand ?? null,
    emailFinancialsMode: mode,
    borrowerEntity: name ? { name, formationState: entity?.formationState ?? null } : null,
    creditEventsReported,
    covenants: guarantorCovenantLine(metrics.sponsorStrength, mode),
  };
}

/** The dates documents speak to, from the field sources that cite them. */
function documentDates(profile: SubmissionProfile): Map<string, IsoDate> {
  const out = new Map<string, IsoDate>();
  for (const src of Object.values(profile.fieldSources) as (FieldSource | undefined)[]) {
    if (src?.source !== "document" || !src.asOf) continue;
    const prev = out.get(src.ref);
    if (!prev || src.asOf > prev) out.set(src.ref, src.asOf);
  }
  return out;
}

export function lenderEmailFacts(input: LenderEmailInput): EmailRenderFacts {
  const { ctx } = input;
  const profile = ctx.profile ?? blankProfile(ctx);
  const dates = documentDates(profile);
  const documents = [...input.documents]
    .sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || a.label.localeCompare(b.label) || a.documentId.localeCompare(b.documentId))
    .map((d) => ({ label: d.label, kind: d.kind, date: dates.get(d.documentId) ?? null }));
  const documentKinds: Record<string, string> = {};
  for (const d of ctx.vaultDocuments) documentKinds[d.id] = d.kind;
  for (const d of input.documents) documentKinds[d.documentId] = d.kind;

  const reportsOnHand: { label: string; date: IsoDate | null }[] = [];
  const seen = new Set<string>();
  for (const r of ctx.construction?.reports ?? []) {
    if (r.status !== "accepted" && r.status !== "delivered") continue;
    seen.add(REPORT_LABELS[r.reportType].toLowerCase());
    reportsOnHand.push({ label: REPORT_LABELS[r.reportType], date: (r.deliveredAt ?? r.acceptedAt)?.slice(0, 10) ?? null });
  }
  for (const i of ctx.checklistItems) {
    if (i.category !== "third_party" || !RECEIVED_STATUSES.includes(i.status) || i.status === "waived" || i.status === "not_applicable" || seen.has(i.title.toLowerCase())) continue;
    seen.add(i.title.toLowerCase());
    reportsOnHand.push({ label: i.title, date: i.documentDate });
  }
  if (!seen.has("appraisal") && ctx.vaultDocuments.some((d) => d.kind === "APPRAISAL")) reportsOnHand.push({ label: "Appraisal", date: profile.asIsValueSource === "appraisal" ? profile.asIsValueAsOf : null });

  return {
    templateVersion: EMAIL_TEMPLATE_VERSION,
    stage: input.stage,
    playbook: profile.playbook,
    deal: { id: ctx.deal.id, title: ctx.deal.title, program: ctx.deal.program, loanAmountCents: ctx.deal.loanAmountCents, propertyState: ctx.deal.propertyState, propertyAddress: profile.maskAddress ? null : ctx.deal.propertyAddress },
    profile,
    sponsor: sponsorFacts(ctx, input.metrics),
    metrics: input.metrics.metrics,
    hardMoney: hardMoneyFacts(ctx),
    construction: ctx.construction ? { generalContractorName: ctx.construction.project.generalContractorName, licenseStatus: ctx.construction.licenseCheck?.status ?? null } : null,
    lender: input.lender,
    fit: input.fit,
    documents,
    reportsOnHand,
    notYetInHand: [...input.notYetInHand],
    advisor: input.advisor,
    documentKinds,
  };
}

// ---------------------------------------------------------------------------
// Rendering

const ASK: Record<TargetStage, string> = { screen: "a soft quote", term_sheet: "a term sheet", underwrite: "full underwriting" };
// Lower-cases a label for mid-sentence use, but keeps a leading acronym ("C-PACE assessment", "HUD").
const lower = (s: string) => (/^[A-Z][A-Z0-9-]/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
const listJoin = (items: readonly string[]) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
const has = <T>(v: T | null | undefined): v is T => v !== null && v !== undefined && !(typeof v === "string" && v.trim() === "");

/** Staff free text, cut at a word boundary to `max` characters. */
function excerpt(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, "")}…`;
}

/** "  Label:       value" with the value column at `width`. */
function kv(label: string, value: string, width: number): string {
  const l = `${label}:`;
  return `  ${l.length >= width ? `${l} ` : l.padEnd(width)}${value}`;
}

const DOC_NAMES: Record<string, string> = { T12: "T-12", RENT_ROLL: "rent roll", CENSUS: "census", STR_REPORT: "STR report", APPRAISAL: "appraisal", PIP_BUDGET: "PIP budget", FRANCHISE_AGREEMENT: "franchise agreement" };
const RECORDS = { principals: "the org chart", hm_underwriting: "the hard money file", construction_projects: "the construction project" } as const;

/** Short source tag: "from the T-12", "per borrower", "entered by Corin". `printedDate` drops a date already on the line. */
function tag(src: FieldSource | null | undefined, f: EmailRenderFacts, printedDate?: string | null): string {
  if (!src || src.source === "entered") return "entered by Corin";
  switch (src.source) {
    case "borrower":
      return "per borrower";
    case "document": {
      const kind = f.documentKinds?.[src.ref];
      const name = kind && DOC_NAMES[kind] ? `the ${DOC_NAMES[kind]}` : "a borrower document";
      return `from ${name}${src.asOf && src.asOf !== printedDate ? ` dated ${fmt.date(src.asOf)}` : ""}`;
    }
    case "spread":
      return "Corin spread";
    case "record":
      return `from ${RECORDS[src.record]}`;
    case "public_record":
      return "public record";
  }
}

const src = (f: EmailRenderFacts, key: string) => (f.profile.fieldSources as Record<string, FieldSource | undefined>)[key] ?? null;
const m = (f: EmailRenderFacts, key: Metric["key"]) => metricOf(f.metrics, key);
const val = (x: Metric | null) => (x ? formatMetricValue(x) : null);
const ltvOnPrice = (x: Metric | null) => Boolean(x?.inputs.some((i) => i.field === "purchasePriceCents"));
const sum = (lines: readonly { amountCents: number }[]) => lines.reduce((s, l) => s + l.amountCents, 0);

function assumption(f: EmailRenderFacts): string | null {
  const { assumedRatePct: r, assumedAmortMonths: a } = f.profile;
  if (r === null || a === null) return null;
  return `at an assumed ${fmt.rate(r)} / ${a % 12 === 0 ? `${a / 12}-year` : `${a}-month`} schedule — an assumption, not a quote`;
}

const SUBJECT_LABELS: Record<string, string> = { "Debt yield": "debt yield", "Yield on cost": "yield on cost", "Global DSCR": "global DSCR", "Combined LTV": "combined LTV", "Combined LTC": "combined LTC", "Loan to price": "loan-to-price" };

function subjectLine(f: EmailRenderFacts): string {
  const p = f.profile;
  const amount = f.deal.loanAmountCents && f.deal.loanAmountCents > 0 ? fmt.usd(f.deal.loanAmountCents) : null;
  const head = `Loan request: ${[amount, PLAYBOOK_SHORT_LABELS[f.playbook]].filter(Boolean).join(" ")}`;
  const where = [p.city, f.deal.propertyState].filter(has).join(" ");
  const property = [sizePhrase(p), where || null].filter(has).join(", ");
  const metrics = headlineMetricKeys(f.playbook)
    .map((alts) => alts.map((k) => m(f, k)).find(Boolean) ?? null)
    .filter((x): x is Metric => x !== null)
    .map((x) => `${formatMetricValue(x)} ${SUBJECT_LABELS[headlineLabel(x)] ?? headlineLabel(x)}`);
  const subject = [head, property || null, metrics.length ? metrics.join(", ") : null, "Corin Commercial"].filter(has).join(" | ");
  return subject.length <= 200 ? subject : `${subject.slice(0, 199)}…`;
}

function fitLines(f: EmailRenderFacts): string[] {
  const l = f.lender;
  const out: string[] = [];
  const box: string[] = [];
  if (l.loanTypes.length) box.push(listJoin(l.loanTypes.map((t) => LENDER_LOAN_TYPE_LABELS[t])));
  if (l.minLoanCents !== null || l.maxLoanCents !== null) box.push(l.minLoanCents !== null && l.maxLoanCents !== null ? `${fmt.usdCompact(l.minLoanCents)}–${fmt.usdCompact(l.maxLoanCents)}` : l.minLoanCents !== null ? `${fmt.usdCompact(l.minLoanCents)} minimum` : `up to ${fmt.usdCompact(l.maxLoanCents!)}`);
  if (box.length || l.states.length) box.push(l.states.length ? listJoin(l.states) : "nationwide");
  if (box.length) {
    const req = [LENDER_LOAN_TYPE_LABELS[playbookLoanTypes[f.playbook][0]!], f.deal.loanAmountCents ? fmt.usdCompact(f.deal.loanAmountCents) : null, f.deal.propertyState].filter(has);
    out.push(`Your recorded box: ${box.join(", ")}. This request: ${req.join(", ")}.`);
  }
  if (f.fit.exceptions.length) out.push(`Outside your recorded box: ${f.fit.exceptions.join("; ")}.`);
  return out;
}

function requestBlock(f: EmailRenderFacts): string[] {
  const p = f.profile;
  const W = 13;
  const lines = ["THE REQUEST"];
  const loan = [f.deal.loanAmountCents && f.deal.loanAmountCents > 0 ? fmt.usd(f.deal.loanAmountCents) : null, p.purpose ? lower(LOAN_PURPOSE_LABELS[p.purpose]) : null, p.lienPosition ? lower(LIEN_POSITION_LABELS[p.lienPosition]) : null].filter(has);
  if (loan.length) lines.push(kv("Loan", loan.join(", "), W));
  const amort = p.requestedAmortMonths === null ? (p.requestedTermMonths !== null || p.requestedIoMonths !== null ? "interest-only" : null) : `${p.requestedIoMonths ? `${p.requestedIoMonths} months interest-only, then ` : ""}${fmt.amortization(p.requestedAmortMonths)}`;
  const structure = [p.requestedTermMonths !== null ? `${p.requestedTermMonths} months` : null, amort, p.rateType ? lower(RATE_TYPE_LABELS[p.rateType]) : null, p.recourse ? lower(RECOURSE_LABELS[p.recourse]) : null].filter(has);
  if (structure.length) lines.push(kv("Structure", structure.join(", "), W));
  if (p.targetCloseDate) lines.push(kv("Closing", `target ${fmt.date(p.targetCloseDate)}${p.closeDriver ? ` (${p.closeDriver})` : ""}`, W));
  if (p.existingDebtCents !== null) lines.push(`  Existing debt: ${[fmt.usd(p.existingDebtCents), p.existingLender ? `with ${p.existingLender}` : null].filter(has).join(" ")}${p.existingMaturityDate ? `, matures ${fmt.date(p.existingMaturityDate)}` : ""}`);
  if (p.cashOutCents) lines.push(kv("Cash out", `${fmt.usd(p.cashOutCents)}${p.cashOutUse ? ` (${p.cashOutUse})` : ""}`, W));
  return lines.length > 1 ? lines : [];
}

function addressLine(f: EmailRenderFacts): string | null {
  const p = f.profile;
  const where = f.deal.propertyAddress ? `${f.deal.propertyAddress}${f.deal.propertyState && !f.deal.propertyAddress.includes(f.deal.propertyState) ? `, ${f.deal.propertyState}` : ""}` : [p.city, f.deal.propertyState].filter(has).join(", ") || null;
  const built = p.yearBuilt !== null ? `built ${p.yearBuilt}${p.yearRenovated !== null ? `, renovated ${p.yearRenovated}` : ""}` : p.yearRenovated !== null ? `renovated ${p.yearRenovated}` : null;
  const left = [p.propertyName, where].filter(has).join(", ");
  const right = [sizePhrase(p), built].filter(has).join(", ");
  if (!left && !right) return null;
  return `  ${[left || null, right || null].filter(has).join(" — ")}`;
}

function valueLine(f: EmailRenderFacts): string | null {
  const p = f.profile;
  const parts: string[] = [];
  if (p.purchasePriceCents !== null) parts.push(`Purchase price: ${fmt.usd(p.purchasePriceCents)}${p.purchaseCloseDate ? `, closing ${fmt.date(p.purchaseCloseDate)}` : ""}`);
  if (p.asIsValueCents !== null) parts.push(`As-is value: ${fmt.usd(p.asIsValueCents)}${p.asIsValueSource || p.asIsValueAsOf ? ` (${[p.asIsValueSource ? VALUE_SOURCE_LABELS[p.asIsValueSource] : null, p.asIsValueAsOf ? fmt.date(p.asIsValueAsOf) : null].filter(has).join(", ")})` : ""}`);
  return parts.length ? `  ${parts.join("   ")}` : null;
}

function propertyBlock(f: EmailRenderFacts, title = "THE PROPERTY", withValue = true): string[] {
  const p = f.profile;
  const lines = [title];
  const a = addressLine(f);
  if (a) lines.push(a);
  if (p.occupancyPct !== null) lines.push(kv("Occupancy", `${fmt.pct(p.occupancyPct)}${p.occupancyAsOf ? ` as of ${fmt.date(p.occupancyAsOf)}` : ""} (${tag(src(f, "occupancyPct"), f, p.occupancyAsOf)})`, 13));
  const v = withValue ? valueLine(f) : null;
  if (v) lines.push(v);
  return lines.length > 1 ? lines : [];
}

const W2 = 19;

function ltvLine(f: EmailRenderFacts, stabilizedOnly = false): string | null {
  const asIs = stabilizedOnly ? null : m(f, "ltv_as_is");
  const stab = m(f, "ltv_stabilized");
  if (asIs && ltvOnPrice(asIs)) return kv("Loan to price", `${val(asIs)} of the purchase price${stab ? ` / LTV ${val(stab)} stabilized` : ""} (Corin calculation)`, W2);
  const parts = [asIs ? `${val(asIs)} as-is` : null, stab ? `${val(stab)} stabilized` : null].filter(has);
  return parts.length ? kv("LTV", `${parts.join(" / ")} (Corin calculation)`, W2) : null;
}

function ltcLine(f: EmailRenderFacts): string | null {
  const ltc = m(f, "ltc");
  if (!ltc) return null;
  const cost = f.profile.uses.length ? sum(f.profile.uses) : null;
  return kv("LTC", `${val(ltc)}${cost ? ` of ${fmt.usd(cost)} total cost` : ""}`, W2);
}

function debtYieldLine(f: EmailRenderFacts): string | null {
  const parts = [m(f, "debt_yield_in_place") ? `${val(m(f, "debt_yield_in_place"))} in place` : null, m(f, "debt_yield_stabilized") ? `${val(m(f, "debt_yield_stabilized"))} stabilized` : null].filter(has);
  return parts.length ? kv("Debt yield", parts.join(" / "), W2) : null;
}

function dscrLine(f: EmailRenderFacts): string | null {
  const parts = [m(f, "dscr_in_place") ? `${val(m(f, "dscr_in_place"))} in place` : null, m(f, "dscr_stabilized") ? `${val(m(f, "dscr_stabilized"))} stabilized` : null].filter(has);
  const at = assumption(f);
  return parts.length ? kv("DSCR", `${parts.join(" / ")}${at ? ` ${at}` : ""}`, W2) : null;
}

function perUnitLine(f: EmailRenderFacts): string | null {
  const unit = f.profile.sizeUnit;
  if (unit === "units" || unit === "keys" || unit === "beds") {
    const x = m(f, "loan_per_unit");
    return x ? kv(`Loan per ${unit.replace(/s$/, "")}`, val(x)!, W2) : null;
  }
  const sf = m(f, "loan_per_sf");
  return sf ? kv("Loan per SF", val(sf)!, W2) : null;
}

function noiLines(f: EmailRenderFacts): string[] {
  const p = f.profile;
  const out: string[] = [];
  if (p.noiInPlaceCents !== null) {
    const basis = p.noiBasis ? `${lower(NOI_BASIS_LABELS[p.noiBasis])}${p.noiPeriodEnd ? ` through ${fmt.date(p.noiPeriodEnd)}` : ""}` : null;
    out.push(kv("NOI in place", `${fmt.usd(p.noiInPlaceCents)} (${[basis, tag(src(f, "noiInPlaceCents"), f, p.noiPeriodEnd)].filter(has).join("; ")})`, W2));
  }
  const uw = m(f, "noi_underwritten");
  if (uw && uw.value !== p.noiInPlaceCents) out.push(kv("Underwritten NOI", `${val(uw)} (Corin normalization of the operating statement)`, W2));
  if (p.noiStabilizedCents !== null) out.push(kv("NOI stabilized", `${fmt.usd(p.noiStabilizedCents)}${p.stabilizationMonths !== null ? ` in about ${p.stabilizationMonths} months` : ""} (Corin pro forma from the sponsor's plan)`, W2));
  return out;
}

function numbersBlock(f: EmailRenderFacts): string[] {
  const pb = f.playbook;
  const p = f.profile;
  const lines: (string | null)[] = ["THE NUMBERS"];
  if (pb === "construction") {
    lines.push(ltcLine(f));
    const yoc = m(f, "yield_on_cost");
    if (yoc) lines.push(kv("Yield on cost", `${val(yoc)}${p.noiStabilizedCents !== null ? ` on stabilized NOI of ${fmt.usd(p.noiStabilizedCents)}` : ""} (Corin pro forma from the sponsor's plan)`, W2));
    if (p.stabilizedValueCents !== null) lines.push(kv("As-stabilized value", `${fmt.usd(p.stabilizedValueCents)}${p.stabilizedValueSource ? ` (${VALUE_SOURCE_LABELS[p.stabilizedValueSource]})` : ""}`, W2));
    lines.push(ltvLine(f, true));
    const ds = m(f, "dscr_stabilized");
    const at = assumption(f);
    if (ds) lines.push(kv("DSCR", `${val(ds)} stabilized${at ? ` ${at}` : ""}`, W2));
    lines.push(perUnitLine(f));
  } else if (pb === "hard_money" || pb === "fix_flip") {
    const hm = f.hardMoney;
    if (hm) {
      lines.push(kv("Purchase price", `${fmt.usd(hm.purchasePriceCents)}   As-is value: ${fmt.usd(hm.asIsValueCents)}${p.asIsValueSource ? ` (${VALUE_SOURCE_LABELS[p.asIsValueSource]}${p.asIsValueAsOf ? `, ${fmt.date(p.asIsValueAsOf)}` : ""})` : ""}`, W2));
      lines.push(kv("After-repair value", `${fmt.usd(hm.arvCents)} (${VALUE_SOURCE_LABELS[hm.arvSource]})`, W2));
      const contingency = sum(p.uses.filter((u) => u.kind === "contingency"));
      lines.push(kv("Rehab", `${fmt.usd(hm.rehabBudgetCents)} budget${contingency ? ` plus ${fmt.usd(contingency)} contingency` : ""}${hm.rehabWeeks ? `; about ${hm.rehabWeeks} weeks of work` : ""} (from the hard money file)`, W2));
    } else {
      const v = valueLine(f);
      if (v) lines.push(v);
    }
    lines.push(ltcLine(f));
    const ltarv = m(f, "ltarv");
    if (ltarv) lines.push(kv("LTARV", `${val(ltarv)} of the after-repair value`, W2));
    const asIs = m(f, "ltv_as_is");
    if (asIs) lines.push(kv(ltvOnPrice(asIs) ? "Loan to price" : "LTV", `${val(asIs)} ${ltvOnPrice(asIs) ? "of the purchase price" : "as-is"} (Corin calculation)`, W2));
    const margin = m(f, "flip_margin");
    if (margin) lines.push(kv("Projected margin", `${val(margin)} of the sale price after selling costs (Corin calculation)`, W2));
  } else if (pb === "dscr_rental") {
    const r = p.programDetails.rental;
    if (r) {
      const rent = [r.monthlyRentCents !== undefined ? `${fmt.usd(r.monthlyRentCents)} a month under leases (${tag(src(f, "programDetails.rental.monthlyRentCents"), f)})` : null, r.marketRentCents !== undefined ? `market rent ${fmt.usd(r.marketRentCents)}${r.marketRentSource ? ` (${MARKET_RENT_SOURCE_LABELS[r.marketRentSource]})` : ""}` : null].filter(has);
      if (rent.length) lines.push(kv("Rent", rent.join("; "), W2));
      const costs = [r.monthlyTaxesCents !== undefined ? `taxes ${fmt.usd(r.monthlyTaxesCents)}` : null, r.monthlyInsuranceCents !== undefined ? `insurance ${fmt.usd(r.monthlyInsuranceCents)}` : null, r.monthlyHoaCents ? `HOA ${fmt.usd(r.monthlyHoaCents)}` : null].filter(has);
      if (costs.length) lines.push(kv("Monthly costs", costs.join(", "), W2));
    }
    const pitia = m(f, "pitia_monthly");
    const at = assumption(f);
    if (pitia) lines.push(kv("PITIA", `${val(pitia)} a month${at ? ` ${at}` : ""}`, W2));
    const dscr = m(f, "dscr_rental");
    if (dscr) lines.push(kv("DSCR", `${val(dscr)} (lower of lease and market rent ÷ PITIA)`, W2));
    lines.push(ltvLine(f));
    if (r?.leaseStatus) lines.push(kv("Leases", `${lower(LEASE_STATUS_LABELS[r.leaseStatus])}${r.earliestLeaseEnd ? `; earliest lease ends ${fmt.date(r.earliestLeaseEnd)}` : ""}`, W2));
    if (r?.reservesMonths !== undefined) lines.push(kv("Reserves", `${r.reservesMonths} months of PITIA after closing`, W2));
  } else {
    lines.push(...noiLines(f));
    const debtYieldFirst = pb === "cmbs" || pb === "life_company" || pb === "bank" || pb === "hotel_cmbs";
    if (debtYieldFirst) lines.push(debtYieldLine(f), ltvLine(f), ltcLine(f));
    // A subordinate tranche's own LTV would mislead; THE CAPITAL STACK shows the combined (last-dollar) figures.
    else if (pb === "mezz_pref" || pb === "c_pace") lines.push(debtYieldLine(f));
    else lines.push(ltvLine(f), pb === "bridge" || pb === "hotel_pip_bridge" ? ltcLine(f) : null, debtYieldLine(f));
    if (pb === "sba_7a" || pb === "sba_504") {
      const g = m(f, "global_dscr");
      if (g) lines.push(kv("Global DSCR", `${val(g)} (Corin spread of the business and personal cash flow)`, W2));
    } else lines.push(dscrLine(f));
    lines.push(perUnitLine(f));
  }
  const out = lines.filter(has);
  return out.length > 1 ? out : [];
}

function projectBlock(f: EmailRenderFacts): string[] {
  const c = f.profile.programDetails.construction;
  const lines = ["THE PROJECT"];
  const a = addressLine(f);
  if (a) lines.push(a);
  if (c) {
    const build = [c.unitsToBuild !== undefined ? `${fmt.count(c.unitsToBuild)} units` : null, c.grossSf !== undefined ? `${fmt.count(c.grossSf)} SF` : null].filter(has);
    const time = [c.constructionMonths !== undefined ? `${c.constructionMonths} months to build` : null, c.leaseUpMonths ? `${c.leaseUpMonths} months to lease up` : null].filter(has);
    if (build.length || time.length) lines.push(kv("Build", [build.join(", "), time.join(", ")].filter(has).join("; "), 13));
    const status = [c.entitlementStatus ? ENTITLEMENT_STATUS_LABELS[c.entitlementStatus] : null, c.permitStatus ? `permits: ${lower(PERMIT_STATUS_LABELS[c.permitStatus])}` : null].filter(has);
    if (status.length) lines.push(kv("Status", status.join("; "), 13));
    const gc = f.construction?.generalContractorName;
    const contractor = [gc ? `${gc}${f.construction?.licenseStatus ? ` (CSLB check: ${f.construction.licenseStatus === "clear" ? "clear" : f.construction.licenseStatus.replace(/_/g, " ")})` : ""}` : null, c.contractType ? CONSTRUCTION_CONTRACT_LABELS[c.contractType] : null].filter(has);
    if (contractor.length) lines.push(kv("Contractor", contractor.join("; "), 13));
    if (c.completionGuaranty !== undefined) lines.push(kv("Completion guaranty offered", c.completionGuaranty ? "yes" : "no", 13));
  }
  const v = valueLine(f);
  if (v) lines.push(v);
  return lines.length > 1 ? lines : [];
}

function budgetBlock(f: EmailRenderFacts, title: string): string[] {
  const b = f.profile.programDetails.construction?.budget;
  if (!b) return [];
  const lines = ([["Land", b.landCents], ["Hard costs", b.hardCents], ["Soft costs", b.softCents], ["Contingency", b.contingencyCents], ["Developer fee", b.developerFeeCents], ["Financing", b.financingCents], ["Reserves requested of the lender", b.reservesCents]] as const).filter(([, v]) => v > 0);
  if (!lines.length) return [];
  return [title, `  ${lines.map(([l, v]) => `${l} ${fmt.usd(v)}`).join("; ")} = ${fmt.usd(lines.reduce((s, [, v]) => s + v, 0))}`];
}

function improvementsBlock(f: EmailRenderFacts): string[] {
  const c = f.profile.programDetails.construction;
  if (!c) return [];
  const lines = budgetBlock(f, "THE IMPROVEMENTS");
  const out = lines.length ? lines : ["THE IMPROVEMENTS"];
  const time = c.constructionMonths !== undefined ? `about ${c.constructionMonths} months of work` : null;
  const detail = [time, c.contractType ? CONSTRUCTION_CONTRACT_LABELS[c.contractType] : null, c.permitStatus ? `permits: ${lower(PERMIT_STATUS_LABELS[c.permitStatus])}` : null, f.construction?.generalContractorName ? `contractor ${f.construction.generalContractorName}` : null].filter(has);
  if (detail.length) out.push(`  ${detail.join("; ")}`);
  return out.length > 1 ? out : [];
}

function renovationBlock(f: EmailRenderFacts): string[] {
  const r = f.profile.programDetails.rehab;
  if (!r) return [];
  const out = ["THE RENOVATION"];
  if (r.budgetCents !== undefined) out.push(kv("Budget", `${fmt.usd(r.budgetCents)}${r.months !== undefined ? ` over about ${r.months} months` : ""}`, 13));
  if (r.scopeSummary) out.push(kv("Scope", excerpt(r.scopeSummary, 300), 13));
  const rr = r.reservesRequested;
  const res = [rr?.interestCents ? `interest ${fmt.usd(rr.interestCents)}` : null, rr?.capexCents ? `capex ${fmt.usd(rr.capexCents)}` : null, rr?.leasingCents ? `leasing ${fmt.usd(rr.leasingCents)}` : null].filter(has);
  if (res.length) out.push(`  Reserves requested of the lender: ${res.join("; ")}`);
  return out.length > 1 ? out : [];
}

function hotelBlock(f: EmailRenderFacts): string[] {
  const h = f.profile.programDetails.hotel;
  if (!h) return [];
  const out = ["THE HOTEL"];
  const brand = [h.brand, h.franchiseExpiry ? `franchise expires ${fmt.date(h.franchiseExpiry)}` : null].filter(has);
  if (brand.length) out.push(kv("Brand", brand.join("; "), 13));
  const perf = [m(f, "hotel_occupancy") ? `${val(m(f, "hotel_occupancy"))} occupancy` : null, m(f, "hotel_adr") ? `${val(m(f, "hotel_adr"))} ADR` : null, m(f, "hotel_revpar") ? `${val(m(f, "hotel_revpar"))} RevPAR` : null, m(f, "revpar_index") ? `RevPAR index ${val(m(f, "revpar_index"))}` : null].filter(has);
  if (perf.length) out.push(kv("Performance", `${perf.join(", ")} (${tag(m(f, "hotel_revpar")?.inputs[0]?.source ?? src(f, "programDetails.hotel.revparCents"), f)})`, 13));
  if (h.ffeReservePct !== undefined) out.push(kv("FF&E reserve", `${fmt.pct(h.ffeReservePct)} of revenue`, 13));
  if (h.pip) {
    if (!h.pip.required) out.push(kv("PIP", "none required by the brand", 13));
    else {
      const ppk = m(f, "pip_per_key");
      const pip = [h.pip.budgetCents !== undefined ? `${fmt.usd(h.pip.budgetCents)}${ppk ? ` (${val(ppk)} a key)` : ""}` : "required", h.pip.deadline ? `due ${fmt.date(h.pip.deadline)}` : null, h.pip.brandApproved !== undefined ? `brand sign-off on the scope: ${h.pip.brandApproved ? "yes" : "not yet"}` : null].filter(has);
      out.push(kv("PIP", pip.join("; "), 13));
    }
  }
  return out.length > 1 ? out : [];
}

function businessBlock(f: EmailRenderFacts): string[] {
  const s = f.profile.programDetails.sba;
  if (!s) return [];
  const out = ["THE BUSINESS"];
  const who = [s.businessName, s.naics ? `NAICS ${s.naics}` : null, s.yearsInBusiness !== undefined ? `${s.yearsInBusiness} years in business` : null, s.employees !== undefined ? `${fmt.count(s.employees)} employees` : null, f.profile.ownerOccupiedPct !== null ? `occupies ${fmt.pct(f.profile.ownerOccupiedPct)} of the property` : null].filter(has);
  if (who.length) out.push(`  ${who.join(", ")}`);
  const cash = [s.businessRevenueCents !== undefined ? `revenue ${fmt.usd(s.businessRevenueCents)}` : null, s.businessEbitdaCents !== undefined ? `EBITDA ${fmt.usd(s.businessEbitdaCents)}` : null, s.existingBusinessDebtServiceCents !== undefined ? `existing debt service ${fmt.usd(s.existingBusinessDebtServiceCents)}` : null].filter(has);
  if (cash.length) out.push(kv("Cash flow", `${cash.join(", ")} (annual; ${tag(src(f, "programDetails.sba.businessRevenueCents"), f)})`, 13));
  if (s.equityInjectionCents !== undefined) out.push(kv("Injection", `${fmt.usd(s.equityInjectionCents)}${s.equityInjectionSource ? ` (${s.equityInjectionSource})` : ""}`, 13));
  const flags = ([["franchise", s.franchise], ["change of ownership", s.changeOfOwnership], ["affiliates", s.affiliates]] as const).filter(([, v]) => typeof v === "boolean").map(([l, v]) => `${l}: ${v ? "yes" : "no"}`);
  if (flags.length) out.push(kv("Eligibility", flags.join("; "), 13));
  const cdc = [s.cdcName ? `CDC: ${s.cdcName}` : null, s.jobsCreated !== undefined ? `${s.jobsCreated} jobs created or retained` : null].filter(has);
  if (cdc.length) out.push(`  ${cdc.join("; ")}`);
  return out.length > 1 ? out : [];
}

function tenancyBlock(f: EmailRenderFacts): string[] {
  const t = f.profile.programDetails.tenancy;
  if (!t) return [];
  const out = ["THE TENANCY"];
  for (const x of t.topTenants ?? []) out.push(`  ${x.name}: ${fmt.pct(x.sharePct)} of rent, lease ends ${fmt.date(x.leaseEnd)}`);
  const roll = [t.rolloverPctWithinTerm !== undefined ? `${fmt.pct(t.rolloverPctWithinTerm)} of rent ends inside the requested term` : null, t.walMonths !== undefined ? `weighted average lease term ${t.walMonths} months` : null].filter(has);
  if (roll.length) out.push(kv("Rollover", roll.join("; "), 13));
  return out.length > 1 ? out : [];
}

function agencyBlock(f: EmailRenderFacts): string[] {
  const a = f.profile.programDetails.agency;
  if (!a) return [];
  const out = ["AGENCY DETAILS"];
  if (a.unitMix?.length) out.push(kv("Unit mix", a.unitMix.map((u) => `${u.count} x ${u.type} at ${fmt.usd(u.avgRentCents)}`).join("; "), 13));
  const occ = [f.profile.occupancyPct !== null ? `${fmt.pct(f.profile.occupancyPct)} physical` : null, a.economicOccupancyPct !== undefined ? `${fmt.pct(a.economicOccupancyPct)} economic` : null].filter(has);
  if (occ.length) out.push(kv("Occupancy", occ.join(", "), 13));
  if (a.studentOrSeniorPct !== undefined) out.push(kv("Student or senior concentration", fmt.pct(a.studentOrSeniorPct), 13));
  if (a.affordabilityNote) out.push(kv("Affordability", excerpt(a.affordabilityNote, 300), 13));
  return out.length > 1 ? out : [];
}

function hudBlock(f: EmailRenderFacts): string[] {
  const h = f.profile.programDetails.hud;
  if (!h) return [];
  const out = ["HUD DETAILS"];
  const program = [h.section ? HUD_SECTION_LABELS[h.section] : null, h.repairsCents !== undefined ? (h.repairsCents ? `repairs ${fmt.usd(h.repairsCents)} from the capital needs assessment` : "no repairs called for") : null].filter(has);
  if (program.length) out.push(kv("Program", program.join("; "), 13));
  if (h.priorHudParticipation !== undefined) out.push(kv("Prior HUD participation", h.priorHudParticipation ? "yes" : "no", 13));
  const ops = [h.licensedBeds !== undefined ? `${h.licensedBeds} licensed beds` : null, h.operatorName ? `operator ${h.operatorName}` : null].filter(has);
  if (ops.length) out.push(kv("Operations", ops.join("; "), 13));
  if (h.payorMixNote) out.push(kv("Payor mix", excerpt(h.payorMixNote, 300), 13));
  if (h.surveyHistoryNote) out.push(kv("Surveys", excerpt(h.surveyHistoryNote, 300), 13));
  return out.length > 1 ? out : [];
}

const EQUITY_SOURCES = new Set(["sponsor_equity", "investor_equity", "land_equity", "seller_credit"]);

function capitalStackBlock(f: EmailRenderFacts): string[] {
  const s = f.profile.programDetails.capitalStack;
  if (!s) return [];
  const out = ["THE CAPITAL STACK"];
  const senior = [s.seniorAmountCents !== undefined ? fmt.usd(s.seniorAmountCents) : null, s.seniorLender ? `from ${s.seniorLender}` : null, s.seniorRatePct !== undefined ? `at ${fmt.rate(s.seniorRatePct)}` : null].filter(has);
  if (senior.length || s.seniorMaturity) out.push(kv("Senior", `${senior.join(" ")}${s.seniorMaturity ? `${senior.length ? ", " : ""}matures ${fmt.date(s.seniorMaturity)}` : ""}${s.seniorAllowsSubordinate !== undefined ? `; allows subordinate financing: ${s.seniorAllowsSubordinate ? "yes" : "no"}` : ""}`, 13));
  if (f.deal.loanAmountCents) out.push(kv("This loan", `${fmt.usd(f.deal.loanAmountCents)}${s.thisTrancheKind ? ` ${lower(TRANCHE_KIND_LABELS[s.thisTrancheKind])}` : ""}`, 13));
  const equity = sum(f.profile.sources.filter((l) => EQUITY_SOURCES.has(l.kind)));
  if (equity) out.push(kv("Equity", fmt.usd(equity), 13));
  const combined = [m(f, "combined_ltv") ? `${val(m(f, "combined_ltv"))} LTV` : null, m(f, "combined_ltc") ? `${val(m(f, "combined_ltc"))} LTC` : null].filter(has);
  if (combined.length) out.push(kv("Combined", `${combined.join(" / ")} (Corin calculation)`, 13));
  const status = f.playbook === "c_pace" ? s.consentStatus : s.intercreditorStatus;
  if (status) out.push(kv(f.playbook === "c_pace" ? "Mortgage holder's consent" : "Intercreditor", lower(CONSENT_STATUS_LABELS[status]), 13));
  const cpace = [s.eligibleImprovementsCents !== undefined ? `eligible improvements ${fmt.usd(s.eligibleImprovementsCents)}` : null, s.programJurisdiction ? `${s.programJurisdiction} program` : null].filter(has);
  if (cpace.length) out.push(kv("C-PACE", cpace.join("; "), 13));
  return out.length > 1 ? out : [];
}

const ENTITY_TYPES: [RegExp, string][] = [
  [/\bL\.?L\.?C\.?$/i, "LLC"],
  [/\bL\.?P\.?$/i, "limited partnership"],
  [/\b(?:Inc\.?|Incorporated|Corp\.?|Corporation)$/i, "corporation"],
];

function sponsorBlock(f: EmailRenderFacts): string[] {
  const s = f.sponsor;
  if (!s) return [];
  const out = ["THE SPONSOR"];
  const e = s.borrowerEntity;
  const type = e?.name ? ENTITY_TYPES.find(([re]) => re.test(e.name!.trim()))?.[1] : undefined;
  const entity = e?.name ? `${e.name}${e.formationState || type ? `, a ${[e.formationState, type].filter(has).join(" ") || "borrowing entity"}` : ""}` : null;
  const first = [entity ? `${entity}.` : null, s.experienceSummary ? excerpt(s.experienceSummary, 300) : null].filter(has);
  if (first.length) out.push(`  ${first.join(" ")}`);
  const track = [s.yearsExperience !== null ? `${s.yearsExperience} years` : null, s.similarProjectsCount !== null ? `${s.similarProjectsCount} similar project${s.similarProjectsCount === 1 ? "" : "s"}` : null, s.portfolioSizeNote ?? (s.portfolioCount !== null ? `${s.portfolioCount} properties owned` : null)].filter(has);
  if (f.playbook === "construction") {
    const g = f.profile.programDetails.construction?.groundUpProjectsCompleted;
    if (g !== undefined) track.push(`${g} ground-up project${g === 1 ? "" : "s"} completed`);
  }
  if (f.hardMoney) track.push(`${f.hardMoney.verifiedProjects36m} verified project${f.hardMoney.verifiedProjects36m === 1 ? "" : "s"} in the last 36 months`);
  if (track.length) out.push(`  ${track.join(", ")}`);
  const c = s.covenants;
  if (c) {
    const who = f.playbook === "agency" || f.playbook === "hud_multifamily" || f.playbook === "hud_232" ? "Key principal" : "Guarantor";
    const multiple = c.thresholds.netWorthMultiple === 1 ? "the loan amount" : `${c.thresholds.netWorthMultiple}x the loan amount`;
    const liq = c.thresholds.liquidityPct <= 1 ? c.thresholds.liquidityPct * 100 : c.thresholds.liquidityPct;
    const checks = [c.netWorthAtLeastLoan !== null ? `${who} net worth at or above ${multiple}: ${c.netWorthAtLeastLoan ? "yes" : "no"}.` : null, c.liquidityAtLeastPct !== null ? `Liquidity at or above ${fmt.pct(liq)} of the loan: ${c.liquidityAtLeastPct ? "yes" : "no"}.` : null].filter(has);
    if (checks.length) out.push(`  ${checks.join(" ")}`);
    if (c.rounded) {
      const r = (cents: number) => (cents > 0 ? `about ${fmt.usd(cents)}` : `under ${fmt.usd(50_000_000)}`);
      out.push(`  Combined ${lower(who)} net worth ${r(c.rounded.netWorthCents)}; liquidity ${r(c.rounded.liquidityCents)} (rounded down to the nearest $500,000).`);
    }
    out.push(`    (${c.basis === "pfs" ? `from personal financial statements${c.asOf ? ` dated ${fmt.date(c.asOf)}` : ""}` : `as stated by the sponsor${c.asOf ? ` on ${fmt.date(c.asOf)}` : ""}`}; figures are in the summary)`);
  }
  if (s.creditBand && s.creditBand !== "NOT_PROVIDED") {
    const events = s.creditEventsReported === false ? "; no bankruptcies, foreclosures, judgments or open litigation reported" : s.creditEventsReported ? "; a credit event was disclosed and is explained in the summary" : "";
    out.push(`  Credit: ${CREDIT_BAND_LABELS[s.creditBand]} (self-reported band)${events}`);
  }
  if (s.managementCompany) out.push(`  Management: ${s.managementCompany}`);
  return out.length > 1 ? out : [];
}

function planBlock(f: EmailRenderFacts): string[] {
  const p = f.profile;
  const out = ["THE PLAN AND THE EXIT"];
  if (p.businessPlan) out.push(`  ${excerpt(p.businessPlan, 600)}`);
  const hm = f.hardMoney;
  let exit: string | null = null;
  if (hm) exit = `Exit: ${hm.exit.type} in about ${hm.exit.targetMonths} months${hm.exit.type === "refinance" && hm.exit.refinanceProgram ? ` into a ${lower(hm.exit.refinanceProgram)}` : ""}.`;
  else if (p.exitStrategy && p.exitStrategy !== "not_applicable") exit = p.exitStrategy === "hold_to_maturity" ? "Exit: hold to maturity." : `Exit: ${lower(EXIT_STRATEGY_LABELS[p.exitStrategy])}${p.exitMonths !== null ? ` in about ${p.exitMonths} months` : ""}.`;
  const exitLine = [exit, p.exitDetail ? excerpt(p.exitDetail, 300) : null].filter(has);
  if (exitLine.length) out.push(`  ${exitLine.join(" ")}`);
  return out.length > 1 ? out : [];
}

function sourcesUsesBlock(f: EmailRenderFacts): string[] {
  const p = f.profile;
  if (!p.sources.length && !p.uses.length) return [];
  const line = (lines: readonly { kind: string; amountCents: number; note?: string }[], labels: Record<string, string>) => `${lines.map((l) => `${labels[l.kind]}${l.note ? ` (${l.note})` : ""} ${fmt.usd(l.amountCents)}`).join("; ")} = ${fmt.usd(sum(lines))}`;
  const out = ["SOURCES AND USES"];
  if (p.sources.length) out.push(`  Sources: ${line(p.sources, SOURCE_KIND_LABELS)}`);
  if (p.uses.length) out.push(`  Uses:    ${line(p.uses, USE_KIND_LABELS)}`);
  return out;
}

function issuesBlock(f: EmailRenderFacts): string[] {
  const risks = f.profile.risks.filter((r) => r.risk.trim());
  return risks.length ? ["KNOWN ISSUES", ...risks.map((r) => `  - ${r.risk}${r.mitigant.trim() ? `: ${r.mitigant}` : ""}`)] : [];
}

const DOC_LABELS: Record<string, string> = {
  DEAL_SUMMARY: "Deal summary (PDF)",
  EXECUTIVE_SUMMARY: "Executive summary (PDF)",
  T12: "T-12 operating statement",
  RENT_ROLL: "rent roll",
  CENSUS: "census",
  STR_REPORT: "STR report",
  APPRAISAL: "appraisal",
  FRANCHISE_AGREEMENT: "franchise agreement",
  PIP_BUDGET: "PIP budget",
  PFS: "sponsor financial statement",
  TAX_RETURN: "tax returns",
};

function documentsBlock(f: EmailRenderFacts): string[] {
  const n = f.documents.length;
  const out = [`IN THE PACKAGE (${n} document${n === 1 ? "" : "s"})`];
  // Personal documents are counted, never named (a file name could carry a person's name).
  const counts = new Map<string, number>();
  const labels: string[] = [];
  for (const d of f.documents) {
    if (d.kind === "PFS" || d.kind === "TAX_RETURN") {
      counts.set(d.kind, (counts.get(d.kind) ?? 0) + 1);
      continue;
    }
    const base = DOC_LABELS[d.kind] ?? d.label.replace(/\.[a-z0-9]{2,5}$/i, "");
    const date = d.date ? (d.kind === "T12" ? ` through ${fmt.monthYear(d.date)}` : ` dated ${fmt.date(d.date)}`) : "";
    labels.push(`${base}${date}`);
  }
  for (const [kind, count] of counts) labels.push(kind === "PFS" ? `${count} sponsor financial statement${count === 1 ? "" : "s"}` : `${count} set${count === 1 ? "" : "s"} of tax returns`);
  if (labels.length) out.push(`  ${labels.join("; ")}`);
  if (f.reportsOnHand.length) out.push(`  Reports on hand: ${f.reportsOnHand.map((r) => `${r.label}${r.date ? ` dated ${fmt.date(r.date)}` : ""}`).join(", ")}`);
  if (f.notYetInHand.length) out.push(`  Not yet in hand: ${f.notYetInHand.join("; ")}`);
  return out;
}

/** "415-555-0100" for a US number; anything else is printed only when it holds no long digit run. */
export function formatPhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length === 10) return `${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}`;
  return /\d{9,}/.test(raw) ? null : raw.trim();
}

/** Staff-typed text the email prints (checkSummaryCopy runs on all of it). */
function emailStaffText(f: EmailRenderFacts): string[] {
  const p = f.profile;
  const d = p.programDetails;
  const s = f.sponsor;
  return [
    f.deal.title,
    p.propertyName,
    p.closeDriver,
    p.existingLender,
    p.cashOutUse,
    p.businessPlan,
    p.exitDetail,
    ...p.risks.flatMap((r) => [r.risk, r.mitigant]),
    ...p.sources.map((l) => l.note),
    ...p.uses.map((l) => l.note),
    d.rehab?.scopeSummary,
    d.hotel?.brand,
    d.sba?.businessName,
    d.sba?.equityInjectionSource,
    d.sba?.cdcName,
    d.agency?.affordabilityNote,
    ...(d.agency?.unitMix ?? []).map((u) => u.type),
    d.hud?.operatorName,
    d.hud?.payorMixNote,
    d.hud?.surveyHistoryNote,
    d.capitalStack?.seniorLender,
    d.capitalStack?.programJurisdiction,
    ...(d.tenancy?.topTenants ?? []).map((t) => t.name),
    s?.experienceSummary,
    s?.portfolioSizeNote,
    s?.managementCompany,
    s?.borrowerEntity?.name,
  ].filter((t): t is string => typeof t === "string" && t.trim().length > 0);
}

const PRE_NUMBERS: Partial<Record<SubmissionPlaybook, (f: EmailRenderFacts) => string[]>> = {
  construction: (f) => budgetBlock(f, "THE BUDGET"),
  hotel_cmbs: hotelBlock,
  hotel_pip_bridge: hotelBlock,
  sba_7a: businessBlock,
  sba_504: businessBlock,
  agency: agencyBlock,
  hud_multifamily: hudBlock,
  hud_232: hudBlock,
};
const POST_NUMBERS: Partial<Record<SubmissionPlaybook, (f: EmailRenderFacts) => string[][]>> = {
  bridge: (f) => [renovationBlock(f)],
  hotel_pip_bridge: (f) => [renovationBlock(f)],
  cmbs: (f) => [tenancyBlock(f)],
  life_company: (f) => [tenancyBlock(f)],
  bank: (f) => [tenancyBlock(f)],
  mezz_pref: (f) => [capitalStackBlock(f)],
  c_pace: (f) => [capitalStackBlock(f), improvementsBlock(f)],
};

/** The playbooks with their own blocks before and after THE NUMBERS (the email's variations; spec 5.3), for checks and tests. */
export const EMAIL_BLOCK_PLAYBOOKS: { readonly beforeNumbers: readonly SubmissionPlaybook[]; readonly afterNumbers: readonly SubmissionPlaybook[] } = {
  beforeNumbers: Object.keys(PRE_NUMBERS) as SubmissionPlaybook[],
  afterNumbers: Object.keys(POST_NUMBERS) as SubmissionPlaybook[],
};

/**
 * Renders the email. Throws PackageCopyError on overclaiming staff copy and
 * EmailSafetyError when the text holds a restricted identifier or (with
 * `safety.names`) a principal's name.
 */
export function renderLenderEmail(f: EmailRenderFacts, safety: EmailSafetyOptions = {}): LenderEmail {
  checkSummaryCopy(emailStaffText(f));
  const pb = f.playbook;
  const blocks: string[][] = [];
  blocks.push([`${f.lender.contactFirstName ?? "Hello"},`]);
  blocks.push([`${site.legalName} is the broker on this request, not the lender. We are asking ${f.lender.name} for ${ASK[f.stage]} on the loan below. Please reply with yes, no, or what else you need.`]);
  blocks.push(fitLines(f));
  blocks.push(requestBlock(f));
  if (pb === "construction") blocks.push(projectBlock(f));
  else blocks.push(propertyBlock(f, "THE PROPERTY", pb !== "hard_money" && pb !== "fix_flip"));
  blocks.push(PRE_NUMBERS[pb]?.(f) ?? []);
  blocks.push(numbersBlock(f));
  blocks.push(...(POST_NUMBERS[pb]?.(f) ?? []));
  blocks.push(sponsorBlock(f));
  blocks.push(planBlock(f));
  blocks.push(sourcesUsesBlock(f));
  blocks.push(issuesBlock(f));
  blocks.push(documentsBlock(f));
  blocks.push([`Secure link for ${f.lender.name} only (expires ${EMAIL_PLACEHOLDERS.linkExpires}):`, EMAIL_PLACEHOLDERS.shareLink]);
  const a = f.advisor;
  const phone = formatPhone(a.phone);
  blocks.push([[`${a.name}${a.title ? `, ${a.title}` : ""}`, a.dreLicense ? `DRE ${a.dreLicense}` : null].filter(has).join(" · "), [a.email, phone].filter(has).join(" · ")]);
  blocks.push([
    `${site.legalName} arranges loans as a broker and does not lend. Figures come from the borrower's documents and Corin's calculations as labeled; your institution performs its own underwriting and makes every credit decision. This is a request for terms, not a commitment by any party. Confidential: for ${f.lender.name}'s credit review only. Please do not forward the link.`,
    licenseLine(),
  ]);
  const text = `${blocks
    .filter((b) => b.length)
    .map((b) => b.join("\n"))
    .join("\n\n")}\n`;
  const subject = subjectLine(f);
  assertEmailSafe(`${subject}\n${text}`, safety);
  return { subject, text, sha256: emailSha256(text) };
}

/** The principals' names the email must never print, and the borrowing entity's own name it may. */
export function emailSafetyFor(ctx: SubmissionContext): EmailSafetyOptions {
  return { names: ctx.principals.filter((p) => p.kind === "individual").map((p) => p.legalName), allow: [ctx.deal.borrowerName, ...ctx.principals.filter((p) => p.kind === "entity").map((p) => p.legalName)].filter((n): n is string => Boolean(n)) };
}

/** Facts and rendering in one step, with the principal-name check (spec 5.3 buildLenderEmail). */
export function buildLenderEmail(input: LenderEmailInput): LenderEmail {
  return renderLenderEmail(lenderEmailFacts(input), emailSafetyFor(input.ctx));
}

/** The approved text with the share link and its expiry filled in (after approval only). */
export function fillEmailPlaceholders(text: string, link: { shareUrl: string; expiresAt: string }): string {
  return text.split(EMAIL_PLACEHOLDERS.shareLink).join(link.shareUrl).split(EMAIL_PLACEHOLDERS.linkExpires).join(fmt.date(link.expiresAt));
}
