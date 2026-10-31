import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { closedApprovalGate, type ApprovalGate } from "@/lib/compliance/approval-gate";
import { consentLedger, MemoryConsentLedger, type ConsentLedger } from "@/lib/consent/ledger";
import { supabaseAdmin } from "@/lib/supabase/server";
import { MemoryConsentReader, SupabaseConsentReader, type ConsentReader } from "./consent";
import { emailClientFromEnv } from "./email";
import { preApprovedFromEnv } from "./gate";
import { MemoryLeadSource, SupabaseLeadSource, type LeadSource } from "./leads";
import { optOutSinkFromEnv, type PersonIdResolver } from "./optout";
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
 * The broker approval gate. Until WS-I's `approvals` queue lands this is the
 * closed gate: templates that are not pre-approved stay pending and nothing
 * sends. Swap in the lib/approvals gate here when it exists.
 */
export function approvalGate(): ApprovalGate {
  return closedApprovalGate;
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
  const notifier = new Notifier({
    email: emailClientFromEnv(),
    sms: smsClientFromEnv(),
    store,
    consent,
    gate: approvalGate(),
    preApproved: preApprovedFromEnv(),
  });
  cached = { notifier, store, leads: db ? new SupabaseLeadSource(db) : new MemoryLeadSource(), consent, ledger, staff: staffContactsFromEnv(), db };
  return cached;
}

/** Test hook. */
export function setNotifyRuntime(runtime: NotifyRuntime | undefined) {
  cached = runtime;
}

/** Twenty person ids already tied to a phone number through the consent ledger and the leads table. */
function knownPersonIds(db: SupabaseClient | null): PersonIdResolver {
  return async (phone) => {
    if (!db) return [];
    const { data: consent } = await db.from("consent_events").select("lead_id").eq("phone", phone).not("lead_id", "is", null).limit(50);
    const leadIds = [...new Set((consent ?? []).map((r) => r.lead_id as string))];
    if (leadIds.length === 0) return [];
    const { data: leads } = await db.from("leads").select("twenty_person_id").in("id", leadIds).not("twenty_person_id", "is", null);
    return [...new Set((leads ?? []).map((r) => r.twenty_person_id as string))];
  };
}

export function telnyxWebhookDeps(): TelnyxWebhookDeps {
  const rt = notifyRuntime();
  return {
    publicKey: process.env.TELNYX_PUBLIC_KEY?.trim() || undefined,
    store: rt.store,
    notifier: rt.notifier,
    ledger: rt.ledger,
    consent: rt.consent,
    optOut: optOutSinkFromEnv(knownPersonIds(rt.db)),
    staffEmails: rt.staff.emails,
    now: () => new Date(),
  };
}
