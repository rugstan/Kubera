import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseExtractionStore } from "@/lib/agents/documents/store";
import { dealPrograms, type DealProgram } from "@/lib/deals/types";
import { supabaseAdmin } from "@/lib/supabase/server";
import { intakeSchema } from "@/lib/validation";
import type { SpreadServiceDeps } from "./service";
import { supabaseSpreadStore } from "./store";
import type { SpreadSubjectInfo, SpreadWorkflowDeps } from "./workflow";

// Server wiring for the spreads service; null when Supabase is not configured.
export function spreadServiceDeps(): SpreadServiceDeps | null {
  const db = supabaseAdmin();
  return db ? { extractions: supabaseExtractionStore(db), spreads: supabaseSpreadStore(db) } : null;
}

const program = (p: unknown): DealProgram | null => ((dealPrograms as readonly string[]).includes(String(p)) ? (p as DealProgram) : null);

/** Deal ↔ lead resolution and the lead's intake, for the document.extracted workflow. */
export function supabaseSpreadSubjects(db: SupabaseClient): SpreadWorkflowDeps["subject"] {
  return async ({ dealId, leadId }): Promise<SpreadSubjectInfo> => {
    let deal: { id: string; lead_id: string | null; program: string } | null = null;
    if (dealId) {
      const { data, error } = await db.from("deals").select("id, lead_id, program").eq("id", dealId).maybeSingle<{ id: string; lead_id: string | null; program: string }>();
      if (error) throw new Error(`deals read failed: ${error.message}`);
      deal = data;
    } else if (leadId) {
      const { data, error } = await db.from("deals").select("id, lead_id, program").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(1).maybeSingle<{ id: string; lead_id: string | null; program: string }>();
      if (error) throw new Error(`deals read failed: ${error.message}`);
      deal = data;
    }
    const lead = deal?.lead_id ?? leadId;
    let intake: SpreadSubjectInfo["intake"] = null;
    if (lead) {
      const { data, error } = await db.from("leads").select("intake").eq("id", lead).maybeSingle<{ intake: unknown }>();
      if (error) throw new Error(`leads read failed: ${error.message}`);
      const parsed = intakeSchema.safeParse(data?.intake);
      intake = parsed.success ? parsed.data : null;
    }
    return { dealId: deal?.id ?? null, leadId: lead ?? null, intake, program: program(deal?.program) };
  };
}

/** Everything the document.extracted → spreads → Jev workflow needs; null without Supabase. */
export function spreadWorkflowDeps(): SpreadWorkflowDeps | null {
  const db = supabaseAdmin();
  if (!db) return null;
  return { extractions: supabaseExtractionStore(db), spreads: supabaseSpreadStore(db), subject: supabaseSpreadSubjects(db), now: () => new Date() };
}
