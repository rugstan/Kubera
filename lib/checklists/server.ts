import "server-only";
import { closedApprovalGate } from "@/lib/compliance/approval-gate";
import { supabasePortalInviteStore, supabasePrincipalStore } from "@/lib/principals/supabase";
import { piiKeyring } from "@/lib/privacy/crypto";
import { sanctionsClient } from "@/lib/screening";
import { supabaseDealHoldStore, supabaseScreeningStore } from "@/lib/screening/supabase";
import { DOCUMENT_BUCKET, supabaseAdmin } from "@/lib/supabase/server";
import type { DeskServices } from "./desk";
import { supabaseChecklistStorage, supabaseChecklistStore } from "./supabase";

export { checklistDeps, principalDeps, screeningDeps, type DeskServices } from "./desk";

// Server wiring for the checklist desk and the borrower portal. Tests swap the
// whole bundle with setDeskServices(); production builds it from the
// service-role client. Without Supabase the desk and portal report
// "not available" instead of crashing (Global rule 3).
//
// The approval gate is closed until WS-I's approvals queue is wired in: portal
// invitation emails stay pending (the broker can copy the link instead).

let override: DeskServices | null | undefined;

/** Test hook: inject services (null = "not configured"; undefined restores Supabase). */
export function setDeskServices(services: DeskServices | null | undefined): void {
  override = services;
}

export function deskServices(): DeskServices | null {
  if (override !== undefined) return override;
  const db = supabaseAdmin();
  if (!db) return null;
  return {
    checklists: supabaseChecklistStore(db),
    principals: supabasePrincipalStore(db),
    invites: supabasePortalInviteStore(db),
    screenings: supabaseScreeningStore(db),
    holds: supabaseDealHoldStore(db),
    storage: supabaseChecklistStorage(db, DOCUMENT_BUCKET),
    sanctions: sanctionsClient(),
    keyring: piiKeyring(),
    gate: closedApprovalGate,
  };
}
