import "server-only";
import { verifyLeadToken } from "@/lib/security";
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

// Compliance-staff endpoints (request view / verify, export, legal hold)
// authenticate with the WS-I staff session: see ./staff.ts. The former shared
// PRIVACY_ADMIN_TOKEN bearer is retired and no longer read.
