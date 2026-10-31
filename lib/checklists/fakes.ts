// In-memory vault storage and a full desk bundle for WS-U tests.

import { FakeApprovalGate } from "@/lib/compliance/approval-gate";
import { MemoryPortalInviteStore, MemoryPrincipalStore } from "@/lib/principals/store";
import { TEST_KEYRING } from "@/lib/principals/test-fixtures";
import { FakeSanctionsClient, type FakeListEntry } from "@/lib/screening/fake";
import { MemoryDealHoldStore, MemoryScreeningStore } from "@/lib/screening/store";
import type { DeskServices } from "./desk";
import type { ChecklistObjectStorage } from "./service";
import { MemoryChecklistStore } from "./store";

export class FakeObjectStorage implements ChecklistObjectStorage {
  readonly objects = new Map<string, Uint8Array>();
  readonly signed: string[] = [];
  readonly removed: string[] = [];

  async createSignedUploadUrl(path: string) {
    this.signed.push(path);
    return { url: `https://storage.test/upload/${encodeURIComponent(path)}?token=t`, token: `tok-${this.signed.length}` };
  }

  /** What the browser's PUT to the signed URL does. */
  put(path: string, bytes: Uint8Array | string) {
    this.objects.set(path, typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes);
  }

  async readHead(path: string, bytes: number) {
    const o = this.objects.get(path);
    return o ? o.subarray(0, bytes) : null;
  }

  async remove(path: string) {
    this.removed.push(path);
    this.objects.delete(path);
  }
}

export function memoryDesk(opts: { sanctions?: FakeListEntry[]; now?: () => Date } = {}): DeskServices & { storage: FakeObjectStorage; gate: FakeApprovalGate; sanctions: FakeSanctionsClient; invites: MemoryPortalInviteStore; checklists: MemoryChecklistStore; principals: MemoryPrincipalStore } {
  return {
    checklists: new MemoryChecklistStore(),
    principals: new MemoryPrincipalStore(),
    invites: new MemoryPortalInviteStore(),
    screenings: new MemoryScreeningStore(),
    holds: new MemoryDealHoldStore(),
    storage: new FakeObjectStorage(),
    sanctions: new FakeSanctionsClient(opts.sanctions ?? [], { now: opts.now }),
    keyring: TEST_KEYRING,
    gate: new FakeApprovalGate("pending"),
    now: opts.now,
  };
}
