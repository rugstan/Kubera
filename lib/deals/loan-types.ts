// Lender loan types: the user-facing "what kind of loan" tags staff filter the
// Lender panel by. Separate from deal programs (lib/deals/types.ts
// dealPrograms), which drive stage templates, DRE reporting and the matcher and
// are not changed. Pure (no server-only), so tests and the add-lender action
// share one derivation.
//
// deriveLenderLoanTypes() is mirrored by public.derive_lender_loan_types() in
// supabase/migrations/20261105130000_int_lender_loan_types.sql; every pattern
// below is a plain string that means the same thing to a JS RegExp ("i" flag)
// and a Postgres ARE (~* / regexp_replace 'gi'): no \b, no lookaround, no
// non-greedy quantifiers. lib/deals/loan-types-parity.test.ts proves the two agree.

import type { LenderCategory } from "@/lib/compliance/schemas";
import type { DealProgram } from "./types";

export const lenderLoanTypes = [
  "construction",
  "bridge",
  "private_money",
  "fix_flip",
  "dscr",
  "sba",
  "hud_fha",
  "agency",
  "cmbs",
  "bank",
  "life_company",
  "mezz_pref",
  "c_pace",
  "hotel",
] as const;
export type LenderLoanType = (typeof lenderLoanTypes)[number];

export const LENDER_LOAN_TYPE_LABELS: Record<LenderLoanType, string> = {
  construction: "Construction",
  bridge: "Bridge",
  private_money: "Private / hard money",
  fix_flip: "Fix & flip",
  dscr: "DSCR (investor rental)",
  sba: "SBA 7(a) / 504",
  hud_fha: "HUD / FHA",
  agency: "Agency (Fannie / Freddie)",
  cmbs: "CMBS / conduit",
  bank: "Bank / credit union",
  life_company: "Life company",
  mezz_pref: "Mezzanine / pref equity",
  c_pace: "C-PACE",
  hotel: "Hotel / PIP",
};

/** Table badges (narrow screens). */
export const LENDER_LOAN_TYPE_SHORT_LABELS: Record<LenderLoanType, string> = {
  construction: "Construction",
  bridge: "Bridge",
  private_money: "Private money",
  fix_flip: "Fix & flip",
  dscr: "DSCR",
  sba: "SBA",
  hud_fha: "HUD / FHA",
  agency: "Agency",
  cmbs: "CMBS",
  bank: "Bank / CU",
  life_company: "Life co",
  mezz_pref: "Mezz / pref",
  c_pace: "C-PACE",
  hotel: "Hotel",
};

export const LENDER_LOAN_TYPE_DESCRIPTIONS: Record<LenderLoanType, string> = {
  construction: "Ground-up, heavy-rehab and land development loans, including construction-to-perm.",
  bridge: "Short-term (about 6–36 months) transitional, value-add and lease-up loans from debt funds, REITs and bridge lenders.",
  private_money: "Asset-based private-money and trust-deed lenders that close fast and lend on equity more than credit.",
  fix_flip: "Investor loans to buy, renovate and resell 1–4 unit homes (residential transition loans).",
  dscr: "Long-term investor rental loans sized on the property's rent, not personal income: 1–4 and 5–8 units and small mixed-use.",
  sba: "Government-guaranteed loans for owner-occupied businesses and their real estate, including 504 CDCs.",
  hud_fha: "FHA-insured multifamily and healthcare loans: 223(f), 221(d)(4), 223(a)(7) and 232.",
  agency: "Fannie Mae DUS and Freddie Mac Optigo multifamily and seniors-housing loans, including small-balance.",
  cmbs: "Securitized fixed-rate, non-recourse loans on stabilized commercial property, including hotel CMBS.",
  bank: "Balance-sheet loans from banks, thrifts and credit unions: usually recourse and relationship-based.",
  life_company: "Insurance-company loans: low leverage and long fixed-rate terms on high-quality stabilized property.",
  mezz_pref: "Subordinate debt or preferred equity that fills the gap between the senior loan and the sponsor's equity.",
  c_pace: "Property-assessed clean-energy financing repaid through the property-tax bill, often part of a construction capital stack.",
  hotel: "Lenders that finance hotels, including PIP renovation, flag-change and hotel bridge loans.",
};

/** Visual grouping of the filter chips (nested fieldsets); every type appears exactly once, in canonical order. */
export const LENDER_LOAN_TYPE_GROUPS: readonly { label: string; types: readonly LenderLoanType[] }[] = [
  { label: "Short-term and investor", types: ["construction", "bridge", "private_money", "fix_flip", "dscr"] },
  { label: "Government and agency", types: ["sba", "hud_fha", "agency"] },
  { label: "Permanent and balance sheet", types: ["cmbs", "bank", "life_company"] },
  { label: "Gap and specialty", types: ["mezz_pref", "c_pace", "hotel"] },
];

export function isLenderLoanType(v: unknown): v is LenderLoanType {
  return typeof v === "string" && (lenderLoanTypes as readonly string[]).includes(v);
}

/** Known ids only, deduped, in canonical order. */
export function sortLoanTypes(types: Iterable<string>): LenderLoanType[] {
  const set = new Set(types);
  return lenderLoanTypes.filter((t) => set.has(t));
}

// --- Derivation tables ------------------------------------------------------------------------

/** Deal program -> loan types. BANK_LIFE_CO is resolved last (see deriveLenderLoanTypes). */
export const PROGRAM_LOAN_TYPES: Record<DealProgram, readonly LenderLoanType[]> = {
  HUD_232: ["hud_fha"],
  HUD_MULTIFAMILY: ["hud_fha"],
  SBA_7A: ["sba"],
  SBA_504: ["sba"],
  HOTEL_CMBS: ["cmbs", "hotel"],
  PIP_BRIDGE: ["bridge", "hotel"],
  AGENCY: ["agency"],
  BANK_LIFE_CO: [],
  PRIVATE_BRIDGE: ["bridge"],
  HARD_MONEY: ["private_money"],
  CONSTRUCTION: ["construction"],
};

/**
 * Wholesale-directory desk subcategory (the label in "| Desks: HM-094 <label> (tier B, ...)")
 * -> what the desk name itself asserts. Lumped labels assert only their unambiguous part:
 * "HUD 232 / Agency (permanent & construction)" is hud_fha (agency and construction come
 * from the box text), "Construction mezz / pref equity / C-PACE" is construction + mezz_pref
 * (C-PACE from the box text). [] = the label says nothing reliable (the box text decides).
 * A label missing from this table is fed to the keyword rules instead.
 */
export const DESK_LOAN_TYPES: Readonly<Record<string, readonly LenderLoanType[]>> = {
  "CRE construction debt fund / private": ["construction"],
  "CRE construction bank": ["construction", "bank"],
  "Land / horizontal development": ["construction"],
  "Construction mezz / pref equity / C-PACE": ["construction", "mezz_pref"],
  "Investor ground-up (wholesale)": ["construction"],
  "California private money": ["private_money"],
  "National commercial hard money": ["private_money"],
  "Commercial bridge / transitional": ["bridge"],
  "Small-balance commercial (SBC)": [],
  "Hospitality bridge / PIP": ["bridge", "hotel"],
  "Investor fix & flip / bridge (wholesale)": ["fix_flip", "bridge"],
  "Investor DSCR rental take-out (wholesale)": ["dscr"],
  "HUD 232 / Agency (permanent & construction)": ["hud_fha"],
  "Healthcare bridge / bridge-to-HUD": ["bridge"],
  "Healthcare bank / balance sheet": ["bank"],
  "Senior housing construction": ["construction"],
  "Healthcare mezz / pref equity": ["mezz_pref"],
  "SBA / small care facility (RCFE, assisted living)": [],
  "Agency multifamily (Fannie / Freddie)": ["agency"],
  "HUD multifamily (221(d)(4) / 223(f))": ["hud_fha"],
  "Multifamily bridge / value-add": ["bridge"],
  "Small-balance multifamily (5-50 units)": [],
  "Multifamily bank / credit union": ["bank"],
  "SBA hotel lender (7(a) / 504)": ["sba", "hotel"],
  "Hotel bridge / PIP": ["bridge", "hotel"],
  "Hotel construction": ["construction", "hotel"],
  "Life insurance company": ["life_company"],
  "CMBS conduit": ["cmbs"],
  "Mortgage REIT / large-balance debt fund": ["bridge"],
  "Hedge fund / private credit": ["bridge"],
  "Family office / private capital": [],
  "Community bank / credit union CRE": ["bank"],
  "SBA 504 CDC": ["sba"],
  "SBA 7(a) lender": ["sba"],
};

/** An evidenced charter category says what kind of lender it is. */
export const CATEGORY_LOAN_TYPES: Partial<Record<LenderCategory, LenderLoanType>> = {
  NATIONAL_BANK: "bank",
  STATE_BANK: "bank",
  SAVINGS_ASSOCIATION: "bank",
  CREDIT_UNION: "bank",
  INDUSTRIAL_LOAN_COMPANY: "bank",
  INSURANCE_COMPANY: "life_company",
};

/** Signals that a BANK_LIFE_CO program is the seed generator's multifamily fallback, not a bank. */
const BANK_LIFE_CO_OVERRIDES: readonly LenderLoanType[] = ["bank", "life_company", "dscr", "fix_flip", "private_money"];

// Directory note structure (research_notes/Wholesale lender directory/gen_seed_sql.py).
export const DESKS_SEGMENT = "\\| Desks: ([^|]*)";
export const DIRECTORY_SEGMENTS = "\\| (Desks|Website|Broker page|Phone|HQ|Footprint|Lends in CA|Licences \\(unverified\\)|Parent / AKA): [^|]*";
export const DIRECTORY_PREAMBLE = "^From the wholesale lender directory[^|]*";
export const BOX_PROGRAMS_SEGMENT = "Programs \\(as published\\): ([^|]*)";

const W = "[^a-z0-9]"; // word edge; the corpus is padded with spaces

/** Applied in order (global, case-insensitive), each match replaced by one space. */
export const LOAN_TYPE_CLEANUPS: readonly { id: string; pattern: string }[] = [
  { id: "url", pattern: "https?://[^ |]*" },
  { id: "bank_statement", pattern: "bank[ -]statements?" },
  { id: "negated_parenthetical", pattern: "\\((no|not|excl[a-z]*|except|excluding|without)[^a-z0-9][^)|]*\\)?" },
  { id: "negated_word", pattern: `${W}(no|non|not|excluding|excludes|except|without)[ -]+(ground[ -]?up|construction|land|mezz[a-z]*|bridge|hotels?|hospitality|dscr|sba|c-?pace|fix[ -]*(&|and|n|/)?[ -]*flips?)` },
  { id: "takeout_target", pattern: `${W}to[ -](hud|fha|agency|fannie|freddie|sba|perm[a-z]*)${W}` },
  { id: "takeout_named", pattern: "(hud|fha|agency)[^,;|()]*(exit|take[ -]?outs?)|bridge[ -](hud|fha)" },
  { id: "cmbs_investor", pattern: "cmbs[ -](b[ -]pieces?|investments?|bonds?|securities)|cmbs \\([^)|]*securities[^)|]*\\)" },
  { id: "affiliate", pattern: "(held|owned|funded|originated) by [^,;|()]*" },
  { id: "dscr_minimum", pattern: "(min|minimum|max|maximum)[ .:]*dscr" },
  { id: "dscr_ratio_after", pattern: "dscr[ :]*(of|>=?|at least)?[ :]*[0-9]+\\.[0-9]+" },
  { id: "dscr_ratio_before", pattern: "[0-9]+\\.[0-9]+ ?x?[ ]*(min[a-z]*[ ]*)?dscr" },
];

/** One case-insensitive rule per type, tested against the cleaned corpus. */
export const LOAN_TYPE_KEYWORD_RULES: readonly { loanType: LenderLoanType; pattern: string }[] = [
  { loanType: "construction", pattern: `construction|ground[ -]?up|${W}land${W}|horizontal development|build[ -]?(to|for)[ -]?rent|${W}btr${W}|spec (home|homes|build|builds|sfr)` },
  { loanType: "bridge", pattern: "bridge|transitional|value[ -]add|lease[ -]up" },
  { loanType: "private_money", pattern: `hard[ -]?money|private[ -]money|private[ -]lend|asset[ -]based|equity[ -]based|trust deeds?|${W}(1st|2nd|first|second)[ -](td|tds)${W}` },
  { loanType: "fix_flip", pattern: `fix[ -]*(&|and|n|/)?[ -]*flip|${W}flip(s|per|pers|ping)?${W}|${W}f&f${W}|${W}rtl${W}|residential transition` },
  { loanType: "dscr", pattern: `${W}dscr${W}|long[ -]term rentals?|rental[ -](loan|loans|portfolio|portfolios|program|programs|term|take[ -]?outs?)|to[ -]rental|single[ -]family rentals?|${W}sfr[ -]?(1-4[ -]?)?rentals?|investor rental|${W}no[ -]ratio` },
  { loanType: "sba", pattern: `${W}sba${W}|${W}7 ?\\(a\\)|${W}cdc${W}|${W}504 (loan|loans|program|cdc|first)` },
  { loanType: "hud_fha", pattern: `${W}(hud|fha)${W}|22[13] ?\\([adf]\\)|section 232|lean 232` },
  { loanType: "agency", pattern: `fannie|freddie|${W}(dus|optigo|gse)${W}|agency (multifamily|lending|lender|lenders|loan|loans|mf|small[ -]balance|sbl)` },
  { loanType: "cmbs", pattern: `${W}cmbs${W}|conduit|${W}sasb${W}` },
  { loanType: "bank", pattern: `${W}banks?${W}|credit unions?|${W}thrifts?${W}|savings (and loan|association|bank)` },
  { loanType: "life_company", pattern: `life[ -](insurance|insurer|compan|cos?${W})|insurance compan|${W}insurers?${W}` },
  { loanType: "mezz_pref", pattern: `mezz|pref(erred)?[ -]*equity|${W}pref${W}|subordinate|gap financing|junior (debt|loan|loans|lien|liens)` },
  { loanType: "c_pace", pattern: `c-?pace|property[ -]assessed|${W}pace (financ|loan|lend|fund|program)` },
  { loanType: "hotel", pattern: `hotel|hospitality|motel|lodging|${W}pip${W}|flag[ -]change` },
];

const CLEANUP_RES = LOAN_TYPE_CLEANUPS.map((c) => new RegExp(c.pattern, "gi"));
const RULE_RES = LOAN_TYPE_KEYWORD_RULES.map((r) => ({ loanType: r.loanType, re: new RegExp(r.pattern, "i") }));

// --- Derivation -------------------------------------------------------------------------------------

export type LoanTypeSource = {
  programs: readonly DealProgram[];
  category: LenderCategory | null;
  appetiteNotes: string | null;
  assetTypes: readonly string[];
  /** The lender's credit-box notes, in box id order (only their "Programs (as published)" part is read). */
  boxNotes: readonly (string | null)[];
};

/** Desk subcategory labels from a directory row's "| Desks: ..." segment, in order. */
export function deskLabels(notes: string | null): string[] {
  const m = new RegExp(DESKS_SEGMENT).exec(notes ?? "");
  if (!m) return [];
  return m[1]!
    .split(";")
    .map((d) => d.replace(/^ +| +$/g, "").replace(/^[A-Z]+-[0-9]+ /, "").replace(/ \(tier [^)]*\)$/, ""))
    .filter((d) => d !== "");
}

/** The cleaned text the keyword rules read (exported for tests and the parity check). */
export function loanTypeCorpus(src: LoanTypeSource): string {
  const notes = (src.appetiteNotes ?? "").replace(new RegExp(DIRECTORY_SEGMENTS, "g"), " ").replace(new RegExp(DIRECTORY_PREAMBLE), " ");
  const unmapped = deskLabels(src.appetiteNotes).filter((d) => !Object.hasOwn(DESK_LOAN_TYPES, d));
  const boxes = src.boxNotes.flatMap((n) => {
    const seg = n === null ? undefined : new RegExp(BOX_PROGRAMS_SEGMENT).exec(n)?.[1];
    return seg === undefined ? [] : [seg];
  });
  let corpus = ` ${notes} | ${unmapped.join(" | ")} | ${src.assetTypes.join(", ")} | ${boxes.join(" | ")} `;
  for (const re of CLEANUP_RES) corpus = corpus.replace(re, " ");
  return corpus;
}

export type LoanTypeReason =
  | { kind: "program"; program: DealProgram }
  | { kind: "desk"; desk: string }
  | { kind: "keyword"; excerpt: string }
  | { kind: "category"; category: LenderCategory }
  | { kind: "bank_life_co" };

/** Each derived type with why it was derived (detail page "Why these suggestions"). */
export function explainLenderLoanTypes(src: LoanTypeSource): Map<LenderLoanType, LoanTypeReason[]> {
  const out = new Map<LenderLoanType, LoanTypeReason[]>();
  const add = (t: LenderLoanType, r: LoanTypeReason) => out.set(t, [...(out.get(t) ?? []), r]);
  for (const p of src.programs) for (const t of PROGRAM_LOAN_TYPES[p] ?? []) add(t, { kind: "program", program: p });
  for (const d of deskLabels(src.appetiteNotes)) for (const t of Object.hasOwn(DESK_LOAN_TYPES, d) ? DESK_LOAN_TYPES[d]! : []) add(t, { kind: "desk", desk: d });
  const corpus = loanTypeCorpus(src);
  for (const { loanType, re } of RULE_RES) {
    const m = re.exec(corpus);
    if (m) add(loanType, { kind: "keyword", excerpt: corpus.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30).replace(/\s+/g, " ").trim() });
  }
  const cat = src.category ? CATEGORY_LOAN_TYPES[src.category] : undefined;
  if (cat && src.category) add(cat, { kind: "category", category: src.category });
  if (src.programs.includes("BANK_LIFE_CO") && !BANK_LIFE_CO_OVERRIDES.some((t) => out.has(t))) add("bank", { kind: "bank_life_co" });
  return out;
}

/** Suggested loan types for a lender, canonical order. Mirrors public.derive_lender_loan_types(). */
export function deriveLenderLoanTypes(src: LoanTypeSource): LenderLoanType[] {
  return sortLoanTypes(explainLenderLoanTypes(src).keys());
}
