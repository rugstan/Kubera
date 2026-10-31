// Spreads for a deal or lead: load its extractions, build every applicable
// spread from the accepted ones, and save a new version of each.

import type { ExtractionStore } from "@/lib/agents/documents/store";
import { buildSpreadBundle, type SpreadBundle, type SpreadContext } from "./deal";
import { saveSpreadBundle, type SpreadRecord, type SpreadStore, type SpreadSubject } from "./store";

export type SpreadServiceDeps = { extractions: ExtractionStore; spreads: SpreadStore };

export async function recalculateSpreads(
  deps: SpreadServiceDeps,
  subject: SpreadSubject,
  ctx: SpreadContext,
  actor: string,
): Promise<{ bundle: SpreadBundle; saved: SpreadRecord[] }> {
  const extractions = subject.dealId ? await deps.extractions.listForDeal(subject.dealId) : subject.leadId ? await deps.extractions.listForLead(subject.leadId) : [];
  const bundle = buildSpreadBundle(extractions, ctx);
  // Inputs hold the analyst's context only (no document values); results hold the numbers.
  const { quotes, sba, ...rest } = ctx;
  const inputs = { ...rest, quoteCount: quotes?.length ?? 0, sba: Boolean(sba) };
  const saved = await saveSpreadBundle(deps.spreads, subject, bundle, { inputs, createdBy: actor });
  return { bundle, saved };
}
