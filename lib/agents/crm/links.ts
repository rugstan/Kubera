// Where a Corin deal or lead lives in Twenty, and who the advisor is there.
// The deal desk stores `twenty_opportunity_id` on the deal; the qualifier
// stores `twenty_person_id` / `twenty_opportunity_id` on the lead.

import type { SupabaseClient } from "@supabase/supabase-js";

export type CrmLinks = {
  dealId: string | null;
  leadId: string | null;
  opportunityId: string | null;
  personId: string | null;
  /** Deal-desk stage now (deals only). */
  dealStage: string | null;
  /** Supabase user id of the deal owner (deals only). */
  ownerUserId: string | null;
};

export type OpenDealLink = { dealId: string; leadId: string | null; opportunityId: string; stage: string };

export interface CrmLinkLookup {
  forDeal(dealId: string): Promise<CrmLinks | null>;
  forLead(leadId: string): Promise<CrmLinks | null>;
  /** Open deals that have a Twenty opportunity, for the reconcile sweep. */
  openDeals(limit: number): Promise<OpenDealLink[]>;
  /** Twenty workspace member id for a staff user (matched by email), or null. */
  memberIdForUser(userId: string): Promise<string | null>;
}

export class MemoryCrmLinks implements CrmLinkLookup {
  readonly deals = new Map<string, CrmLinks>();
  readonly leads = new Map<string, CrmLinks>();
  readonly members = new Map<string, string>();

  async forDeal(dealId: string) {
    return this.deals.get(dealId) ?? null;
  }
  async forLead(leadId: string) {
    return this.leads.get(leadId) ?? null;
  }
  async openDeals(limit: number) {
    return [...this.deals.values()]
      .filter((d): d is CrmLinks & { dealId: string; opportunityId: string; dealStage: string } => Boolean(d.dealId && d.opportunityId && d.dealStage))
      .slice(0, limit)
      .map((d) => ({ dealId: d.dealId, leadId: d.leadId, opportunityId: d.opportunityId, stage: d.dealStage }));
  }
  async memberIdForUser(userId: string) {
    return this.members.get(userId) ?? null;
  }
}

type DealRow = { id: string; lead_id: string | null; twenty_opportunity_id: string | null; stage: string | null; owner_id: string | null; status?: string | null };
type LeadRow = { id: string; twenty_person_id: string | null; twenty_opportunity_id: string | null };

const OPEN_STATUSES = ["active", "on_hold", "held_for_counsel"];

/** Resolves links from Supabase; member ids by matching the staff profile email to a Twenty member. */
export function supabaseCrmLinks(db: SupabaseClient, members: () => Promise<{ id: string; email: string | null }[]>): CrmLinkLookup {
  async function lead(leadId: string | null): Promise<LeadRow | null> {
    if (!leadId) return null;
    const { data, error } = await db.from("leads").select("id, twenty_person_id, twenty_opportunity_id").eq("id", leadId).maybeSingle();
    if (error) throw new Error(`leads lookup failed: ${error.message}`);
    return (data as LeadRow | null) ?? null;
  }
  return {
    async forDeal(dealId) {
      const { data, error } = await db.from("deals").select("id, lead_id, twenty_opportunity_id, stage, owner_id").eq("id", dealId).maybeSingle();
      if (error) throw new Error(`deals lookup failed: ${error.message}`);
      const deal = data as DealRow | null;
      if (!deal) return null;
      const l = await lead(deal.lead_id);
      return { dealId: deal.id, leadId: deal.lead_id, opportunityId: deal.twenty_opportunity_id ?? l?.twenty_opportunity_id ?? null, personId: l?.twenty_person_id ?? null, dealStage: deal.stage, ownerUserId: deal.owner_id };
    },
    async forLead(leadId) {
      const l = await lead(leadId);
      if (!l) return null;
      return { dealId: null, leadId: l.id, opportunityId: l.twenty_opportunity_id, personId: l.twenty_person_id, dealStage: null, ownerUserId: null };
    },
    async openDeals(limit) {
      const { data, error } = await db
        .from("deals")
        .select("id, lead_id, twenty_opportunity_id, stage")
        .not("twenty_opportunity_id", "is", null)
        .not("stage", "is", null)
        .in("status", OPEN_STATUSES)
        .order("updated_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(`open deals lookup failed: ${error.message}`);
      return ((data ?? []) as DealRow[]).map((d) => ({ dealId: d.id, leadId: d.lead_id, opportunityId: d.twenty_opportunity_id!, stage: d.stage! }));
    },
    async memberIdForUser(userId) {
      const { data, error } = await db.from("profiles").select("email").eq("id", userId).maybeSingle();
      if (error) throw new Error(`profile lookup failed: ${error.message}`);
      const email = (data as { email?: string } | null)?.email?.toLowerCase();
      if (!email) return null;
      return (await members()).find((m) => m.email?.toLowerCase() === email)?.id ?? null;
    },
  };
}
