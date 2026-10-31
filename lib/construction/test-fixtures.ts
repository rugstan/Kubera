// Shared fixtures for construction desk tests.

import { FakeApprovalGate } from "@/lib/compliance/approval-gate";
import { FakeLicenseLookup } from "./cslb";
import { FakeDealCreator, type ConstructionDeps } from "./deps";
import { MemoryConstructionStore } from "./store";
import type { ContractorLicense } from "./types";

export const NOW = new Date("2026-11-04T18:00:00Z");

export type TestDeps = ConstructionDeps & {
  store: MemoryConstructionStore;
  gate: FakeApprovalGate;
  licenses: FakeLicenseLookup;
  deals: FakeDealCreator;
  clock: { now: Date };
};

export function makeDeps(options: { gate?: FakeApprovalGate; start?: Date } = {}): TestDeps {
  const clock = { now: options.start ?? NOW };
  return {
    store: new MemoryConstructionStore(),
    gate: options.gate ?? new FakeApprovalGate("approved"),
    licenses: new FakeLicenseLookup(),
    deals: new FakeDealCreator(),
    now: () => clock.now,
    clock,
  };
}

export const projectInput = (over: Record<string, unknown> = {}) => ({
  name: "Harbor View Apartments",
  program: "BANK_CONSTRUCTION",
  assetType: "MULTIFAMILY",
  propertyAddress: "100 Harbor Way",
  city: "Long Beach",
  state: "ca",
  zip: "90802",
  units: "120",
  seismicZone: "on",
  newConstruction: "on",
  generalContractorName: "Pacific Builders Inc",
  generalContractorLicense: "",
  ...over,
});

export const goodLicense = (over: Partial<ContractorLicense> = {}): ContractorLicense => ({
  licenseNumber: "1234567",
  businessName: "Pacific Builders Inc",
  status: "ACTIVE",
  issueDate: "2010-03-01",
  expirationDate: "2027-03-31",
  classifications: ["B", "C10"],
  bondOnFile: true,
  bondExpiresOn: null,
  workersCompStatus: "active",
  disciplinaryAction: false,
  ...over,
});
