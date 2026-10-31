// In-memory WS-K vault and a full desk bundle for WS-U tests.

import { FakeApprovalGate } from "@/lib/compliance/approval-gate";
import { MemoryPortalInviteStore, MemoryPrincipalStore } from "@/lib/principals/store";
import { TEST_KEYRING } from "@/lib/principals/test-fixtures";
import { FakeSanctionsClient, type FakeListEntry } from "@/lib/screening/fake";
import { MemoryDealHoldStore, MemoryScreeningStore } from "@/lib/screening/store";
import type { DeskServices } from "./desk";
import { makeVault } from "@/lib/documents/testing";
import { MemoryChecklistStore } from "./store";
import { checklistVault, type ChecklistVault } from "./vault";

/** The real vault flow (reserve, finalize, scan) on in-memory WS-K stores, filed under `leadId`. */
export function memoryVault(leadId: string | null = TEST_LEAD_ID) {
  const vault = makeVault();
  const leads = new Map<string, string | null>();
  const checklistVaultImpl = checklistVault(vault.deps, async (dealId) => (leads.has(dealId) ? (leads.get(dealId) ?? null) : leadId));
  return { ...vault, leads, vault: checklistVaultImpl };
}

export const TEST_LEAD_ID = "6f1b5c1e-2a8e-4c39-9a55-3d3c1b7f2a10";

export function memoryDesk(opts: { sanctions?: FakeListEntry[]; now?: () => Date } = {}): DeskServices & {
  vault: ChecklistVault;
  vaultParts: ReturnType<typeof memoryVault>;
  gate: FakeApprovalGate;
  sanctions: FakeSanctionsClient;
  invites: MemoryPortalInviteStore;
  checklists: MemoryChecklistStore;
  principals: MemoryPrincipalStore;
} {
  const vaultParts = memoryVault();
  return {
    checklists: new MemoryChecklistStore(),
    principals: new MemoryPrincipalStore(),
    invites: new MemoryPortalInviteStore(),
    screenings: new MemoryScreeningStore(),
    holds: new MemoryDealHoldStore(),
    vault: vaultParts.vault,
    vaultParts,
    sanctions: new FakeSanctionsClient(opts.sanctions ?? [], { now: opts.now }),
    keyring: TEST_KEYRING,
    gate: new FakeApprovalGate("pending"),
    now: opts.now,
  };
}
