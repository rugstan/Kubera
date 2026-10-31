import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConsentEvent, ConsentLedger } from "@/lib/consent/ledger";
import { SMS_START_CONSENT, SMS_STOP_NOTICE } from "./sms/keywords";
import type { Channel, ConsentPolicy } from "./types";

// Consent gating for outbound notifications. The source of truth is the
// append-only consent ledger (consent_events): the latest event that covers a
// channel for an email address or phone number decides. A later 'revoked' row
// (SMS STOP, privacy request) beats an earlier grant, and a grant after a
// revocation (the person texts START, or submits a new form) restores it.

export type ConsentRecord = {
  id?: string;
  eventType: "granted" | "revoked" | "confirmed";
  form: string;
  channels: readonly string[];
  /** ISO timestamp. */
  occurredAt: string;
  leadId?: string | null;
  partnerId?: string | null;
};

export type ConsentContact = { email?: string | null; phone?: string | null };

export interface ConsentReader {
  /** Ledger rows for the contact point that matters to `channel` (phone for sms, email for email). */
  history(channel: Channel, contact: ConsentContact): Promise<ConsentRecord[]>;
}

export type ConsentState = {
  state: "granted" | "revoked" | "none";
  /** The ledger row that decided the state. */
  eventId?: string;
  leadId?: string | null;
  partnerId?: string | null;
};

/** The ledger channel a notification channel needs. */
const LEDGER_CHANNEL: Record<Channel, string> = { sms: "sms", email: "email" };

export function consentState(records: readonly ConsentRecord[], channel: Channel): ConsentState {
  const wanted = LEDGER_CHANNEL[channel];
  const relevant = records
    .filter((r) => r.channels.includes(wanted))
    // Newsletter opt-ins and unsubscribes are a different program from deal updates.
    .filter((r) => !(channel === "email" && r.form === "newsletter"))
    .map((r, index) => ({ r, index, at: Date.parse(r.occurredAt) }))
    // Oldest first; on a tie a revocation sorts after a grant so it wins.
    .sort((a, b) => a.at - b.at || Number(a.r.eventType === "revoked") - Number(b.r.eventType === "revoked") || a.index - b.index);
  const last = relevant.at(-1)?.r;
  // Lead/partner linkage comes from the most recent row that has one, so a
  // phone-only STOP row can still be tied back to the lead.
  const linked = [...relevant].reverse().find((x) => x.r.leadId || x.r.partnerId)?.r;
  if (!last) return { state: "none" };
  return {
    state: last.eventType === "revoked" ? "revoked" : "granted",
    eventId: last.id,
    leadId: linked?.leadId ?? null,
    partnerId: linked?.partnerId ?? null,
  };
}

export function consentAllows(policy: ConsentPolicy, state: ConsentState): boolean {
  if (policy === "none") return true;
  if (policy === "not_revoked") return state.state !== "revoked";
  return state.state === "granted";
}

// --- Readers ----------------------------------------------------------------------

export class SupabaseConsentReader implements ConsentReader {
  constructor(private readonly db: SupabaseClient) {}

  async history(channel: Channel, contact: ConsentContact): Promise<ConsentRecord[]> {
    const column = channel === "sms" ? "phone" : "email";
    const value = channel === "sms" ? contact.phone : contact.email?.trim().toLowerCase();
    if (!value) return [];
    const { data, error } = await this.db
      .from("consent_events")
      .select("id, event_type, form, channels, occurred_at, lead_id, partner_id")
      .eq(column, value)
      .order("occurred_at", { ascending: true })
      .limit(500);
    if (error) throw new Error(`consent lookup failed: ${error.message}`);
    return (data ?? []).map((row) => ({
      id: String(row.id),
      eventType: row.event_type as ConsentRecord["eventType"],
      form: String(row.form),
      channels: (row.channels ?? []) as string[],
      occurredAt: String(row.occurred_at),
      leadId: (row.lead_id as string | null) ?? null,
      partnerId: (row.partner_id as string | null) ?? null,
    }));
  }
}

/** Reads consent events held in memory (tests and the no-database fallback). */
export class MemoryConsentReader implements ConsentReader {
  constructor(private readonly events: () => readonly (ConsentEvent & { id: string })[]) {}

  async history(channel: Channel, contact: ConsentContact): Promise<ConsentRecord[]> {
    const email = contact.email?.trim().toLowerCase();
    return this.events()
      .filter((e) => (channel === "sms" ? Boolean(contact.phone) && e.phone === contact.phone : Boolean(email) && e.email === email))
      .map((e) => ({
        id: e.id,
        eventType: e.eventType,
        form: e.form,
        channels: e.channels,
        occurredAt: e.occurredAt,
        leadId: e.leadId ?? null,
        partnerId: e.partnerId ?? null,
      }));
  }
}

// --- Writing STOP / START to the ledger --------------------------------------------

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export type SmsConsentChange = {
  phone: string;
  leadId?: string | null;
  partnerId?: string | null;
  now: Date;
  /** Provider message id of the inbound text, kept as the `page` for audit. */
  source: string;
};

/**
 * Builds the ledger row for a STOP (revocation) or START (re-subscription).
 * `form: "sms"` is allowed by the consent_events check constraint; the
 * TypeScript ConsentForm union (lib/consent/texts.ts, WS-B) does not list it
 * yet, hence the assertion. Revocations cover texts and automated contact
 * only: a person who texts STOP has not asked us to stop emailing them.
 */
export function smsConsentEvent(kind: "revoked" | "granted", change: SmsConsentChange): ConsentEvent {
  const notice = kind === "revoked" ? SMS_STOP_NOTICE : SMS_START_CONSENT;
  return {
    eventType: kind,
    form: "sms" as unknown as ConsentEvent["form"],
    textVersion: notice.id,
    textSha256: sha256(notice.text),
    channels: ["sms", "autodialer"],
    email: null,
    phone: change.phone,
    ip: null,
    userAgent: null,
    page: `sms:${change.source}`.slice(0, 512),
    leadId: change.leadId ?? null,
    partnerId: change.partnerId ?? null,
    occurredAt: change.now.toISOString(),
  };
}

/** Writes the row and throws on failure: a STOP that cannot be recorded must be retried, not dropped. */
export async function recordSmsConsent(ledger: ConsentLedger, kind: "revoked" | "granted", change: SmsConsentChange) {
  return ledger.record(smsConsentEvent(kind, change));
}
