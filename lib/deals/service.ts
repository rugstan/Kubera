// Deal desk orchestration: create deals on their program's stage template,
// load the facts each stage event checks (engagement agreement, locked package
// sent, term sheet, compliance gates A/H, Form 159), apply the event, and
// edit deal fields subject to the term lock.

import { dealClosingGate, type ChecklistDeps } from "@/lib/checklists/service";
import { BROKER_OF_RECORD_FILE_MISSING, evaluateDealCompliance, type DealCompliance } from "@/lib/compliance/gates";
import { namesKubera } from "@/lib/disclosures/broker-of-record";
import type { DisclosureRecord, DisclosureStore } from "@/lib/disclosures/store";
import { governingNoteRate } from "./broker-of-record";
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

  const mlds = currentMlds(await deps.disclosures!.listForDeal({ dealId: deal.id, ...(deal.leadId ? { leadId: deal.leadId } : {}) }));
  const loan = await deps.store.getLoanBrokerOfRecord(deal.id);
  const mods = (await deps.store.listModifications(deal.id)).filter((m) => m.status !== "withdrawn");
  const realProperty = Boolean(deal.collateralRealProperty);
  // Gate H elements are recorded on every loan. Without the broker-of-record
  // row the closing gate fails closed (evaluateDealCompliance blocks closing
  // with BROKER_OF_RECORD_FILE_MISSING when no usury facts are supplied).
  if (!loan) missing.push(BROKER_OF_RECORD_FILE_MISSING);
  const compliance = evaluateDealCompliance({
    mlds: {
      facts: {
        kuberaRole: "broker",
        program: deal.program,
        collateral: loan?.collateral ?? { realPropertyLien: realProperty, equityPledgeOrUccOnly: false },
        tableFundedInKuberaName: loan?.tableFundedInKuberaName ?? false,
        ...namesKubera(loan ?? {}),
      },
      status: mlds?.status ?? null,
    },
    ...(mlds ? mldsTimerInput(mlds) : {}),
    usury: loan
      ? {
          lender: loan.lender,
          noteRatePct: loan.noteRatePct,
          fedDiscountRatePct: loan.fedDiscountRatePct,
          ...(loan.lenderCharges ? { lenderCharges: loan.lenderCharges } : {}),
          collateral: loan.collateral,
          elements: loan.elements,
          tableFundedInKuberaName: loan.tableFundedInKuberaName,
          transactionDate: loan.transactionDate,
        }
      : undefined,
    modifications: mods.map((m) => m.facts),
    now: deps.now(),
  });
  // The rate gate H evaluated must be the rate the deal is locked at.
  const governing = loan ? await governingNoteRate(deps.store, deal) : null;
  if (loan && governing !== null && governing !== loan.noteRatePct) {
    compliance.gates.closing = {
      allowed: false,
      reasons: [...compliance.gates.closing.reasons, `The locked note rate (${governing}%) differs from the ${loan.noteRatePct}% gate H evaluated; update the broker-of-record file.`],
    };
  }
  return { compliance, missing };
}

/** The deal's current MLDS (newest non-superseded RE 882 record). */
function currentMlds(records: DisclosureRecord[]): DisclosureRecord | null {
  return records.filter((d) => d.kind === "MLDS_RE882" && d.status !== "superseded").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

/**
 * The B&P §10240 delivery clock for the current MLDS: from the completed
 * written application to the earlier of 3 business days or obligation;
 * delivery is the send for signature. A re-issued MLDS (supersedes a signed
 * one) has no fresh statutory clock, so it is not timed here.
 */
export function mldsTimerInput(mlds: DisclosureRecord): { timer?: { applicationCompletedAt: Date; borrowerObligatedAt: Date | null; deliveredAt: Date | null } } {
  if (!mlds.applicationCompletedAt || mlds.supersedesId) return {};
  return {
    timer: {
      applicationCompletedAt: new Date(mlds.applicationCompletedAt),
      borrowerObligatedAt: mlds.borrowerObligatedAt ? new Date(mlds.borrowerObligatedAt) : null,
      deliveredAt: mlds.sentAt ? new Date(mlds.sentAt) : null,
    },
  };
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

/** A designated-officer override for a collateral change after an MLDS case was opened. */
export type CollateralOverride = { officer: boolean; reason: string };

/**
 * Edits deal fields. Locked terms (after term-sheet acceptance) change only
 * through a documented modification. Once an MLDS (RE 882) case is open the
 * collateral answer drives gate A, so it changes only with a designated
 * officer's override and a recorded reason (the open MLDS still has to be
 * signed or superseded either way).
 */
export async function editDeal(
  deps: { store: DealDeskStore; now: Clock; disclosures?: DisclosureStore | null },
  dealId: string,
  expectedVersion: number,
  patch: DealEdit,
  actor: string,
  opts: { collateralOverride?: CollateralOverride } = {},
): Promise<Deal> {
  const deal = await deps.store.getDeal(dealId);
  if (!deal) throw new DealError(`Deal ${dealId} not found`);
  if (patch.program && patch.program !== deal.program && deal.stage !== "intake") throw new DealError("The program can change only at intake (each program has its own stage template)");
  let auditActor = actor;
  if (patch.collateralRealProperty !== undefined && patch.collateralRealProperty !== deal.collateralRealProperty) {
    // Fail closed: without the disclosure store an open MLDS cannot be ruled out.
    const records = deps.disclosures ? await deps.disclosures.listForDeal({ dealId: deal.id, ...(deal.leadId ? { leadId: deal.leadId } : {}) }) : null;
    const open = records === null ? true : currentMlds(records) !== null;
    if (open) {
      const o = opts.collateralOverride;
      if (!o?.officer || o.reason.trim().length < 10) {
        throw new DealError(
          records === null
            ? "The collateral cannot change while MLDS records cannot be checked (the disclosure store is not configured)."
            : "An MLDS (RE 882) is open on this deal, so the collateral can change only with the designated officer's override and a reason (at least 10 characters). The open MLDS must still be signed or superseded.",
        );
      }
      auditActor = `${actor} (officer override: ${o.reason.trim().slice(0, 200)})`;
    }
  }
  assertEditable(deal, patch);
  return deps.store.updateDeal(deal.id, expectedVersion, patch, auditActor, deps.now());
}
