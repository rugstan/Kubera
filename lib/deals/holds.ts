// Sanctions holds (WS-U deal_holds) reflected on the deal's pipeline status:
// a possible match puts the deal `on_hold`, a confirmed match puts it
// `held_for_counsel`, and releasing the last hold returns it to `active`.
// Deals already won, lost or withdrawn keep their status.
//
// The deal desk itself refuses every event but withdraw / mark lost while a
// hold is open (lib/deals/service.ts reads deal_holds directly), so the status
// is the pipeline's view of the hold, not the enforcement.

import type { DealHoldSink } from "@/lib/screening/service";
import type { DealHold, DealHoldStore } from "@/lib/screening/store";
import { ConcurrentUpdateError, type DealDeskStore } from "./store";
import type { Clock, DealStatus } from "./types";

const HOLD_STATUSES: readonly DealStatus[] = ["on_hold", "held_for_counsel"];

/** The status a deal should carry given its open holds. */
export function holdStatusFor(current: DealStatus, holds: readonly Pick<DealHold, "reason">[]): DealStatus {
  if (current !== "active" && !HOLD_STATUSES.includes(current)) return current;
  // A confirmed match (or any counsel-review hold) waits for counsel; a possible match waits for review.
  if (holds.some((h) => h.reason !== "sanctions_potential_match")) return "held_for_counsel";
  if (holds.length) return "on_hold";
  return "active";
}

export const HOLD_ACTOR = "system:screening";

/** Brings deals.status in line with the deal's open holds (retries once on a concurrent edit). */
export async function syncDealHoldStatus(deps: { store: DealDeskStore; holds: DealHoldStore; now: Clock }, dealId: string): Promise<DealStatus | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const deal = await deps.store.getDeal(dealId);
    if (!deal) return null;
    const next = holdStatusFor(deal.status ?? "active", await deps.holds.active(dealId));
    if (next === deal.status) return next;
    try {
      return (await deps.store.updateDeal(deal.id, deal.recordVersion, { status: next }, HOLD_ACTOR, deps.now())).status;
    } catch (err) {
      if (!(err instanceof ConcurrentUpdateError) || attempt > 0) throw err;
    }
  }
  return null;
}

/** DealHoldSink for the screening service: keeps the deal's status in step with its holds. */
export function dealStatusHoldSink(deps: { store: DealDeskStore; holds: DealHoldStore; now: Clock }): DealHoldSink {
  return {
    async held(hold) {
      await syncDealHoldStatus(deps, hold.dealId);
    },
    async released(dealId) {
      await syncDealHoldStatus(deps, dealId);
    },
  };
}
