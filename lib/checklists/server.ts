import "server-only";
import { approvalGate } from "@/lib/approvals/server";
import { dealStatusHoldSink } from "@/lib/deals/holds";
import { demoDesks } from "@/lib/deals/demo";
import { SupabaseDealDeskStore } from "@/lib/deals/store-supabase";
import { supabasePortalInviteStore, supabasePrincipalStore } from "@/lib/principals/supabase";
import { piiKeyring } from "@/lib/privacy/crypto";
import { sanctionsClient } from "@/lib/screening";
import { supabaseDealHoldStore, supabaseScreeningStore } from "@/lib/screening/supabase";
import { documentServices } from "@/lib/documents/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { DeskServices } from "./desk";
import { supabaseChecklistStore } from "./supabase";
import { checklistVault } from "./vault";

export { checklistDeps, principalDeps, screeningDeps, type DeskServices } from "./desk";

// Server wiring for the checklist desk and the borrower portal. Tests swap the
// whole bundle with setDeskServices(); production builds it from the
// service-role client. In fake-auth mode (local development, e2e) it runs on
// the shared in-memory demo desks (lib/deals/demo.ts). Without Supabase the
// desk and portal report "not available" instead of crashing (Global rule 3).
//
// Outbound actions (the portal invitation email) go through the WS-I approvals
// queue; without it the gate stays closed and the broker can copy the link.

let override: DeskServices | null | undefined;

/** Test hook: inject services (null = "not configured"; undefined restores Supabase). */
export function setDeskServices(services: DeskServices | null | undefined): void {
  override = services;
}

function vaultFor(db: NonNullable<ReturnType<typeof supabaseAdmin>>) {
  const vault = documentServices();
  if (!vault) return null;
  return checklistVault(vault, async (dealId) => {
    const { data, error } = await db.from("deals").select("lead_id").eq("id", dealId).maybeSingle<{ lead_id: string | null }>();
    if (error) throw new Error(`deal lead lookup failed: ${error.message}`);
    return data?.lead_id ?? null;
  });
}

export function deskServices(): DeskServices | null {
  if (override !== undefined) return override;
  const demo = demoDesks();
  if (demo) {
    return {
      checklists: demo.checklists,
      principals: demo.principals,
      invites: demo.invites,
      screenings: demo.screenings,
      holds: demo.holds,
      holdSink: dealStatusHoldSink({ store: demo.deals, holds: demo.holds, now: () => new Date() }),
      // No demo vault: portal uploads report "not available" and the broker collects files by email.
      vault: null,
      sanctions: demo.sanctions,
      keyring: demo.keyring,
      gate: approvalGate(),
    };
  }
  const db = supabaseAdmin();
  if (!db) return null;
  const holds = supabaseDealHoldStore(db);
  return {
    checklists: supabaseChecklistStore(db),
    principals: supabasePrincipalStore(db),
    invites: supabasePortalInviteStore(db),
    screenings: supabaseScreeningStore(db),
    holds,
    // Opening or releasing a sanctions hold moves deals.status (on_hold / held_for_counsel / active).
    holdSink: dealStatusHoldSink({ store: new SupabaseDealDeskStore(db), holds, now: () => new Date() }),
    // Portal uploads go through the WS-K vault: quarantine bucket, finalize, malware scan.
    vault: vaultFor(db),
    sanctions: sanctionsClient(),
    keyring: piiKeyring(),
    gate: approvalGate(),
  };
}
