-- Final fixes r2 (completeness): lenders@ term sheets are filed in the vault.
--
-- A lenders@ message classified `term_sheet` and routed to a deal has its
-- PDF / XLSX / XLS / CSV attachments stored in the quarantine bucket and
-- registered as `documents` rows of kind TERM_SHEET (lib/mail/attachments.ts).
-- The malware scan releases them, the document agent extracts them with the
-- TERM_SHEET spec, and the lenders agent builds the quote from that extraction.
--
-- Term sheets are the broker's working papers with one lender: portal members
-- (the borrower side) do not read them, and the deal desk keeps them out of
-- lender packages (lib/deals/runtime.ts).

alter table public.documents drop constraint if exists documents_kind_check;
alter table public.documents
  add constraint documents_kind_check
  check (kind in ('T12', 'RENT_ROLL', 'CENSUS', 'STR_REPORT', 'FRANCHISE_AGREEMENT', 'PIP_BUDGET', 'PFS', 'TAX_RETURN', 'APPRAISAL', 'OTHER', 'TERM_SHEET'));

drop policy if exists documents_read_member on public.documents;
create policy documents_read_member on public.documents for select to authenticated using (
  documents.kind <> 'TERM_SHEET'
  and exists (select 1 from public.deals d where d.lead_id = documents.lead_id and public.is_deal_member(d.id))
);
