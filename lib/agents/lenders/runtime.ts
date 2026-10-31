import "server-only";
import { agentSafety } from "@/lib/agents/core/server";
import { modelGateway } from "@/lib/ai/gateway";
import { dealDeskRuntime, type DealDeskRuntime } from "@/lib/deals/runtime";
import { supabaseAdmin } from "@/lib/supabase/server";
import { supabaseSpreadStore, type SpreadStore } from "@/lib/spreads/store";
import { packageSpreadsFromSaved, type SavedPackageSpreads } from "@/lib/spreads/workflow";
import type { OutreachDeps } from "./outreach";
import type { ExecutiveSummarySpec } from "./package";
import type { LenderMatchStore, PartnerSource, TermSheetMailSource } from "./store";
import { SupabaseLenderMatchStore, SupabasePartnerSource, SupabaseTermSheetMailSource } from "./store-supabase";

// Production wiring for lender matching. Env-gated (Global rule 3): without
// Supabase the lenders desk renders "not configured"; without an Anthropic
// key term sheets are parsed by rules and all land in the review queue; the
// approval gate and mailer come from the deal desk runtime, so with no
// approvals queue every submission stays pending and nothing is sent.

export type LenderRuntime = {
  desk: DealDeskRuntime;
  store: LenderMatchStore;
  partners: PartnerSource;
  mail: TermSheetMailSource;
  outreach: OutreachDeps;
  /** Saved spreads (WS-L), the default source of the desk's metrics. */
  spreads: SpreadStore;
};

/** The latest saved spread bundle for the deal (or its lead) as package metrics; null when none is saved. */
export async function savedSpreadsFor(rt: Pick<LenderRuntime, "spreads">, deal: { id: string; leadId: string | null }): Promise<SavedPackageSpreads | null> {
  try {
    return (await packageSpreadsFromSaved(rt.spreads, { dealId: deal.id, leadId: null })) ?? (deal.leadId ? await packageSpreadsFromSaved(rt.spreads, { dealId: null, leadId: deal.leadId }) : null);
  } catch (err) {
    console.warn("[lenders] saved spreads unavailable", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function renderSummaryPdf(spec: ExecutiveSummarySpec): Promise<Uint8Array> {
  const { renderExecutiveSummaryPdf } = await import("./package-pdf");
  return renderExecutiveSummaryPdf(spec);
}

/** Index levels for floating-rate term sheets that quote only a spread (VERIFY daily; optional). */
export function indexRatesFromEnv(env: Record<string, string | undefined> = process.env): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, key] of [
    ["SOFR", "LENDER_INDEX_SOFR_PCT"],
    ["PRIME", "LENDER_INDEX_PRIME_PCT"],
    ["TREASURY", "LENDER_INDEX_TREASURY_PCT"],
  ] as const) {
    const v = Number(env[key]);
    if (env[key] && Number.isFinite(v) && v >= 0 && v < 25) out[name] = v;
  }
  return out;
}

export function lenderRuntime(): LenderRuntime | null {
  const desk = dealDeskRuntime();
  const db = supabaseAdmin();
  if (!desk || !db) return null;
  return {
    desk,
    store: new SupabaseLenderMatchStore(db),
    partners: new SupabasePartnerSource(db),
    mail: new SupabaseTermSheetMailSource(db),
    spreads: supabaseSpreadStore(db),
    outreach: { desk: desk.store, boxes: new SupabaseLenderMatchStore(db), gate: desk.gate, mailer: desk.mailer, storage: desk.storage, renderPdf: renderSummaryPdf, baseUrl: desk.baseUrl, now: desk.now, events: agentSafety().events },
  };
}

export { modelGateway };
