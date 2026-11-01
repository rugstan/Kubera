// Shared fixtures for lib/deals tests.

import { checklistDeps } from "@/lib/checklists/desk";
import { memoryDesk } from "@/lib/checklists/fakes";
import { createDealChecklist, moveItem, syncDealPrincipalItems } from "@/lib/checklists/service";
import { FakeApprovalGate } from "@/lib/compliance/approval-gate";
import { addPrincipal } from "@/lib/principals/service";
import { screenDeal } from "@/lib/screening/service";
import type { FakeListEntry } from "@/lib/screening/fake";
import { createDeal } from "./service";
import { MemoryDealDeskStore } from "./store";
import type { Deal, LoanBrokerOfRecord, NewDeal, NewLender, PackageItem } from "./types";

export const T0 = new Date("2026-11-03T17:00:00.000Z");

export function clockAt(start: Date = T0) {
  let t = start.getTime();
  const now = () => new Date(t);
  return { now, advance: (ms: number) => (t += ms) };
}

/** A sanctions-hold reader with no open holds (WS-U desk configured, deal clear). */
export const noHolds = { active: async () => [] };

export function setup(gateDefault: ConstructorParameters<typeof FakeApprovalGate>[0] = "approved") {
  const store = new MemoryDealDeskStore();
  const gate = new FakeApprovalGate(gateDefault);
  const clock = clockAt();
  return { store, gate, clock, now: clock.now };
}

export async function newDeal(store: MemoryDealDeskStore, now: () => Date, input: Partial<NewDeal> = {}): Promise<Deal> {
  return createDeal({ store, now }, { title: "Sunrise Assisted Living refi", program: "HUD_232", loanAmountCents: 1_250_000_000, collateralRealProperty: true, propertyState: "CA", borrowerName: "Sunrise Care LLC", ...input }, "broker:ana");
}

export const lenderInput = (over: Partial<NewLender> = {}): NewLender => ({
  partnerId: null,
  name: "Cambridge Realty Capital",
  category: "STATE_BANK",
  categoryEvidenceRef: "CA DFPI charter 1234",
  programs: ["HUD_232", "HUD_MULTIFAMILY", "SBA_7A", "HARD_MONEY"],
  minLoanCents: 100_000_000,
  maxLoanCents: 10_000_000_000,
  states: [],
  assetTypes: ["senior_housing"],
  appetiteNotes: null,
  brokerFriendly: true,
  feeSplitKind: "percent_of_lender_fee",
  feeSplitValue: 50,
  feeAgreementRef: "vault://agreements/cambridge-2026.pdf",
  contactName: "Dana Lee",
  contactEmail: "dana@lender.example",
  verifiedAt: "2026-10-01T00:00:00.000Z",
  verifiedBy: "broker:ana",
  active: true,
  ...over,
});

export const docs = (n: number, salt = "a"): PackageItem[] =>
  Array.from({ length: n }, (_, i) => ({
    documentId: `doc-${i + 1}`,
    label: `Document ${i + 1}`,
    kind: i === 0 ? "T12" : "OTHER",
    storagePath: `leads/x/doc-${i + 1}.pdf`,
    sha256: (salt + String(i)).padEnd(64, "0").replace(/[^0-9a-f]/g, "0"),
  }));

export function loanRecord(dealId: string, over: Partial<LoanBrokerOfRecord> = {}): LoanBrokerOfRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    dealId,
    leadId: null,
    lender: { name: "Fidelis Private Fund", category: "PRIVATE_NON_EXEMPT" },
    noteRatePct: 12.5,
    fedDiscountRatePct: 4.5,
    collateral: { realPropertyLien: true, equityPledgeOrUccOnly: false, apn: "041-1234-005", lienPosition: 1 },
    elements: { negotiationLog: [], businessPurposeCertified: false },
    tableFundedInKuberaName: false,
    transactionDate: "2026-03-01",
    ...over,
  };
}

export const fullElements = {
  arrangingLicensee: { name: "Neeli Khanna", dreLicense: "01234567", activeAtTransaction: true },
  actsFor: "borrower" as const,
  engagementAgreementRef: "vault://engagement/ext-1.pdf",
  compensation: { amountUsd: 15_000, payer: "borrower" as const, expected: true },
  negotiationLog: [{ at: "2026-10-20T18:00:00.000Z", kind: "term_sheet" as const, ref: "ext-term-sheet-v2", summary: "6-month extension at 12.5%" }],
  businessPurposeCertified: true,
};

/**
 * WS-U desk for a deal: one checklist with every required item accepted, a
 * borrower entity wholly owned by one managing member, and both screened
 * against `sanctions` (default: no list entries, so the screening is clear).
 */
export async function checklistDesk(dealId: string, now: () => Date, opts: { sanctions?: FakeListEntry[]; complete?: boolean } = {}) {
  const desk = memoryDesk({ sanctions: opts.sanctions ?? [], now });
  const deps = checklistDeps(desk);
  const pdeps = { principals: desk.principals, keyring: desk.keyring, now };
  await createDealChecklist(deps, { dealId, program: "BRIDGE", createdBy: "broker:ana" });
  const entity = await addPrincipal(pdeps, { dealId, kind: "entity", legalName: "Sunrise Care LLC", roles: ["borrower_entity"], formationState: "CA" });
  await addPrincipal(pdeps, { dealId, parentId: entity.principal.id, kind: "individual", legalName: "Pat Owner", roles: ["managing_member"], ownershipPct: 100, email: "pat@example.com" });
  await syncDealPrincipalItems(deps, dealId);
  if (opts.complete !== false) {
    for (const item of await deps.checklists.itemsForDeal(dealId)) {
      if (!item.required) continue;
      await moveItem(deps, { itemId: item.id, expectedVersion: item.version, to: "accepted", actor: { kind: "staff", id: "broker@kuberacommercial.com" }, documentDate: now().toISOString().slice(0, 10) });
    }
  }
  const sdeps = { client: desk.sanctions, screenings: desk.screenings, holds: desk.holds, principals: desk.principals, keyring: desk.keyring, now };
  const screened = await screenDeal(sdeps, { dealId, purpose: "initial", requestedBy: "broker@kuberacommercial.com" });
  return { desk, deps, sdeps, screened };
}
