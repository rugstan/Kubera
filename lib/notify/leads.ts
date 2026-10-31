import type { SupabaseClient } from "@supabase/supabase-js";

// Read access to the `leads` rows the notification triggers need. Triggers
// pass a lead id, not contact details, so no PII travels over the internal
// API routes.

export type LeadRecord = {
  id: string;
  createdAt: string;
  /** Jev urgency tier, e.g. TIER_1_INSTITUTIONAL_HOT; null for advisor-only leads (no automated scoring). */
  tier: string | null;
  loanAmount: number | null;
  program: string | null;
  assetType: string | null;
  contact: { firstName: string; email: string | null; phone: string | null; consent: boolean };
};

export interface LeadSource {
  get(id: string): Promise<LeadRecord | null>;
  /** Tier-1 leads created since `sinceIso`, oldest first. */
  recentTier1(sinceIso: string): Promise<LeadRecord[]>;
}

type Row = Record<string, unknown>;

function toLead(r: Row): LeadRecord {
  const contact = (r.contact ?? {}) as Record<string, unknown>;
  const intake = (r.intake ?? {}) as Record<string, unknown>;
  return {
    id: String(r.id),
    createdAt: String(r.created_at),
    tier: (r.urgency_tier as string | null) ?? null,
    loanAmount: r.loan_amount == null ? null : Number(r.loan_amount),
    program: (r.primary_program as string | null) ?? null,
    assetType: typeof intake.assetType === "string" ? intake.assetType : null,
    contact: {
      firstName: typeof contact.firstName === "string" && contact.firstName ? contact.firstName : "there",
      email: typeof contact.email === "string" && contact.email ? contact.email : null,
      phone: typeof contact.phone === "string" && contact.phone ? contact.phone : null,
      consent: contact.consent === true,
    },
  };
}

const COLUMNS = "id, created_at, urgency_tier, primary_program, loan_amount, intake, contact";

export class SupabaseLeadSource implements LeadSource {
  constructor(private readonly db: SupabaseClient) {}

  async get(id: string) {
    const { data, error } = await this.db.from("leads").select(COLUMNS).eq("id", id).maybeSingle();
    if (error) throw new Error(`lead lookup failed: ${error.message}`);
    return data ? toLead(data) : null;
  }

  async recentTier1(sinceIso: string) {
    const { data, error } = await this.db
      .from("leads")
      .select(COLUMNS)
      .eq("urgency_tier", "TIER_1_INSTITUTIONAL_HOT")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: true })
      .limit(100);
    if (error) throw new Error(`tier-1 lead lookup failed: ${error.message}`);
    return (data ?? []).map(toLead);
  }
}

export class MemoryLeadSource implements LeadSource {
  constructor(readonly leads: LeadRecord[] = []) {}

  async get(id: string) {
    return this.leads.find((l) => l.id === id) ?? null;
  }

  async recentTier1(sinceIso: string) {
    return this.leads.filter((l) => l.tier === "TIER_1_INSTITUTIONAL_HOT" && l.createdAt >= sinceIso);
  }
}
