import "server-only";
import { supabaseExtractionStore } from "@/lib/agents/documents/store";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { SpreadServiceDeps } from "./service";
import { supabaseSpreadStore } from "./store";

// Server wiring for the spreads service; null when Supabase is not configured.
export function spreadServiceDeps(): SpreadServiceDeps | null {
  const db = supabaseAdmin();
  return db ? { extractions: supabaseExtractionStore(db), spreads: supabaseSpreadStore(db) } : null;
}
