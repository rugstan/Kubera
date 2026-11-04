// Builds every applicable spread for a deal (or lead) from its accepted
// extractions: NOI per lender profile, quotes at each lender's constant, rent
// roll, census, STR, construction budget and SBA global cash flow.

import type { ExtractionRecord } from "@/lib/agents/documents/store";
import { ACCEPTED_STATUSES, type DocType } from "@/lib/agents/documents/types";
import { LENDER_PROFILE_IDS, type AssetClass, type LenderProfileId } from "./assumptions";
import { budgetSpread, budgetTotals, type BudgetSpread } from "./construction";
import {
  budgetFromExtraction,
  censusFromExtraction,
  guarantorFromPfs,
  quoteFromTermSheet,
  statementFromT12,
  strFromExtraction,
  unitsFromRentRoll,
} from "./from-extraction";
import { strMetrics, type StrResult } from "./hotel";
import { normalizeNoi, type NoiResult } from "./noi";
import { analyzeQuotes, type LoanQuote, type QuoteAnalysis } from "./quotes";
import { normalizeRentRoll, type RentControlFacts, type RentRollResult } from "./rentroll";
import { globalCashFlow, type BusinessCashFlowInput, type GlobalCashFlowResult } from "./sba";
import { censusMetrics, type CensusResult } from "./senior";

export type SpreadContext = {
  asset: AssetClass;
  /** Units / beds / keys when no document states them. */
  units?: number;
  /** Value for LTV (appraisal, purchase price or estimate). */
  value?: number | null;
  /** Lender profiles to normalize NOI under (default: all). */
  profiles?: LenderProfileId[];
  /** Profile whose NOI the quotes are tested against (default: the most conservative). */
  quoteProfile?: LenderProfileId;
  quotes?: LoanQuote[];
  reassessedTaxes?: number | null;
  rentControl?: RentControlFacts;
  /** For SBA deals: business cash flow and debt service (from tax returns / the T-12). */
  sba?: { business: BusinessCashFlowInput; businessDebtService: { existing: number; proposed: number }; minDscr?: number };
  construction?: { loanAmount?: number; asCompletedValue?: number; stabilizedNoi?: number; maxLtc?: number };
  /** As-of date for the rent roll when the document has none (YYYY-MM-DD). */
  asOf: string;
};

export type SpreadBundle = {
  operating: Partial<Record<LenderProfileId, NoiResult>>;
  /** NOI the quotes were tested with, and its profile. */
  quoteNoi: { profile: LenderProfileId; noi: number } | null;
  quotes: QuoteAnalysis[];
  rentRoll: RentRollResult | null;
  census: CensusResult | null;
  str: StrResult | null;
  construction: (BudgetSpread & { gmpContract: boolean | null }) | null;
  globalCashFlow: GlobalCashFlowResult | null;
  /** Extraction ids used per spread kind. */
  sources: Partial<Record<keyof Omit<SpreadBundle, "sources" | "flags" | "quoteNoi">, string[]>>;
  flags: string[];
};

/** Latest accepted extraction per document type (approved beats extracted at the same time). */
export function latestAccepted(extractions: ExtractionRecord[]): Partial<Record<DocType, ExtractionRecord[]>> {
  const out: Partial<Record<DocType, ExtractionRecord[]>> = {};
  const accepted = extractions
    .filter((e) => e.doc_type && ACCEPTED_STATUSES.includes(e.status))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || (a.status === "approved" ? -1 : 1));
  for (const e of accepted) (out[e.doc_type!] ??= []).push(e);
  return out;
}

export function buildSpreadBundle(extractions: ExtractionRecord[], ctx: SpreadContext): SpreadBundle {
  const by = latestAccepted(extractions);
  const flags: string[] = [];
  const sources: SpreadBundle["sources"] = {};
  const first = (t: DocType) => by[t]?.[0];

  const rr = first("RENT_ROLL");
  const census = first("CENSUS");
  const str = first("STR");
  const t12 = first("T12");

  // Units for reserves: the documents first, then the context.
  const rentRoll = rr ? normalizeRentRoll(unitsFromRentRoll(rr.fields), { asOf: String(rr.fields.scalars.asOfDate?.value ?? ctx.asOf), ...(ctx.rentControl ? { rentControl: ctx.rentControl } : {}) }) : null;
  if (rr) sources.rentRoll = [rr.id];
  const censusInput = census ? censusFromExtraction(census.fields) : null;
  const censusResult = censusInput ? censusMetrics(censusInput.rows, { licensedBeds: censusInput.licensedBeds, totalUnits: censusInput.totalUnits }) : null;
  if (census) sources.census = [census.id];
  const strInput = str ? strFromExtraction(str.fields) : null;
  const rooms = strInput?.rooms ?? ctx.units ?? 0;
  const strResult = strInput && strInput.months.length ? strMetrics(strInput.months, rooms) : null;
  if (str) sources.str = [str.id];
  if (strInput && !strInput.rooms && !ctx.units) flags.push("hotel_rooms_unknown");

  const units = rentRoll?.units || censusResult?.capacity || strInput?.rooms || ctx.units || 0;
  if (!units) flags.push("unit_count_unknown");

  const operating: SpreadBundle["operating"] = {};
  if (t12) {
    const stmt = statementFromT12(t12.fields);
    for (const profile of ctx.profiles ?? LENDER_PROFILE_IDS) {
      operating[profile] = normalizeNoi(stmt, { asset: ctx.asset, units, profile, ...(ctx.reassessedTaxes ? { reassessedTaxes: ctx.reassessedTaxes } : {}) });
    }
    sources.operating = [t12.id];
  }

  let quoteNoi: SpreadBundle["quoteNoi"] = null;
  const profiles = Object.values(operating) as NoiResult[];
  if (profiles.length) {
    const pick = ctx.quoteProfile && operating[ctx.quoteProfile] ? operating[ctx.quoteProfile]! : profiles.reduce((a, b) => (b.underwrittenNoi < a.underwrittenNoi ? b : a));
    quoteNoi = { profile: pick.profile, noi: pick.underwrittenNoi };
  }
  const quotes: LoanQuote[] = [...(ctx.quotes ?? [])];
  for (const ts of by.TERM_SHEET ?? []) {
    const q = quoteFromTermSheet(ts.fields, ts.id);
    if (!q) {
      flags.push(`term_sheet_incomplete:${ts.id}`);
      continue;
    }
    if (ts.fields.scalars.amortizationYears?.value == null) flags.push(`amortization_assumed_30yr:${ts.id}`);
    quotes.push(q);
    (sources.quotes ??= []).push(ts.id);
  }
  const quoteResults = quoteNoi && quotes.length ? analyzeQuotes(quoteNoi.noi, ctx.value ?? null, quotes) : [];
  if (quotes.length && !quoteNoi) flags.push("quotes_need_noi");

  const budget = first("CONSTRUCTION_BUDGET");
  let construction: SpreadBundle["construction"] = null;
  if (budget) {
    const b = budgetFromExtraction(budget.fields);
    const totals = budgetTotals(b.lines, b.scalars);
    construction = { ...budgetSpread(totals, { ...ctx.construction, gmpContract: b.gmpContract }), gmpContract: b.gmpContract };
    sources.construction = [budget.id];
  }

  let gcf: GlobalCashFlowResult | null = null;
  if (ctx.sba) {
    const pfs = by.PFS ?? [];
    gcf = globalCashFlow({
      business: ctx.sba.business,
      businessDebtService: ctx.sba.businessDebtService,
      guarantors: pfs.map((p, i) => guarantorFromPfs(p.fields, `Guarantor ${i + 1}`)),
      ...(ctx.sba.minDscr ? { minDscr: ctx.sba.minDscr } : {}),
    });
    if (!pfs.length) flags.push("no_guarantor_pfs");
    sources.globalCashFlow = pfs.map((p) => p.id);
  }

  return { operating, quoteNoi, quotes: quoteResults, rentRoll, census: censusResult, str: strResult, construction, globalCashFlow: gcf, sources, flags };
}
