# Lender contact research (round 3, November 2026)

The directory seed loaded 374 lenders, but only 41 had a usable main phone, 26 an email and 55 a named contact, so the Lender panel showed "No email on file" for most of them. This round looks up each lender's public business contact details so a broker can call or email to open an account.

## What is here

| File | What it holds |
|---|---|
| `contacts.json` | One record per researched lender, keyed by its `lender_panel` id (or `ROUTED-nn` for the ten lenders in `lib/ai/lenders.ts`, which the seed left off the panel). Fields: website, main phone, general and submission inbox, broker page, HQ address, up to two named contacts, the source URL for each value, a confidence grade and notes. |
| `../gen_contacts_sql.py` | Writes the migration that loads `contacts.json` into the panel. |

Each record has `status`: `active`, `acquired_or_merged`, `closed` or `not_found`. Lenders not yet researched are simply absent; a later round adds them.

## How the values were found

Lender websites are blocked by the research environment's network policy, so each lookup is a web search restricted to the lender's own domain, which returns text from the lender's own pages. Press releases and official lists (NMLS, HUD, Fannie Mae, SBA) were the fallback. The rules:

- Only addresses and numbers a lender publishes. No email is ever built from a naming pattern.
- No data-broker or people-search sites (ZoomInfo, RocketReach, LeadIQ, Apollo, LinkedIn and the like).
- Business contacts in originations, broker relations or business development only. No personal mobiles, passwords, account numbers or bank details.
- Blank beats wrong: conflicts are described in `notes` and the field is left empty.

Confidence is `high` when the value is on the lender's own site, `medium` for a press release or official list.

## Loading it

`supabase/migrations/20261105150000_int_lender_contacts_research.sql` is generated from `contacts.json`:

```bash
python3 "research_notes/Wholesale lender directory/gen_contacts_sql.py" \
    supabase/migrations/20261105150000_int_lender_contacts_research.sql \
    "research_notes/Wholesale lender directory/research3_contacts/contacts.json"
```

It only fills blank fields and never overwrites anything a broker entered. Contacts arrive unverified, with their source URL in the contact's notes, and a new contact is primary only when the lender has none. Once that migration is applied, never edit it: load later rounds with a new migration with a later timestamp. The generator's checks keep it idempotent, so running it on rows it already filled changes nothing.

`lib/deals/lender-contacts-research-migration.test.ts` applies it on PGlite and checks the fill, the no-overwrite rule, the routed lenders, the audit redaction and idempotency.
