import type { DeedMortgageRecord, FloodZoneRecord, ParcelRecord, PropertyAddress, RentCompsRecord } from "./types";

// Shared test fixtures: one Los Angeles apartment building that every source knows about.

export const ADDRESS: PropertyAddress = { line1: "1234 Wilshire Blvd", city: "Los Angeles", state: "CA", zip: "90017" };

export const PARCEL: ParcelRecord = {
  apn: "5143-012-007",
  owner: "WILSHIRE HOLDINGS LLC",
  coordinates: { lat: 34.0522, lon: -118.2437 },
  county: "Los Angeles",
  city: "Los Angeles",
  state: "CA",
  zip: "90017",
  yearBuilt: 1972,
  units: 24,
  stories: 3,
  buildingSqft: 21_600,
  lotAcres: 0.42,
  useDescription: "Apartments 5+ units",
  zoning: "R3-1",
  assessedTotal: 2_450_000,
  assessedLand: 980_000,
  assessedImprovements: 1_470_000,
  lastSalePrice: 2_900_000,
  lastSaleDate: "2014-06-12",
  asOf: "2026-09-01",
};

export const DEED: DeedMortgageRecord = {
  apn: "5143012007",
  ownerOfRecord: "Wilshire Holdings LLC",
  coordinates: { lat: 34.0523, lon: -118.2436 },
  yearBuilt: 1972,
  units: 24,
  buildingSqft: 22_000,
  lotAcres: 0.42,
  assessedTotal: 2_450_000,
  annualTaxes: 29_400,
  lastSalePrice: 2_900_000,
  lastSaleDate: "2014-06-12",
  mortgages: [{ lender: "Pacific Mutual Bank", originalAmount: 1_800_000, originationDate: "2019-08-01", maturityDate: "2029-08-01", interestRatePct: 4.25 }],
};

export const FLOOD_X: FloodZoneRecord = { zone: "X", zoneSubtype: "AREA OF MINIMAL FLOOD HAZARD", specialFloodHazardArea: false, firmPanel: "06037C" };

export const RENT_COMPS: RentCompsRecord = {
  comps: [
    { name: "Grand Court", bedrooms: 2, rent: 2_650, sqft: 900, distanceMiles: 0.4 },
    { name: "Olive Terrace", bedrooms: 2, rent: 2_800, sqft: 950, distanceMiles: 0.7 },
  ],
  medianRent: 2_725,
  expenseBenchmarks: { opexPerUnit: 6_900, taxesPerUnit: 1_225 },
};
