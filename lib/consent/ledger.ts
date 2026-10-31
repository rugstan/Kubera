import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { ConsentChannel, ConsentText } from "./texts";

// Append-only consent ledger (public.consent_events). One row per grant or
// revocation; later workstreams (SMS STOP handling, newsletter double opt-in)
// add rows with event_type 'revoked' / 'confirmed' rather than editing rows.

export type ConsentEventType = "granted" | "revoked" | "confirmed";

export type ConsentEvent = {
  eventType: ConsentEventType;
  form: ConsentText["form"];
  textVersion: string;
  textSha256: string;
  channels: readonly ConsentChannel[];
  email: string | null;
  phone: string | null;
  ip: string | null;
  userAgent: string | null;
  page: string | null;
  leadId?: string | null;
  partnerId?: string | null;
  /** Server time the consent was captured (ISO). */
  occurredAt: string;
};

export type StoredConsentEvent = ConsentEvent & { id: string };

export interface ConsentLedger {
  record(event: ConsentEvent): Promise<StoredConsentEvent>;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** E.164-ish normalization so STOP lookups match regardless of formatting. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (digits.startsWith("+")) return `+${digits.slice(1).replace(/\D/g, "")}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits;
}

export function buildConsentEvent(input: {
  text: ConsentText;
  eventType?: ConsentEventType;
  email?: string | null;
  phone?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  page?: string | null;
  leadId?: string | null;
  partnerId?: string | null;
  now?: Date;
}): ConsentEvent {
  return {
    eventType: input.eventType ?? "granted",
    form: input.text.form,
    textVersion: input.text.id,
    textSha256: sha256(input.text.text),
    channels: input.text.channels,
    email: input.email?.trim().toLowerCase() || null,
    phone: normalizePhone(input.phone),
    ip: input.ip && input.ip !== "unknown" ? input.ip.slice(0, 64) : null,
    userAgent: input.userAgent?.slice(0, 512) || null,
    page: input.page?.slice(0, 512) || null,
    leadId: input.leadId ?? null,
    partnerId: input.partnerId ?? null,
    occurredAt: (input.now ?? new Date()).toISOString(),
  };
}

export class SupabaseConsentLedger implements ConsentLedger {
  constructor(private readonly db: SupabaseClient) {}

  async record(event: ConsentEvent): Promise<StoredConsentEvent> {
    const { data, error } = await this.db
      .from("consent_events")
      .insert({
        event_type: event.eventType,
        form: event.form,
        text_version: event.textVersion,
        text_sha256: event.textSha256,
        channels: event.channels,
        email: event.email,
        phone: event.phone,
        ip: event.ip,
        user_agent: event.userAgent,
        page: event.page,
        lead_id: event.leadId ?? null,
        partner_id: event.partnerId ?? null,
        occurred_at: event.occurredAt,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`consent insert failed: ${error?.message ?? "no row"}`);
    return { ...event, id: String(data.id) };
  }
}

/** Test fake and no-database fallback. */
export class MemoryConsentLedger implements ConsentLedger {
  readonly events: StoredConsentEvent[] = [];

  async record(event: ConsentEvent): Promise<StoredConsentEvent> {
    const stored = { ...event, id: randomUUID() };
    this.events.push(stored);
    return stored;
  }
}

let instance: ConsentLedger | undefined;

export function consentLedger(): ConsentLedger {
  if (instance) return instance;
  const db = supabaseAdmin();
  if (db) {
    instance = new SupabaseConsentLedger(db);
  } else {
    console.warn("consent ledger: Supabase not configured; consent events kept in memory only");
    instance = new MemoryConsentLedger();
  }
  return instance;
}

/** Test hook (undefined resets to the env-derived ledger). */
export function setConsentLedger(ledger: ConsentLedger | undefined) {
  instance = ledger;
}

/**
 * Writes a consent event and never throws: a ledger failure is logged loudly,
 * and downstream outreach treats a missing consent row as "no consent".
 */
export async function recordConsent(event: ConsentEvent): Promise<StoredConsentEvent | null> {
  try {
    return await consentLedger().record(event);
  } catch (err) {
    console.error("CONSENT LEDGER WRITE FAILED", event.form, event.leadId ?? event.partnerId ?? "", err instanceof Error ? err.message : err);
    return null;
  }
}
