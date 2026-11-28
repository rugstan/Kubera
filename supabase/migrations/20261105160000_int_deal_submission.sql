-- Lender-ready deal submission: the structured facts a lender needs to screen,
-- quote and underwrite a deal, the sponsor summary, the locked one-page
-- summaries lenders were shown, and the readiness / email record on each
-- submission.
--
-- deal_submission_profiles  one per deal: loan request, property, value,
--                           financials, plan and exit, sources and uses,
--                           program sections (jsonb, validated by
--                           lib/deals/submission/schema.ts) and field sources
-- deal_sponsor_profiles     one per deal: sponsor experience and stated
--                           financial strength. Personal information: its audit
--                           rows keep who changed which column, never the values
-- deal_summaries            immutable summaries locked into a package version
-- lender_outreach           + target stage, summary, readiness, override reason,
--                           the approved email text and its hash
--
-- Broker only (Global rule 1): reserve and budget fields record what the
-- borrower asks the lender for. Nothing here holds, schedules or releases
-- money, and no column models construction advances (the no-custody guard
-- checks). Ratios (LTV, LTC, DSCR, debt yield) are computed in
-- lib/deals/submission/metrics.ts and are never stored as typed values.
-- RLS is enabled with no policies: only the service role reads or writes.

-- 0. Restricted identifiers in free text ------------------------------------------
-- The database twin of lib/deals/submission/redaction.ts RESTRICTED_TEXT_PATTERNS,
-- after the same normalization (normalizeForScan, then maskMoney): NFKC;
-- format characters (zero-width, bidi marks, soft hyphen, tags) removed; NEL
-- (U+0085) read as a space; every Unicode decimal digit that NFKC leaves alone
-- read as its ASCII digit; combining marks, variation selectors, CGJ and
-- Hangul fillers removed after a digit; lower case; and every money amount
-- (after "$", with comma thousands, or ending in cents) replaced by "$", so its
-- digit groups never start or join an identifier.
--
-- Always restricted: nine or more digits in a row (a 10 to 12 digit run right
-- after "loan", "loan #", "loan no." or "loan number" excepted); the SSN /
-- ITIN 3-2-4 shape (one to three separators that are not list punctuation, or
-- the same comma or colon on both sides, and with a space only when the last
-- group is not a year); the EIN 2-7 shape (dashes, spaces, dots or slashes
-- between); SSN / ITIN wording ("SSN", "SS#", "social security number",
-- "social security ... last four 6789"). Restricted in context only, so APNs,
-- unit lists, years, rents, money and phone numbers save: a 3-3-3 or 4-4-4
-- grouping right after an identity or account word (SSN, social security, tax
-- id, TIN, ITIN, EIN, account, acct, card, routing; only punctuation, "no.",
-- "number" or "is" between); birth wording followed by a full date (day and
-- month), or "year of birth" / "birth year" followed by a year; account
-- wording followed by an account number ("#", "no.", "number" or "ending" and
-- digits, a mask such as x4821, or six or more digits in a row; seven after
-- checking, savings and A/C), never by money, a year or a count.
--
-- Every value is checked on its own (submission_texts_restricted,
-- submission_json_restricted), as the app checks each field, so digit groups
-- in two neighbouring values never join into one shape.
--
-- The app refuses the same text first, with a message; these checks hold the
-- database to the rule. What only a direct database write (service role,
-- psql) could still get past, because Postgres regular expressions are not
-- JavaScript's:
--   * Combining marks after a digit are removed only from the main combining
--     blocks listed below (the app removes every \p{M}); other scripts' marks
--     still split a number here.
--   * [[:alnum:]], [[:space:]] and \y follow the database's character
--     classification, not Unicode \p{L} / \p{N} / \s and JavaScript's ASCII
--     \b. With the C collation they agree for letters, digits and NFKC's
--     spaces; another locale may count a few symbols differently.
--   * The decimal digits are the Unicode 16 list the app was built with; a
--     digit added to Unicode later reads as a letter here.
create or replace function public.submission_text_restricted(t text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    -- SSN / ITIN 3-2-4
    n.s ~ ('(?<![0-9])[0-9]{3}(' || p.ssn_sep || '[0-9]{2}' || p.ssn_sep
      || '|,[0-9]{2},|:[0-9]{2}:|;[0-9]{2};|(,[[:space:]]{1,2}[0-9]{2},|:[[:space:]]{1,2}[0-9]{2}:|;[[:space:]]{1,2}[0-9]{2};)[[:space:]]{1,2}(?!(19|20)[0-9]{2}(?![0-9])))[0-9]{4}(?![0-9])')
    -- 3-3-3 right after an identity or account word
    or n.s ~ (p.id_lead || '(?<![0-9])[0-9]{3}' || p.sep || '[0-9]{3}' || p.sep || '[0-9]{3}(?![0-9])')
    -- SSN / ITIN wording
    or n.s ~ '\y(ssns?|s\.[[:space:]]?s\.[[:space:]]?n|itins?|i\.[[:space:]]?t\.[[:space:]]?i\.[[:space:]]?n)\y|\yss[[:space:]]?#|\ysocial[[:space:]_.-]*security[[:space:]_.-]*(numbers?\y|nos?\y|#|cards?\y)|\ysoc\.?[[:space:]]?sec\y'
    or n.s ~ '\ysocial[[:space:]_.-]*security\y[^0-9]{0,25}(last|ending|ends)[^0-9]{0,12}[0-9]{4}'
    -- EIN 2-7
    or n.s ~ '(?<![0-9])[0-9]{2}[^[:alnum:],:;(){}\[\]]{1,3}[0-9]{7}(?![0-9])'
    -- nine or more digits in a row; a 10 to 12 digit loan number after "loan" excepted
    or n.s ~ '(?<![0-9])([0-9]{9}|[0-9]{13,})(?![0-9])'
    or n.s ~ '(?<!\yloan\y[^[:alnum:]]{0,4}((no|nos|number|num)\y[^[:alnum:]]{0,4})?)(?<![0-9])[0-9]{10,12}(?![0-9])'
    -- 4-4-4 (account, card) right after an identity or account word
    or n.s ~ (p.id_lead || '(?<![0-9])[0-9]{4}(' || p.sep || '[0-9]{4}){2,}(?![0-9])')
    -- birth wording followed by a full date; "year of birth" followed by a year
    or n.s ~ ('\y(d\.?[[:space:]]?o\.?[[:space:]]?b|date[[:space:]_.-]*of[[:space:]_.-]*birth|birth[[:space:]_.-]?(dates?|days?)|b-?day|born|birth)\y'
      || p.birth_gap
      || '(?<![0-9])([0-9]{1,2}[^[:alnum:]]{1,2}[0-9]{1,2}[^[:alnum:]]{1,2}[0-9]{2,4}|[0-9]{4}[^[:alnum:]][0-9]{1,2}[^[:alnum:]][0-9]{1,2}|'
      || p.month || '[[:space:]]+[0-9]{1,2}|[0-9]{1,2}(st|nd|rd|th)?[[:space:]]+(of[[:space:]]+)?' || p.month || ')(?![0-9])')
    or n.s ~ ('\y(year[[:space:]_.-]*of[[:space:]_.-]*birth|birth[[:space:]_.-]?year)\y' || p.birth_gap || '(19|20)[0-9]{2}(?![0-9])')
    -- account wording followed by an account number (never money, a year or a count)
    or n.s ~ ('\y(accounts?|acct|routing|iban|aba)\y[^[:alnum:]$]{0,6}(' || p.qualified || '|[x*•]+[0-9]{4}|[0-9]{6,}(?![0-9]|[.,][0-9]))')
    or n.s ~ ('\y(checking|savings|a/c)\y[^[:alnum:]$]{0,3}(' || p.qualified || '|[x*•]+[0-9]{4}|[0-9]{7,}(?![0-9]|[.,][0-9]))')
  from
    (select regexp_replace(lower(regexp_replace(
      -- Most text is plain ASCII: the 680-character digit translation runs only on text that holds anything else.
      case when a.s ~ '[^\u0001-\u007f]' then translate(
        a.s,
        '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹߀߁߂߃߄߅߆߇߈߉०१२३४५६७८९০১২৩৪৫৬৭৮৯੦੧੨੩੪੫੬੭੮੯૦૧૨૩૪૫૬૭૮૯୦୧୨୩୪୫୬୭୮୯௦௧௨௩௪௫௬௭௮௯౦౧౨౩౪౫౬౭౮౯'
      || '೦೧೨೩೪೫೬೭೮೯൦൧൨൩൪൫൬൭൮൯෦෧෨෩෪෫෬෭෮෯๐๑๒๓๔๕๖๗๘๙໐໑໒໓໔໕໖໗໘໙༠༡༢༣༤༥༦༧༨༩၀၁၂၃၄၅၆၇၈၉႐႑႒႓႔႕႖႗႘႙០១២៣៤៥៦៧៨៩᠐᠑᠒᠓᠔᠕᠖᠗᠘᠙'
      || '᥆᥇᥈᥉᥊᥋᥌᥍᥎᥏᧐᧑᧒᧓᧔᧕᧖᧗᧘᧙᪀᪁᪂᪃᪄᪅᪆᪇᪈᪉᪐᪑᪒᪓᪔᪕᪖᪗᪘᪙᭐᭑᭒᭓᭔᭕᭖᭗᭘᭙᮰᮱᮲᮳᮴᮵᮶᮷᮸᮹᱀᱁᱂᱃᱄᱅᱆᱇᱈᱉᱐᱑᱒᱓᱔᱕᱖᱗᱘᱙꘠꘡꘢꘣꘤꘥꘦꘧꘨꘩꣐꣑꣒꣓꣔꣕꣖꣗꣘꣙'
      || '꤀꤁꤂꤃꤄꤅꤆꤇꤈꤉꧐꧑꧒꧓꧔꧕꧖꧗꧘꧙꧰꧱꧲꧳꧴꧵꧶꧷꧸꧹꩐꩑꩒꩓꩔꩕꩖꩗꩘꩙꯰꯱꯲꯳꯴꯵꯶꯷꯸꯹𐒠𐒡𐒢𐒣𐒤𐒥𐒦𐒧𐒨𐒩𐴰𐴱𐴲𐴳𐴴𐴵𐴶𐴷𐴸𐴹𐵀𐵁𐵂𐵃𐵄𐵅𐵆𐵇𐵈𐵉𑁦𑁧𑁨𑁩𑁪𑁫𑁬𑁭𑁮𑁯𑃰𑃱𑃲𑃳𑃴𑃵𑃶𑃷𑃸𑃹'
      || '𑄶𑄷𑄸𑄹𑄺𑄻𑄼𑄽𑄾𑄿𑇐𑇑𑇒𑇓𑇔𑇕𑇖𑇗𑇘𑇙𑋰𑋱𑋲𑋳𑋴𑋵𑋶𑋷𑋸𑋹𑑐𑑑𑑒𑑓𑑔𑑕𑑖𑑗𑑘𑑙𑓐𑓑𑓒𑓓𑓔𑓕𑓖𑓗𑓘𑓙𑙐𑙑𑙒𑙓𑙔𑙕𑙖𑙗𑙘𑙙𑛀𑛁𑛂𑛃𑛄𑛅𑛆𑛇𑛈𑛉𑛐𑛑𑛒𑛓𑛔𑛕𑛖𑛗𑛘𑛙𑛚𑛛𑛜𑛝𑛞𑛟𑛠𑛡𑛢𑛣𑜰𑜱𑜲𑜳𑜴𑜵𑜶𑜷𑜸𑜹'
      || '𑣠𑣡𑣢𑣣𑣤𑣥𑣦𑣧𑣨𑣩𑥐𑥑𑥒𑥓𑥔𑥕𑥖𑥗𑥘𑥙𑯰𑯱𑯲𑯳𑯴𑯵𑯶𑯷𑯸𑯹𑱐𑱑𑱒𑱓𑱔𑱕𑱖𑱗𑱘𑱙𑵐𑵑𑵒𑵓𑵔𑵕𑵖𑵗𑵘𑵙𑶠𑶡𑶢𑶣𑶤𑶥𑶦𑶧𑶨𑶩𑷠𑷡𑷢𑷣𑷤𑷥𑷦𑷧𑷨𑷩𑽐𑽑𑽒𑽓𑽔𑽕𑽖𑽗𑽘𑽙𖄰𖄱𖄲𖄳𖄴𖄵𖄶𖄷𖄸𖄹𖩠𖩡𖩢𖩣𖩤𖩥𖩦𖩧𖩨𖩩'
      || '𖫀𖫁𖫂𖫃𖫄𖫅𖫆𖫇𖫈𖫉𖭐𖭑𖭒𖭓𖭔𖭕𖭖𖭗𖭘𖭙𖵰𖵱𖵲𖵳𖵴𖵵𖵶𖵷𖵸𖵹𞅀𞅁𞅂𞅃𞅄𞅅𞅆𞅇𞅈𞅉𞋰𞋱𞋲𞋳𞋴𞋵𞋶𞋷𞋸𞋹𞓰𞓱𞓲𞓳𞓴𞓵𞓶𞓷𞓸𞓹𞗱𞗲𞗳𞗴𞗵𞗶𞗷𞗸𞗹𞗺𞥐𞥑𞥒𞥓𞥔𞥕𞥖𞥗𞥘𞥙',
        repeat('0123456789', 68)) else a.s end,
      '([0-9])[\u0300-\u036f\u0483-\u0489\u034f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe00-\ufe0f\ufe20-\ufe2f\u115f\u1160\u3164\uffa0\U000e0100-\U000e01ef]+',
      '\1', 'g')),
      -- maskMoney: after "$", comma thousands, or cents (not "123.45.6789")
      '\$[[:space:]]?[0-9][0-9,]*(\.[0-9]+)?|(?<![0-9])[0-9]{1,3}(,[0-9]{3})+(\.[0-9]+)?(?![0-9]|,[0-9])|(?<![0-9.,])[0-9]+\.[0-9]{2}(?![0-9]|[./-][0-9])',
      '$', 'g') as s
    from (select regexp_replace(
      translate(normalize(coalesce(t, ''), NFKC), chr(133), ' '),
      '[\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890\u0891\u08e2\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]',
      '', 'g') as s) a) n,
    (select
      '[^[:alnum:]]{1,3}'::text as sep,
      '[^[:alnum:],:;]{1,3}'::text as ssn_sep,
      '\y(ssns?|social([[:space:]_.-]*security)?|tax[^[:alnum:]]{0,3}id|tins?|itins?|eins?|accounts?|acct|card|routing)\y([^[:alnum:]]{0,4}(no|nos|number|num|is)\y){0,2}[^[:alnum:]]{0,4}'::text as id_lead,
      '[^[:alnum:]]{0,4}((is|was|on|in|of|date|dated)[^[:alnum:]]{1,4}){0,2}'::text as birth_gap,
      '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?'::text as month,
      '(#|(no|nos|number|numbers|num|(ending|ends?)([^[:alnum:]]{1,3}(in|with))?)\y)[^[:alnum:]$]{0,6}[x*•]*[0-9]([^[:alnum:]]{0,3}[0-9]){3,}'::text as qualified
    ) p
$$;
revoke execute on function public.submission_text_restricted(text) from public, anon, authenticated;

-- True when any one of the values is restricted. Each value is checked on its
-- own, as the app checks each field, so no digit group in one value joins a
-- group in the next (a tenant "Dental Suite 100-24" beside a lease end
-- "2031-06-30").
create or replace function public.submission_texts_restricted(variadic t text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select exists (select 1 from unnest(t) as v where public.submission_text_restricted(v))
$$;
revoke execute on function public.submission_texts_restricted(text[]) from public, anon, authenticated;

-- True when any string value inside a jsonb document (risks, sources and uses
-- notes, program sections, credit-event explanations) is restricted, each
-- value on its own.
create or replace function public.submission_json_restricted(j jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select exists (
    select 1
    from jsonb_path_query(coalesce(j, '{}'::jsonb), 'strict $.** ? (@.type() == "string")') as v
    where public.submission_text_restricted(v #>> '{}')
  )
$$;
revoke execute on function public.submission_json_restricted(jsonb) from public, anon, authenticated;

-- 1. Deal, property and financial facts ---------------------------------------
create table public.deal_submission_profiles (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null unique references public.deals (id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by text not null check (length(created_by) between 1 and 200),
  updated_at timestamptz not null default now(),
  updated_by text check (updated_by is null or length(updated_by) between 1 and 200),
  record_version integer not null default 1 check (record_version > 0),

  playbook text not null check (playbook in (
    'construction', 'bridge', 'hard_money', 'fix_flip', 'dscr_rental', 'sba_7a', 'sba_504',
    'hud_multifamily', 'hud_232', 'agency', 'cmbs', 'hotel_cmbs', 'hotel_pip_bridge',
    'bank', 'life_company', 'mezz_pref', 'c_pace'
  )),

  -- Loan request
  purpose text check (purpose is null or purpose in (
    'acquisition', 'refinance', 'cash_out_refinance', 'construction', 'renovation', 'recapitalization'
  )),
  requested_term_months integer check (requested_term_months is null or requested_term_months between 1 and 480),
  requested_amort_months integer check (requested_amort_months is null or requested_amort_months between 12 and 480),
  requested_io_months integer check (requested_io_months is null or requested_io_months between 0 and 480),
  rate_type text check (rate_type is null or rate_type in ('fixed', 'floating', 'either')),
  recourse text check (recourse is null or recourse in ('full', 'partial', 'non_recourse', 'negotiable')),
  lien_position text check (lien_position is null or lien_position in ('first', 'second', 'mezzanine', 'assessment')),
  target_close_date date,
  close_driver text check (close_driver is null or length(close_driver) between 1 and 300),
  prepay_preference text check (prepay_preference is null or length(prepay_preference) between 1 and 300),
  existing_lender text check (existing_lender is null or length(existing_lender) between 1 and 200),
  existing_debt_cents bigint check (existing_debt_cents is null or existing_debt_cents >= 0),
  existing_rate_pct numeric(6, 3) check (existing_rate_pct is null or existing_rate_pct between 0 and 40),
  existing_maturity_date date,
  cash_out_cents bigint check (cash_out_cents is null or cash_out_cents >= 0),
  cash_out_use text check (cash_out_use is null or length(cash_out_use) between 1 and 500),
  -- Sizing assumption for DSCR only; shown to lenders as "assumed, not a quote".
  assumed_rate_pct numeric(6, 3) check (assumed_rate_pct is null or assumed_rate_pct between 0 and 40),
  assumed_amort_months integer check (assumed_amort_months is null or assumed_amort_months between 12 and 480),

  -- Property (address and state stay on public.deals)
  asset_type text check (asset_type is null or asset_type ~ '^[A-Z0-9_]{2,40}$'),
  property_name text check (property_name is null or length(property_name) between 1 and 200),
  city text check (city is null or length(city) between 1 and 120),
  county text check (county is null or length(county) between 1 and 80),
  postal_code text check (postal_code is null or postal_code ~ '^[0-9]{5}(-[0-9]{4})?$'),
  apn text check (apn is null or length(apn) between 1 and 60),
  year_built integer check (year_built is null or year_built between 1700 and 2100),
  year_renovated integer check (year_renovated is null or year_renovated between 1700 and 2100),
  size_count integer check (size_count is null or size_count between 0 and 1000000),
  size_unit text check (size_unit is null or size_unit in ('units', 'beds', 'keys', 'sf', 'pads', 'lots', 'acres')),
  rentable_sf integer check (rentable_sf is null or rentable_sf between 0 and 100000000),
  land_acres numeric(10, 3) check (land_acres is null or land_acres between 0 and 1000000),
  tenancy text check (tenancy is null or tenancy in ('single_tenant', 'multi_tenant', 'owner_user', 'not_applicable')),
  owner_occupied_pct numeric(6, 3) check (owner_occupied_pct is null or owner_occupied_pct between 0 and 100),
  occupancy_pct numeric(6, 3) check (occupancy_pct is null or occupancy_pct between 0 and 100),
  occupancy_as_of date,
  zoning text check (zoning is null or length(zoning) between 1 and 120),
  flood_zone text check (flood_zone is null or length(flood_zone) between 1 and 20),
  rent_control boolean,
  seismic_zone boolean,
  -- Show city and submarket only in the email (off-market acquisitions under confidentiality).
  mask_address boolean not null default false,

  -- Value
  purchase_price_cents bigint check (purchase_price_cents is null or purchase_price_cents >= 0),
  purchase_close_date date,
  as_is_value_cents bigint check (as_is_value_cents is null or as_is_value_cents >= 0),
  as_is_value_source text check (as_is_value_source is null or as_is_value_source in (
    'appraisal', 'bpo', 'broker_opinion', 'purchase_price', 'comparable_sales', 'sponsor_estimate'
  )),
  as_is_value_as_of date,
  stabilized_value_cents bigint check (stabilized_value_cents is null or stabilized_value_cents >= 0),
  stabilized_value_source text check (stabilized_value_source is null or stabilized_value_source in (
    'appraisal', 'bpo', 'broker_opinion', 'comparable_sales', 'sponsor_estimate'
  )),

  -- Operating financials (income property)
  revenue_cents bigint check (revenue_cents is null or revenue_cents >= 0),
  expenses_cents bigint check (expenses_cents is null or expenses_cents >= 0),
  noi_in_place_cents bigint,
  noi_period_end date,
  noi_basis text check (noi_basis is null or noi_basis in ('t12', 't3_annualized', 'fiscal_year', 'borrower_stated')),
  noi_stabilized_cents bigint,
  stabilization_months integer check (stabilization_months is null or stabilization_months between 0 and 120),

  -- Business plan and exit
  business_plan text check (business_plan is null or length(business_plan) between 1 and 4000),
  exit_strategy text check (exit_strategy is null or exit_strategy in (
    'sale', 'refinance', 'construction_to_permanent', 'hold_to_maturity', 'not_applicable'
  )),
  exit_months integer check (exit_months is null or exit_months between 1 and 480),
  exit_detail text check (exit_detail is null or length(exit_detail) between 1 and 2000),
  highlights text[] not null default '{}' check (cardinality(highlights) <= 12),
  risks jsonb not null default '[]'::jsonb check (jsonb_typeof(risks) = 'array' and jsonb_array_length(risks) <= 12),

  -- Sources and uses
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) <= 40),
  uses jsonb not null default '[]'::jsonb check (jsonb_typeof(uses) = 'array' and jsonb_array_length(uses) <= 60),

  -- Program sections and provenance
  program_details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(program_details) = 'object' and length(program_details::text) <= 200000),
  field_sources jsonb not null default '{}'::jsonb
    check (jsonb_typeof(field_sources) = 'object' and length(field_sources::text) <= 100000),

  constraint deal_submission_profiles_io_within_term
    check (requested_io_months is null or requested_term_months is null or requested_io_months <= requested_term_months),
  -- Restricted identifiers never belong in free text (lib/deals/submission/redaction.ts, the same rules):
  -- every free-text column and every string inside the jsonb sections. The APN is an identifier, not free text.
  constraint deal_submission_profiles_no_restricted check (
    not public.submission_texts_restricted(
      close_driver, prepay_preference, existing_lender, cash_out_use, property_name, city, county, zoning, flood_zone,
      business_plan, exit_detail)
    and not public.submission_texts_restricted(variadic highlights)
    and not public.submission_json_restricted(risks) and not public.submission_json_restricted(sources)
    and not public.submission_json_restricted(uses) and not public.submission_json_restricted(program_details)
  )
);
create index deal_submission_profiles_playbook_idx on public.deal_submission_profiles (playbook);

create trigger deal_submission_profiles_touch before update on public.deal_submission_profiles
  for each row execute function public.touch_updated_at();

-- 2. Sponsor summary (personal information) -----------------------------------
create table public.deal_sponsor_profiles (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null unique references public.deals (id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by text not null check (length(created_by) between 1 and 200),
  updated_at timestamptz not null default now(),
  updated_by text check (updated_by is null or length(updated_by) between 1 and 200),
  record_version integer not null default 1 check (record_version > 0),

  experience_summary text check (experience_summary is null or length(experience_summary) between 1 and 4000),
  years_experience integer check (years_experience is null or years_experience between 0 and 80),
  similar_projects_count integer check (similar_projects_count is null or similar_projects_count between 0 and 10000),
  portfolio_count integer check (portfolio_count is null or portfolio_count between 0 and 100000),
  portfolio_size_note text check (portfolio_size_note is null or length(portfolio_size_note) between 1 and 300),
  -- As stated by the sponsor before a PFS is on file. Once a principal's PFS
  -- exists, the summary uses the PFS totals (lib/principals/financials.ts).
  stated_net_worth_cents bigint check (stated_net_worth_cents is null or stated_net_worth_cents between -100000000000000 and 100000000000000),
  stated_liquidity_cents bigint check (stated_liquidity_cents is null or stated_liquidity_cents between 0 and 100000000000000),
  stated_as_of date,
  credit_band text check (credit_band is null or credit_band in ('740_PLUS', '700_739', '660_699', 'BELOW_660', 'NOT_PROVIDED')),
  credit_events jsonb not null default '{}'::jsonb check (jsonb_typeof(credit_events) = 'object' and length(credit_events::text) <= 8000),
  management_company text check (management_company is null or length(management_company) between 1 and 200),
  notes text check (notes is null or length(notes) between 1 and 2000),
  -- What the lender email may say about sponsor financial strength:
  --   covenant_only  "net worth at or above the loan amount: yes" (no dollar figures)
  --   rounded        rounded combined figures
  --   none           nothing; the summary behind the share link carries it
  email_financials_mode text not null default 'covenant_only'
    check (email_financials_mode in ('covenant_only', 'rounded', 'none')),

  constraint deal_sponsor_profiles_stated_dated
    check ((stated_net_worth_cents is null and stated_liquidity_cents is null) or stated_as_of is not null),
  constraint deal_sponsor_profiles_no_restricted check (
    not public.submission_texts_restricted(experience_summary, portfolio_size_note, management_company, notes)
    and not public.submission_json_restricted(credit_events)
  )
);

create trigger deal_sponsor_profiles_touch before update on public.deal_sponsor_profiles
  for each row execute function public.touch_updated_at();

-- 3. Locked summaries ----------------------------------------------------------
-- The one-page summary a lender was shown: the structured spec (rendered on the
-- share page) and the PDF added to the locked package manifest. Never updated or deleted.
create table public.deal_summaries (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals (id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by text not null check (length(created_by) between 1 and 200),
  as_of date not null,
  playbook text not null,
  target_stage text not null check (target_stage in ('screen', 'term_sheet', 'underwrite')),
  template_version text not null check (length(template_version) between 1 and 40),
  -- Sections, rows, per-row source labels and metric formulas. Holds the sponsor's
  -- combined net worth and liquidity, so the audit trigger redacts it.
  spec jsonb not null check (jsonb_typeof(spec) = 'object' and length(spec::text) <= 400000),
  spec_sha256 text not null check (spec_sha256 ~ '^[0-9a-f]{64}$'),
  pdf_sha256 text not null check (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  pdf_storage_path text not null check (length(pdf_storage_path) between 1 and 500),
  profile_version integer not null check (profile_version > 0),
  sponsor_version integer check (sponsor_version is null or sponsor_version > 0),
  unique (deal_id, pdf_sha256)
);
create index deal_summaries_deal_idx on public.deal_summaries (deal_id, created_at desc);

create or replace function public.deal_summaries_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'deal_summaries rows are immutable; build a new summary instead' using errcode = 'check_violation';
end;
$$;
revoke execute on function public.deal_summaries_immutable() from public, anon, authenticated;
create trigger deal_summaries_immutable before update or delete on public.deal_summaries
  for each row execute function public.deal_summaries_immutable();
-- TRUNCATE skips row triggers; a statement trigger refuses it too.
create trigger deal_summaries_no_truncate before truncate on public.deal_summaries
  for each statement execute function public.deal_summaries_immutable();

-- 4. Submission record ---------------------------------------------------------
alter table public.lender_outreach
  add column target_stage text
    check (target_stage is null or target_stage in ('screen', 'term_sheet', 'underwrite')),
  add column summary_id uuid references public.deal_summaries (id) on delete restrict,
  -- Requirement ids that were required at target_stage and not met when the send was requested.
  add column readiness_missing text[] not null default '{}',
  add column readiness_override_reason text
    check (readiness_override_reason is null or length(btrim(readiness_override_reason)) between 20 and 1000),
  add column lender_fit jsonb
    check (lender_fit is null or jsonb_typeof(lender_fit) = 'object'),
  -- Why this lender is submitted to although the matcher did not rank it, or the request falls
  -- outside its recorded box. Its own reason, apart from the readiness reason.
  add column lender_override_reason text
    check (lender_override_reason is null or length(btrim(lender_override_reason)) between 20 and 1000),
  -- The fair-lending check on the staff-typed text at request time ({flags: [{topic, term}], confirmed}):
  -- flagged copy goes out only with staff's confirmation, and the approving broker sees both.
  -- Both keys are required: a missing "confirmed" reads as NULL, which a plain
  -- comparison would let through. The CASE tests in order and never yields NULL.
  add column neutral_copy jsonb
    check (neutral_copy is null or case
      when jsonb_typeof(neutral_copy) is distinct from 'object' then false
      when jsonb_typeof(neutral_copy -> 'flags') is distinct from 'array' then false
      when jsonb_typeof(neutral_copy -> 'confirmed') is distinct from 'boolean' then false
      else jsonb_array_length(neutral_copy -> 'flags') = 0 or (neutral_copy ->> 'confirmed')::boolean
    end),
  -- The text the broker approved, with {{SHARE_LINK}} and {{LINK_EXPIRES}} placeholders
  -- (the link exists only after approval). email_sha256 is in the approval payload:
  -- the SHA-256 of the subject and text together (lib/deals/submission/email.ts emailSha256).
  add column email_subject text
    check (email_subject is null or (length(email_subject) between 1 and 200 and email_subject !~ '[[:cntrl:]]')),
  add column email_text text
    check (email_text is null or length(email_text) between 1 and 20000),
  add column email_sha256 text
    check (email_sha256 is null or email_sha256 ~ '^[0-9a-f]{64}$'),
  -- A send with unmet required items needs a written reason.
  add constraint lender_outreach_override_when_missing
    check (cardinality(readiness_missing) = 0 or readiness_override_reason is not null),
  add constraint lender_outreach_email_complete
    check ((email_text is null) = (email_sha256 is null) and (email_text is null) = (email_subject is null)),
  -- The stored hash is the hash of the stored subject and text (UTF-8 of subject || LF || text),
  -- so the row cannot hold text other than what the hash in the approval names.
  add constraint lender_outreach_email_hash
    check (email_sha256 is null or email_sha256 = encode(sha256(convert_to(email_subject || chr(10) || email_text, 'UTF8')), 'hex')),
  -- No restricted identifier in the subject, the body or the staff reason (the app's anchored patterns, normalized).
  add constraint lender_outreach_email_no_restricted
    check (not public.submission_texts_restricted(email_subject, email_text, readiness_override_reason, lender_override_reason));

-- 5. Audit -----------------------------------------------------------------------
-- audit_row_change_redacted() wrote deal_id = null because its first tables
-- (lender_contacts, lender_accounts) have no deal. Rows that carry a deal_id now
-- keep it, so the deal's audit panel lists sponsor and summary changes. Nothing
-- changes for tables without a deal_id column.
create or replace function public.audit_row_change_redacted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  o jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  who text;
  diff text[];
  col text;
begin
  who := coalesce(
    nullif(r ->> 'updated_by', ''),
    nullif(r ->> 'created_by', ''),
    nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', ''),
    nullif(current_setting('app.actor', true), ''),
    current_user::text
  );
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(k order by k), '{}') into diff
    from jsonb_object_keys(n) as k
    where (n -> k) is distinct from (o -> k) and k not in ('updated_at');
    if cardinality(diff) = 0 then
      return new;
    end if;
  end if;
  foreach col in array tg_argv loop
    if o is not null and o ? col and jsonb_typeof(o -> col) <> 'null' then
      o := jsonb_set(o, array[col], to_jsonb('[redacted]'::text));
    end if;
    if n is not null and n ? col and jsonb_typeof(n -> col) <> 'null' then
      n := jsonb_set(n, array[col], to_jsonb('[redacted]'::text));
    end if;
  end loop;
  insert into public.audit_log (table_name, row_id, deal_id, action, actor, changed, old_row, new_row)
  values (tg_table_name, r ->> 'id', nullif(r ->> 'deal_id', '')::uuid, tg_op, who, coalesce(diff, '{}'), o, n);
  return coalesce(new, old);
end;
$$;
revoke execute on function public.audit_row_change_redacted() from public, anon, authenticated;

-- Deal and property facts: full values, so a changed NOI or value shows old and new.
create trigger deal_submission_profiles_audit after insert or update or delete on public.deal_submission_profiles
  for each row execute function public.audit_row_change();
-- Sponsor summary: who changed which column, never the values. Every column but the keys and
-- the row bookkeeping (id, deal_id, created_*, updated_*, record_version) is redacted.
create trigger deal_sponsor_profiles_audit after insert or update or delete on public.deal_sponsor_profiles
  for each row execute function public.audit_row_change_redacted(
    'experience_summary', 'years_experience', 'similar_projects_count', 'portfolio_count', 'portfolio_size_note',
    'stated_net_worth_cents', 'stated_liquidity_cents', 'stated_as_of', 'credit_band', 'credit_events',
    'management_company', 'notes', 'email_financials_mode'
  );
-- Locked summaries: the spec holds sponsor totals; its hashes stay readable.
create trigger deal_summaries_audit after insert or update or delete on public.deal_summaries
  for each row execute function public.audit_row_change_redacted('spec');
-- lender_outreach keeps its existing audit trigger; the new columns are audited by it.

-- 6. RLS: service role only ----------------------------------------------------------
alter table public.deal_submission_profiles enable row level security;
alter table public.deal_sponsor_profiles enable row level security;
alter table public.deal_summaries enable row level security;
revoke all on public.deal_submission_profiles, public.deal_sponsor_profiles, public.deal_summaries from anon, authenticated;
