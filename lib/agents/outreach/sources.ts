import type { SupabaseClient } from "@supabase/supabase-js";
import type { Condition } from "@/lib/checklists/conditions";
import type { ChecklistStore } from "@/lib/checklists/store";
import type { DealChecklistItem } from "@/lib/checklists/types";
import type { ConstructionStore } from "@/lib/construction/store";
import type { ConstructionProject, ConstructionReport } from "@/lib/construction/types";
import type { DealDeskStore } from "@/lib/deals/store";
import type { Deal } from "@/lib/deals/types";
import type { LeadRecord, LeadSource } from "@/lib/notify/leads";
import { SPEED_TIERS } from "./speed-to-lead";

// What the chasers read. They never write to these records: a chaser only
// looks at checklist state, report orders and leads, and sends messages.

export type DealOutreachContext = {
  deal: Pick<Deal, "id" | "title" | "stage" | "status" | "leadId" | "closedOn" | "stageEnteredAt" | "propertyAddress">;
  items: DealChecklistItem[];
  conditions: Condition[];
  /** Checklist item ids with an upload in progress (reserved or scanning): not nagged. */
  uploadsInFlight: ReadonlySet<string>;
};

export type VendorOrderContext = {
  project: Pick<ConstructionProject, "id" | "name" | "dealId" | "leadId" | "propertyAddress" | "city" | "state" | "phase">;
  report: ConstructionReport;
};

export interface OutreachSources {
  /** Active (not held, won, lost or withdrawn) deals with their checklist state. */
  activeDeals(): Promise<DealOutreachContext[]>;
  /** Third-party report orders that are with a vendor. */
  vendorOrders(): Promise<VendorOrderContext[]>;
  /** Tier-1/2 leads created since `sinceIso`, oldest first. */
  hotLeads(sinceIso: string): Promise<LeadRecord[]>;
  lead(id: string): Promise<LeadRecord | null>;
}

export class MemorySources implements OutreachSources {
  deals: DealOutreachContext[] = [];
  orders: VendorOrderContext[] = [];
  leads: LeadRecord[] = [];

  async activeDeals() {
    return this.deals;
  }
  async vendorOrders() {
    return this.orders;
  }
  async hotLeads(sinceIso: string) {
    return this.leads.filter((l) => (SPEED_TIERS as readonly string[]).includes(l.tier ?? "") && l.createdAt >= sinceIso);
  }
  async lead(id: string) {
    return this.leads.find((l) => l.id === id) ?? null;
  }
}

const VENDOR_STATUSES: ReadonlySet<string> = new Set(["ordered", "in_progress", "revision_requested"]);
const MAX_DEALS = 300;

export type ComposedSourceDeps = {
  checklists: ChecklistStore;
  deals: Pick<DealDeskStore, "listDeals">;
  construction?: Pick<ConstructionStore, "listProjects" | "listReports"> | null;
  leads: LeadSource;
  /** Ids of Tier-1/2 leads created since a time (database query); omit and hotLeads is empty. */
  hotLeadIds?: (sinceIso: string) => Promise<string[]>;
};

export function composeSources(d: ComposedSourceDeps): OutreachSources {
  return {
    async activeDeals() {
      const deals = (await d.deals.listDeals({ openOnly: true, limit: MAX_DEALS })).filter((x) => x.status === "active");
      const out: DealOutreachContext[] = [];
      for (const deal of deals) {
        const items = await d.checklists.itemsForDeal(deal.id);
        if (items.length === 0) continue;
        const [conditions, files] = await Promise.all([d.checklists.conditionsForDeal(deal.id), d.checklists.filesForDeal(deal.id)]);
        out.push({
          deal: { id: deal.id, title: deal.title, stage: deal.stage, status: deal.status, leadId: deal.leadId, closedOn: deal.closedOn, stageEnteredAt: deal.stageEnteredAt, propertyAddress: deal.propertyAddress },
          items,
          conditions,
          uploadsInFlight: new Set(files.filter((f) => f.status === "pending_upload" || f.status === "scanning").map((f) => f.itemId)),
        });
      }
      return out;
    },
    async vendorOrders() {
      if (!d.construction) return [];
      const out: VendorOrderContext[] = [];
      for (const project of await d.construction.listProjects()) {
        if (project.phase !== "pre_closing") continue;
        for (const report of await d.construction.listReports(project.id)) {
          if (VENDOR_STATUSES.has(report.status)) out.push({ project, report });
        }
      }
      return out;
    },
    async hotLeads(sinceIso) {
      if (!d.hotLeadIds) return [];
      const leads: LeadRecord[] = [];
      for (const id of await d.hotLeadIds(sinceIso)) {
        const lead = await d.leads.get(id);
        if (lead) leads.push(lead);
      }
      return leads;
    },
    lead: (id) => d.leads.get(id),
  };
}

/** Ids of Tier-1/2 leads since a time, oldest first (the sweep's backstop for a missed trigger). */
export function supabaseHotLeadIds(db: SupabaseClient): (sinceIso: string) => Promise<string[]> {
  return async (sinceIso) => {
    const { data, error } = await db
      .from("leads")
      .select("id")
      .in("urgency_tier", [...SPEED_TIERS])
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: true })
      .limit(100);
    if (error) throw new Error(`hot lead lookup failed: ${error.message}`);
    return (data ?? []).map((r) => String(r.id));
  };
}
