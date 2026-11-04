import type { PropertyAddress } from "./types";

// Address normalization for cache keys and cross-source matching. This is a
// key, not a USPS standardizer: it only has to be stable for the same address
// typed two ways ("123 Main Street, Apt 4" vs "123 main st apt 4").

const SUFFIX: Record<string, string> = {
  street: "st",
  avenue: "ave",
  boulevard: "blvd",
  drive: "dr",
  road: "rd",
  lane: "ln",
  court: "ct",
  place: "pl",
  terrace: "ter",
  parkway: "pkwy",
  highway: "hwy",
  circle: "cir",
  square: "sq",
  way: "way",
};

const DIRECTION: Record<string, string> = { north: "n", south: "s", east: "e", west: "w", northeast: "ne", northwest: "nw", southeast: "se", southwest: "sw" };

const UNIT_WORDS: Record<string, string> = { apartment: "apt", suite: "ste", unit: "unit", number: "#" };

const STATES: Record<string, string> = { california: "ca", nevada: "nv", oregon: "or", arizona: "az", washington: "wa" };

function normToken(t: string): string {
  return SUFFIX[t] ?? DIRECTION[t] ?? UNIT_WORDS[t] ?? t;
}

export function normalizeLine1(line1: string): string {
  return line1
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/#\s*/g, "# ")
    .split(/\s+/)
    .filter(Boolean)
    .map(normToken)
    .join(" ");
}

export function normalizeState(state: string | undefined): string {
  const s = (state ?? "ca").trim().toLowerCase();
  return STATES[s] ?? s.slice(0, 2);
}

export function normalizeZip(zip: string | undefined): string {
  return (zip ?? "").trim().slice(0, 5);
}

/** Stable cache key: `line1|city|state|zip5`, lower-case. */
export function normalizeAddress(a: PropertyAddress): string {
  return [normalizeLine1(a.line1), (a.city ?? "").trim().toLowerCase().replace(/\s+/g, " "), normalizeState(a.state), normalizeZip(a.zip)].join("|");
}

/** The address with state defaulted and whitespace tidied, as passed to providers. */
export function cleanAddress(a: PropertyAddress): PropertyAddress {
  const out: PropertyAddress = { line1: a.line1.trim().replace(/\s+/g, " ") };
  if (a.city?.trim()) out.city = a.city.trim().replace(/\s+/g, " ");
  out.state = normalizeState(a.state).toUpperCase();
  if (a.zip?.trim()) out.zip = normalizeZip(a.zip);
  return out;
}

/** APNs are compared without punctuation or leading zeros in each block. */
export function normalizeApn(apn: string): string {
  return apn.replace(/[^0-9a-z]/gi, "").toLowerCase().replace(/^0+/, "");
}
