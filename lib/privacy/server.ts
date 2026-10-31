import "server-only";
import { safeEqual, verifyLeadToken } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { SubjectDataSource } from "./export";
import type { LegalHoldDb } from "./legal-hold";
import type { PrivacyRequestStore, SubmitDeps } from "./requests";
import type { RetentionDb } from "./retention";
import { supabaseObjectStorage, type ObjectStorage } from "./storage";
import { supabaseLeadEmail, supabaseLegalHoldDb, supabasePrivacyRequestStore, supabaseRetentionDb, supabaseSubjectSource } from "./supabase";

// Server wiring for the privacy routes. Tests swap the whole bundle with
// setPrivacyServices(); production builds it from the service-role client.

export type PrivacyServices = {
  requests: PrivacyRequestStore;
  subjects: SubjectDataSource;
  retention: RetentionDb;
  storage: ObjectStorage;
  legalHolds: LegalHoldDb;
  verifyLeadToken: NonNullable<SubmitDeps["verifyLeadToken"]>;
  leadEmail: NonNullable<SubmitDeps["leadEmail"]>;
};

let override: PrivacyServices | null | undefined;

/** Test hook: inject services (null = "not configured"; undefined restores Supabase). */
export function setPrivacyServices(services: PrivacyServices | null | undefined): void {
  override = services;
}

export function privacyServices(): PrivacyServices | null {
  if (override !== undefined) return override;
  const db = supabaseAdmin();
  if (!db) return null;
  return {
    requests: supabasePrivacyRequestStore(db),
    subjects: supabaseSubjectSource(db),
    retention: supabaseRetentionDb(db),
    storage: supabaseObjectStorage(db),
    legalHolds: supabaseLegalHoldDb(db),
    verifyLeadToken: (leadId, token) => Boolean(process.env.LEAD_TOKEN_SECRET) && verifyLeadToken(leadId, token),
    leadEmail: supabaseLeadEmail(db),
  };
}

const MIN_ADMIN_TOKEN = 32;

/**
 * Compliance-staff endpoints (export, verify, legal hold) authenticate with
 * `Authorization: Bearer $PRIVACY_ADMIN_TOKEN` until staff auth (WS-I) lands.
 * Returns "disabled" when no strong token is configured.
 */
export function privacyAdminAuth(req: Request, env: Record<string, string | undefined> = process.env): "ok" | "unauthorized" | "disabled" {
  const token = env.PRIVACY_ADMIN_TOKEN?.trim();
  if (!token || token.length < MIN_ADMIN_TOKEN) return "disabled";
  return safeEqual(req.headers.get("authorization") ?? "", `Bearer ${token}`) ? "ok" : "unauthorized";
}
