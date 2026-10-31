import { normalizeAddress } from "./address";
import { normalizeEntityName } from "./opencorporates";
import {
  failed,
  notFound,
  ok,
  type Coordinates,
  type DeedClient,
  type DeedMortgageRecord,
  type EntityClient,
  type EntityRecord,
  type FloodClient,
  type FloodZoneRecord,
  type ParcelClient,
  type ParcelRecord,
  type PropertyAddress,
  type RentCompClient,
  type RentCompsRecord,
  type RentEstimate,
  type RentEstimateClient,
  type SalesComp,
  type SalesCompQuery,
  type SourceOutcome,
} from "./types";

// In-memory fakes for tests and local development. Each records its calls and
// can be told to fail, so merge and degradation paths are testable without a network.

type Failure = { error: string } | null;

class FakeBase {
  calls: unknown[] = [];
  /** Make every call return an error outcome until cleared. */
  failure: Failure = null;
  protected gate<T>(): SourceOutcome<T> | undefined {
    return this.failure ? failed(this.failure.error) : undefined;
  }
}

export class FakeParcelClient extends FakeBase implements ParcelClient {
  private readonly byAddress = new Map<string, ParcelRecord>();
  set(address: PropertyAddress, record: ParcelRecord): this {
    this.byAddress.set(normalizeAddress(address), record);
    return this;
  }
  async lookupByAddress(address: PropertyAddress): Promise<SourceOutcome<ParcelRecord>> {
    this.calls.push(address);
    const f = this.gate<ParcelRecord>();
    if (f) return f;
    const rec = this.byAddress.get(normalizeAddress(address));
    return rec ? ok(rec) : notFound();
  }
}

export class FakeEntityClient extends FakeBase implements EntityClient {
  private readonly byName = new Map<string, EntityRecord>();
  set(record: EntityRecord): this {
    this.byName.set(normalizeEntityName(record.name), record);
    return this;
  }
  async searchEntity(name: string, jurisdiction?: string): Promise<SourceOutcome<EntityRecord>> {
    this.calls.push({ name, jurisdiction });
    const f = this.gate<EntityRecord>();
    if (f) return f;
    const rec = this.byName.get(normalizeEntityName(name));
    return rec ? ok(rec) : notFound();
  }
}

const pointKey = (p: Coordinates) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;

export class FakeFloodClient extends FakeBase implements FloodClient {
  private readonly byPoint = new Map<string, FloodZoneRecord>();
  set(point: Coordinates, record: FloodZoneRecord): this {
    this.byPoint.set(pointKey(point), record);
    return this;
  }
  async lookup(point: Coordinates): Promise<SourceOutcome<FloodZoneRecord>> {
    this.calls.push(point);
    const f = this.gate<FloodZoneRecord>();
    if (f) return f;
    const rec = this.byPoint.get(pointKey(point));
    return rec ? ok(rec) : notFound();
  }
}

export class FakeDeedClient extends FakeBase implements DeedClient {
  private readonly byAddress = new Map<string, DeedMortgageRecord>();
  comps: SalesComp[] = [];
  set(address: PropertyAddress, record: DeedMortgageRecord): this {
    this.byAddress.set(normalizeAddress(address), record);
    return this;
  }
  async deedAndMortgage(address: PropertyAddress): Promise<SourceOutcome<DeedMortgageRecord>> {
    this.calls.push(address);
    const f = this.gate<DeedMortgageRecord>();
    if (f) return f;
    const rec = this.byAddress.get(normalizeAddress(address));
    return rec ? ok(rec) : notFound();
  }
  async salesComps(query: SalesCompQuery): Promise<SourceOutcome<SalesComp[]>> {
    this.calls.push(query);
    const f = this.gate<SalesComp[]>();
    if (f) return f;
    return this.comps.length ? ok(this.comps) : notFound();
  }
}

export class FakeRentCompClient extends FakeBase implements RentCompClient {
  private readonly byAddress = new Map<string, RentCompsRecord>();
  set(address: PropertyAddress, record: RentCompsRecord): this {
    this.byAddress.set(normalizeAddress(address), record);
    return this;
  }
  async rentComps(address: PropertyAddress, opts?: { bedrooms?: number }): Promise<SourceOutcome<RentCompsRecord>> {
    this.calls.push({ address, opts });
    const f = this.gate<RentCompsRecord>();
    if (f) return f;
    const rec = this.byAddress.get(normalizeAddress(address));
    return rec ? ok(rec) : notFound();
  }
}

export class FakeRentEstimateClient extends FakeBase implements RentEstimateClient {
  private readonly byBedrooms = new Map<number, RentEstimate>();
  set(record: RentEstimate): this {
    this.byBedrooms.set(record.bedrooms, record);
    return this;
  }
  async estimate(address: PropertyAddress, opts: { bedrooms: number }): Promise<SourceOutcome<RentEstimate>> {
    this.calls.push({ address, opts });
    const f = this.gate<RentEstimate>();
    if (f) return f;
    const rec = this.byBedrooms.get(opts.bedrooms);
    return rec ? ok(rec) : notFound();
  }
}
