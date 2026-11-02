-- Phase 3 integration fixes (slot 50).
--
-- 1. Jev re-sizing from the spreads (lib/spreads/workflow.ts, on
--    corin/document.extracted) is saved as a versioned spreads row of kind
--    'jev_resize'.
-- 2. Personal financial statement extractions are restricted personal
--    information: their fields (values and evidence) are sealed by the
--    application (lib/privacy/crypto.ts, envelope "pii1.…") before they are
--    stored. The database refuses a PFS row whose non-empty fields are not
--    sealed. Existing rows are not re-checked (NOT VALID); re-seal them with
--    the application before validating the constraint.

-- 1 · spreads kind ---------------------------------------------------------------------------
alter table public.spreads drop constraint if exists spreads_kind_check;
alter table public.spreads add constraint spreads_kind_check check (
  kind in ('operating_statement', 'quotes', 'global_cash_flow', 'hotel_str', 'senior_census', 'rent_roll', 'construction_budget', 'deal_summary', 'jev_resize')
);

-- 2 · sealed PFS fields ----------------------------------------------------------------------
alter table public.document_extractions drop constraint if exists document_extractions_pfs_sealed;
alter table public.document_extractions add constraint document_extractions_pfs_sealed check (
  doc_type is distinct from 'PFS'
  or fields = '{}'::jsonb
  or fields = '{"scalars": {}, "rows": []}'::jsonb
  -- coalesce: a non-object `fields` makes these NULL, and a NULL check would pass.
  or coalesce(jsonb_typeof(fields -> 'sealed') = 'string' and (fields ->> 'sealed') like 'pii1.%', false)
) not valid;

comment on constraint document_extractions_pfs_sealed on public.document_extractions is
  'PFS extraction fields are sealed by the application (AES-256-GCM, lib/privacy/crypto.ts); plaintext is refused.';
