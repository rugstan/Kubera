// Deal desk orchestration: create deals on their program's stage template,
// load the facts each stage event checks (engagement agreement, locked package
// sent, term sheet, compliance gates A/H, Form 159), apply the event, and
// edit deal fields subject to the term lock.

import { dealClosingGate, type ChecklistDeps } from "@/lib/checklists/service";
import { BROKER_OF_RECORD_FILE_MISSING, evaluateDealCompliance, type DealCompliance } from "@/lib/compliance/gates";
import type { DisclosureStore } from "@/lib/disclosures/store";
import { form159Satisfied } from "./form159";
import { revokeDealShareLinks } from "./share-links";
import { isTerminalStage } from "./stage-catalog";
import { stageChangeOf, type DealStageEventSink } from "./stage-events";
import { CLOSING_TARGET_STAGES, applyStageEvent, assertEditable, availableEvents, stageTemplate, templateDigest, type StageAdvance, type StageContext } from "./stages";
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
  // Gate H elements are recorded on every loan. Without the broker-of-record
  // row the closing gate fails closed (evaluateDealCompliance blocks closing
  // when no usury facts are supplied) and the missing record is reported.
  if (!loan) missing.push("Record the loan's broker-of-record file (lender, category, note rate, elements) before closing.");
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
    modifications: mods.map((m) => m.facts),
    now: deps.now(),
  });
  return { compliance, missing };
}

export type DealDeskDeps = {
  store: DealDeskStore;
  disclosures: DisclosureStore | null;
  now: Clock;
  /**
   * WS-U checklist and screening services: open sanctions holds and the
   * closing gate (checklists, conditions, rescreen window). null = not
   * configured, which fails closed: only withdraw / mark lost apply.
   */
  checklist: ChecklistDeps | null;
  /** Milestone notifications for stage changes (WS-J); null/absent = none. */
  stageEvents?: DealStageEventSink | null;
  /** Called when the stage-event sink throws (the advance itself stands). */
  onStageEventError?: (err: unknown) => void;
};

const HOLDS_UNAVAILABLE = "Sanctions holds cannot be checked because the checklist and screening desk is not configured.";

export async function stageContext(deps: DealDeskDeps, deal: Deal): Promise<StageContext & { complianceMissing: string[] }> {
  const [outreach, entries, forms] = await Promise.all([deps.store.listOutreach(deal.id), deps.store.listFeeEntries(deal.id), deps.store.listForm159(deal.id)]);
  const { compliance, missing } = await loadDealCompliance(deps, deal);
  const termSheet = [...outreach].reverse().find((o) => o.status === "term_sheet" && o.termSheetRef);
  const activeHolds = deps.checklist ? await deps.checklist.holds.active(deal.id) : null;
  // The closing gate is only evaluated when an event into closing is available from this stage.
  const closingReachable = availableEvents(stageTemplate(deal.program), deal.stage).some((e) => CLOSING_TARGET_STAGES.has(e.to));
  const closingGate = closingReachable ? (deps.checklist ? await dealClosingGate({ ...deps.checklist, now: deps.checklist.now ?? deps.now }, deal.id) : null) : undefined;
  return {
    engagementAgreementRef: deal.engagementAgreementRef,
    lockedPackageSent: outreach.some((o) => ["sent", "declined", "term_sheet"].includes(o.status)),
    termSheetRef: termSheet?.termSheetRef ?? null,
    compliance,
    form159Satisfied: form159Satisfied(deal, entries, forms),
    holds: activeHolds ? activeHolds.map((h) => h.detail) : [HOLDS_UNAVAILABLE],
    ...(closingGate !== undefined ? { closingGate: closingGate && { ready: closingGate.ready, reasons: closingGate.reasons } } : {}),
    complianceMissing: missing,
  };
}

export async function advanceDeal(deps: DealDeskDeps, input: { dealId: string; event: string; terms?: Record<string, unknown>; actor: string }): Promise<StageAdvance & { deal: Deal }> {
  const deal = await deps.store.getDeal(input.dealId);
  if (!deal) throw new DealError(`Deal ${input.dealId} not found`);
  const { complianceMissing, ...context } = await stageContext(deps, deal);
  const result = applyStageEvent({ deal, event: input.event, context, terms: input.terms, now: deps.now() });
  if (!result.ok) {
    const needsRecords = result.reasons.some((r) => r.startsWith("Run the compliance evaluation") || r === BROKER_OF_RECORD_FILE_MISSING);
    const reasons = needsRecords ? [...new Set([...result.reasons, ...complianceMissing])] : result.reasons;
    return { ...result, reasons, deal };
  }
  const updated = await deps.store.updateDeal(deal.id, deal.recordVersion, { ...result.patch, updatedBy: input.actor }, input.actor, deps.now());
  // Closed, withdrawn or lost: lenders lose access to the package. The share
  // route also refuses links on a settled deal, so a failure here is logged
  // and the advance (already committed) stands.
  if (isTerminalStage(updated.stage)) {
    try {
      await revokeDealShareLinks(deps.store, updated.id, input.actor, `Deal ${updated.stage}`, deps.now());
    } catch (err) {
      console.error("[deals] share link revocation failed:", err instanceof Error ? err.message : err);
    }
  }
  if (deps.stageEvents) {
    try {
      await deps.stageEvents.stageChanged(stageChangeOf(updated, result.from, input.event));
    } catch (err) {
      (deps.onStageEventError ?? ((e) => console.error("[deals] stage notification failed:", e instanceof Error ? e.message : e)))(err);
    }
  }
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
