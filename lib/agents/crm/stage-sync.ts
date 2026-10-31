// Stage updates from deal events. The deal desk owns the stage; this mirrors it
// into Twenty as a `stage_update` the broker approves (a stage change in the
// CRM is visible to the whole team and drives their pipeline views). Also
// creates the broker task that goes with the new stage, and a reconcile sweep
// that catches stages that drifted (a failed write, an expired approval).

import { civilDateOf } from "@/lib/disclosures/business-days";
import type { DealStageChange, DealStageEventSink } from "@/lib/deals/stage-events";
import type { CrmLinkLookup, CrmLinks } from "./links";
import { clientForTask } from "./scopes";
import { stageMapFromEnv, twentyStageFor } from "./stage-map";
import { stageTaskDraft, targetsFrom, taskOp } from "./tasks";
import type { CrmAgentWriter, WriteOutcome } from "./writer";
import type { CrmClient } from "./types";

export type StageSyncDeps = {
  writer: CrmAgentWriter;
  client: CrmClient;
  links: CrmLinkLookup;
  stageMap?: Readonly<Record<string, string>>;
  now?: () => Date;
};

export type StageChangeInput = Pick<DealStageChange, "eventId" | "dealId" | "leadId" | "stage" | "previousStage">;

/** Approval wait for a stage change: after this the deal has moved on and the reconcile sweep re-asks if still needed. */
export const STAGE_APPROVAL_TTL_MINUTES = 24 * 60;

/** Proposes the Twenty stage for a deal-desk stage change. */
export async function syncDealStage(change: StageChangeInput, deps: StageSyncDeps, preloaded?: CrmLinks | null): Promise<WriteOutcome> {
  const to = twentyStageFor(change.stage, deps.stageMap ?? stageMapFromEnv());
  if (!to) return { status: "skipped", reason: "stage_not_mapped" };
  const links = preloaded ?? (await deps.links.forDeal(change.dealId));
  if (!links?.opportunityId) return { status: "skipped", reason: "no_crm_opportunity" };
  const opp = await clientForTask(deps.client, "stage_sync").getOpportunity(links.opportunityId);
  if (!opp) return { status: "skipped", reason: "opportunity_not_found" };
  return deps.writer.submit(
    { type: "stage_update", opportunityId: opp.id, toStage: to, fromStage: opp.stage, dealId: change.dealId, dealStage: change.stage },
    {
      task: "stage_sync",
      idempotencyKey: `stage:${change.eventId}`,
      dealId: change.dealId,
      leadId: change.leadId,
      reasonCodes: ["deal_stage_changed"],
      ttlMinutes: STAGE_APPROVAL_TTL_MINUTES,
      detail: { previousDealStage: change.previousStage },
    },
  );
}

/** Creates the advisor task for entering a stage, if the stage has one. */
export async function proposeStageTask(change: StageChangeInput, deps: StageSyncDeps, preloaded?: CrmLinks | null): Promise<WriteOutcome> {
  const draft = stageTaskDraft(change.stage);
  if (!draft) return { status: "skipped", reason: "no_task_for_stage" };
  const links = preloaded ?? (await deps.links.forDeal(change.dealId));
  const targets = targetsFrom(links);
  if (!targets) return { status: "skipped", reason: "no_crm_record" };
  const assigneeId = links?.ownerUserId ? await deps.links.memberIdForUser(links.ownerUserId).catch(() => null) : null;
  const now = (deps.now ?? (() => new Date()))();
  return deps.writer.submit(taskOp(draft, { targets, source: { kind: "stage", id: change.eventId }, assigneeId, now }), {
    task: "broker_tasks",
    idempotencyKey: `task:${change.eventId}:${draft.key}`,
    dealId: change.dealId,
    leadId: change.leadId,
    reasonCodes: ["stage_task"],
  });
}

/**
 * The deal desk's stage sink for the CRM agents (compose it with the
 * notification sink). A failure here never undoes the stage change.
 */
export function crmStageSink(deps: StageSyncDeps): DealStageEventSink {
  return {
    async stageChanged(change) {
      try {
        const links = await deps.links.forDeal(change.dealId);
        await syncDealStage(change, deps, links);
        await proposeStageTask(change, deps, links);
      } catch (err) {
        console.warn(`[crm-agent] stage sync for deal ${change.dealId} failed:`, err instanceof Error ? err.message : err);
      }
    },
  };
}

export type ReconcileResult = { checked: number; proposed: number; inSync: number; skipped: number; failed: number };

/** Compares open deals with their Twenty opportunities and proposes a stage update where they differ. */
export async function reconcileStages(deps: StageSyncDeps, opts: { limit?: number; maxProposals?: number } = {}): Promise<ReconcileResult> {
  const now = (deps.now ?? (() => new Date()))();
  const day = civilDateOf(now);
  const map = deps.stageMap ?? stageMapFromEnv();
  const reader = clientForTask(deps.client, "stage_sync");
  const result: ReconcileResult = { checked: 0, proposed: 0, inSync: 0, skipped: 0, failed: 0 };
  for (const deal of await deps.links.openDeals(opts.limit ?? 200)) {
    if (result.proposed >= (opts.maxProposals ?? 25)) break;
    result.checked += 1;
    try {
      const to = twentyStageFor(deal.stage, map);
      if (!to) {
        result.skipped += 1;
        continue;
      }
      const opp = await reader.getOpportunity(deal.opportunityId);
      if (!opp) {
        result.skipped += 1;
        continue;
      }
      if (opp.stage === to) {
        result.inSync += 1;
        continue;
      }
      const out = await deps.writer.submit(
        { type: "stage_update", opportunityId: opp.id, toStage: to, fromStage: opp.stage, dealId: deal.dealId, dealStage: deal.stage },
        {
          task: "stage_sync",
          idempotencyKey: `stage-reconcile:${deal.dealId}:${to}:${day}`,
          dealId: deal.dealId,
          leadId: deal.leadId,
          reasonCodes: ["stage_drift"],
          ttlMinutes: STAGE_APPROVAL_TTL_MINUTES,
        },
      );
      if (out.status === "failed" || out.status === "blocked") result.failed += 1;
      else if (out.status === "skipped") result.skipped += 1;
      else result.proposed += 1;
    } catch (err) {
      result.failed += 1;
      console.warn(`[crm-agent] reconcile of deal ${deal.dealId} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return result;
}
