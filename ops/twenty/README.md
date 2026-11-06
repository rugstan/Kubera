# Twenty CRM fields written by the site

`fields.json` lists the custom fields the site fills in Twenty (crm.corincommercial.com):

- **Opportunity** (one per lead, from the 60-second qualifier at /express and the form on every /financing page):
  - where the lead came from: lead source, source page, and the site lead ID;
  - what the visitor entered: property type, transaction, timeline, notes, NOI, value, units, occupancy, and the hotel, hard money, construction and rental details;
  - the qualifier's match: primary and secondary program, lead tier, asset vertical, sizing flag, call right away, and recommended lenders.
- **Company** (one per partner registration at /partners):
  - partner type and site partner ID;
  - lender credit box: type, min and max loan, appetite, LTV/LTC, DSCR, debt yield, fee protection;
  - referral license; operator type and units; vendor services; markets served.

The privacy request form is not synced. Those requests stay in the compliance queue on the site.

## Changing a field

1. Edit `TWENTY_FIELDS` in `lib/crm/twenty-fields.ts`.
2. Run `npm run twenty:fields` to regenerate this file. The unit tests fail if the two differ.
3. Apply `fields.json` to the workspace with the CRM's schema script (`corin-schema.py --dry-run`, then `--apply`). Do this before deploying the release that writes the new field. Changes are additive: the script never deletes or renames a field.

If a release ships before step 3, nothing breaks. Leads and partners still reach Twenty with their note, the full record, and the server log says "the form fields … were refused; apply ops/twenty/fields.json". Applying the fields afterwards fills new records from then on.
