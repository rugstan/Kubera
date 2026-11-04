// CCPA consumer requests: intake, verification, deadlines, and the
// compliance@ queue (public.privacy_requests).
//
// Request types
//   access              right to know / data export (Civ. Code §1798.110, .115)
//   deletion            right to delete (§1798.105)
//   correction          right to correct (§1798.106)
//   human_review        advisor-only handling: no automated scoring and no AI
//                       processing of the person's data (applies immediately)
//   opt_out_sale_share  §1798.120 (Corin does not sell or share; recorded anyway)
//
// Verification (11 CCR §7060–7062): access, deletion and correction need a
// verified requester before anything is disclosed or deleted. A borrower who
// still has the lead capability token from the qualifier is verified when the
// token is valid and the email matches the lead; everyone else waits for
// compliance to match them against our records. Authorized agents are never
// auto-verified (§7063 needs signed permission). Opt-outs need no verification
// because they only restrict what we do (§7026(d)).
//
// Deadlines (§7021): confirm receipt within 10 business days and respond
// within 45 calendar days of receipt (extendable once by 45 with notice).

import { createHash } from "node:crypto";
import { z } from "zod";
import { addBusinessDays, addCalendarDays, civilDateOf, type CivilDate } from "@/lib/disclosures/business-days";

export const PRIVACY_REQUEST_TYPES = ["access", "deletion", "correction", "human_review", "opt_out_sale_share"] as const;
export type PrivacyRequestType = (typeof PRIVACY_REQUEST_TYPES)[number];

export const PRIVACY_REQUEST_STATUSES = ["pending_verification", "verified", "in_progress", "completed", "partially_completed", "denied", "withdrawn"] as const;
export type PrivacyRequestStatus = (typeof PRIVACY_REQUEST_STATUSES)[number];

export const OPEN_STATUSES: readonly PrivacyRequestStatus[] = ["pending_verification", "verified", "in_progress"];

export const COMPLIANCE_MAILBOX = "compliance@corincommercial.com";

/** Request types that only restrict processing: applied at once, no verification. */
export const SELF_EXECUTING_TYPES: readonly PrivacyRequestType[] = ["human_review", "opt_out_sale_share"];

export const ACKNOWLEDGE_BUSINESS_DAYS = 10;
export const RESPONSE_CALENDAR_DAYS = 45;

export const privacyRequestSchema = z
  .object({
    type: z.enum(PRIVACY_REQUEST_TYPES),
    name: z.string().trim().min(1, "Enter your name").max(200),
    email: z.email("Enter a valid email address").trim().max(200),
    phone: z.string().trim().max(40).optional().default(""),
    relationship: z.enum(["self", "authorized_agent"]).optional().default("self"),
    agentName: z.string().trim().max(200).optional(),
    details: z.string().trim().max(4000).optional(),
    /** Optional proof of ownership: the lead id and token the qualifier returned. */
    leadId: z.uuid().optional(),
    leadToken: z.string().trim().min(10).max(200).optional(),
    /** The requester confirms they are the person (or their authorized agent). */
    attest: z.literal(true, "Please confirm the request is yours or that you are authorized to make it"),
  })
  .refine((r) => r.relationship !== "authorized_agent" || Boolean(r.agentName?.trim()), { path: ["agentName"], message: "Enter the authorized agent's name" })
  .refine((r) => r.type !== "correction" || Boolean(r.details?.trim()), { path: ["details"], message: "Tell us what to correct" });

export type PrivacyRequestInput = z.infer<typeof privacyRequestSchema>;

export type VerificationMethod = "lead_token" | "staff_match" | "not_required";

export type PrivacyRequestRow = {
  id: string;
  created_at: string;
  updated_at?: string;
  request_type: PrivacyRequestType;
  status: PrivacyRequestStatus;
  queue: "compliance";
  mailbox: string;
  subject_email: string;
  subject_name: string | null;
  subject_phone: string | null;
  relationship: "self" | "authorized_agent";
  agent_name: string | null;
  details: string | null;
  lead_id: string | null;
  verification_method: VerificationMethod | null;
  verified_at: string | null;
  verified_by: string | null;
  acknowledge_by: CivilDate;
  due_at: CivilDate;
  extended_due_at?: CivilDate | null;
  acknowledged_at?: string | null;
  completed_at: string | null;
  denial_reason?: string | null;
  resolution: Record<string, unknown>;
  export_generated_at?: string | null;
  export_sha256?: string | null;
  ip_hash: string | null;
  user_agent: string | null;
  dedupe_key: string;
  legal_hold?: boolean;
};

export type NewPrivacyRequest = Omit<PrivacyRequestRow, "id" | "created_at" | "updated_at"> & { created_at?: string };

export type PrivacyRequestPatch = Partial<
  Pick<
    PrivacyRequestRow,
    "status" | "verification_method" | "verified_at" | "verified_by" | "completed_at" | "denial_reason" | "resolution" | "export_generated_at" | "export_sha256" | "acknowledged_at"
  >
>;

export type PrivacyPreferences = {
  subject_email: string;
  human_review_only: boolean;
  ai_processing_opt_out: boolean;
  opt_out_sale_share: boolean;
  source_request_id?: string | null;
};

export interface PrivacyRequestStore {
  /** Inserts unless a row with the same dedupe_key exists, in which case that row is returned. */
  insert(row: NewPrivacyRequest): Promise<{ row: PrivacyRequestRow; duplicate: boolean }>;
  get(id: string): Promise<PrivacyRequestRow | null>;
  update(id: string, patch: PrivacyRequestPatch): Promise<void>;
  /** Verified requests of one type waiting to be processed, oldest first. */
  listByStatus(type: PrivacyRequestType, status: PrivacyRequestStatus, limit: number): Promise<PrivacyRequestRow[]>;
  getPreferences(email: string): Promise<PrivacyPreferences | null>;
  /** Merges `prefs` (true values only turn flags on unless `replace`). */
  upsertPreferences(email: string, prefs: Partial<Omit<PrivacyPreferences, "subject_email">>, sourceRequestId: string | null): Promise<PrivacyPreferences>;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** One request per subject, type and office day from the public form (resubmits return the same ticket). */
export function dedupeKey(type: PrivacyRequestType, email: string, day: CivilDate): string {
  return createHash("sha256").update(`${type}|${normalizeEmail(email)}|${day}`).digest("hex").slice(0, 40);
}

export function requestDeadlines(receivedAt: Date): { receivedOn: CivilDate; acknowledgeBy: CivilDate; dueAt: CivilDate } {
  const receivedOn = civilDateOf(receivedAt);
  return {
    receivedOn,
    acknowledgeBy: addBusinessDays(receivedOn, ACKNOWLEDGE_BUSINESS_DAYS),
    dueAt: addCalendarDays(receivedOn, RESPONSE_CALENDAR_DAYS),
  };
}

export type SubmitDeps = {
  store: PrivacyRequestStore;
  now?: () => Date;
  /** Verifies a lead capability token (lib/security verifyLeadToken). */
  verifyLeadToken?: (leadId: string, token: string) => boolean;
  /** Email on file for a lead, for matching against the requester. */
  leadEmail?: (leadId: string) => Promise<string | null>;
};

export type SubmitMeta = { ipHash?: string | null; userAgent?: string | null };

export type SubmitResult = {
  id: string;
  type: PrivacyRequestType;
  status: PrivacyRequestStatus;
  verified: boolean;
  duplicate: boolean;
  acknowledgeBy: CivilDate;
  dueAt: CivilDate;
};

async function verifyByLeadToken(input: PrivacyRequestInput, deps: SubmitDeps): Promise<string | null> {
  if (input.relationship !== "self" || !input.leadId || !input.leadToken || !deps.verifyLeadToken || !deps.leadEmail) return null;
  let tokenOk = false;
  try {
    tokenOk = deps.verifyLeadToken(input.leadId, input.leadToken);
  } catch {
    tokenOk = false;
  }
  if (!tokenOk) return null;
  const onFile = await deps.leadEmail(input.leadId);
  return onFile && normalizeEmail(onFile) === normalizeEmail(input.email) ? input.leadId : null;
}

/**
 * Files a request in the compliance queue. Opt-outs are applied immediately;
 * other requests are verified by lead token when possible and otherwise wait
 * for staff verification.
 */
export async function submitPrivacyRequest(input: PrivacyRequestInput, deps: SubmitDeps, meta: SubmitMeta = {}): Promise<SubmitResult> {
  const now = (deps.now ?? (() => new Date()))();
  const nowIso = now.toISOString();
  const email = normalizeEmail(input.email);
  const { receivedOn, acknowledgeBy, dueAt } = requestDeadlines(now);
  const selfExecuting = SELF_EXECUTING_TYPES.includes(input.type);
  const verifiedLead = selfExecuting ? null : await verifyByLeadToken(input, deps);

  const status: PrivacyRequestStatus = selfExecuting ? "completed" : verifiedLead ? "verified" : "pending_verification";
  const row: NewPrivacyRequest = {
    created_at: nowIso,
    request_type: input.type,
    status,
    queue: "compliance",
    mailbox: COMPLIANCE_MAILBOX,
    subject_email: email,
    subject_name: input.name,
    subject_phone: input.phone || null,
    relationship: input.relationship,
    agent_name: input.relationship === "authorized_agent" ? (input.agentName ?? null) : null,
    details: input.details || null,
    lead_id: verifiedLead,
    verification_method: selfExecuting ? "not_required" : verifiedLead ? "lead_token" : null,
    verified_at: selfExecuting || verifiedLead ? nowIso : null,
    verified_by: selfExecuting ? null : verifiedLead ? "lead_token" : null,
    acknowledge_by: acknowledgeBy,
    due_at: dueAt,
    completed_at: selfExecuting ? nowIso : null,
    resolution: selfExecuting ? { applied: preferenceFlags(input.type), at: nowIso } : {},
    ip_hash: meta.ipHash ?? null,
    user_agent: meta.userAgent?.slice(0, 512) ?? null,
    dedupe_key: dedupeKey(input.type, email, receivedOn),
  };

  const { row: saved, duplicate } = await deps.store.insert(row);
  if (selfExecuting && !duplicate) await deps.store.upsertPreferences(email, preferenceFlags(input.type), saved.id);

  return {
    id: saved.id,
    type: saved.request_type,
    status: saved.status,
    verified: saved.verified_at !== null,
    duplicate,
    acknowledgeBy: saved.acknowledge_by,
    dueAt: saved.due_at,
  };
}

function preferenceFlags(type: PrivacyRequestType): Partial<Omit<PrivacyPreferences, "subject_email">> {
  if (type === "human_review") return { human_review_only: true, ai_processing_opt_out: true };
  if (type === "opt_out_sale_share") return { opt_out_sale_share: true };
  return {};
}

export class PrivacyRequestStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrivacyRequestStateError";
  }
}

/** Staff verification after matching the requester against our records. */
export async function markVerified(store: PrivacyRequestStore, id: string, by: string, now: Date = new Date()): Promise<PrivacyRequestRow> {
  const row = await store.get(id);
  if (!row) throw new PrivacyRequestStateError("Privacy request not found");
  if (row.status !== "pending_verification") throw new PrivacyRequestStateError(`Request is ${row.status}, not pending verification`);
  if (!by.trim()) throw new PrivacyRequestStateError("Verifier is required");
  const patch: PrivacyRequestPatch = { status: "verified", verification_method: "staff_match", verified_at: now.toISOString(), verified_by: by.trim() };
  await store.update(id, patch);
  return { ...row, ...patch } as PrivacyRequestRow;
}

/** Whether a request may have personal information disclosed or deleted. */
export function isActionable(row: Pick<PrivacyRequestRow, "status" | "verified_at">): boolean {
  return (row.status === "verified" || row.status === "in_progress") && row.verified_at !== null;
}

// --- Preferences -----------------------------------------------------------------

/** What the model routing guard needs to know about a person (lib/ai/routing.ts `subject`). */
export async function routingSubject(store: PrivacyRequestStore | null, email: string | null | undefined): Promise<{ aiProcessingOptOut: boolean; humanReviewOnly: boolean }> {
  if (!email) return { aiProcessingOptOut: false, humanReviewOnly: false };
  // No preference store configured means no preference can have been recorded.
  if (!store) return { aiProcessingOptOut: false, humanReviewOnly: false };
  let prefs: PrivacyPreferences | null;
  try {
    prefs = await store.getPreferences(normalizeEmail(email));
  } catch (err) {
    // Fail closed: if the lookup fails we cannot prove there is no opt-out.
    console.error("[privacy] preference lookup failed", err instanceof Error ? err.message : err);
    return { aiProcessingOptOut: true, humanReviewOnly: true };
  }
  return { aiProcessingOptOut: Boolean(prefs?.ai_processing_opt_out), humanReviewOnly: Boolean(prefs?.human_review_only) };
}
