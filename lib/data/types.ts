// Shared types for the multifamily data layer (WS-Z). Every external source
// sits behind a small interface; every call returns a SourceOutcome and never
// throws, so one provider outage degrades a property lookup instead of failing it.

export const SOURCE_NAMES = ["regrid", "opencorporates", "fema_nfhl", "attom", "hellodata", "rentometer"] as const;
export type SourceName = (typeof SOURCE_NAMES)[number];

export type SourceOutcome<T> =
  | { status: "ok"; data: T }
  | { status: "not_found" }
  | { status: "not_configured" }
  | { status: "error"; error: string };

export const ok = <T>(data: T): SourceOutcome<T> => ({ status: "ok", data });
export const notFound = (): SourceOutcome<never> => ({ status: "not_found" });
export const notConfigured = (): SourceOutcome<never> => ({ status: "not_configured" });
export const failed = (error: string): SourceOutcome<never> => ({ status: "error", error });

/** A US street address as the caller knows it. */
export type PropertyAddress = {
  line1: string;
  city?: string;
  /** Two-letter state; defaults to CA where a client needs one. */
  state?: string;
  zip?: string;
};

export type Coordinates = { lat: number; lon: number };

// --- Parcel (Regrid) ---------------------------------------------------------

export type ParcelRecord = {
  apn?: string;
  owner?: string;
  coordinates?: Coordinates;
  county?: string;
  city?: string;
  state?: string;
  zip?: string;
  yearBuilt?: number;
  units?: number;
  stories?: number;
  buildingSqft?: number;
  lotAcres?: number;
  useDescription?: string;
  zoning?: string;
  assessedTotal?: number;
  assessedLand?: number;
  assessedImprovements?: number;
  lastSalePrice?: number;
  lastSaleDate?: string;
  /** Provider's own refresh date for the parcel, ISO date. */
  asOf?: string;
};

export interface ParcelClient {
  lookupByAddress(address: PropertyAddress): Promise<SourceOutcome<ParcelRecord>>;
}

// --- Entity status (OpenCorporates) ------------------------------------------

export type EntityRecord = {
  name: string;
  jurisdiction: string;
  companyNumber: string;
  /** Provider status text, e.g. "Active", "Dissolved", "Suspended". */
  status?: string;
  active?: boolean;
  incorporationDate?: string;
  dissolutionDate?: string;
  companyType?: string;
  registeredAddress?: string;
  agentName?: string;
  url?: string;
};

export interface EntityClient {
  /** Best match for a legal entity name; `jurisdiction` is an OpenCorporates code such as `us_ca`. */
  searchEntity(name: string, jurisdiction?: string): Promise<SourceOutcome<EntityRecord>>;
}

// --- Flood (FEMA NFHL) ---------------------------------------------------------

export type FloodZoneRecord = {
  zone: string;
  zoneSubtype?: string;
  /** Special Flood Hazard Area: flood insurance is mandatory for federally backed loans. */
  specialFloodHazardArea: boolean;
  baseFloodElevationFt?: number;
  firmPanel?: string;
};

export interface FloodClient {
  lookup(point: Coordinates): Promise<SourceOutcome<FloodZoneRecord>>;
}

// --- Deed, mortgage, sales comps (ATTOM) ----------------------------------------

export type MortgageRecord = {
  lender?: string;
  originalAmount?: number;
  originationDate?: string;
  maturityDate?: string;
  interestRatePct?: number;
  loanType?: string;
};

export type DeedMortgageRecord = {
  apn?: string;
  ownerOfRecord?: string;
  coordinates?: Coordinates;
  yearBuilt?: number;
  units?: number;
  buildingSqft?: number;
  lotAcres?: number;
  assessedTotal?: number;
  annualTaxes?: number;
  lastSalePrice?: number;
  lastSaleDate?: string;
  mortgages: MortgageRecord[];
};

export type SalesCompQuery = {
  center: Coordinates;
  radiusMiles?: number;
  minUnits?: number;
  /** ISO date; sales on or after. */
  since?: string;
  limit?: number;
};

export type SalesComp = {
  address: string;
  saleDate?: string;
  salePrice?: number;
  units?: number;
  yearBuilt?: number;
  buildingSqft?: number;
  pricePerUnit?: number;
  distanceMiles?: number;
};

export interface DeedClient {
  deedAndMortgage(address: PropertyAddress): Promise<SourceOutcome<DeedMortgageRecord>>;
  salesComps(query: SalesCompQuery): Promise<SourceOutcome<SalesComp[]>>;
}

// --- Rent comps and expense benchmarks (HelloData, Rentometer) ----------------

export type RentComp = {
  name?: string;
  address?: string;
  bedrooms?: number;
  rent?: number;
  sqft?: number;
  distanceMiles?: number;
  yearBuilt?: number;
  occupancyPct?: number;
  concessionPct?: number;
};

export type ExpenseBenchmarks = {
  /** Operating expense per unit per year, whole dollars. */
  opexPerUnit?: number;
  taxesPerUnit?: number;
  insurancePerUnit?: number;
  utilitiesPerUnit?: number;
  repairsPerUnit?: number;
  payrollPerUnit?: number;
  managementFeePct?: number;
  sampleSize?: number;
};

export type RentCompsRecord = {
  comps: RentComp[];
  medianRent?: number;
  medianRentPerSqft?: number;
  expenseBenchmarks?: ExpenseBenchmarks;
};

export interface RentCompClient {
  rentComps(address: PropertyAddress, opts?: { bedrooms?: number }): Promise<SourceOutcome<RentCompsRecord>>;
}

export type RentEstimate = {
  bedrooms: number;
  mean?: number;
  median?: number;
  min?: number;
  max?: number;
  percentile25?: number;
  percentile75?: number;
  sampleSize?: number;
};

export interface RentEstimateClient {
  estimate(address: PropertyAddress, opts: { bedrooms: number; bathrooms?: number; buildingType?: string }): Promise<SourceOutcome<RentEstimate>>;
}

/** Every configured client; null means the source is not configured. */
export type DataClients = {
  regrid: ParcelClient | null;
  opencorporates: EntityClient | null;
  fema: FloodClient | null;
  attom: DeedClient | null;
  hellodata: RentCompClient | null;
  rentometer: RentEstimateClient | null;
};

// --- Merged result -----------------------------------------------------------------

export type Confidence = "high" | "medium" | "low";

/** A merged value and where it came from. */
export type Fact<T> = {
  value: T;
  source: SourceName;
  confidence: Confidence;
  asOf?: string;
  /** Values other sources reported that differ from `value`. */
  alternates?: { value: T; source: SourceName }[];
};

export type SourceStatus = { status: SourceOutcome<never>["status"] | "ok" | "skipped"; detail?: string };

export type DataFlagCode =
  | "outside_california"
  | "flood_hazard_area"
  | "owner_entity_inactive"
  | "owner_entity_unverified"
  | "conflict_apn"
  | "conflict_year_built"
  | "conflict_units"
  | "conflict_owner"
  | "conflict_building_sqft"
  | "no_parcel_match"
  | "sources_incomplete";

export type DataFlag = { code: DataFlagCode; message: string };

export type OwnerAssessedValue = { total: number; land?: number; improvements?: number };

export type LastSale = { price?: number; date?: string };

export type PropertyFacts = {
  /** Normalized cache key, see normalizeAddress(). */
  addressKey: string;
  address: PropertyAddress;
  apn?: Fact<string>;
  coordinates?: Fact<Coordinates>;
  county?: Fact<string>;
  city?: Fact<string>;
  owner?: Fact<string>;
  ownerEntity?: Fact<EntityRecord>;
  yearBuilt?: Fact<number>;
  units?: Fact<number>;
  stories?: Fact<number>;
  buildingSqft?: Fact<number>;
  lotAcres?: Fact<number>;
  useDescription?: Fact<string>;
  zoning?: Fact<string>;
  assessedValue?: Fact<OwnerAssessedValue>;
  annualTaxes?: Fact<number>;
  lastSale?: Fact<LastSale>;
  mortgages?: Fact<MortgageRecord[]>;
  flood?: Fact<FloodZoneRecord>;
  rentComps?: Fact<RentCompsRecord>;
  rentEstimates?: Fact<RentEstimate[]>;
  expenseBenchmarks?: Fact<ExpenseBenchmarks>;
  salesComps?: Fact<SalesComp[]>;
  flags: DataFlag[];
  sources: Record<SourceName, SourceStatus>;
  fetchedAt: string;
  expiresAt: string;
  /** True when this object was read from the property_facts cache. */
  fromCache: boolean;
};
