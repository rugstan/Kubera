# Round 2 addendum (read after ../research/SCHEMA.md)

Round 2 looks for lenders that are NOT already in the directory. The list of every lender already
researched is in KNOWN_LENDERS.md next to this file. Do not add any name on it, any brand of the same
firm, or the same desk under a new name. If a known lender has a different desk that belongs in your
segment (for example a bank already listed for construction that also has an SBA hotel desk), you may add
that desk. Put "Other desk of <known name>" first in fit_notes.

Use the record schema, rubrics and hard rules from ../research/SCHEMA.md unchanged, except for these
category and subcategory values.

## Categories and subcategories for round 2

Use exactly one of these category / subcategory pairs. They map to the app's deal programs, so do not
invent new ones.

| category | subcategory |
|---|---|
| Multifamily | Agency multifamily (Fannie / Freddie) |
| Multifamily | HUD multifamily (221(d)(4) / 223(f)) |
| Multifamily | Multifamily bridge / value-add |
| Multifamily | Small-balance multifamily (5-50 units) |
| Multifamily | Multifamily bank / credit union |
| Hospitality | SBA hotel lender (7(a) / 504) |
| Hospitality | Hotel bridge / PIP |
| Hospitality | Hotel construction |
| Institutional / Capital Markets | Life insurance company |
| Institutional / Capital Markets | CMBS conduit |
| Institutional / Capital Markets | Mortgage REIT / large-balance debt fund |
| Institutional / Capital Markets | Hedge fund / private credit |
| Institutional / Capital Markets | Family office / private capital |
| Bank / SBA | Community bank / credit union CRE |
| Bank / SBA | SBA 504 CDC |
| Bank / SBA | SBA 7(a) lender |
| Construction | (round 1 values) CRE construction debt fund / private, CRE construction bank, Land / horizontal development, Construction mezz / pref equity / C-PACE, Investor ground-up (wholesale) |
| Hard Money / Bridge | (round 1 values) California private money, National commercial hard money, Commercial bridge / transitional, Small-balance commercial (SBC), Investor fix & flip / bridge (wholesale), Investor DSCR rental take-out (wholesale) |
| Senior Living / Healthcare | (round 1 values) HUD 232 / Agency (permanent & construction), Healthcare bridge / bridge-to-HUD, Healthcare bank / balance sheet, Senior housing construction, Healthcare mezz / pref equity, SBA / small care facility (RCFE, assisted living) |

## How institutional lenders work with brokers

Life companies, CMBS conduits, REITs and hedge funds rarely publish a "broker program". For them,
broker_program evidence means one of:
- a correspondent network they publish (a life company's list of correspondents, or "we work with mortgage bankers and brokers");
- an origination page that invites submissions from intermediaries;
- 2024-2026 deals announced as "arranged by <outside broker or mortgage banker>".

Life companies often take loans only through correspondents. Say so, name the correspondents if they are
published, and still give the life company's own real estate investment group contact. Tier these A only when
the lender takes deals directly from independent brokers or the evidence shows California deals arranged by
small or independent intermediaries.

## Search budget and saving

- Lender websites are blocked by the network policy, so do not call WebFetch. Use WebSearch only.
- Your brief gives your search cap. Stop at the cap.
- Write your JSON file after every 5 lenders, so nothing is lost if searches run out.
- At the end, add a "not_researched" list of the names you found but did not verify.
