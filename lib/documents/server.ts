import "server-only";
import { hashIp } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { VaultDeps } from "./mint";
import { supabaseVaultStorage } from "./storage";
import { supabaseDocumentStore, supabaseEventLog } from "./store";
import { limitsFromEnv, systemClock } from "./types";

// Server wiring for the vault routes and the scan worker. Tests swap the whole
// bundle with setDocumentServices(); production builds it from the service-role
// client. Missing Supabase config yields null (routes answer 503), never a crash.

let override: VaultDeps | null | undefined;

/** Test hook: inject services (null = "not configured"; undefined restores Supabase). */
export function setDocumentServices(deps: VaultDeps | null | undefined): void {
  override = deps;
}

export function documentServices(): VaultDeps | null {
  if (override !== undefined) return override;
  const db = supabaseAdmin();
  if (!db) return null;
  return {
    store: supabaseDocumentStore(db),
    events: supabaseEventLog(db),
    storage: supabaseVaultStorage(db),
    clock: systemClock,
    limits: limitsFromEnv(),
  };
}

export { hashIp };

// Staff download and delete authenticate with a WS-I staff session (MFA) in
// ./staff-auth.ts, kept separate so the scan worker CLI never loads next/headers.
