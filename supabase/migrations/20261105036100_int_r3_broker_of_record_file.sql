-- Final fixes r3 (compliance logic): the loan-level broker-of-record file.
--
-- Staff now record the loan's gate-H file on the deal desk
-- (lib/deals/broker-of-record.ts). Two facts the gates need were not stored:
--
-- 1. Lender-retained charges. Under the California usury analysis the
--    lender's points, exit fee and minimum interest are generally treated as
--    interest, so gate H tests the effective annualized rate, not only the
--    note rate (lib/compliance/gates.ts effectiveRatePct; VERIFY pending
--    counsel). The computed figure is stored next to the note rate.
-- 2. The beneficiary named on the deed of trust and the originator named on
--    the note. A document naming Corin holds the deal for counsel (gate A/H);
--    the names are stored as written, and the derived booleans are kept for
--    reporting.

alter table public.broker_of_record
  add column lender_points_pct numeric(7, 4) check (lender_points_pct >= 0),
  add column lender_exit_fee_pct numeric(7, 4) check (lender_exit_fee_pct >= 0),
  add column minimum_interest_months smallint check (minimum_interest_months between 0 and 120),
  add column charges_term_months smallint check (charges_term_months between 1 and 600),
  add column recorded_effective_rate_pct numeric(8, 4) check (recorded_effective_rate_pct >= 0),
  add column effective_rate_pct numeric(8, 4) check (effective_rate_pct >= 0),
  add column deed_beneficiary_name text,
  add column originator_name text,
  add column names_corin_as_beneficiary boolean generated always as (coalesce(deed_beneficiary_name ~* '\mcorin\M', false)) stored,
  add column names_corin_as_originator boolean generated always as (coalesce(originator_name ~* '\mcorin\M', false)) stored;

comment on column public.broker_of_record.effective_rate_pct is
  'Note rate plus lender-retained charges, annualized over the stated term (VERIFY, counsel gate H). Not a usury determination.';
