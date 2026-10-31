import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { reviewGuardrailSink, type GuardrailSink } from "./sink";
import { SupabaseReviewStore } from "./supabase";
import type { ReviewStore } from "./types";

// Production wiring (Global rule 3): without Supabase there is no review queue
// and the guardrail sink is absent. The filter itself still runs; its hits are
// then only logged.

let override: { store: ReviewStore | null } | undefined;
let supabaseStore: ReviewStore | null | undefined;

/** The review store, or null when Supabase is not configured. */
export function reviewStore(): ReviewStore | null {
  if (override) return override.store;
  if (supabaseStore !== undefined) return supabaseStore;
  const db = supabaseAdmin();
  supabaseStore = db ? new SupabaseReviewStore(db) : null;
  return supabaseStore;
}

/** The sink the advisor reports guardrail hits to, or null when there is no store. */
export function guardrailSink(): GuardrailSink | null {
  const store = reviewStore();
  return store ? reviewGuardrailSink(store) : null;
}

/** Test hook: route review calls to a store (null = none); undefined restores the env-derived one. */
export function setReviewStore(store: ReviewStore | null | undefined): void {
  override = store === undefined ? undefined : { store };
}
