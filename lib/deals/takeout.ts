// Opens the take-out refinance deal for a construction project (WS-AA's
// DealCreator), on the deal desk's own createDeal and stage templates.
// Idempotent: the take-out's key is stored on the deal (deals.origin_key,
// unique), so a retry or a second click returns the same deal.
//
// Broker only: the new deal is a refinance Corin arranges for the borrower
// with the take-out lender; no amounts are carried over from the construction
// loan (the take-out is sized on its own).

import type { NewTakeoutDeal } from "@/lib/construction/conversion";
import type { DealCreator } from "@/lib/construction/deps";
import type { TakeoutProgramRef } from "@/lib/construction/types";
import { createDeal } from "./service";
import type { DealDeskStore } from "./store";
import type { Clock, DealProgram } from "./types";

/** Suggested take-out program (sizing program id) → deal-desk program and its stage template. */
export const TAKEOUT_PROGRAM_TO_DEAL: Record<TakeoutProgramRef, DealProgram> = {
  HUD_232_223F: "HUD_232",
  HUD_221D4_223F_MULTIFAMILY: "HUD_MULTIFAMILY",
  AGENCY_FANNIE_FREDDIE: "AGENCY",
  HOSPITALITY_CMBS_NON_RECOURSE: "HOTEL_CMBS",
  BANK_LIFE_CO: "BANK_LIFE_CO",
};

export function takeoutDealProgram(suggested: readonly TakeoutProgramRef[]): DealProgram {
  const first = suggested.find((p) => p in TAKEOUT_PROGRAM_TO_DEAL);
  return first ? TAKEOUT_PROGRAM_TO_DEAL[first] : "BANK_LIFE_CO";
}

export const TAKEOUT_ACTOR = "system:construction-takeout";

function address(input: NewTakeoutDeal): string | null {
  const line = [input.propertyAddress, input.city, [input.state, input.zip].filter(Boolean).join(" ")].filter((p) => p && String(p).trim()).join(", ");
  return line ? line.slice(0, 300) : null;
}

export function dealDeskTakeoutCreator(deps: { store: DealDeskStore; now: Clock }): DealCreator {
  return {
    async createDeal(input) {
      const existing = await deps.store.findDealByOriginKey(input.idempotencyKey);
      if (existing) return { dealId: existing.id };
      const source = input.sourceDealId ? await deps.store.getDeal(input.sourceDealId) : null;
      try {
        const deal = await createDeal(
          deps,
          {
            title: input.name.slice(0, 200),
            program: takeoutDealProgram(input.suggestedPrograms),
            leadId: input.leadId ?? source?.leadId ?? null,
            ownerId: source?.ownerId ?? null,
            borrowerName: source?.borrowerName ?? null,
            propertyAddress: address(input),
            propertyState: input.state && /^[A-Z]{2}$/.test(input.state) ? input.state : null,
            // A take-out refinance is secured by the completed property (drives the MLDS gate).
            collateralRealProperty: true,
            originKey: input.idempotencyKey,
          },
          TAKEOUT_ACTOR,
        );
        return { dealId: deal.id };
      } catch (err) {
        // Lost a race on the unique key: the other request opened the deal.
        const raced = await deps.store.findDealByOriginKey(input.idempotencyKey);
        if (raced) return { dealId: raced.id };
        throw err;
      }
    },
  };
}
