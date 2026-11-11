-- Lender loan types: "bank" no longer comes from text that says the lender is
-- not one. The keyword rule `banks?` matched "SBA 7(a) (Preferred Lender,
-- non-bank)", "non-bank SBLC", "co-originated with Bank OZK" and "co-lending
-- with banks", so four non-bank seeded lenders carried the Bank / credit union
-- tag. Two cleanups run before the keyword rules (lib/deals/loan-types.ts
-- LOAN_TYPE_CLEANUPS non_bank and co_lending); lib/deals/loan-types-parity.test.ts
-- proves this function and deriveLenderLoanTypes() still agree.
--
-- Replaces public.derive_lender_loan_types() from
-- 20261105130000_int_lender_loan_types.sql (unchanged except the two cleanups),
-- then re-derives only the lenders whose stored loan types are still exactly
-- what the old function derived (nobody has edited them since) and whose
-- derivation changes. Staff-edited loan types are left alone.

-- 1. What the old function derived, per lender, before it is replaced.
create temporary table lender_loan_types_before as
select l.id,
       public.derive_lender_loan_types(
         l.programs, l.category, l.appetite_notes, l.asset_types,
         coalesce((select array_agg(b.notes order by b.id) from public.credit_boxes b where b.lender_id = l.id), '{}')
       ) as loan_types
  from public.lender_panel l;

-- 2. The function, with the non_bank and co_lending cleanups.
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
    '[^a-z0-9]non[ -]?banks?',
    'co[ -]?(lend|originat)[a-z]* (with|alongside) [^,;|()]*|alongside (a |the )?banks?',
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

-- 3. Re-derive the untouched lenders whose loan types change. Seeded rows keep
-- their updated_by (lib/agents/lenders/directory-seed.test.ts and later seed
-- rounds recognise them by it); every other changed row is attributed to this
-- migration. One UPDATE per lender, so one audit row.
with derived as (
  select l.id,
         b.loan_types as before,
         public.derive_lender_loan_types(
           l.programs, l.category, l.appetite_notes, l.asset_types,
           coalesce((select array_agg(c.notes order by c.id) from public.credit_boxes c where c.lender_id = l.id), '{}')
         ) as after
    from public.lender_panel l
    join lender_loan_types_before b on b.id = l.id
   where l.loan_types = b.loan_types
)
update public.lender_panel l
   set loan_types = d.after,
       updated_by = case when l.updated_by like 'seed:lender-directory%' then l.updated_by
                         else 'migration:20261105140000_int_lender_loan_types_non_bank' end
  from derived d
 where d.id = l.id
   and d.after is distinct from d.before;

drop table if exists lender_loan_types_before;
