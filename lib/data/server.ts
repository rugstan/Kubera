import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getPropertyFacts, type GetPropertyFactsOptions } from "./property-facts";
import { SupabasePropertyFactsStore } from "./store-supabase";
import type { PropertyAddress, PropertyFacts } from "./types";

/**
 * getPropertyFacts wired to the production cache (public.property_facts via the
 * service-role client). With Supabase unconfigured it runs uncached.
 */
export async function getPropertyFactsCached(address: PropertyAddress, opts: GetPropertyFactsOptions = {}): Promise<PropertyFacts> {
  const db = supabaseAdmin();
  return getPropertyFacts(address, { store: db ? new SupabasePropertyFactsStore(db) : undefined, ...opts });
}
