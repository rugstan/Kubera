import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { approvalGate as queueGate } from "@/lib/approvals/server";
import type { ApprovalGate } from "@/lib/compliance/approval-gate";
import { consentLedger, MemoryConsentLedger, type ConsentLedger } from "@/lib/consent/ledger";
import { supabaseAdmin } from "@/lib/supabase/server";
import { MemoryConsentReader, SupabaseConsentReader, type ConsentReader } from "./consent";
import { emailClientFromEnv } from "./email";
import { preApprovedFromEnv } from "./gate";
import { MemoryLeadSource, SupabaseLeadSource, type LeadSource } from "./leads";
import { optOutSinkFromEnv, supabaseKnownPersonIds } from "./optout";
import { MemoryOptOutSyncQueue, supabaseOptOutSyncQueue, type OptOutSyncQueue } from "./optout-sync";
import { Notifier } from "./service";
import { smsClientFromEnv } from "./sms";
import type { TelnyxWebhookDeps } from "./sms/webhook";
import { MemoryNotifyStore, SupabaseNotifyStore, type NotifyStore } from "./store";
import { staffContactsFromEnv, type StaffContacts } from "./tier1";

// Production wiring for the notification pipeline: real providers when their
// env vars are set, otherwise null clients that skip (never crash). Routes call
// notifyRuntime(); tests build a Notifier directly with fakes.

export type NotifyRuntime = {
  notifier: Notifier;
  store: NotifyStore;
  leads: LeadSource;
  consent: ConsentReader;
  ledger: ConsentLedger;
  staff: StaffContacts;
  db: SupabaseClient | null;
};

/**
 * The broker approval gate: WS-I's approvals queue, or the closed gate when it
 * is not configured (templates that are not pre-approved stay pending and
 * nothing sends). A held notification is retried by sending again with the
 * same idempotency key once its approval is approved.
 */
export function approvalGate(): ApprovalGate {
  return queueGate();
}

let cached: NotifyRuntime | undefined;
let warnedMemory = false;

export function notifyRuntime(): NotifyRuntime {
  if (cached) return cached;
  const db = supabaseAdmin();
  if (!db && !warnedMemory) {
    warnedMemory = true;
    console.warn("notify: Supabase is not configured; notification records are kept in memory only");
  }
  const ledger = consentLedger();
  const store: NotifyStore = db ? new SupabaseNotifyStore(db) : new MemoryNotifyStore();
  const consent: ConsentReader = db
    ? new SupabaseConsentReader(db)
    : new MemoryConsentReader(() => (ledger instanceof MemoryConsentLedger ? ledger.events : []));
  const staff = staffContactsFromEnv();
  const notifier = new Notifier({
    email: emailClientFromEnv(),
    sms: smsClientFromEnv(),
    store,
    consent,
    gate: approvalGate(),
    preApproved: preApprovedFromEnv(),
    staffEmails: staff.emails,
  });
  cached = { notifier, store, leads: db ? new SupabaseLeadSource(db) : new MemoryLeadSource(), consent, ledger, staff, db };
  return cached;
}

/**
 * A notifier on the runtime's store, consent ledger and providers with its own
 * gate: for a message a broker already approved through another request (the
 * portal invitation, lib/principals/portal-mail.ts).
 */
export function notifierWithGate(gate: ApprovalGate): Notifier {
  const rt = notifyRuntime();
  return new Notifier({ email: emailClientFromEnv(), sms: smsClientFromEnv(), store: rt.store, consent: rt.consent, gate, preApproved: preApprovedFromEnv(), staffEmails: rt.staff.emails });
}

/** Test hook. */
export function setNotifyRuntime(runtime: NotifyRuntime | undefined) {
  cached = runtime;
}

let memoryOptOutSync: MemoryOptOutSyncQueue | undefined;

/** Pending Twenty opt-out syncs (crm_optout_sync), retried by the crm-retry cron. */
export function optOutSyncQueue(): OptOutSyncQueue {
  const db = notifyRuntime().db;
  if (db) return supabaseOptOutSyncQueue(db);
  memoryOptOutSync ??= new MemoryOptOutSyncQueue();
  return memoryOptOutSync;
}


export function telnyxWebhookDeps(): TelnyxWebhookDeps {
  const rt = notifyRuntime();
  return {
    publicKey: process.env.TELNYX_PUBLIC_KEY?.trim() || undefined,
    store: rt.store,
    notifier: rt.notifier,
    ledger: rt.ledger,
    consent: rt.consent,
    optOut: optOutSinkFromEnv(supabaseKnownPersonIds(rt.db)),
    optOutSync: optOutSyncQueue(),
    staffEmails: rt.staff.emails,
    now: () => new Date(),
  };
}
