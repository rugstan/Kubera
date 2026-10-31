import "server-only";
import { approvalGate } from "@/lib/approvals/server";
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
// Outbound actions (the portal invitation email) go through the WS-I approvals
// queue; without it the gate stays closed and the broker can copy the link.

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
    gate: approvalGate(),
  };
}
