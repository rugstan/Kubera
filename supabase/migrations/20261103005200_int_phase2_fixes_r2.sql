-- Phase 2 integration fixes, round 2 (slot 52, after slot 51).
--
-- Gate H lender no-exemption notice: when a broker approves the notice but no
-- mailer can send it, the approval is recorded on the modification (it is not
-- claimed in the approvals queue), so staff see that the notice is approved,
-- send the approved text themselves and record "Notice sent".

alter table public.deal_modifications
  add column if not exists lender_notice_approval_id text,
  add column if not exists lender_notice_approved_at timestamptz;
