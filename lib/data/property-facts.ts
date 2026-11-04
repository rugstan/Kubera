import { cleanAddress, normalizeAddress } from "./address";
import { dataClients } from "./clients";
import { looksLikeEntity } from "./opencorporates";
import { hasAnyData, mergePropertyFacts, type RawResults, type SkipReasons } from "./merge";
import type { PropertyFactsStore } from "./store";
import type { Coordinates, DataClients, PropertyAddress, PropertyFacts, SourceOutcome } from "./types";

export const DEFAULT_TTL_DAYS = 30;
const DAY_MS = 86_400_000;
const DEGRADED_TTL_MS = 60 * 60 * 1000;

export type GetPropertyFactsOptions = {
  /** Clients to use; defaults to the env-configured set. */
  clients?: DataClients;
  /** Cache; omit to skip caching. */
  store?: PropertyFactsStore;
  /** Bypass a fresh cache entry and refetch. */
  force?: boolean;
  /** Clock, for tests. */
  now?: () => Date;
  /** Bedroom counts to price with Rentometer (one billable call each). Default 1 and 2. */
  bedrooms?: number[];
  /** Coordinates to use for flood and comps when no source resolves any. */
  coordinates?: Coordinates;
  /** Cache lifetime in days; default PROPERTY_FACTS_TTL_DAYS or 30. */
  ttlDays?: number;
  /** Sales-comp search radius in miles (default 3). */
  compRadiusMiles?: number;
};

function ttlMs(opts: GetPropertyFactsOptions): number {
  const env = Number(process.env.PROPERTY_FACTS_TTL_DAYS);
  const days = opts.ttlDays ?? (Number.isFinite(env) && env > 0 ? env : DEFAULT_TTL_DAYS);
  return days * DAY_MS;
}

/** Run a source call so an unexpected throw becomes an error outcome (clients should not throw, but a bug in one must not sink the lookup). */
async function safe<T>(label: string, run: () => Promise<SourceOutcome<T>>): Promise<SourceOutcome<T>> {
  try {
    return await run();
  } catch (err) {
    console.error(`property facts: ${label} threw`, err instanceof Error ? err.message : err);
    return { status: "error", error: "client-exception" };
  }
}

/**
 * Everything Corin knows about a property, merged from Regrid (parcel, owner,
 * year built), ATTOM (deed, mortgage, sales comps), OpenCorporates (owner
 * entity), FEMA NFHL (flood zone), HelloData (rent comps, expense benchmarks)
 * and Rentometer (rent by bedroom count).
 *
 * Unconfigured or failing sources degrade the result (see `sources` and
 * `flags`); the function itself does not throw for provider problems. Fresh
 * results are cached by normalized address.
 */
export async function getPropertyFacts(input: PropertyAddress, opts: GetPropertyFactsOptions = {}): Promise<PropertyFacts> {
  const now = (opts.now ?? (() => new Date()))();
  const address = cleanAddress(input);
  const addressKey = normalizeAddress(address);
  const clients = opts.clients ?? dataClients();

  if (opts.store && !opts.force) {
    const cached = await opts.store.get(addressKey, now).catch(() => null);
    if (cached) return { ...cached, fromCache: true };
  }

  const raw: RawResults = {};
  const skipped: SkipReasons = {};
  const bedrooms = opts.bedrooms ?? [1, 2];

  // Stage 1: lookups that need only the address.
  await Promise.all([
    clients.regrid && safe("regrid", () => clients.regrid!.lookupByAddress(address)).then((r) => void (raw.parcel = r)),
    clients.attom && safe("attom", () => clients.attom!.deedAndMortgage(address)).then((r) => void (raw.deed = r)),
    clients.hellodata && safe("hellodata", () => clients.hellodata!.rentComps(address)).then((r) => void (raw.rentComps = r)),
    clients.rentometer &&
      Promise.all(bedrooms.map((b) => safe("rentometer", () => clients.rentometer!.estimate(address, { bedrooms: b })))).then((r) => void (raw.rentEstimates = r)),
  ]);

  // Stage 2: lookups that need what stage 1 found.
  const parcel = raw.parcel?.status === "ok" ? raw.parcel.data : undefined;
  const deed = raw.deed?.status === "ok" ? raw.deed.data : undefined;
  const coords = parcel?.coordinates ?? deed?.coordinates ?? opts.coordinates;
  const owner = deed?.ownerOfRecord ?? parcel?.owner;

  const stage2: Promise<void>[] = [];
  if (clients.fema) {
    if (coords) stage2.push(safe("fema", () => clients.fema!.lookup(coords)).then((r) => void (raw.flood = r)));
    else skipped.fema_nfhl = "no coordinates";
  }
  if (clients.attom) {
    if (coords) {
      const since = new Date(now.getTime() - 3 * 365 * DAY_MS).toISOString().slice(0, 10);
      stage2.push(
        safe("attom comps", () => clients.attom!.salesComps({ center: coords, radiusMiles: opts.compRadiusMiles ?? 3, minUnits: 5, since, limit: 10 })).then(
          (r) => void (raw.salesComps = r),
        ),
      );
    }
  }
  if (clients.opencorporates) {
    if (owner && looksLikeEntity(owner)) stage2.push(safe("opencorporates", () => clients.opencorporates!.searchEntity(owner, "us_ca")).then((r) => void (raw.entity = r)));
    else skipped.opencorporates = owner ? "owner is not an entity" : "no owner";
  }
  await Promise.all(stage2);

  const facts = mergePropertyFacts(raw, {
    address,
    addressKey,
    now,
    ttlMs: ttlMs(opts),
    degradedTtlMs: DEGRADED_TTL_MS,
    skipped,
    fallbackCoordinates: opts.coordinates,
  });

  // Nothing came back: nothing worth caching (and a later configured run should not be shadowed).
  if (opts.store && hasAnyData(facts)) await opts.store.put(facts).catch((err) => console.error("property facts cache write failed", err instanceof Error ? err.message : err));
  return facts;
}
