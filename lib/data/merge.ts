import { normalizeApn } from "./address";
import { looksLikeEntity, normalizeEntityName } from "./opencorporates";
import {
  SOURCE_NAMES,
  type Confidence,
  type Coordinates,
  type DataFlag,
  type DeedMortgageRecord,
  type EntityRecord,
  type Fact,
  type FloodZoneRecord,
  type ParcelRecord,
  type PropertyAddress,
  type PropertyFacts,
  type RentCompsRecord,
  type RentEstimate,
  type SalesComp,
  type SourceName,
  type SourceOutcome,
  type SourceStatus,
} from "./types";

// Pure merge of per-source results into one PropertyFacts. No I/O, no clock:
// callers pass `now`. Priority order per field is data (FIELD_PRIORITY) so the
// rule "which source wins" is visible and tested, not buried in code.

export type RawResults = {
  parcel?: SourceOutcome<ParcelRecord>;
  deed?: SourceOutcome<DeedMortgageRecord>;
  entity?: SourceOutcome<EntityRecord>;
  flood?: SourceOutcome<FloodZoneRecord>;
  rentComps?: SourceOutcome<RentCompsRecord>;
  rentEstimates?: SourceOutcome<RentEstimate>[];
  salesComps?: SourceOutcome<SalesComp[]>;
};

/** Which sources are known to the caller to be unconfigured/skipped, by source. */
export type SkipReasons = Partial<Record<SourceName, string>>;

export type MergeContext = {
  address: PropertyAddress;
  addressKey: string;
  now: Date;
  ttlMs: number;
  /** Shorter lifetime used when a configured source failed, so the gap heals soon. */
  degradedTtlMs: number;
  skipped?: SkipReasons;
  /** Coordinates the caller supplied when no source resolved any. */
  fallbackCoordinates?: Coordinates;
};

/** First source in a list wins a field; later ones become alternates. */
export const FIELD_PRIORITY = {
  apn: ["regrid", "attom"],
  coordinates: ["regrid", "attom"],
  owner: ["attom", "regrid"],
  yearBuilt: ["regrid", "attom"],
  units: ["attom", "regrid"],
  buildingSqft: ["attom", "regrid"],
  lotAcres: ["regrid", "attom"],
  assessedValue: ["attom", "regrid"],
  lastSale: ["attom", "regrid"],
} as const satisfies Record<string, readonly SourceName[]>;

type Candidate<T> = { source: SourceName; value: T; asOf?: string };

function fromOutcome<T>(o: SourceOutcome<T> | undefined): T | undefined {
  return o?.status === "ok" ? o.data : undefined;
}

/** Choose the winner by priority; confidence reflects agreement between sources. */
export function pickFact<T>(candidates: Candidate<T>[], equal: (a: T, b: T) => boolean = (a, b) => a === b): { fact?: Fact<T>; conflict: boolean } {
  if (candidates.length === 0) return { conflict: false };
  const [winner, ...rest] = candidates as [Candidate<T>, ...Candidate<T>[]];
  const disagreeing = rest.filter((c) => !equal(c.value, winner.value));
  const agreeing = rest.length - disagreeing.length;
  const confidence: Confidence = disagreeing.length > 0 ? "low" : agreeing > 0 ? "high" : "medium";
  const fact: Fact<T> = { value: winner.value, source: winner.source, confidence };
  if (winner.asOf) fact.asOf = winner.asOf;
  if (disagreeing.length) fact.alternates = disagreeing.map((c) => ({ value: c.value, source: c.source }));
  return { fact, conflict: disagreeing.length > 0 };
}

function ordered<T>(order: readonly SourceName[], values: Partial<Record<SourceName, T | undefined>>, asOf: Partial<Record<SourceName, string | undefined>> = {}): Candidate<T>[] {
  const out: Candidate<T>[] = [];
  for (const source of order) {
    const value = values[source];
    if (value !== undefined) out.push({ source, value, asOf: asOf[source] });
  }
  return out;
}

const withinPct = (a: number, b: number, pct: number) => Math.abs(a - b) <= Math.max(a, b) * (pct / 100);

/** Owner names match when their normalized word sets are equal ("SMITH JOHN" vs "John Smith"). */
export function sameOwner(a: string, b: string): boolean {
  const words = (s: string) => normalizeEntityName(s).split(" ").filter(Boolean).sort().join(" ");
  return words(a) === words(b);
}

export function validYearBuilt(y: number | undefined, now: Date): number | undefined {
  return y !== undefined && Number.isInteger(y) && y >= 1800 && y <= now.getUTCFullYear() + 2 ? y : undefined;
}

const validUnits = (n: number | undefined) => (n !== undefined && Number.isInteger(n) && n >= 1 && n <= 5000 ? n : undefined);

/** Rough bounding box of California; used only to flag obviously out-of-state results. */
export function inCaliforniaBox(c: Coordinates): boolean {
  return c.lat >= 32.4 && c.lat <= 42.1 && c.lon >= -124.6 && c.lon <= -114.0;
}

/** An absent outcome means the client is not configured, or was skipped for a stated reason. */
function sourceStatus(o: SourceOutcome<unknown> | undefined, skipped: string | undefined): SourceStatus {
  if (!o) return skipped ? { status: "skipped", detail: skipped } : { status: "not_configured" };
  if (o.status === "error") return { status: "error", detail: o.error };
  return { status: o.status };
}

/** Collapse several outcomes (Rentometer is called once per bedroom count) into one status. */
function combine(outcomes: SourceOutcome<unknown>[] | undefined, skipped: string | undefined): SourceStatus {
  if (!outcomes || outcomes.length === 0) return skipped ? { status: "skipped", detail: skipped } : { status: "not_configured" };
  if (outcomes.some((o) => o.status === "ok")) return { status: "ok" };
  const err = outcomes.find((o) => o.status === "error");
  if (err && err.status === "error") return { status: "error", detail: err.error };
  if (outcomes.every((o) => o.status === "not_configured")) return { status: "not_configured" };
  return { status: "not_found" };
}

export function mergePropertyFacts(raw: RawResults, ctx: MergeContext): PropertyFacts {
  const flags: DataFlag[] = [];
  const parcel = fromOutcome(raw.parcel);
  const deed = fromOutcome(raw.deed);
  const skipped = ctx.skipped ?? {};

  const sources = {} as Record<SourceName, SourceStatus>;
  sources.regrid = sourceStatus(raw.parcel, skipped.regrid);
  sources.attom = sourceStatus(raw.deed ?? raw.salesComps, skipped.attom);
  // ATTOM serves both deed and comps: ok if either worked.
  if (raw.deed && raw.salesComps && raw.deed.status !== "ok" && raw.salesComps.status === "ok") sources.attom = { status: "ok" };
  sources.opencorporates = sourceStatus(raw.entity, skipped.opencorporates);
  sources.fema_nfhl = sourceStatus(raw.flood, skipped.fema_nfhl);
  sources.hellodata = sourceStatus(raw.rentComps, skipped.hellodata);
  sources.rentometer = combine(raw.rentEstimates, skipped.rentometer);

  const facts: PropertyFacts = {
    addressKey: ctx.addressKey,
    address: ctx.address,
    flags,
    sources,
    fetchedAt: ctx.now.toISOString(),
    expiresAt: "",
    fromCache: false,
  };

  const asOfBy: Partial<Record<SourceName, string | undefined>> = { regrid: parcel?.asOf };

  const apn = pickFact(
    ordered(FIELD_PRIORITY.apn, { regrid: parcel?.apn, attom: deed?.apn }, asOfBy),
    (a, b) => normalizeApn(a) === normalizeApn(b),
  );
  if (apn.fact) facts.apn = apn.fact;
  if (apn.conflict) flags.push({ code: "conflict_apn", message: `Sources report different APNs (${apn.fact!.value} vs ${apn.fact!.alternates!.map((a) => `${a.value} from ${a.source}`).join(", ")}).` });

  const coordinates = pickFact(
    ordered(FIELD_PRIORITY.coordinates, { regrid: parcel?.coordinates, attom: deed?.coordinates }),
    (a, b) => Math.abs(a.lat - b.lat) < 0.002 && Math.abs(a.lon - b.lon) < 0.002,
  );
  if (coordinates.fact) facts.coordinates = coordinates.fact;
  else if (ctx.fallbackCoordinates) facts.coordinates = { value: ctx.fallbackCoordinates, source: "regrid", confidence: "low" };

  if (parcel?.county) facts.county = { value: parcel.county, source: "regrid", confidence: "medium", asOf: parcel.asOf };
  const cityValue = parcel?.city ?? ctx.address.city;
  if (cityValue) facts.city = { value: cityValue, source: "regrid", confidence: parcel?.city ? "medium" : "low", asOf: parcel?.asOf };

  const owner = pickFact(ordered(FIELD_PRIORITY.owner, { attom: deed?.ownerOfRecord, regrid: parcel?.owner }), sameOwner);
  if (owner.fact) facts.owner = owner.fact;
  if (owner.conflict) flags.push({ code: "conflict_owner", message: `Deed owner (${owner.fact!.value}) differs from the assessor owner (${owner.fact!.alternates![0]!.value}); confirm vesting with title.` });

  const yearBuilt = pickFact(ordered(FIELD_PRIORITY.yearBuilt, { regrid: validYearBuilt(parcel?.yearBuilt, ctx.now), attom: validYearBuilt(deed?.yearBuilt, ctx.now) }, asOfBy));
  if (yearBuilt.fact) facts.yearBuilt = yearBuilt.fact;
  if (yearBuilt.conflict) flags.push({ code: "conflict_year_built", message: `Year built differs by source (${yearBuilt.fact!.value} vs ${yearBuilt.fact!.alternates!.map((a) => `${a.value} from ${a.source}`).join(", ")}); the 15-year rent-control exemption depends on it.` });

  const units = pickFact(ordered(FIELD_PRIORITY.units, { attom: validUnits(deed?.units), regrid: validUnits(parcel?.units) }, asOfBy));
  if (units.fact) facts.units = units.fact;
  if (units.conflict) flags.push({ code: "conflict_units", message: `Unit count differs by source (${units.fact!.value} vs ${units.fact!.alternates!.map((a) => `${a.value} from ${a.source}`).join(", ")}); verify against the rent roll.` });

  const sqft = pickFact(ordered(FIELD_PRIORITY.buildingSqft, { attom: deed?.buildingSqft, regrid: parcel?.buildingSqft }, asOfBy), (a, b) => withinPct(a, b, 15));
  if (sqft.fact) facts.buildingSqft = sqft.fact;
  if (sqft.conflict) flags.push({ code: "conflict_building_sqft", message: "Building area differs by more than 15% between sources." });

  if (parcel?.stories) facts.stories = { value: parcel.stories, source: "regrid", confidence: "medium", asOf: parcel.asOf };
  const lot = pickFact(ordered(FIELD_PRIORITY.lotAcres, { regrid: parcel?.lotAcres, attom: deed?.lotAcres }, asOfBy), (a, b) => withinPct(a, b, 10));
  if (lot.fact) facts.lotAcres = lot.fact;
  if (parcel?.useDescription) facts.useDescription = { value: parcel.useDescription, source: "regrid", confidence: "medium", asOf: parcel.asOf };
  if (parcel?.zoning) facts.zoning = { value: parcel.zoning, source: "regrid", confidence: "medium", asOf: parcel.asOf };

  const assessed = pickFact(
    ordered(
      FIELD_PRIORITY.assessedValue,
      {
        attom: deed?.assessedTotal !== undefined ? { total: deed.assessedTotal } : undefined,
        regrid:
          parcel?.assessedTotal !== undefined
            ? { total: parcel.assessedTotal, ...(parcel.assessedLand !== undefined ? { land: parcel.assessedLand } : {}), ...(parcel.assessedImprovements !== undefined ? { improvements: parcel.assessedImprovements } : {}) }
            : undefined,
      },
      asOfBy,
    ),
    (a, b) => withinPct(a.total, b.total, 5),
  );
  if (assessed.fact) {
    // Only the parcel layer reports the land/improvement split. Keep it when its total agrees with the winner's.
    const winner = assessed.fact.value;
    if (winner.land === undefined && parcel?.assessedLand !== undefined && parcel.assessedTotal !== undefined && withinPct(winner.total, parcel.assessedTotal, 5)) {
      assessed.fact.value = { ...winner, land: parcel.assessedLand, ...(parcel.assessedImprovements !== undefined ? { improvements: parcel.assessedImprovements } : {}) };
    }
    facts.assessedValue = assessed.fact;
  }

  if (deed?.annualTaxes) facts.annualTaxes = { value: deed.annualTaxes, source: "attom", confidence: "medium" };

  const lastSale = pickFact(
    ordered(
      FIELD_PRIORITY.lastSale,
      {
        attom: deed?.lastSalePrice !== undefined || deed?.lastSaleDate ? { price: deed.lastSalePrice, date: deed.lastSaleDate } : undefined,
        regrid: parcel?.lastSalePrice !== undefined || parcel?.lastSaleDate ? { price: parcel.lastSalePrice, date: parcel.lastSaleDate } : undefined,
      },
      asOfBy,
    ),
    (a, b) => a.date === b.date && a.price === b.price,
  );
  if (lastSale.fact) facts.lastSale = lastSale.fact;

  if (deed && deed.mortgages.length > 0) facts.mortgages = { value: deed.mortgages, source: "attom", confidence: "medium" };

  // Owner entity (OpenCorporates): only meaningful when the owner looks like a legal entity.
  const entity = fromOutcome(raw.entity);
  if (entity) {
    facts.ownerEntity = { value: entity, source: "opencorporates", confidence: "high" };
    if (entity.active === false) {
      flags.push({ code: "owner_entity_inactive", message: `${entity.name} is shown as ${entity.status ?? "inactive"} (${entity.jurisdiction}); confirm good standing before relying on the borrower entity.` });
    }
  } else if (facts.owner && looksLikeEntity(facts.owner.value) && raw.entity?.status === "not_found") {
    flags.push({ code: "owner_entity_unverified", message: `No registry match found for ${facts.owner.value}; verify the entity and its standing.` });
  }

  const flood = fromOutcome(raw.flood);
  if (flood) {
    facts.flood = { value: flood, source: "fema_nfhl", confidence: "high" };
    if (flood.specialFloodHazardArea) {
      flags.push({ code: "flood_hazard_area", message: `FEMA flood zone ${flood.zone}: Special Flood Hazard Area. Flood insurance is required on federally related loans.` });
    }
  }

  const rentComps = fromOutcome(raw.rentComps);
  if (rentComps) {
    facts.rentComps = { value: rentComps, source: "hellodata", confidence: "medium" };
    if (rentComps.expenseBenchmarks) facts.expenseBenchmarks = { value: rentComps.expenseBenchmarks, source: "hellodata", confidence: "medium" };
  }
  const estimates = (raw.rentEstimates ?? []).map(fromOutcome).filter((e): e is RentEstimate => e !== undefined);
  if (estimates.length) facts.rentEstimates = { value: estimates.sort((a, b) => a.bedrooms - b.bedrooms), source: "rentometer", confidence: "medium" };

  const salesComps = fromOutcome(raw.salesComps);
  if (salesComps?.length) facts.salesComps = { value: salesComps, source: "attom", confidence: "medium" };

  // Jurisdiction sanity: the California rules engine must not be applied elsewhere.
  const declaredState = (ctx.address.state ?? "CA").toUpperCase();
  const parcelState = parcel?.state?.toUpperCase();
  const coords = facts.coordinates?.value;
  if (declaredState !== "CA" || (parcelState && parcelState !== "CA") || (coords && !inCaliforniaBox(coords))) {
    flags.push({ code: "outside_california", message: "The property is not in California; California rent-control, Prop 13 and prevailing-wage rules do not apply." });
  }

  if (raw.parcel?.status === "not_found" && (!raw.deed || raw.deed.status !== "ok")) {
    flags.push({ code: "no_parcel_match", message: "No parcel matched this address; check the street address or search by APN." });
  }

  const failedSources = SOURCE_NAMES.filter((s) => sources[s].status === "error");
  if (failedSources.length) {
    flags.push({ code: "sources_incomplete", message: `Some sources failed and were skipped: ${failedSources.join(", ")}. Results may be partial.` });
  }

  facts.expiresAt = new Date(ctx.now.getTime() + (failedSources.length ? ctx.degradedTtlMs : ctx.ttlMs)).toISOString();
  return facts;
}

/** True when at least one source returned data (nothing to cache otherwise). */
export function hasAnyData(facts: PropertyFacts): boolean {
  return SOURCE_NAMES.some((s) => facts.sources[s].status === "ok");
}
