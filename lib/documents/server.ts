import "server-only";
import { hashIp, safeEqual } from "@/lib/security";
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

// --- Staff authentication ---------------------------------------------------------

const MIN_STAFF_TOKEN = 32;

export type StaffIdentity = { actor: string };
export type StaffAuthResult = { ok: true; staff: StaffIdentity } | { ok: false; status: 401 | 503 };

/**
 * Staff endpoints (download, delete) authenticate with
 * `Authorization: Bearer $DOCUMENT_STAFF_TOKEN` until staff auth (WS-I) lands.
 * The caller names themselves in `x-staff-actor` (recorded in the audit log;
 * self-asserted while a shared token is in use). Swap this function for a
 * session check when `lib/auth` is available; callers only use the result.
 */
export function authenticateStaff(req: Request, env: Record<string, string | undefined> = process.env): StaffAuthResult {
  const token = env.DOCUMENT_STAFF_TOKEN?.trim();
  if (!token || token.length < MIN_STAFF_TOKEN) return { ok: false, status: 503 };
  if (!safeEqual(req.headers.get("authorization") ?? "", `Bearer ${token}`)) return { ok: false, status: 401 };
  const named = (req.headers.get("x-staff-actor") ?? "").replace(/[^\w@.\- ]+/g, "").trim().slice(0, 100);
  return { ok: true, staff: { actor: `staff:${named || "unnamed"}` } };
}
