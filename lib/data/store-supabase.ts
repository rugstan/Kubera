import type { SupabaseClient } from "@supabase/supabase-js";
import type { PropertyFactsStore } from "./store";
import type { PropertyFacts } from "./types";

// Supabase-backed cache over public.property_facts (service role only; RLS
// denies anon and authenticated). Cache failures are logged and swallowed: a
// broken cache must never break a property lookup.

export type PropertyFactsRow = {
  address_key: string;
  address: PropertyFacts["address"];
  apn: string | null;
  county: string | null;
  facts: PropertyFacts;
  source_status: PropertyFacts["sources"];
  fetched_at: string;
  expires_at: string;
};

export function toRow(facts: PropertyFacts): PropertyFactsRow {
  return {
    address_key: facts.addressKey,
    address: facts.address,
    apn: facts.apn?.value ?? null,
    county: facts.county?.value ?? null,
    facts: { ...facts, fromCache: false },
    source_status: facts.sources,
    fetched_at: facts.fetchedAt,
    expires_at: facts.expiresAt,
  };
}

export function fromRow(row: Pick<PropertyFactsRow, "facts">): PropertyFacts {
  return { ...row.facts, fromCache: true };
}

export class SupabasePropertyFactsStore implements PropertyFactsStore {
  constructor(private readonly db: SupabaseClient) {}

  async get(addressKey: string, now: Date): Promise<PropertyFacts | null> {
    try {
      const { data, error } = await this.db
        .from("property_facts")
        .select("facts")
        .eq("address_key", addressKey)
        .gt("expires_at", now.toISOString())
        .maybeSingle();
      if (error || !data) return null;
      return fromRow(data as Pick<PropertyFactsRow, "facts">);
    } catch (err) {
      console.error("property_facts read failed", err instanceof Error ? err.message : err);
      return null;
    }
  }

  async put(facts: PropertyFacts): Promise<void> {
    try {
      const { error } = await this.db.from("property_facts").upsert(toRow(facts), { onConflict: "address_key" });
      if (error) console.error("property_facts write failed", error.message);
    } catch (err) {
      console.error("property_facts write failed", err instanceof Error ? err.message : err);
    }
  }
}
