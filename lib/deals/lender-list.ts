// Lender panel list: the URL query model, filter, search, sort, facet counts and
// paging for /deals/lenders (and the loan-type filter on /lenders). Pure (no
// server-only), unit tested in lib/deals/lender-list.test.ts. ~400 lenders are
// filtered in memory after one listLenders() read: the facet counts need every
// row anyway. Revisit (server-side .overlaps("loan_types") plus a count RPC)
// past ~5,000 lenders.

import { formatCents } from "./money";
import { LENDER_LOAN_TYPE_LABELS, LENDER_LOAN_TYPE_SHORT_LABELS, deskLabels, isLenderLoanType, lenderLoanTypes, sortLoanTypes, type LenderLoanType } from "./loan-types";
import type { LenderPanelEntry } from "./types";

export const LENDER_SORTS = ["name", "max_loan", "min_loan", "verified", "added"] as const;
export type LenderSort = (typeof LENDER_SORTS)[number];
export const LENDER_SORT_LABELS: Record<LenderSort, string> = {
  name: "Name (A–Z)",
  max_loan: "Largest maximum loan",
  min_loan: "Smallest minimum loan",
  verified: "Recently verified",
  added: "Recently added",
};
export const LENDER_PAGE_SIZE = 50;
export const LENDER_SEARCH_MAX = 80;
const MAX_TOKENS = 8;
const MAX_AMOUNT_CENTS = 1_000_000_000_000; // $10B

export type LoanTypeMatch = "any" | "all";
export type LenderListQuery = {
  types: LenderLoanType[];
  match: LoanTypeMatch;
  q: string;
  sort: LenderSort;
  activeOnly: boolean;
  lendsInCa: boolean;
  hasContact: boolean;
  amountCents: number | null;
  page: number;
};
export const DEFAULT_LENDER_LIST_QUERY: LenderListQuery = { types: [], match: "any", q: "", sort: "name", activeOnly: false, lendsInCa: false, hasContact: false, amountCents: null, page: 1 };

/** The fields the list reads (contactEmail, mainPhone, primaryContactName come from spec.md's derived contacts). */
export type LenderListRow = Pick<
  LenderPanelEntry,
  "id" | "name" | "loanTypes" | "active" | "states" | "assetTypes" | "appetiteNotes" | "minLoanCents" | "maxLoanCents" | "verifiedAt" | "createdAt" | "contactEmail" | "mainPhone" | "primaryContactName"
>;

export type SearchInput = URLSearchParams | Record<string, string | string[] | undefined>;

function values(sp: SearchInput, k: string): string[] {
  if (sp instanceof URLSearchParams) return sp.getAll(k);
  const v = sp[k];
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}
const first = (sp: SearchInput, k: string) => values(sp, k)[0] ?? "";
const flag = (sp: SearchInput, k: string) => ["1", "on", "true"].includes(first(sp, k));

/** NFKC; zero-width and bidi controls removed, other control characters to spaces; collapsed; at most 80 characters. */
export function cleanSearch(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LENDER_SEARCH_MAX);
}

const AMOUNT_SCALES: Readonly<Record<string, number>> = { k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, mil: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9 };

/**
 * "2,500,000", "$2.5m", "$2.5MM" (the CRE shorthand), "2.5 million", "750k", "1200000.50" -> cents;
 * anything else (or 0, or over $10B) -> null.
 */
export function parseAmount(raw: string): number | null {
  const m = /^\$?\s*(\d{1,3}(?:,\d{3})+|\d{1,13})(?:\.(\d{1,6}))?\s*(k|thousand|mm|m|mil|million|bn|b|billion)?$/i.exec(raw.trim());
  if (!m) return null;
  const scale = m[3] ? AMOUNT_SCALES[m[3].toLowerCase()]! : 1;
  const cents = Math.round(Number(`${m[1]!.replace(/,/g, "")}.${m[2] ?? "0"}`) * scale * 100);
  return Number.isSafeInteger(cents) && cents > 0 && cents <= MAX_AMOUNT_CENTS ? cents : null;
}

/**
 * The loan amount the URL asked for when parseAmount cannot read it (cleaned, at
 * most 40 characters), so the page can say so and keep it in the field instead
 * of silently showing every size. Null when there is none or it was read.
 */
export function unreadAmount(sp: SearchInput): string | null {
  const original = first(sp, "amount");
  if (parseAmount(original) !== null) return null;
  return cleanSearch(original).slice(0, 40) || null;
}

/** Reads the query string. Unknown keys and values are ignored, never an error. */
export function parseLenderListQuery(sp: SearchInput): LenderListQuery {
  const types = sortLoanTypes(
    values(sp, "type")
      .flatMap((v) => v.split(","))
      .map((v) => v.trim().toLowerCase())
      .filter(isLenderLoanType),
  );
  const sort = first(sp, "sort");
  const page = Number(first(sp, "page"));
  return {
    types,
    match: first(sp, "match") === "all" ? "all" : "any",
    q: cleanSearch(first(sp, "q")),
    sort: (LENDER_SORTS as readonly string[]).includes(sort) ? (sort as LenderSort) : "name",
    activeOnly: flag(sp, "active"),
    lendsInCa: flag(sp, "ca"),
    hasContact: flag(sp, "contact"),
    amountCents: parseAmount(first(sp, "amount")),
    page: Number.isInteger(page) && page >= 1 && page <= 1000 ? page : 1,
  };
}

/** Canonical query string ("" or "?type=..."): fixed key order, defaults omitted, types in canonical order. */
export function serializeLenderListQuery(q: LenderListQuery): string {
  const p = new URLSearchParams();
  const types = sortLoanTypes(q.types);
  for (const t of types) p.append("type", t);
  if (q.match === "all" && types.length > 1) p.set("match", "all");
  if (q.q) p.set("q", q.q);
  if (q.amountCents !== null) p.set("amount", String(Math.round(q.amountCents / 100)));
  if (q.lendsInCa) p.set("ca", "1");
  if (q.hasContact) p.set("contact", "1");
  if (q.activeOnly) p.set("active", "1");
  if (q.sort !== "name") p.set("sort", q.sort);
  if (q.page > 1) p.set("page", String(q.page));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** A link to the list with `patch` applied; any change goes back to page 1 unless the patch sets a page. */
export function lenderListHref(q: LenderListQuery, patch: Partial<LenderListQuery> = {}, base = "/deals/lenders"): string {
  return base + serializeLenderListQuery({ ...q, page: 1, ...patch });
}

export type CaStatus = "yes" | "unconfirmed" | "no";

/** Listed states decide; empty states mean nationwide unless the directory note says "Lends in CA: Unconfirmed" / "No". */
export function caStatus(l: Pick<LenderPanelEntry, "states" | "appetiteNotes">): CaStatus {
  if (l.states.length) return l.states.includes("CA") ? "yes" : "no";
  const v = /\| Lends in CA: ([^|]*)/.exec(l.appetiteNotes ?? "")?.[1]?.trim().toLowerCase();
  if (v === undefined || v === "yes") return "yes";
  return v === "no" ? "no" : "unconfirmed";
}

/** A way to reach the lender: the submission recipient (primary contact or inbox) or the main phone. */
export function hasContactInfo(l: Pick<LenderPanelEntry, "contactEmail" | "mainPhone">): boolean {
  return Boolean(l.contactEmail || l.mainPhone);
}

export function normalizeForSearch(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Name, parent / AKA, directory desk labels, asset types, loan type labels and the primary
 * contact's name, normalized and padded with spaces so a token matches at a word start.
 */
export function lenderSearchText(l: LenderListRow): string {
  const aka = /\| Parent \/ AKA: ([^|]*)/.exec(l.appetiteNotes ?? "")?.[1] ?? "";
  const types = l.loanTypes.map((t) => `${LENDER_LOAN_TYPE_LABELS[t]} ${LENDER_LOAN_TYPE_SHORT_LABELS[t]}`);
  return ` ${normalizeForSearch([l.name, aka, ...deskLabels(l.appetiteNotes), ...l.assetTypes, ...types, l.primaryContactName ?? ""].join(" "))}`;
}

export function searchTokens(q: string): string[] {
  return normalizeForSearch(q).split(" ").filter(Boolean).slice(0, MAX_TOKENS);
}

/** Every token starts a word of `text` (a normalizeForSearch result with a leading space). */
export function matchesTokens(text: string, tokens: readonly string[]): boolean {
  return tokens.every((t) => text.includes(` ${t}`));
}

/** OR ("any") or AND ("all") over the selected types; no selection matches everything. */
export function matchesLoanTypes(have: readonly string[], want: readonly LenderLoanType[], match: LoanTypeMatch): boolean {
  if (!want.length) return true;
  return match === "all" ? want.every((t) => have.includes(t)) : want.some((t) => have.includes(t));
}

/** Every filter in the query (AND across filters). `ignoreTypes` is for the facet counts. */
export function filterLenders<T extends LenderListRow>(rows: readonly T[], q: LenderListQuery, opts: { ignoreTypes?: boolean } = {}): T[] {
  const tokens = searchTokens(q.q);
  const amt = q.amountCents;
  return rows.filter(
    (l) =>
      (opts.ignoreTypes || matchesLoanTypes(l.loanTypes, q.types, q.match)) &&
      (!q.activeOnly || l.active) &&
      (!q.lendsInCa || caStatus(l) === "yes") &&
      (!q.hasContact || hasContactInfo(l)) &&
      (amt === null || ((l.minLoanCents === null || l.minLoanCents <= amt) && (l.maxLoanCents === null || amt <= l.maxLoanCents))) &&
      (!tokens.length || matchesTokens(lenderSearchText(l), tokens)),
  );
}

const byName = (a: LenderListRow, b: LenderListRow) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const nullsLast = (a: number | null, b: number | null, dir: 1 | -1) => (a === null ? (b === null ? 0 : 1) : b === null ? -1 : (a - b) * dir);
const time = (iso: string | null) => (iso ? Date.parse(iso) : null);
const COMPARE: Record<LenderSort, (a: LenderListRow, b: LenderListRow) => number> = {
  name: byName,
  max_loan: (a, b) => nullsLast(a.maxLoanCents, b.maxLoanCents, -1) || byName(a, b),
  min_loan: (a, b) => nullsLast(a.minLoanCents, b.minLoanCents, 1) || byName(a, b),
  verified: (a, b) => nullsLast(time(a.verifiedAt), time(b.verifiedAt), -1) || byName(a, b),
  added: (a, b) => nullsLast(time(a.createdAt), time(b.createdAt), -1) || byName(a, b),
};

/** Unknown sizes and never-verified lenders sort last; ties go by name, then id. */
export function sortLenders<T extends LenderListRow>(rows: readonly T[], sort: LenderSort): T[] {
  return [...rows].sort(COMPARE[sort]);
}

/**
 * Chip counts. "any": lenders that pass every other filter and offer the type.
 * "all": the result count if that type were added to the selection (a selected type shows the current total).
 */
export function loanTypeCounts(rows: readonly LenderListRow[], q: LenderListQuery): Record<LenderLoanType, number> {
  return loanTypeFacet(filterLenders(rows, q, { ignoreTypes: true }), (l) => l.loanTypes, q).counts;
}

/** The loan-type filter and chip counts for any rows that carry loan types (/lenders uses the linked lender's). */
export function loanTypeFacet<T>(rows: readonly T[], typesOf: (row: T) => readonly string[], q: Pick<LenderListQuery, "types" | "match">): { matched: T[]; counts: Record<LenderLoanType, number> } {
  const counts = {} as Record<LenderLoanType, number>;
  for (const t of lenderLoanTypes) {
    const want = q.match === "all" ? sortLoanTypes([...q.types, t]) : [t];
    counts[t] = rows.filter((r) => matchesLoanTypes(typesOf(r), want, "all")).length;
  }
  return { matched: rows.filter((r) => matchesLoanTypes(typesOf(r), q.types, q.match)), counts };
}

export type LenderListView<T> = { rows: T[]; total: number; panelTotal: number; counts: Record<LenderLoanType, number>; page: number; pages: number; from: number; to: number };

export function lenderListView<T extends LenderListRow>(lenders: readonly T[], q: LenderListQuery, pageSize = LENDER_PAGE_SIZE): LenderListView<T> {
  const matched = sortLenders(filterLenders(lenders, q), q.sort);
  const pages = Math.max(1, Math.ceil(matched.length / pageSize));
  const page = Math.min(q.page, pages);
  const start = (page - 1) * pageSize;
  const rows = matched.slice(start, start + pageSize);
  return { rows, total: matched.length, panelTotal: lenders.length, counts: loanTypeCounts(lenders, q), page, pages, from: rows.length ? start + 1 : 0, to: start + rows.length };
}

export type FilterLink = { key: string; label: string; href: string };

/** One removable entry per active filter; each href drops only that filter. */
export function appliedFilters(q: LenderListQuery, base = "/deals/lenders"): FilterLink[] {
  const out: FilterLink[] = q.types.map((t) => ({ key: `type:${t}`, label: LENDER_LOAN_TYPE_LABELS[t], href: lenderListHref(q, { types: q.types.filter((x) => x !== t) }, base) }));
  if (q.match === "all" && q.types.length > 1) out.push({ key: "match", label: "Match all selected types", href: lenderListHref(q, { match: "any" }, base) });
  if (q.q) out.push({ key: "q", label: `Search “${q.q}”`, href: lenderListHref(q, { q: "" }, base) });
  if (q.amountCents !== null) out.push({ key: "amount", label: `Fits a ${formatCents(q.amountCents)} loan`, href: lenderListHref(q, { amountCents: null }, base) });
  if (q.lendsInCa) out.push({ key: "ca", label: "Lends in California", href: lenderListHref(q, { lendsInCa: false }, base) });
  if (q.hasContact) out.push({ key: "contact", label: "Has an email or phone", href: lenderListHref(q, { hasContact: false }, base) });
  if (q.activeOnly) out.push({ key: "active", label: "Active only", href: lenderListHref(q, { activeOnly: false }, base) });
  return out;
}

/** Ways out of an empty result, most likely first; always ends with "Clear all filters". */
export function emptyStateSuggestions(q: LenderListQuery, base = "/deals/lenders"): FilterLink[] {
  const out: FilterLink[] = [];
  if (q.match === "all" && q.types.length > 1) out.push({ key: "match", label: "Match any selected loan type instead", href: lenderListHref(q, { match: "any" }, base) });
  if (q.activeOnly) out.push({ key: "active", label: "Include inactive lenders", href: lenderListHref(q, { activeOnly: false }, base) });
  if (q.lendsInCa) out.push({ key: "ca", label: "Include lenders whose California lending is unconfirmed", href: lenderListHref(q, { lendsInCa: false }, base) });
  if (q.hasContact) out.push({ key: "contact", label: "Include lenders without contact info", href: lenderListHref(q, { hasContact: false }, base) });
  if (q.amountCents !== null) out.push({ key: "amount", label: "Any loan size", href: lenderListHref(q, { amountCents: null }, base) });
  if (q.q) out.push({ key: "q", label: "Clear the search", href: lenderListHref(q, { q: "" }, base) });
  if (q.types.length) out.push({ key: "types", label: "Any loan type", href: lenderListHref(q, { types: [], match: "any" }, base) });
  out.push({ key: "all", label: "Clear all filters", href: base });
  return out;
}
