import "server-only";
import { agentSafety } from "@/lib/agents/core/server";
import { supabaseExtractionStore } from "@/lib/agents/documents/store";
import { modelGateway } from "@/lib/ai/gateway";
import { supabaseDocumentStore } from "@/lib/documents/store";
import { demoDesks } from "@/lib/deals/demo";
import { dealDeskRuntime, type DealDeskRuntime } from "@/lib/deals/runtime";
import { supabaseAdmin } from "@/lib/supabase/server";
import { supabaseSpreadStore, type SpreadStore } from "@/lib/spreads/store";
import { packageSpreadsFromSaved, type SavedPackageSpreads } from "@/lib/spreads/workflow";
import { vaultTermSheetAttachments, type TermSheetAttachmentSource } from "./attachments";
import type { OutreachDeps } from "./outreach";
import type { ExecutiveSummarySpec } from "./package";
import type { LenderMatchStore, PartnerSource, TermSheetMailSource } from "./store";
import { SupabaseLenderMatchStore, SupabasePartnerSource, SupabaseTermSheetMailSource } from "./store-supabase";

// Production wiring for lender matching. Env-gated (Global rule 3): in
// fake-auth mode it runs on the shared in-memory demo desks
// (lib/deals/demo.ts); otherwise, without Supabase the lenders desk renders
// "not configured"; without an Anthropic
// key term sheets are parsed by rules and all land in the review queue; the
// approval gate and mailer come from the deal desk runtime (its lenderMailer,
// null unless LENDER_EMAIL_ENABLED=true), so with no approvals queue every
// submission stays pending and nothing is sent, and while email to lenders is
// off an approved submission's link goes to staff to send by hand.

export type LenderRuntime = {
  desk: DealDeskRuntime;
  store: LenderMatchStore;
  partners: PartnerSource;
  mail: TermSheetMailSource;
  /** Term sheets filed from lenders@ attachments and their extractions; null in demo mode (no filed mail). */
  attachments: TermSheetAttachmentSource | null;
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
  const demo = demoDesks();
  if (desk && demo) {
    return {
      desk,
      store: demo.lenderStore,
      partners: demo.partners,
      mail: demo.termSheetMail,
      attachments: null,
      spreads: demo.spreads,
      outreach: { desk: desk.store, boxes: demo.lenderStore, gate: desk.gate, mailer: desk.lenderMailer, storage: desk.storage, renderPdf: renderSummaryPdf, baseUrl: desk.baseUrl, now: desk.now, holds: desk.checklist?.holds ?? null, events: agentSafety().events },
    };
  }
  const db = supabaseAdmin();
  if (!desk || !db) return null;
  return {
    desk,
    store: new SupabaseLenderMatchStore(db),
    partners: new SupabasePartnerSource(db),
    mail: new SupabaseTermSheetMailSource(db),
    attachments: vaultTermSheetAttachments({ documents: supabaseDocumentStore(db), extractions: supabaseExtractionStore(db) }),
    spreads: supabaseSpreadStore(db),
    outreach: { desk: desk.store, boxes: new SupabaseLenderMatchStore(db), gate: desk.gate, mailer: desk.lenderMailer, storage: desk.storage, renderPdf: renderSummaryPdf, baseUrl: desk.baseUrl, now: desk.now, holds: desk.checklist?.holds ?? null, events: agentSafety().events },
  };
}

export { modelGateway };
