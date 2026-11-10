-- Lender loan types: the user-facing "what kind of loan" tags staff filter the
-- Lender panel by (construction, DSCR, bridge, private / hard money, ...).
--
-- Additive only. lender_panel.programs keeps the deal-desk program ids that the
-- stage templates, DRE reporting and the matcher use; loan_types is a separate,
-- broader, staff-editable tag set. lib/deals/loan-types.ts holds the same ids,
-- the program and desk mapping tables and the keyword rules;
-- lib/deals/loan-types-parity.test.ts proves derive_lender_loan_types() below
-- returns exactly what deriveLenderLoanTypes() returns. Changing a rule means
-- changing both: edit the TS module and add a migration that replaces this
-- function (never edit this file once applied).

-- 1. Column, allowed ids, GIN index ------------------------------------------------------------
alter table public.lender_panel
  add column loan_types text[] not null default '{}'
    constraint lender_panel_loan_types_known check (
      loan_types <@ array[
        'construction', 'bridge', 'private_money', 'fix_flip', 'dscr', 'sba', 'hud_fha',
        'agency', 'cmbs', 'bank', 'life_company', 'mezz_pref', 'c_pace', 'hotel'
      ]::text[]
      and array_position(loan_types, null) is null
    );

comment on column public.lender_panel.loan_types is
  'User-facing loan types (lib/deals/loan-types.ts lenderLoanTypes) staff filter the panel by. Backfilled by 20261105130000_int_lender_loan_types; staff-owned afterwards. Not used by the matcher.';

create index lender_panel_loan_types_idx on public.lender_panel using gin (loan_types);

-- 2. Pure derivation (same rules as lib/deals/loan-types.ts deriveLenderLoanTypes) ----------
-- Sources, in order: deal programs (explicit table), directory desk labels
-- parsed from "| Desks: ..." (explicit table), keyword rules over a cleaned
-- corpus (staff notes, unmapped desk labels, asset types and the
-- "Programs (as published)" part of the lender's credit-box notes), the
-- evidenced lender category, and finally BANK_LIFE_CO resolved to bank when
-- nothing says life company or investor lending.
create or replace function public.derive_lender_loan_types(
  p_programs text[],
  p_category text,
  p_appetite_notes text,
  p_asset_types text[],
  p_box_notes text[]
)
returns text[]
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_order constant text[] := array[
    'construction', 'bridge', 'private_money', 'fix_flip', 'dscr', 'sba', 'hud_fha',
    'agency', 'cmbs', 'bank', 'life_company', 'mezz_pref', 'c_pace', 'hotel'
  ];
  v_types text[] := '{}';
  v_notes text := coalesce(p_appetite_notes, '');
  v_desk text;
  v_mapped text[];
  v_unmapped text[] := '{}';
  v_boxes text;
  v_corpus text;
  v_pattern text;
  v_rule record;
begin
  -- 1. Deal programs. BANK_LIFE_CO is resolved in step 5.
  select coalesce(array_agg(m.loan_type), '{}') into v_types
    from (values
      ('HUD_232', 'hud_fha'), ('HUD_MULTIFAMILY', 'hud_fha'),
      ('SBA_7A', 'sba'), ('SBA_504', 'sba'),
      ('HOTEL_CMBS', 'cmbs'), ('HOTEL_CMBS', 'hotel'),
      ('PIP_BRIDGE', 'bridge'), ('PIP_BRIDGE', 'hotel'),
      ('AGENCY', 'agency'),
      ('PRIVATE_BRIDGE', 'bridge'),
      ('HARD_MONEY', 'private_money'),
      ('CONSTRUCTION', 'construction')
    ) as m (program, loan_type)
   where m.program = any (coalesce(p_programs, '{}'));

  -- 2. Directory desk labels ("HM-094 Investor fix & flip / bridge (wholesale) (tier B, medium confidence)").
  for v_desk in
    select regexp_replace(regexp_replace(btrim(d), '^[A-Z]+-[0-9]+ ', ''), ' \(tier [^)]*\)$', '')
      from regexp_split_to_table(coalesce(substring(v_notes from '\| Desks: ([^|]*)'), ''), ';') as d
  loop
    continue when v_desk = '';
    select m.loan_types into v_mapped
      from (values
        ('CRE construction debt fund / private', array['construction']),
        ('CRE construction bank', array['construction', 'bank']),
        ('Land / horizontal development', array['construction']),
        ('Construction mezz / pref equity / C-PACE', array['construction', 'mezz_pref']),
        ('Investor ground-up (wholesale)', array['construction']),
        ('California private money', array['private_money']),
        ('National commercial hard money', array['private_money']),
        ('Commercial bridge / transitional', array['bridge']),
        ('Small-balance commercial (SBC)', '{}'::text[]),
        ('Hospitality bridge / PIP', array['bridge', 'hotel']),
        ('Investor fix & flip / bridge (wholesale)', array['fix_flip', 'bridge']),
        ('Investor DSCR rental take-out (wholesale)', array['dscr']),
        ('HUD 232 / Agency (permanent & construction)', array['hud_fha']),
        ('Healthcare bridge / bridge-to-HUD', array['bridge']),
        ('Healthcare bank / balance sheet', array['bank']),
        ('Senior housing construction', array['construction']),
        ('Healthcare mezz / pref equity', array['mezz_pref']),
        ('SBA / small care facility (RCFE, assisted living)', '{}'::text[]),
        ('Agency multifamily (Fannie / Freddie)', array['agency']),
        ('HUD multifamily (221(d)(4) / 223(f))', array['hud_fha']),
        ('Multifamily bridge / value-add', array['bridge']),
        ('Small-balance multifamily (5-50 units)', '{}'::text[]),
        ('Multifamily bank / credit union', array['bank']),
        ('SBA hotel lender (7(a) / 504)', array['sba', 'hotel']),
        ('Hotel bridge / PIP', array['bridge', 'hotel']),
        ('Hotel construction', array['construction', 'hotel']),
        ('Life insurance company', array['life_company']),
        ('CMBS conduit', array['cmbs']),
        ('Mortgage REIT / large-balance debt fund', array['bridge']),
        ('Hedge fund / private credit', array['bridge']),
        ('Family office / private capital', '{}'::text[]),
        ('Community bank / credit union CRE', array['bank']),
        ('SBA 504 CDC', array['sba']),
        ('SBA 7(a) lender', array['sba'])
      ) as m (desk, loan_types)
     where m.desk = v_desk;
    if found then
      v_types := v_types || v_mapped;
    else
      v_unmapped := v_unmapped || v_desk;
    end if;
  end loop;

  -- 3. Keyword corpus: staff notes (directory segments and preamble removed),
  -- unmapped desk labels, asset types, credit-box "Programs (as published)".
  select string_agg(s.seg, ' | ' order by s.ord) into v_boxes
    from (
      select b.ord, substring(b.n from 'Programs \(as published\): ([^|]*)') as seg
        from unnest(coalesce(p_box_notes, '{}')) with ordinality as b (n, ord)
    ) as s
   where s.seg is not null;
  v_corpus := ' '
    || regexp_replace(
         regexp_replace(v_notes, '\| (Desks|Website|Broker page|Phone|HQ|Footprint|Lends in CA|Licences \(unverified\)|Parent / AKA): [^|]*', ' ', 'g'),
         '^From the wholesale lender directory[^|]*', ' ')
    || ' | ' || array_to_string(v_unmapped, ' | ')
    || ' | ' || array_to_string(coalesce(p_asset_types, '{}'), ', ')
    || ' | ' || coalesce(v_boxes, '')
    || ' ';
  foreach v_pattern in array array[
    'https?://[^ |]*',
    'bank[ -]statements?',
    '\((no|not|excl[a-z]*|except|excluding|without)[^a-z0-9][^)|]*\)?',
    '[^a-z0-9](no|non|not|excluding|excludes|except|without)[ -]+(ground[ -]?up|construction|land|mezz[a-z]*|bridge|hotels?|hospitality|dscr|sba|c-?pace|fix[ -]*(&|and|n|/)?[ -]*flips?)',
    '[^a-z0-9]to[ -](hud|fha|agency|fannie|freddie|sba|perm[a-z]*)[^a-z0-9]',
    '(hud|fha|agency)[^,;|()]*(exit|take[ -]?outs?)|bridge[ -](hud|fha)',
    'cmbs[ -](b[ -]pieces?|investments?|bonds?|securities)|cmbs \([^)|]*securities[^)|]*\)',
    '(held|owned|funded|originated) by [^,;|()]*',
    '(min|minimum|max|maximum)[ .:]*dscr',
    'dscr[ :]*(of|>=?|at least)?[ :]*[0-9]+\.[0-9]+',
    '[0-9]+\.[0-9]+ ?x?[ ]*(min[a-z]*[ ]*)?dscr'
  ] loop
    v_corpus := regexp_replace(v_corpus, v_pattern, ' ', 'gi');
  end loop;

  -- 4. Keyword rules (case-insensitive).
  for v_rule in
    select * from (values
      ('construction', 'construction|ground[ -]?up|[^a-z0-9]land[^a-z0-9]|horizontal development|build[ -]?(to|for)[ -]?rent|[^a-z0-9]btr[^a-z0-9]|spec (home|homes|build|builds|sfr)'),
      ('bridge', 'bridge|transitional|value[ -]add|lease[ -]up'),
      ('private_money', 'hard[ -]?money|private[ -]money|private[ -]lend|asset[ -]based|equity[ -]based|trust deeds?|[^a-z0-9](1st|2nd|first|second)[ -](td|tds)[^a-z0-9]'),
      ('fix_flip', 'fix[ -]*(&|and|n|/)?[ -]*flip|[^a-z0-9]flip(s|per|pers|ping)?[^a-z0-9]|[^a-z0-9]f&f[^a-z0-9]|[^a-z0-9]rtl[^a-z0-9]|residential transition'),
      ('dscr', '[^a-z0-9]dscr[^a-z0-9]|long[ -]term rentals?|rental[ -](loan|loans|portfolio|portfolios|program|programs|term|take[ -]?outs?)|to[ -]rental|single[ -]family rentals?|[^a-z0-9]sfr[ -]?(1-4[ -]?)?rentals?|investor rental|[^a-z0-9]no[ -]ratio'),
      ('sba', '[^a-z0-9]sba[^a-z0-9]|[^a-z0-9]7 ?\(a\)|[^a-z0-9]cdc[^a-z0-9]|[^a-z0-9]504 (loan|loans|program|cdc|first)'),
      ('hud_fha', '[^a-z0-9](hud|fha)[^a-z0-9]|22[13] ?\([adf]\)|section 232|lean 232'),
      ('agency', 'fannie|freddie|[^a-z0-9](dus|optigo|gse)[^a-z0-9]|agency (multifamily|lending|lender|lenders|loan|loans|mf|small[ -]balance|sbl)'),
      ('cmbs', '[^a-z0-9]cmbs[^a-z0-9]|conduit|[^a-z0-9]sasb[^a-z0-9]'),
      ('bank', '[^a-z0-9]banks?[^a-z0-9]|credit unions?|[^a-z0-9]thrifts?[^a-z0-9]|savings (and loan|association|bank)'),
      ('life_company', 'life[ -](insurance|insurer|compan|cos?[^a-z0-9])|insurance compan|[^a-z0-9]insurers?[^a-z0-9]'),
      ('mezz_pref', 'mezz|pref(erred)?[ -]*equity|[^a-z0-9]pref[^a-z0-9]|subordinate|gap financing|junior (debt|loan|loans|lien|liens)'),
      ('c_pace', 'c-?pace|property[ -]assessed|[^a-z0-9]pace (financ|loan|lend|fund|program)'),
      ('hotel', 'hotel|hospitality|motel|lodging|[^a-z0-9]pip[^a-z0-9]|flag[ -]change')
    ) as r (loan_type, pattern)
  loop
    if v_corpus ~* v_rule.pattern then
      v_types := v_types || v_rule.loan_type;
    end if;
  end loop;

  -- 5. Evidenced category, then BANK_LIFE_CO.
  v_types := v_types || case
    when p_category in ('NATIONAL_BANK', 'STATE_BANK', 'SAVINGS_ASSOCIATION', 'CREDIT_UNION', 'INDUSTRIAL_LOAN_COMPANY') then array['bank']
    when p_category = 'INSURANCE_COMPANY' then array['life_company']
    else '{}'::text[]
  end;
  if 'BANK_LIFE_CO' = any (coalesce(p_programs, '{}'))
     and not (v_types && array['bank', 'life_company', 'dscr', 'fix_flip', 'private_money']) then
    v_types := v_types || array['bank'];
  end if;

  return array(
    select t from unnest(v_order) with ordinality as o (t, ord)
     where t = any (v_types)
     order by o.ord
  );
end;
$$;
revoke execute on function public.derive_lender_loan_types(text[], text, text, text[], text[]) from public, anon, authenticated;

-- 3. Backfill -----------------------------------------------------------------------------------------
-- Only rows that have no loan types yet. Box notes are passed in id order.
-- Seeded rows keep their updated_by (lib/agents/lenders/directory-seed.test.ts
-- and later seed rounds recognise them by it); every other changed row is
-- attributed to this migration. One UPDATE per lender, so one audit row.
with derived as (
  select l.id,
         public.derive_lender_loan_types(
           l.programs, l.category, l.appetite_notes, l.asset_types,
           coalesce((select array_agg(b.notes order by b.id) from public.credit_boxes b where b.lender_id = l.id), '{}')
         ) as loan_types
    from public.lender_panel l
   where l.loan_types = '{}'
)
update public.lender_panel l
   set loan_types = d.loan_types,
       updated_by = case when l.updated_by like 'seed:lender-directory%' then l.updated_by
                         else 'migration:20261105130000_int_lender_loan_types' end
  from derived d
 where d.id = l.id
   and d.loan_types <> '{}';
