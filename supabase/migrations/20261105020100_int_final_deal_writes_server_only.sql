-- Final fixes (round 1, backend security): deals and deal memberships are
-- written by the server only.
--
-- 20261103000100_i_auth_profiles_approvals granted INSERT and UPDATE on
-- public.deals and public.deal_members to `authenticated`, with policies that
-- let any broker or admin with an aal2 session write them. No application
-- code uses those grants: the staff app reads through the user-scoped client
-- (pipeline, documents) and every deal-desk write goes through the server with
-- the service role (SupabaseDealDeskStore), which applies the MLDS hard block,
-- the sanctions (OFAC) hold and the stage-template events. A broker holding
-- their own access token could otherwise PATCH /rest/v1/deals directly and
-- move a deal to closing without a signed MLDS, or reactivate a held deal.
--
-- Reads are unchanged: staff with MFA read every deal, portal members read
-- their own deals and memberships.

revoke insert, update, delete, truncate, references, trigger on public.deals, public.deal_members from authenticated;
revoke all on public.deals, public.deal_members from anon;

drop policy if exists deals_insert_broker on public.deals;
drop policy if exists deals_update_broker on public.deals;
drop policy if exists deal_members_insert_broker on public.deal_members;
drop policy if exists deal_members_update_broker on public.deal_members;
