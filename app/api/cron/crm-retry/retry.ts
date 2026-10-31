// Core of the CRM retry cron. Pure and dependency-injected: the route wires in
// Supabase and the Twenty client, tests wire in fakes. No `server-only` imports
// here so vitest can load it directly.
//
// Qualifier and partner routes push to Twenty after responding. When that push
// fails they record `crm_error` and move on. This job re-pushes those rows with
// exponential backoff and stops after MAX_ATTEMPTS so one poisoned row can't
// loop forever. Rows that hit the cap keep their last error for staff to triage.
//
// Pushes are resumable: each Twenty record id is checkpointed into
// `crm_progress` as soon as it is created, and a retry passes that checkpoint
// back so steps that already succeeded are skipped. A failure after the
// opportunity was created therefore never yields a second company or deal.

import { HUMAN_REVIEW_ENGINE, type JevResult } from "@/lib/ai/jev";
import type { CrmProgress, PushOptions } from "@/lib/crm/twenty";
import type { SmsOptOutSink } from "@/lib/notify/optout";
import { syncPendingOptOuts, type OptOutSyncQueue, type OptOutSyncSummary } from "@/lib/notify/optout-sync";
import type { Contact, Intake, PartnerRegistration } from "@/lib/validation";
import { leadSchema, partnerSchema } from "@/lib/validation";

export const MAX_ATTEMPTS = 8;
/** First retry waits this long after the failed attempt; doubles each time. */
export const BASE_BACKOFF_MS = 15 * 60_000;
export const MAX_BACKOFF_MS = 24 * 60 * 60_000;
/** Rows processed per run. Each push is up to four Twenty calls. */
export const DEFAULT_BATCH = 25;
/** Stop starting new pushes after this long so the function finishes inside maxDuration. */
export const DEFAULT_BUDGET_MS = 45_000;

export type FailedLeadRow = {
  id: string;
  contact: unknown;
  intake: unknown;
  /** Empty object for advisor-only (human_review) leads, which carry no decision. */
  decision: JevResult["decision"];
  rationale: string[];
  engine: JevResult["engine"] | typeof HUMAN_REVIEW_ENGINE;
  latency_ms: number;
  crm_attempts: number;
  crm_last_attempt_at: string | null;
  /** Twenty ids created by earlier attempts (jsonb; may be missing on old rows). */
  crm_progress?: unknown;
};

export type FailedPartnerRow = {
  id: string;
  profile: unknown;
  crm_attempts: number;
  crm_last_attempt_at: string | null;
  crm_progress?: unknown;
};

export type RowPatch = {
  crm_error: string | null;
  crm_attempts: number;
  crm_last_attempt_at: string;
} & Record<string, string | number | null>;

/** Persistence the job needs. The Supabase implementation lives in ./wiring.ts. */
export interface RetryStore {
  /** Leads with `crm_error` set, no Twenty person id, and attempts below the cap. */
  failedLeads(limit: number): Promise<FailedLeadRow[]>;
  failedPartners(limit: number): Promise<FailedPartnerRow[]>;
  updateLead(id: string, patch: RowPatch): Promise<void>;
  updatePartner(id: string, patch: RowPatch): Promise<void>;
  /** Checkpoints the Twenty ids created so far (written after every step). */
  saveLeadProgress(id: string, progress: CrmProgress): Promise<void>;
  savePartnerProgress(id: string, progress: CrmProgress): Promise<void>;
}

export interface CrmPusher {
  pushLead(intake: Intake, contact: Contact, jev: JevResult | null, opts?: PushOptions): Promise<{ personId: string; opportunityId?: string }>;
  pushPartner(reg: PartnerRegistration, opts?: PushOptions): Promise<{ companyId?: string }>;
}

export type RetryDeps = {
  store: RetryStore;
  crm: CrmPusher;
  /** Rebuilds the full Jev result (quotes included) from what was persisted. */
  rebuildJev: (intake: Intake, stored: Pick<FailedLeadRow, "decision" | "rationale" | "engine" | "latency_ms"> & { engine: JevResult["engine"] }) => JevResult;
  /** Latest SMS consent state for a phone (consent ledger): a number revoked since the form is not written to Twenty as textable. */
  smsConsent?: PushOptions["smsConsent"];
  /** SMS opt-outs the Telnyx webhook could not write to Twenty, retried after the leads (so a person created this run is found). */
  optOuts?: { queue: OptOutSyncQueue; sink: SmsOptOutSink } | null;
  now?: () => number;
  batch?: number;
  budgetMs?: number;
};

export type KindSummary = { candidates: number; attempted: number; succeeded: number; failed: number; exhausted: number; deferred: number };
export type RetrySummary = { leads: KindSummary; partners: KindSummary; optOuts?: OptOutSyncSummary; stoppedEarly: boolean };

export function backoffMs(attempts: number): number {
  if (attempts <= 0) return 0;
  return Math.min(BASE_BACKOFF_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS);
}

/** A row is due when it has never been retried or its backoff has elapsed. */
export function isDue(row: { crm_attempts: number; crm_last_attempt_at: string | null }, nowMs: number): boolean {
  if (row.crm_attempts >= MAX_ATTEMPTS) return false;
  if (!row.crm_last_attempt_at) return true;
  const last = Date.parse(row.crm_last_attempt_at);
  if (!Number.isFinite(last)) return true;
  return nowMs - last >= backoffMs(row.crm_attempts);
}

export function errorMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 1_000);
}

const emptySummary = (): KindSummary => ({ candidates: 0, attempted: 0, succeeded: 0, failed: 0, exhausted: 0, deferred: 0 });

export async function runCrmRetry(deps: RetryDeps): Promise<RetrySummary> {
  const now = deps.now ?? Date.now;
  const batch = deps.batch ?? DEFAULT_BATCH;
  const deadline = now() + (deps.budgetMs ?? DEFAULT_BUDGET_MS);
  const summary: RetrySummary = { leads: emptySummary(), partners: emptySummary(), stoppedEarly: false };
  // Fetch a wider window than the batch: not-yet-due rows are skipped, not counted.
  const window = batch * 4;

  const leads = await deps.store.failedLeads(window);
  summary.leads.candidates = leads.length;
  let used = 0;
  for (const row of leads) {
    if (!isDue(row, now())) {
      summary.leads.deferred++;
      continue;
    }
    if (used >= batch || now() >= deadline) {
      summary.stoppedEarly = true;
      break;
    }
    used++;
    summary.leads.attempted++;
    const attemptedAt = new Date(now()).toISOString();
    const attempts = row.crm_attempts + 1;
    const parsed = leadSchema.safeParse({ intake: row.intake, contact: row.contact });
    if (!parsed.success) {
      // Stored payload no longer validates; retrying can never help.
      await deps.store.updateLead(row.id, { crm_error: "Stored lead no longer passes validation; manual CRM entry needed", crm_attempts: MAX_ATTEMPTS, crm_last_attempt_at: attemptedAt });
      summary.leads.exhausted++;
      continue;
    }
    try {
      const { intake, contact } = parsed.data;
      // Advisor-only leads were never scored; rebuilding a decision would run
      // the automated scoring the person opted out of.
      const jev = row.engine === HUMAN_REVIEW_ENGINE ? null : deps.rebuildJev(intake, { ...row, engine: row.engine });
      const refs = await deps.crm.pushLead(intake, contact, jev, {
        progress: row.crm_progress as CrmProgress | null | undefined,
        onProgress: (progress) => deps.store.saveLeadProgress(row.id, progress),
        ...(deps.smsConsent ? { smsConsent: deps.smsConsent } : {}),
      });
      await deps.store.updateLead(row.id, {
        crm_error: null,
        crm_attempts: attempts,
        crm_last_attempt_at: attemptedAt,
        twenty_person_id: refs.personId,
        twenty_opportunity_id: refs.opportunityId ?? null,
      });
      summary.leads.succeeded++;
    } catch (err) {
      await deps.store.updateLead(row.id, { crm_error: errorMessage(err), crm_attempts: attempts, crm_last_attempt_at: attemptedAt });
      summary.leads.failed++;
      if (attempts >= MAX_ATTEMPTS) summary.leads.exhausted++;
    }
  }

  const partners = await deps.store.failedPartners(window);
  summary.partners.candidates = partners.length;
  used = 0;
  for (const row of partners) {
    if (!isDue(row, now())) {
      summary.partners.deferred++;
      continue;
    }
    if (used >= batch || now() >= deadline) {
      summary.stoppedEarly = true;
      break;
    }
    used++;
    summary.partners.attempted++;
    const attemptedAt = new Date(now()).toISOString();
    const attempts = row.crm_attempts + 1;
    const parsed = partnerSchema.safeParse(row.profile);
    if (!parsed.success) {
      await deps.store.updatePartner(row.id, { crm_error: "Stored registration no longer passes validation; manual CRM entry needed", crm_attempts: MAX_ATTEMPTS, crm_last_attempt_at: attemptedAt });
      summary.partners.exhausted++;
      continue;
    }
    try {
      const refs = await deps.crm.pushPartner(parsed.data, {
        progress: row.crm_progress as CrmProgress | null | undefined,
        onProgress: (progress) => deps.store.savePartnerProgress(row.id, progress),
        ...(deps.smsConsent ? { smsConsent: deps.smsConsent } : {}),
      });
      await deps.store.updatePartner(row.id, {
        crm_error: null,
        crm_attempts: attempts,
        crm_last_attempt_at: attemptedAt,
        twenty_company_id: refs.companyId ?? null,
      });
      summary.partners.succeeded++;
    } catch (err) {
      await deps.store.updatePartner(row.id, { crm_error: errorMessage(err), crm_attempts: attempts, crm_last_attempt_at: attemptedAt });
      summary.partners.failed++;
      if (attempts >= MAX_ATTEMPTS) summary.partners.exhausted++;
    }
  }

  // Opt-outs last: a person this run created is now in Twenty and can be found by phone.
  if (deps.optOuts) {
    summary.optOuts = await syncPendingOptOuts({ queue: deps.optOuts.queue, sink: deps.optOuts.sink, now, limit: batch * 2, deadline });
  }

  return summary;
}
