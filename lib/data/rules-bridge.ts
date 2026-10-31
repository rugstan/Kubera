import { looksLikeEntity } from "./opencorporates";
import type { PropertyFacts } from "./types";
import { evaluateRentControl, type OwnerType, type RentControlInput, type RentControlPropertyType, type RentControlResult } from "@/lib/rules/california/rent-control";
import type { DateInput } from "@/lib/rules/california/dates";
import type { Prop13Input } from "@/lib/rules/california/prop13";

// Bridges merged property facts to the California rules engine. Kept out of
// lib/rules so the rules stay pure and free of data-layer imports.

/** Best-effort property type from unit count and the parcel's use description. */
export function inferPropertyType(facts: PropertyFacts): RentControlPropertyType {
  const use = facts.useDescription?.value.toLowerCase() ?? "";
  const units = facts.units?.value;
  if (/condo/.test(use)) return "condominium";
  if (units === undefined) {
    if (/single/.test(use)) return "single_family";
    if (/duplex|two[- ]family|2[- ]unit/.test(use)) return "duplex";
    return "multifamily";
  }
  if (units === 1) return "single_family";
  if (units === 2) return "duplex";
  return "multifamily";
}

/**
 * Owner type from the owner name. An LLC maps to `unknown` on purpose: the
 * single-family exemption turns on whether any member is a corporation, which
 * a registry lookup does not tell us.
 */
export function inferOwnerType(owner: string | undefined): OwnerType {
  if (!owner) return "unknown";
  const o = owner.toLowerCase();
  if (/\breit\b|real estate investment trust/.test(o)) return "reit";
  if (/\b(inc|incorporated|corp|corporation)\b\.?/.test(o)) return "corporation";
  if (/\btrust\b|\btrustee\b/.test(o)) return "trust";
  if (/\b(lp|l\.p|llp|partners|partnership)\b/.test(o)) return "partnership";
  if (/\bllc\b|l\.l\.c/.test(o)) return "unknown";
  return looksLikeEntity(owner) ? "unknown" : "natural_person";
}

export type RentControlOverrides = Partial<Omit<RentControlInput, "asOf">>;

/** Rent-control input from property facts; `overrides` (rent roll, lease facts) win. */
export function rentControlInputFromFacts(facts: PropertyFacts, asOf: DateInput, overrides: RentControlOverrides = {}): RentControlInput {
  return {
    asOf,
    state: facts.address.state ?? "CA",
    county: facts.county?.value,
    city: facts.city?.value ?? facts.address.city,
    propertyType: inferPropertyType(facts),
    units: facts.units?.value,
    yearBuilt: facts.yearBuilt?.value,
    owner: { type: inferOwnerType(facts.owner?.value) },
    ...overrides,
  };
}

/** One call: evaluate California rent control for a looked-up property. */
export function evaluateRentControlForFacts(facts: PropertyFacts, asOf: DateInput, overrides: RentControlOverrides = {}): RentControlResult {
  // Outside California the engine answers `not_california` itself; facts that carry the out-of-state flag force it.
  const outside = facts.flags.some((f) => f.code === "outside_california");
  return evaluateRentControl(rentControlInputFromFacts(facts, asOf, outside ? { state: "XX", ...overrides } : overrides));
}

/** Prop 13 input from facts; null when the assessed value is unknown. */
export function prop13InputFromFacts(facts: PropertyFacts, deal: Omit<Prop13Input, "currentAssessedValue">): Prop13Input | null {
  const assessed = facts.assessedValue?.value.total;
  if (assessed === undefined) return null;
  return { ...deal, currentAssessedValue: assessed };
}
