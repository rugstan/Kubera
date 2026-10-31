// The service bundle the checklist desk and the borrower portal run on.
// lib/checklists/server.ts builds it from Supabase; tests build it from the
// in-memory stores in ./fakes.ts.

import type { ApprovalGate } from "@/lib/compliance/approval-gate";
import type { PortalInviteStore, PrincipalStore } from "@/lib/principals/store";
import type { PiiKeyring } from "@/lib/privacy/crypto";
import type { DealHoldSink, ScreeningDeps } from "@/lib/screening/service";
import type { DealHoldStore, ScreeningStore } from "@/lib/screening/store";
import type { SanctionsClient } from "@/lib/screening/types";
import type { ChecklistDeps, ChecklistObjectStorage } from "./service";
import type { ChecklistStore } from "./store";

export type DeskServices = {
  checklists: ChecklistStore;
  principals: PrincipalStore;
  invites: PortalInviteStore;
  screenings: ScreeningStore;
  holds: DealHoldStore;
  storage: ChecklistObjectStorage | null;
  sanctions: SanctionsClient | null;
  keyring: PiiKeyring | null;
  gate: ApprovalGate;
  holdSink?: DealHoldSink;
  now?: () => Date;
};

export function checklistDeps(s: DeskServices): ChecklistDeps {
  return { checklists: s.checklists, principals: s.principals, screenings: s.screenings, holds: s.holds, storage: s.storage, now: s.now };
}

export function screeningDeps(s: DeskServices): ScreeningDeps {
  return { client: s.sanctions, screenings: s.screenings, holds: s.holds, principals: s.principals, keyring: s.keyring, sink: s.holdSink, now: s.now };
}

export function principalDeps(s: DeskServices) {
  return { principals: s.principals, keyring: s.keyring, now: s.now };
}
