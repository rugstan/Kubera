// Deal desk orchestration: create deals on their program's stage template,
// load the facts each stage event checks (engagement agreement, locked package
// sent, term sheet, compliance gates A/H, Form 159), apply the event, and
// edit deal fields subject to the term lock.

import { evaluateDealCompliance, type DealCompliance } from "@/lib/compliance/gates";
import type { DisclosureStore } from "@/lib/disclosures/store";
import { form159Satisfied } from "./form159";
import { applyStageEvent, assertEditable, stageTemplate, templateDigest, type StageAdvance, type StageContext } from "./stages";
import type { DealDeskStore } from "./store";
import type { Clock, Deal, NewDeal } from "./types";

export class DealError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DealError";
  }
}

export async function createDeal(deps: { store: DealDeskStore; now: Clock }, input: NewDeal, actor: string): Promise<Deal> {
  const template = stageTemplate(input.program);
  await deps.store.publishStageTemplate(template, templateDigest(template));
  return deps.store.createDeal({ ...input, stage: template.stages[0]!.key, stageTemplateVersion: template.version }, actor, deps.now());
}

/** Compliance evaluation for the deal; null when the facts it needs are not recorded yet. */
export async function loadDealCompliance(deps: { store: DealDeskStore; disclosures: DisclosureStore | null; now: Clock }, deal: Deal): Promise<{ compliance: DealCompliance | null; missing: string[] }> {
  const missing: string[] = [];
  if (deal.collateralRealProperty === null) missing.push("Record whether a lien on real property secures the loan.");
  if (!deps.disclosures) missing.push("The disclosure store is not configured, so MLDS status cannot be read.");
  if (missing.length) return { compliance: null, missing };

  const disclosures = await deps.disclosures!.listForDeal({ dealId: deal.id, ...(deal.leadId ? { leadId: deal.leadId } : {}) });
  const mlds = disclosures.find((d) => d.kind === "MLDS_RE882") ?? null;
  const loan = await deps.store.getLoanBrokerOfRecord(deal.id);
  const mods = (await deps.store.listModifications(deal.id)).filter((m) => m.status !== "withdrawn");
  const realProperty = Boolean(deal.collateralRealProperty);
  const compliance = evaluateDealCompliance({
    mlds: {
      facts: {
        kuberaRole: "broker",
        program: deal.program,
        collateral: loan?.collateral ?? { realPropertyLien: realProperty, equityPledgeOrUccOnly: false },
        tableFundedInKuberaName: loan?.tableFundedInKuberaName ?? false,
      },
      status: mlds?.status ?? null,
    },
    usury: loan
      ? {
          lender: loan.lender,
          noteRatePct: loan.noteRatePct,
          fedDiscountRatePct: loan.fedDiscountRatePct,
          collateral: loan.collateral,
          elements: loan.elements,
          tableFundedInKuberaName: loan.tableFundedInKuberaName,
          transactionDate: loan.transactionDate,
        }
      : undefined,
    modifications: loan ? mods.map((m) => m.facts) : undefined,
    now: deps.now(),
  });
  return { compliance, missing };
}

export async function stageContext(deps: { store: DealDeskStore; disclosures: DisclosureStore | null; now: Clock }, deal: Deal): Promise<StageContext & { complianceMissing: string[] }> {
  const [outreach, entries, forms] = await Promise.all([deps.store.listOutreach(deal.id), deps.store.listFeeEntries(deal.id), deps.store.listForm159(deal.id)]);
  const { compliance, missing } = await loadDealCompliance(deps, deal);
  const termSheet = [...outreach].reverse().find((o) => o.status === "term_sheet" && o.termSheetRef);
  return {
    engagementAgreementRef: deal.engagementAgreementRef,
    lockedPackageSent: outreach.some((o) => ["sent", "declined", "term_sheet"].includes(o.status)),
    termSheetRef: termSheet?.termSheetRef ?? null,
    compliance,
    form159Satisfied: form159Satisfied(deal, entries, forms),
    complianceMissing: missing,
  };
}

export async function advanceDeal(
  deps: { store: DealDeskStore; disclosures: DisclosureStore | null; now: Clock },
  input: { dealId: string; event: string; terms?: Record<string, unknown>; actor: string },
): Promise<StageAdvance & { deal: Deal }> {
  const deal = await deps.store.getDeal(input.dealId);
  if (!deal) throw new DealError(`Deal ${input.dealId} not found`);
  const { complianceMissing, ...context } = await stageContext(deps, deal);
  const result = applyStageEvent({ deal, event: input.event, context, terms: input.terms, now: deps.now() });
  if (!result.ok) {
    const reasons = result.reasons.some((r) => r.startsWith("Run the compliance evaluation")) ? [...result.reasons, ...complianceMissing] : result.reasons;
    return { ...result, reasons, deal };
  }
  const updated = await deps.store.updateDeal(deal.id, deal.recordVersion, { ...result.patch, updatedBy: input.actor }, input.actor, deps.now());
  return { ...result, deal: updated };
}

export type DealEdit = Partial<Pick<Deal, "title" | "borrowerName" | "propertyAddress" | "propertyState" | "loanAmountCents" | "collateralRealProperty" | "engagementAgreementRef" | "ownerId" | "program">>;

/** Edits deal fields. Locked terms (after term-sheet acceptance) change only through a documented modification. */
export async function editDeal(deps: { store: DealDeskStore; now: Clock }, dealId: string, expectedVersion: number, patch: DealEdit, actor: string): Promise<Deal> {
  const deal = await deps.store.getDeal(dealId);
  if (!deal) throw new DealError(`Deal ${dealId} not found`);
  if (patch.program && patch.program !== deal.program && deal.stage !== "intake") throw new DealError("The program can change only at intake (each program has its own stage template)");
  assertEditable(deal, patch);
  return deps.store.updateDeal(deal.id, expectedVersion, patch, actor, deps.now());
}
