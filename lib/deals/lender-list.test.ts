// Lender panel list model (lib/deals/lender-list.ts): the URL query, filters,
// search, sort, disjunctive facet counts, paging and the links the page renders.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LENDER_LIST_QUERY,
  appliedFilters,
  caStatus,
  cleanSearch,
  emptyStateSuggestions,
  filterLenders,
  lenderListHref,
  lenderListView,
  loanTypeCounts,
  loanTypeFacet,
  normalizeForSearch,
  parseAmount,
  parseLenderListQuery,
  serializeLenderListQuery,
  sortLenders,
  type LenderListQuery,
  type LenderListRow,
} from "./lender-list";
import { panelForDeal } from "./lenders";
import { lenderLoanTypes, sortLoanTypes, type LenderLoanType } from "./loan-types";
import { lenderInput, toPanelEntry } from "./test-fixtures";

let seq = 0;
function row(over: Partial<LenderListRow> = {}): LenderListRow {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    name: `Lender ${seq}`,
    loanTypes: [],
    active: true,
    states: [],
    assetTypes: [],
    appetiteNotes: null,
    minLoanCents: null,
    maxLoanCents: null,
    verifiedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    contactEmail: null,
    mainPhone: null,
    primaryContactName: null,
    ...over,
  };
}
const q = (over: Partial<LenderListQuery> = {}): LenderListQuery => ({ ...DEFAULT_LENDER_LIST_QUERY, ...over });
const names = (rows: readonly LenderListRow[]) => rows.map((r) => r.name);
const M = 100_000_000; // $1M in cents

describe("parseLenderListQuery", () => {
  it("reads repeated and comma-separated types, ignores unknown values and never throws", () => {
    const parsed = parseLenderListQuery(new URLSearchParams("type=dscr&type=bogus&type=Construction,bridge&match=all&q=&amount=2.5m&sort=max_loan&page=0&ca=on"));
    expect(parsed).toEqual({ types: ["construction", "bridge", "dscr"], match: "all", q: "", sort: "max_loan", activeOnly: false, lendsInCa: true, hasContact: false, amountCents: 250_000_000, page: 1 });
  });

  it("takes the first value of a record input, and falls back on bad sorts and pages", () => {
    expect(parseLenderListQuery({ q: ["a", "b"] }).q).toBe("a");
    expect(parseLenderListQuery({ sort: "price" }).sort).toBe("name");
    expect(parseLenderListQuery({ page: "1001" }).page).toBe(1);
    expect(parseLenderListQuery({ page: "2.5" }).page).toBe(1);
    expect(parseLenderListQuery({ page: "3" }).page).toBe(3);
    expect(parseLenderListQuery({})).toEqual(DEFAULT_LENDER_LIST_QUERY);
    expect(parseLenderListQuery(new URLSearchParams("q=&match=any&sort=name&active=on"))).toEqual({ ...DEFAULT_LENDER_LIST_QUERY, activeOnly: true });
  });
});

describe("parseAmount", () => {
  it("reads dollars with commas, suffixes and cents", () => {
    expect(parseAmount("2,500,000")).toBe(250_000_000);
    expect(parseAmount("$2.5m")).toBe(250_000_000);
    expect(parseAmount("750k")).toBe(75_000_000);
    expect(parseAmount("1200000.50")).toBe(120_000_050);
  });

  it("refuses junk, zero, bad grouping and amounts over $10B", () => {
    for (const v of ["abc", "0", "1,23", "99999999999", "", "-5"]) expect(parseAmount(v), v).toBeNull();
  });
});

describe("search text", () => {
  it("cleans and caps the search, and normalizes for word-start matching", () => {
    expect(cleanSearch("  Ari‮xa \u0000 capital  ")).toBe("Arixa capital");
    expect(cleanSearch("x".repeat(200))).toHaveLength(80);
    expect(normalizeForSearch("Café & Co.")).toBe("cafe and co");
  });
});

describe("serializeLenderListQuery", () => {
  it("is empty for the default query and canonical otherwise", () => {
    expect(serializeLenderListQuery(DEFAULT_LENDER_LIST_QUERY)).toBe("");
    const parsed = parseLenderListQuery(new URLSearchParams("type=dscr&type=bogus&type=Construction,bridge&match=all&q=&amount=2.5m&sort=max_loan&page=0&ca=on"));
    expect(serializeLenderListQuery(parsed)).toBe("?type=construction&type=bridge&type=dscr&match=all&amount=2500000&ca=1&sort=max_loan");
    expect(serializeLenderListQuery(q({ types: ["dscr"], match: "all" }))).toBe("?type=dscr");
  });

  it("round-trips canonical queries", () => {
    const queries: LenderListQuery[] = [
      q(),
      q({ types: ["dscr"] }),
      q({ types: ["construction", "bridge"], match: "all" }),
      q({ types: [...lenderLoanTypes] }),
      q({ q: "arixa" }),
      q({ q: "fix & flip lender" }),
      q({ amountCents: 250_000_000 }),
      q({ amountCents: 100 }),
      q({ lendsInCa: true }),
      q({ hasContact: true }),
      q({ activeOnly: true }),
      q({ sort: "max_loan" }),
      q({ sort: "min_loan", page: 2 }),
      q({ sort: "verified" }),
      q({ sort: "added", page: 1000 }),
      q({ types: ["sba", "hotel"], match: "all", q: "504", amountCents: 500_000_000, lendsInCa: true, hasContact: true, activeOnly: true, sort: "added", page: 3 }),
      q({ types: ["c_pace"], page: 7 }),
      q({ types: ["life_company", "mezz_pref"], match: "any" }),
      q({ q: "Café" }),
      q({ types: ["fix_flip", "dscr"], match: "all", lendsInCa: true }),
    ];
    expect(queries).toHaveLength(20);
    for (const query of queries) expect(parseLenderListQuery(new URLSearchParams(serializeLenderListQuery(query).slice(1)))).toEqual(query);
  });

  it("resets to page 1 on any change unless the patch sets a page", () => {
    const base = q({ types: ["dscr"], page: 4 });
    expect(lenderListHref(base, { page: 3 })).toBe("/deals/lenders?type=dscr&page=3");
    expect(lenderListHref(base, { activeOnly: true })).toBe("/deals/lenders?type=dscr&active=1");
    expect(lenderListHref(base, {}, "/lenders")).toBe("/lenders?type=dscr");
  });
});

describe("caStatus", () => {
  it("lets listed states decide, then the directory note", () => {
    expect(caStatus({ states: ["CA"], appetiteNotes: null })).toBe("yes");
    expect(caStatus({ states: ["NV"], appetiteNotes: null })).toBe("no");
    expect(caStatus({ states: [], appetiteNotes: null })).toBe("yes");
    expect(caStatus({ states: [], appetiteNotes: "x | Lends in CA: Unconfirmed" })).toBe("unconfirmed");
    expect(caStatus({ states: [], appetiteNotes: "x | Lends in CA: No" })).toBe("no");
    expect(caStatus({ states: [], appetiteNotes: "x | Lends in CA: Yes | HQ: y" })).toBe("yes");
  });
});

describe("filterLenders", () => {
  it("matches any or all selected loan types", () => {
    const rows = [row({ name: "A", loanTypes: ["bridge"] }), row({ name: "B", loanTypes: ["bridge", "dscr"] }), row({ name: "C", loanTypes: ["dscr"] }), row({ name: "D" })];
    expect(names(filterLenders(rows, q({ types: ["bridge", "dscr"] })))).toEqual(["A", "B", "C"]);
    expect(names(filterLenders(rows, q({ types: ["bridge", "dscr"], match: "all" })))).toEqual(["B"]);
    expect(names(filterLenders(rows, q()))).toEqual(["A", "B", "C", "D"]);
  });

  it("filters active, California-confirmed and reachable lenders", () => {
    const rows = [
      row({ name: "Active CA", states: ["CA"], contactEmail: "a@x.example" }),
      row({ name: "Inactive", active: false, mainPhone: "+13105550100" }),
      row({ name: "Unconfirmed", appetiteNotes: "| Lends in CA: Unconfirmed" }),
      row({ name: "Nevada", states: ["NV"] }),
    ];
    expect(names(filterLenders(rows, q({ activeOnly: true })))).toEqual(["Active CA", "Unconfirmed", "Nevada"]);
    expect(names(filterLenders(rows, q({ lendsInCa: true })))).toEqual(["Active CA", "Inactive"]);
    expect(names(filterLenders(rows, q({ hasContact: true })))).toEqual(["Active CA", "Inactive"]);
  });

  it("keeps lenders whose size covers the amount, and those with unknown bounds", () => {
    const rows = [
      row({ name: "Inside", minLoanCents: 1 * M, maxLoanCents: 5 * M }),
      row({ name: "Min too high", minLoanCents: 3 * M, maxLoanCents: 5 * M }),
      row({ name: "Max too low", minLoanCents: 0, maxLoanCents: 2 * M }),
      row({ name: "No min", minLoanCents: null, maxLoanCents: 5 * M }),
      row({ name: "No max", minLoanCents: 1 * M, maxLoanCents: null }),
      row({ name: "Unknown", minLoanCents: null, maxLoanCents: null }),
    ];
    expect(names(filterLenders(rows, q({ amountCents: 2.5 * M })))).toEqual(["Inside", "No min", "No max", "Unknown"]);
  });

  it("searches names, parents, desks, asset types, loan type labels and the primary contact at word starts", () => {
    const rows = [
      row({ name: "Arixa Capital" }),
      row({ name: "Kiavi", appetiteNotes: "x | Parent / AKA: Roc360 brand | y" }),
      row({ name: "Desk Lender", appetiteNotes: "From the wholesale lender directory. | Desks: SB-001 Small-balance commercial (SBC) (tier B, low confidence)" }),
      row({ name: "Hotel Shop", assetTypes: ["Hotel", "Motel"] }),
      row({ name: "Rental Co", loanTypes: ["dscr", "fix_flip"] }),
      row({ name: "People Bank", primaryContactName: "Dana Lee" }),
      row({ name: "FSBC Funding" }),
    ];
    const hit = (s: string) => names(filterLenders(rows, q({ q: s })));
    expect(hit("arixa")).toEqual(["Arixa Capital"]);
    expect(hit("roc360")).toEqual(["Kiavi"]);
    expect(hit("sbc")).toEqual(["Desk Lender"]);
    expect(hit("hotel")).toEqual(["Hotel Shop"]);
    expect(hit("dscr")).toEqual(["Rental Co"]);
    expect(hit("fix & flip")).toEqual(["Rental Co"]);
    expect(hit("dana")).toEqual(["People Bank"]);
    expect(hit("ixa")).toEqual([]);
    expect(hit("arixa capital")).toEqual(["Arixa Capital"]);
    expect(hit("arixa bank")).toEqual([]);
  });
});

describe("sortLenders", () => {
  const rows = [
    row({ id: "b", name: "beta", maxLoanCents: 5 * M, minLoanCents: 1 * M, verifiedAt: "2026-05-01T00:00:00Z", createdAt: "2026-03-01T00:00:00Z" }),
    row({ id: "a", name: "Alpha", maxLoanCents: null, minLoanCents: null, verifiedAt: null, createdAt: "2026-01-01T00:00:00Z" }),
    row({ id: "c", name: "Gamma", maxLoanCents: 9 * M, minLoanCents: 2 * M, verifiedAt: "2026-07-01T00:00:00Z", createdAt: "2026-02-01T00:00:00Z" }),
    row({ id: "d", name: "BETA", maxLoanCents: 5 * M, minLoanCents: 1 * M, verifiedAt: null, createdAt: "2026-03-01T00:00:00Z" }),
  ];
  it("sorts each way with unknowns last and ties by name, then id", () => {
    expect(sortLenders(rows, "name").map((r) => r.id)).toEqual(["a", "b", "d", "c"]);
    expect(sortLenders(rows, "max_loan").map((r) => r.id)).toEqual(["c", "b", "d", "a"]);
    expect(sortLenders(rows, "min_loan").map((r) => r.id)).toEqual(["b", "d", "c", "a"]);
    expect(sortLenders(rows, "verified").map((r) => r.id)).toEqual(["c", "b", "a", "d"]);
    expect(sortLenders(rows, "added").map((r) => r.id)).toEqual(["b", "d", "c", "a"]);
  });

  it("does not mutate its input", () => {
    const copy = [...rows];
    sortLenders(rows, "max_loan");
    expect(rows).toEqual(copy);
  });
});

describe("facet counts", () => {
  const rows = [
    row({ loanTypes: ["bridge", "dscr"], active: true }),
    row({ loanTypes: ["bridge"], active: true }),
    row({ loanTypes: ["dscr", "fix_flip"], active: false }),
    row({ loanTypes: ["construction"], active: true, states: ["NV"] }),
  ];

  it("in any mode ignore the type selection but apply every other filter", () => {
    const counts = loanTypeCounts(rows, q({ types: ["bridge"], activeOnly: true }));
    expect(counts.bridge).toBe(2);
    expect(counts.dscr).toBe(1);
    expect(counts.fix_flip).toBe(0);
    expect(counts.construction).toBe(1);
    expect(loanTypeCounts(rows, q({ lendsInCa: true })).construction).toBe(0);
  });

  it("in all mode give the result count if the type were added, and the total for a selected type", () => {
    const query = q({ types: ["bridge"], match: "all" });
    const counts = loanTypeCounts(rows, query);
    for (const t of lenderLoanTypes) expect(counts[t], t).toBe(filterLenders(rows, { ...query, types: sortLoanTypes([...query.types, t]) }).length);
    expect(counts.bridge).toBe(filterLenders(rows, query).length);
  });

  it("work the same for any rows with a custom typesOf (boxes linked to lenders)", () => {
    const typesByLender = new Map<string, LenderLoanType[]>([
      ["l1", ["sba", "hotel"]],
      ["l2", ["dscr"]],
    ]);
    const boxes = [{ lenderId: "l1" }, { lenderId: "l1" }, { lenderId: "l2" }, { lenderId: null }];
    const typesOf = (b: { lenderId: string | null }) => (b.lenderId ? (typesByLender.get(b.lenderId) ?? []) : []);
    const facet = loanTypeFacet(boxes, typesOf, { types: ["sba"], match: "any" });
    expect(facet.matched).toHaveLength(2);
    expect(facet.counts.sba).toBe(2);
    expect(facet.counts.dscr).toBe(1);
    expect(facet.counts.bridge).toBe(0);
    const all = loanTypeFacet(boxes, typesOf, { types: ["sba"], match: "all" });
    expect(all.counts.hotel).toBe(2);
    expect(all.counts.dscr).toBe(0);
  });
});

describe("matcher unchanged", () => {
  it("panelForDeal ignores loan types", () => {
    const now = new Date("2026-11-03T00:00:00Z");
    const lenders = [
      toPanelEntry(lenderInput({ name: "Alpha" }), "l1"),
      toPanelEntry(lenderInput({ name: "Beta", programs: ["HARD_MONEY"] }), "l2"),
      toPanelEntry(lenderInput({ name: "Gamma", maxLoanCents: 100 }), "l3"),
    ];
    const deal = { program: "HUD_232" as const, loanAmountCents: 1_250_000_000, propertyState: "CA" };
    const base = panelForDeal(lenders, deal, now);
    expect(panelForDeal(lenders.map((l) => ({ ...l, loanTypes: [] })), deal, now).map((m) => m.lender.id)).toEqual(base.map((m) => m.lender.id));
    expect(panelForDeal(lenders.map((l) => ({ ...l, loanTypes: [...lenderLoanTypes] })), deal, now).map((m) => m.lender.id)).toEqual(base.map((m) => m.lender.id));
  });
});

describe("lenderListView", () => {
  const many = Array.from({ length: 120 }, (_, i) => row({ name: `Lender ${String(i + 1).padStart(3, "0")}` }));

  it("pages by 50 and clamps to the last page", () => {
    const p3 = lenderListView(many, q({ page: 3 }));
    expect(p3).toMatchObject({ page: 3, pages: 3, from: 101, to: 120, total: 120, panelTotal: 120 });
    expect(p3.rows).toHaveLength(20);
    expect(lenderListView(many, q({ page: 9 })).page).toBe(3);
  });

  it("reports an empty result and the unfiltered panel size", () => {
    const empty = lenderListView(many, q({ types: ["c_pace"] }));
    expect(empty).toMatchObject({ from: 0, to: 0, pages: 1, total: 0, panelTotal: 120 });
  });
});

describe("applied filters and empty-state suggestions", () => {
  const full = q({ types: ["construction", "bridge", "dscr"], match: "all", q: "fund", amountCents: 250_000_000, lendsInCa: true, hasContact: true, activeOnly: true, page: 3 });
  const parse = (href: string) => parseLenderListQuery(new URLSearchParams(href.split("?")[1] ?? ""));

  it("removes one filter per link and goes back to page 1", () => {
    const links = appliedFilters(full);
    expect(links.map((l) => l.key)).toEqual(["type:construction", "type:bridge", "type:dscr", "match", "q", "amount", "ca", "contact", "active"]);
    const expectOnly = (href: string, patch: Partial<LenderListQuery>) => expect(parse(href)).toEqual({ ...full, page: 1, ...patch });
    expectOnly(links[0]!.href, { types: ["bridge", "dscr"] });
    expectOnly(links[1]!.href, { types: ["construction", "dscr"] });
    expectOnly(links[2]!.href, { types: ["construction", "bridge"] });
    expectOnly(links[3]!.href, { match: "any" });
    expectOnly(links[4]!.href, { q: "" });
    expectOnly(links[5]!.href, { amountCents: null });
    expectOnly(links[6]!.href, { lendsInCa: false });
    expectOnly(links[7]!.href, { hasContact: false });
    expectOnly(links[8]!.href, { activeOnly: false });
    expect(links[5]!.label).toMatch(/^Fits a \$2,500,000/);
    // With two types left, "match all" still applies; with one, the canonical link drops it.
    expect(parse(appliedFilters(q({ types: ["bridge", "dscr"], match: "all" }))[0]!.href)).toEqual(q({ types: ["dscr"] }));
  });

  it("offers relaxations in order and always ends with Clear all filters", () => {
    const s = emptyStateSuggestions(full);
    expect(s.map((l) => l.key)).toEqual(["match", "active", "ca", "contact", "amount", "q", "types", "all"]);
    expect(s.at(-1)).toEqual({ key: "all", label: "Clear all filters", href: "/deals/lenders" });
    expect(parse(s.find((l) => l.key === "types")!.href)).toEqual({ ...full, page: 1, types: [], match: "any" });
    expect(emptyStateSuggestions(q())).toEqual([{ key: "all", label: "Clear all filters", href: "/deals/lenders" }]);
  });

  it("uses the base path it is given", () => {
    expect(appliedFilters(q({ types: ["sba"] }), "/lenders")[0]!.href).toBe("/lenders");
    expect(emptyStateSuggestions(q({ types: ["sba"] }), "/lenders").at(-1)!.href).toBe("/lenders");
  });
});
