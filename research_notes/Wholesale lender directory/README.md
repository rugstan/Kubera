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
| `second_check/verify_in_*.json`, `verify_out_*.json` | The Tier A rows as sent for an independent re-check, and the checker's findings and corrections |
| `overrides.json` | Decisions made while merging: rows dropped (with reason), field patches, and reconciliations between the two checkers |
| `build_workbook.py` | Builds the workbook from everything above |
| `gen_report.py` | Writes the markdown summary from the finished workbook |

Each JSON file has `lenders` and `excluded` lists. Some also carry the analyst's notes and any names left unresearched.

## How it was produced (2026-11-02)

Six research passes covered one segment each, and a second pass worked through the names the first left unverified. The research environment's network policy blocked lender websites, so every value comes from search-engine extracts of lender pages and trade press, not from pages opened directly. Confidence grades reflect that. A separate pair of checkers then re-verified every Tier A lender's activity in 2026, website, broker page, phone, contact and California lending. Their corrections apply in the build, and their finding shows in the workbook's "Second check" column.

The build merges duplicate rows for the same lender within a category. Senior living HUD/agency desks stay separate from bridge and bank desks. Rows are cross-referenced when the same lender appears under another category, and lenders already in `lib/ai/lenders.ts` are flagged as existing relationships.

## Loaded into the staff backend

`supabase/migrations/20261105070000_int_lender_directory_seed.sql` loads the directory into the staff backend when migrations are applied (`supabase db push`). `gen_seed_sql.py` generates it from the workbook.

- **Lender panel** (`/deals/lenders`): one row per firm, 188 in all. Every row is inactive and never verified, with category `UNKNOWN` (so the usury gate still applies) and no fee split. Each row holds the programs, loan size range, property types, contact and a research summary in its appetite notes.
- **Credit boxes** (`/lenders`): one box per lending desk, 212 in all. Each is `pending_review` and linked to its firm's panel row. Programs, asset classes and loan size are filled in, plus leverage, rate, recourse and lien position wherever the research stated them plainly. The full research text, including the second-check finding, is in the box notes.
- **Not loaded:** the 16 desks of lenders already in `lib/ai/lenders.ts`. Any firm already on the panel under the same name keeps its row; the new boxes attach to it.

To bring a lender live, open the account, then verify its appetite on the box review page and approve the box. Set the panel row's category (with its charter or licence evidence) and fee split, mark it verified and reactivate it. Approved boxes on active lenders are what the matcher ranks. `lib/agents/lenders/directory-seed.test.ts` checks the load against PGlite.

For a later refresh, rerun `gen_seed_sql.py` into a new migration file with a later timestamp; never edit the applied one. Existing rows are skipped, so a refresh only adds new lenders and desks.

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
