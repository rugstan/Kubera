// Illustrative data for fake-auth mode (local development and e2e). Every
// property, owner and signal below is invented; addresses use "Example"
// street names and no record resembles a real person or loan.

import type { RateSnapshotLike, SignalFetchResult } from "./signals";
import type { MaturityRecord } from "./types";

export const DEMO_ZIPS = ["90001", "91201", "92801", "89501"] as const;

function plusMonths(now: Date, months: number): string {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

const record = (now: Date, r: Omit<MaturityRecord, "source" | "dataAsOf" | "sourceRef"> & { ref: string }): MaturityRecord => {
  const { ref, ...rest } = r;
  return { ...rest, source: "fake", sourceRef: ref, dataAsOf: now.toISOString().slice(0, 10) };
};

export function demoMaturityRecords(now: Date): MaturityRecord[] {
  return [
    record(now, {
      ref: "demo-1",
      address: { line1: "100 Example Ave", city: "Los Angeles", state: "CA", zip: "90001" },
      apn: "0000-000-001",
      propertyType: "multifamily",
      units: 48,
      buildingSqft: 41_000,
      yearBuilt: 1978,
      ownerName: "Example Court Partners LLC",
      ownerKind: "entity",
      mailing: { line1: "200 Sample Plaza", city: "Pasadena", state: "CA", zip: "91101" },
      loan: { lender: "Sample Community Bank", originalAmount: 7_400_000, originationDate: plusMonths(now, -112), maturityDate: plusMonths(now, 8), ratePct: 4.1, loanType: "Fixed" },
      lastSaleDate: plusMonths(now, -113),
      lastSalePrice: 11_200_000,
    }),
    record(now, {
      ref: "demo-2",
      address: { line1: "55 Sample Blvd", city: "Glendale", state: "CA", zip: "91201" },
      apn: "0000-000-002",
      propertyType: "senior_housing",
      units: 92,
      buildingSqft: 64_000,
      yearBuilt: 1999,
      ownerName: "Sample Care Holdings LP",
      ownerKind: "entity",
      mailing: { line1: "9 Placeholder Way", city: "Glendale", state: "CA", zip: "91203" },
      loan: { lender: "Example Life Co", originalAmount: 14_000_000, originationDate: plusMonths(now, -118), maturityDate: plusMonths(now, 5), ratePct: 5.2, loanType: "Fixed" },
      lastSaleDate: null,
      lastSalePrice: null,
    }),
    record(now, {
      ref: "demo-3",
      address: { line1: "801 Demo Street", city: "Anaheim", state: "CA", zip: "92801" },
      apn: "0000-000-003",
      propertyType: "hotel",
      units: 84,
      buildingSqft: 52_000,
      yearBuilt: 2005,
      ownerName: "Demo Hospitality Group Inc",
      ownerKind: "entity",
      mailing: { line1: "801 Demo Street", city: "Anaheim", state: "CA", zip: "92801" },
      loan: { lender: "Placeholder Bank", originalAmount: 9_800_000, originationDate: plusMonths(now, -60), maturityDate: plusMonths(now, 11), ratePct: 3.9, loanType: "Adjustable" },
      lastSaleDate: plusMonths(now, -61),
      lastSalePrice: 14_500_000,
    }),
    record(now, {
      ref: "demo-4",
      address: { line1: "17 Illustration Rd", city: "Los Angeles", state: "CA", zip: "90001" },
      apn: "0000-000-004",
      propertyType: "industrial",
      units: null,
      buildingSqft: 28_000,
      yearBuilt: 1988,
      ownerName: "Pat Example",
      ownerKind: "individual",
      mailing: { line1: "3 Sample Lane", city: "Burbank", state: "CA", zip: "91501" },
      loan: { lender: "Example Credit Union", originalAmount: 2_300_000, originationDate: plusMonths(now, -84), maturityDate: plusMonths(now, 2), ratePct: 4.6, loanType: "Fixed" },
      lastSaleDate: plusMonths(now, -85),
      lastSalePrice: 3_400_000,
    }),
    record(now, {
      ref: "demo-5",
      address: { line1: "4 Fictional Ct", city: "Glendale", state: "CA", zip: "91201" },
      apn: "0000-000-005",
      propertyType: "multifamily",
      units: 3,
      buildingSqft: 3_200,
      yearBuilt: 1962,
      ownerName: "Alex Sample",
      ownerKind: "individual",
      mailing: null,
      loan: { lender: "Example Savings", originalAmount: 640_000, originationDate: plusMonths(now, -118), maturityDate: plusMonths(now, 9), ratePct: 5.9, loanType: "Fixed" },
      lastSaleDate: null,
      lastSalePrice: null,
    }),
    record(now, {
      ref: "demo-6",
      address: { line1: "12 Mock Parkway", city: "Reno", state: "NV", zip: "89501" },
      apn: "0000-000-006",
      propertyType: "office",
      units: null,
      buildingSqft: 40_000,
      yearBuilt: 1995,
      ownerName: "Placeholder Offices LLC",
      ownerKind: "entity",
      mailing: { line1: "12 Mock Parkway", city: "Reno", state: "NV", zip: "89501" },
      loan: { lender: "Example Bank", originalAmount: 6_000_000, originationDate: plusMonths(now, -100), maturityDate: plusMonths(now, 7), ratePct: 4.4, loanType: "Fixed" },
      lastSaleDate: null,
      lastSalePrice: null,
    }),
  ];
}

export function demoRateSnapshot(now: Date): RateSnapshotLike {
  const asOf = now.toISOString().slice(0, 10);
  return {
    asOf,
    live: false,
    items: [
      { key: "ust10", label: "10-Yr Treasury", value: "4.25%", changeBps: -3, derived: false },
      { key: "sofr", label: "30-Day SOFR", value: "4.10%", changeBps: 0, derived: false },
      { key: "hud232", label: "HUD 232/223(f)", value: "5.65%–6.05%", derived: true },
    ],
  };
}

export function demoNoticeSignals(now: Date): SignalFetchResult {
  const d = now.toISOString().slice(0, 10);
  return {
    drafts: [
      { source: "federal_register", title: "Illustrative HUD notice: multifamily mortgage insurance premium update", summary: "Notice: sample abstract for demonstration only. Not a real Federal Register document.", url: "https://www.federalregister.gov/", publishedAt: d, key: "demo-fr-1" },
      { source: "feed", title: "Illustrative market commentary: lender appetite for hotel debt", summary: "Sample feed item for demonstration only.", url: "https://example.com/demo-feed-1", publishedAt: d },
    ],
  };
}
