"""Write the markdown summary for the lender directory from the finished workbook.

Usage: python3 gen_report.py <directory.xlsx> <out.md> <xlsx name as linked from the md> <research folder>
"""
import sys
from collections import Counter, OrderedDict

from openpyxl import load_workbook

import glob, json, os
XLSX, OUT, LINK, RESEARCH = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
vres = [v for f in sorted(glob.glob(os.path.join(RESEARCH, "**", "verify_out_*.json"), recursive=True)) for v in json.load(open(f))["results"]]
vcount = Counter(v.get("verdict") for v in vres)
wb = load_workbook(XLSX, data_only=True)
ws = wb["Lenders"]
hdr = [c.value for c in ws[1]]
ix = {h: i for i, h in enumerate(hdr)}
rows = [r for r in ws.iter_rows(min_row=2, values_only=True) if r[0]]
excluded = wb["Excluded & Watchlist"].max_row - 1
n_sources = wb["Sources"].max_row - 1

def g(r, h):
    v = r[ix[h]]
    return "" if v is None else v

CATS_ORDER = ["Construction", "Hard Money / Bridge", "Senior Living / Healthcare", "Multifamily", "Hospitality",
              "Institutional / Capital Markets", "Bank / SBA"]
CATS = [c for c in CATS_ORDER if any(g(r, "Category") == c for r in rows)]
tier = Counter((g(r, "Category"), g(r, "Tier")) for r in rows)
ca = Counter(g(r, "Category") for r in rows if g(r, "Lends in CA") == "Yes")
signup = Counter(g(r, "Category") for r in rows if g(r, "Broker sign-up / broker page"))
conf = Counter(g(r, "Confidence") for r in rows)
existing = [r for r in rows if g(r, "Existing Corin relationship") == "Yes"]
rechecked = [r for r in rows if g(r, "Second check")]
qa = Counter(str(g(r, "Second check")).split(" ")[0] for r in rechecked)
# distinct firms: rows linked through "Same lender, other desk" count once
parent = {g(r, "ID"): g(r, "ID") for r in rows}
def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x
for r in rows:
    for o in str(g(r, "Same lender, other desk") or "").split(","):
        o = o.strip()
        if o in parent:
            parent[find(o)] = find(g(r, "ID"))
unique = len({find(i) for i in parent})

def esc(s):
    return str(s).replace("|", "/").replace("\n", " ").strip()

def short(s, n=160):
    s = esc(s)
    if len(s) <= n:
        return s
    cut = s[:n].rsplit(" ", 1)[0].rstrip(",;:.")
    return cut + "…"

L = []
L.append("# Wholesale lender directory: construction, hard money and senior living\n")
L.append(
    f"Corin Commercial now has a working list of **{len(rows)} lender desks** ({unique} distinct lenders) it can approach "
    f"for broker accounts, in [`{LINK}`](./{LINK.replace(' ', '%20')}). "
    f"{sum(tier[(c, 'A')] for c in CATS)} are Tier A: the lender documents a broker channel (a broker page, portal or fee-protection "
    "statement, or for debt funds and banks, recent loans an outside intermediary arranged), lends in California, and the product fits. Each row carries loan size, leverage, rate, term, recourse, speed, the broker program, the sign-up "
    "link, phone, email, a publicly listed contact, licences, a fit note, a confidence grade and its sources. Yellow columns on "
    "the right are an outreach tracker, and the Dashboard counts progress by category and status. "
    f"{len(existing)} rows are lenders already in Corin's routing table (`lib/ai/lenders.ts`) and start as \"Existing relationship\".\n"
)
L.append(
    "**Read this first:** the research environment could not open lender websites (the network policy blocked them), so every "
    "value comes from search-engine extracts of the lenders' own pages and trade press, not from pages opened directly. "
    f"Confidence is graded on that basis: {conf.get('High', 0)} High, {conf.get('Medium', 0)} Medium, {conf.get('Low', 0)} Low. "
    f"A second, independent pass re-checked every Tier A lender ({len(vres)} checks: {vcount.get('verified', 0)} verified, "
    f"{vcount.get('corrected', 0)} corrected, {vcount.get('flag', 0)} flagged for something to confirm on the first call). "
    "Its corrections are applied and its finding is in the \"Second check\" column; flagged lenders that lost their contact "
    "route or California evidence were moved down to Tier B. Confirm phone numbers, contacts and current terms on first contact.\n"
)

L.append("## What is in the list\n")
L.append("| Category | Tier A | Tier B | Tier C | Total | Lends in CA (Yes) | Has broker sign-up link |")
L.append("|---|---:|---:|---:|---:|---:|---:|")
for c in CATS:
    tot = sum(tier[(c, t)] for t in "ABC")
    L.append(f"| {c} | {tier[(c, 'A')]} | {tier[(c, 'B')]} | {tier[(c, 'C')]} | {tot} | {ca[c]} | {signup[c]} |")
L.append(
    f"| **Total** | **{sum(tier[(c, 'A')] for c in CATS)}** | **{sum(tier[(c, 'B')] for c in CATS)}** | "
    f"**{sum(tier[(c, 'C')] for c in CATS)}** | **{len(rows)}** | **{sum(ca.values())}** | **{sum(signup.values())}** |\n"
)
L.append(
    "A lender with more than one relevant desk (for example Greystone's HUD 232 group and its bridge group) has one row per "
    "desk, linked through the \"Same lender, other desk\" column. "
    f"{excluded} lenders that were researched and left out (acquired, wound down, no broker channel, outside the three "
    f"categories, or unverifiable) are on the Excluded & Watchlist sheet with the reason. The Sources sheet lists all {n_sources} URLs.\n"
)

L.append("## Where to start: Tier A by segment\n")
subs = OrderedDict()
for r in rows:
    if g(r, "Tier") == "A":
        subs.setdefault((g(r, "Category"), g(r, "Subcategory")), []).append(r)
for (cat, sub), rs in subs.items():
    L.append(f"**{cat}: {sub}**\n")
    L.append("| ID | Lender | Size | Broker channel | Contact route |")
    L.append("|---|---|---|---|---|")
    for r in rs:
        lo, hi = g(r, "Min loan ($)"), g(r, "Max loan ($)")
        size = ""
        if lo or hi:
            f = lambda v: (f"${v/1e6:,.1f}M".replace(".0M", "M") if v >= 1e6 else f"${v/1e3:,.0f}K") if v else "?"
            size = f"{f(lo)}–{f(hi)}"
        route = g(r, "Broker sign-up / broker page") or g(r, "Website")
        route = f"[link]({route})" if route else ""
        phone = esc(g(r, "Phone"))
        if phone:
            route = (route + " · " if route else "") + short(phone, 40)
        name = esc(g(r, "Lender")) + (" *(existing)*" if g(r, "Existing Corin relationship") == "Yes" else "")
        L.append(f"| {g(r, 'ID')} | {name} | {size} | {short(g(r, 'Broker program (how they work with / pay brokers)'), 150)} | {route} |")
    L.append("")

L.append("## How the research was done\n")
L.append(
    "Six research passes covered one segment each: HUD 232 and agency seniors housing; senior-living bridge, bank, construction "
    "and SBA; commercial construction debt funds and banks; wholesale investor lenders for ground-up and fix-and-flip; California "
    "private money; and national commercial bridge and hard money. A second pass worked through every name the first pass left "
    "unverified. Each record follows one schema (`research_notes/Wholesale lender directory/SCHEMA.md`), with a no-guessing rule: "
    "a blank cell means the value was not published, and phone numbers, emails, URLs and licence numbers appear only where a "
    "source showed them verbatim. Duplicate rows for the same lender were merged, conflicting findings were resolved in "
    "`overrides.json` with the reason recorded, and the workbook is rebuilt by `build_workbook.py` from those files.\n"
)
L.append("## Caveats\n")
L.append(
    "- **Search extracts, not page reads.** Lender sites were blocked from the research environment, so figures are as quoted "
    "in search results. Several lenders publish conflicting numbers across pages; the fit note says so where it was seen.\n"
    "- **Terms move.** Rates, leverage and minimums are a screen, not a quote. Get the current matrix from the lender.\n"
    "- **Banks and agency lenders rarely publish a broker program,** so most sit in Tier B or C. Debt funds that publish none "
    "but close loans an outside intermediary arranged can still be Tier A, and their broker-channel cell cites that deal. On "
    "HUD 232 loans an outside broker is typically paid out of the lender's own financing fee rather than as a separate charge; "
    "confirm the split with each lender.\n"
    "- **Contacts change.** Named contacts are people each lender lists publicly in an originations or broker role.\n"
    "- **Compliance.** The Account Setup sheet repeats this repo's counsel research on the MLDS (RE 882), table funding and the "
    "broker usury exemption. That research is not legal advice and a California attorney must confirm it.\n"
)
L.append("## Next steps\n")
L.append(
    "1. Filter the Lenders sheet to Tier A and Lends in CA = Yes, and start with the segments where Corin has live files.\n"
    "2. Send the Account Setup package with each broker application, using the email template on that sheet.\n"
    "3. Log each touch in the yellow tracker columns; the Dashboard rolls them up.\n"
    "4. The directory is already loaded into the staff backend by "
    "`supabase/migrations/20261105090000_int_lender_directory_seed.sql`: each firm is an inactive Lender panel entry "
    "(`/deals/lenders`) and each desk a pending-review credit box (`/lenders`), and existing relationships are left as they "
    "are. When an account opens, verify and approve its box, set the lender's category, evidence and fee split, and "
    "reactivate it. Add it to `LENDER_ROUTING` in `lib/ai/lenders.ts` too, which should stay aligned with signed "
    "correspondent and fee-protection agreements.\n"
    "5. To re-verify from lenders' own pages, allow lender domains under Network access in the environment settings and re-run "
    "the research passes; `build_workbook.py` rebuilds the workbook from the JSON.\n"
)
open(OUT, "w").write("\n".join(L))
print("wrote", OUT, len(L), "lines")
