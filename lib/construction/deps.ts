// Collaborators of the construction service, injected so tests run with fakes
// and so the staff app (WS-I) and deals module (WS-T) plug in without this
// module importing them.

import type { ApprovalGate } from "@/lib/compliance/approval-gate";
import type { ContractorLicenseLookup } from "./cslb";
import type { NewTakeoutDeal } from "./conversion";
import type { ConstructionStore } from "./store";

export class ConstructionError extends Error {
  constructor(
    readonly code: "validation" | "not_found" | "conflict" | "unavailable" | "forbidden",
    message: string,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "ConstructionError";
  }
}

/** Opens the refinance deal for a take-out. Implemented by the deals module. */
export interface DealCreator {
  /** Idempotent on `idempotencyKey`: the same key returns the same deal. */
  createDeal(input: NewTakeoutDeal): Promise<{ dealId: string }>;
}

export class FakeDealCreator implements DealCreator {
  readonly created: NewTakeoutDeal[] = [];
  private readonly byKey = new Map<string, string>();

  async createDeal(input: NewTakeoutDeal): Promise<{ dealId: string }> {
    const existing = this.byKey.get(input.idempotencyKey);
    if (existing) return { dealId: existing };
    const dealId = `00000000-0000-4000-8000-${String(this.created.length + 1).padStart(12, "0")}`;
    this.byKey.set(input.idempotencyKey, dealId);
    this.created.push(input);
    return { dealId };
  }
}

export type ConstructionDeps = {
  store: ConstructionStore;
  gate: ApprovalGate;
  licenses: ContractorLicenseLookup;
  /** Null until the deals module registers one; take-outs are then recorded but no deal is opened. */
  deals: DealCreator | null;
  now: () => Date;
};

export const SYSTEM_ACTOR = "system";
