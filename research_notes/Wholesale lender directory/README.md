# Wholesale lender directory: research files

Source data for `reports/Wholesale lender directory.xlsx` and its summary, `reports/Wholesale lender directory.md`.

## What is here

| Path | What it holds |
|---|---|
| `SCHEMA.md` | The record schema, tier and confidence rubrics, and no-guessing rules each research pass followed |
| `research/lenders_A_hud_agency_seniors.json` | Senior living: HUD 232 and Fannie Mae / Freddie Mac seniors housing lenders |
| `research/lenders_B_seniors_bridge_bank.json` | Senior living: bridge, bridge-to-HUD, bank, construction, mezzanine and SBA (RCFE / assisted living) |
| `research/lenders_C_cre_construction.json` | Construction: debt funds, banks, land, C-PACE |
| `research/lenders_D_investor_wholesale.json` | Wholesale investor lenders: ground-up, fix and flip, DSCR take-out |
| `research/lenders_E_california_private.json` | California private and hard money lenders |
| `research/lenders_F_national_bridge.json` | National commercial bridge, hard money, small-balance and hospitality bridge |
| `research2/SCHEMA_ADDENDUM.md` | Round 2's brief: the new categories and subcategories, and how institutional lenders count as broker-reachable |
| `research2/KNOWN_LENDERS.md` | The skip list round 2 checked against (round 1, plus wave 1 of round 2) |
| `research2/lenders_G_multifamily.json` | Round 2: Fannie / Freddie, HUD multifamily, bridge, small-balance and bank multifamily lenders |
| `research2/lenders_H_lifeco_cmbs.json` | Round 2: life insurance companies and CMBS conduits |
| `research2/lenders_I_hedge_reit.json` | Round 2: hedge funds, private credit, mortgage REITs and family offices |
| `research2/lenders_J_hospitality.json` | Round 2: SBA hotel lenders, hotel bridge / PIP and hotel construction |
| `research2/lenders_K_ca_banks_sba.json` | Round 2: California community banks and credit unions, SBA 504 CDCs and 7(a) lenders |
| `research2/lenders_L_construction_hm_gaps.json` | Round 2: construction and hard money lenders round 1 missed |
| `research2/lenders_M_senior_gaps.json` | Round 2: senior living lenders round 1 missed |
| `research2/lenders_N_wave1_followup.json` | Round 2: names wave 1 found but could not verify |
| `second_check/verify_in_*.json`, `verify_out_*.json` | The Tier A rows as sent for an independent re-check, and the checker's findings and corrections |
| `overrides.json` | Decisions made while merging: rows dropped (with reason), field patches, and reconciliations between the two checkers |
| `build_workbook.py` | Builds the workbook from everything above |
| `gen_report.py` | Writes the markdown summary from the finished workbook |
| `gen_seed_sql.py` | Writes a database migration that loads the workbook into the staff Lender panel and Credit boxes |

Each JSON file has `lenders` and `excluded` lists. Some also carry the analyst's notes and any names left unresearched.

## How it was produced

**Round 1 (2026-11-02):** six research passes covered one segment each, and a second pass worked through the names the first left unverified.

**Round 2 (2026-11-03):** eight more passes looked only for lenders not already listed. They covered multifamily; life insurance companies and CMBS; hedge funds, REITs and family offices; hospitality and SBA hotel lenders; California banks, credit unions and SBA lenders; construction and hard money gaps; senior living gaps; and a follow-up on unverified names. That added 206 lender desks in four new categories (Multifamily, Hospitality, Institutional / Capital Markets, Bank / SBA) plus the gaps. The workbook's "Added" column shows each row's round. When both rounds found the same lender in the same category, the round-1 row keeps its name and desk.

In both rounds, the research environment's network policy blocked lender websites, so every value comes from search-engine extracts of lender pages and trade press, not from pages opened directly. Confidence grades reflect that. Separate checkers then re-verified every Tier A lender's activity in 2026, website, broker page, phone, contact and California lending. Their corrections apply in the build, and their finding shows in the workbook's "Second check" column.

The build merges duplicate rows for the same lender within a category. Senior living HUD/agency desks stay separate from bridge and bank desks. Rows are cross-referenced when the same lender appears under another category, and lenders already in `lib/ai/lenders.ts` are flagged as existing relationships.

## Loaded into the staff backend

Two data migrations load the directory into the staff backend. On the VPS they are applied by hand, and they are generated from the workbook by `gen_seed_sql.py`:

- `supabase/migrations/20261105090000_int_lender_directory_seed.sql` (round 1, applied 2026-11-03): 188 firms and 212 credit boxes.
- `supabase/migrations/20261105100000_int_lender_directory_seed_round2.sql` (round 2): 186 new firms and 205 credit boxes. Eight of those boxes are new desks of round-1 firms, such as Live Oak Bank's hospitality team. The load was generated with `--after` the round-1 file and `--only-added "Round 2"`, so it only adds: no round-1 id or firm name is reused.

Both loads together give 374 firms and 417 credit boxes. Both follow the same rules:

- **Lender panel** (`/deals/lenders`): one row per firm. Every row is inactive and never verified, with category `UNKNOWN` (so the usury gate still applies) and no fee split. Each row holds the programs, loan size range, property types, contact and a research summary in its appetite notes.
- **Credit boxes** (`/lenders`): one box per lending desk. Each is `pending_review` and linked to its firm's panel row. Programs, asset classes and loan size are filled in, plus leverage, rate, recourse and lien position wherever the research stated them plainly. The full research text, including the second-check finding, is in the box notes.
- **Not loaded:** desks of lenders already in `lib/ai/lenders.ts` (16 in round 1, plus Waterfall Asset Management in round 2, which manages Ready Capital). Any firm already on the panel under the same name keeps its row; the new boxes attach to it.

To bring a lender live, open the account, then verify its appetite on the box review page and approve the box. Set the panel row's category (with its charter or licence evidence) and fee split, mark it verified and reactivate it. Approved boxes on active lenders are what the matcher ranks. `lib/agents/lenders/directory-seed.test.ts` checks the load against PGlite.

For a later round, put its files in a new `research3/` folder (the build tags rows by folder; extend `ROUND_LABEL` in `build_workbook.py`). Then rebuild and run `gen_seed_sql.py` into a new migration with a later timestamp, passing every earlier seed file with `--after` and the new round with `--only-added`. Never edit an applied migration.

## Rebuild

From the repo root:

```bash
python3 "research_notes/Wholesale lender directory/build_workbook.py" \
    "research_notes/Wholesale lender directory" "reports/Wholesale lender directory.xlsx"
# Open the workbook in Excel or LibreOffice and save it once, so the Dashboard formulas
# store their values (gen_report.py reads those stored values).
python3 "research_notes/Wholesale lender directory/gen_report.py" \
    "reports/Wholesale lender directory.xlsx" "reports/Wholesale lender directory.md" \
    "Wholesale lender directory.xlsx" "research_notes/Wholesale lender directory"
```

Rebuilding overwrites the workbook, including the outreach tracker columns. Once the desk starts logging outreach in the workbook, treat it as the record and edit it directly instead of rebuilding it.

## Re-verifying from lenders' own pages

Allow the lender domains under Network access in the cloud environment settings (https://code.claude.com/docs/en/cloud-environments#network-access). Then re-run the research passes with `SCHEMA.md` as the brief and rebuild.
