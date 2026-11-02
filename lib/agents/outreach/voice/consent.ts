import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConsentReader, ConsentRecord } from "@/lib/notify/consent";

// Consent for voice calls.
//
// Phone and automated-contact consent live in the shared consent ledger
// (consent_events): the qualifier's wording covers "phone" and "autodialer",
// and an SMS STOP revokes "sms" and "autodialer". An AI voice is an artificial
// voice under the TCPA, so it needs its own, separate, express consent that the
// ledger's channel list does not carry. That consent is an append-only record
// in outreach_voice_consents: the form that offers it writes a "granted" row
// with the version of the wording, and a "revoked" row (any channel: a call, a
// text, a privacy request) ends it. The latest row decides.

export const AI_VOICE_CONSENT_TEXT = {
  id: "ai-voice-2026-11-04",
  text: "I agree that Corin Commercial may call me about this financing request using an artificial or prerecorded voice (an AI voice) at the number I gave. Consent is not a condition of any service. I can withdraw it at any time by telling you on a call, replying STOP to a text, or emailing privacy@corincommercial.com.",
} as const;

export type VoiceConsentEvent = {
  id: string;
  eventType: "granted" | "revoked";
  kind: "ai_voice";
  /** E.164. */
  phone: string;
  leadId: string | null;
  textVersion: string;
  textSha256: string;
  /** Where it was captured: a form path, "call:<id>", "sms:<id>", "staff:<user>". */
  page: string | null;
  occurredAt: string;
};

export type NewVoiceConsentEvent = Omit<VoiceConsentEvent, "id">;

export interface VoiceConsentStore {
  record(event: NewVoiceConsentEvent): Promise<VoiceConsentEvent>;
  /** All AI-voice consent rows for a number, oldest first. */
  history(phone: string): Promise<VoiceConsentEvent[]>;
}

export function aiVoiceConsentEvent(input: { phone: string; leadId?: string | null; eventType?: "granted" | "revoked"; page?: string | null; now?: Date }): NewVoiceConsentEvent {
  return {
    eventType: input.eventType ?? "granted",
    kind: "ai_voice",
    phone: input.phone,
    leadId: input.leadId ?? null,
    textVersion: AI_VOICE_CONSENT_TEXT.id,
    textSha256: createHash("sha256").update(AI_VOICE_CONSENT_TEXT.text, "utf8").digest("hex"),
    page: input.page ?? null,
    occurredAt: (input.now ?? new Date()).toISOString(),
  };
}

export class MemoryVoiceConsentStore implements VoiceConsentStore {
  readonly events: VoiceConsentEvent[] = [];
  async record(event: NewVoiceConsentEvent) {
    const stored = { ...event, id: randomUUID() };
    this.events.push(stored);
    return stored;
  }
  async history(phone: string) {
    return this.events.filter((e) => e.phone === phone).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  }
}

export class SupabaseVoiceConsentStore implements VoiceConsentStore {
  constructor(private readonly db: SupabaseClient) {}

  async record(event: NewVoiceConsentEvent) {
    const { data, error } = await this.db
      .from("outreach_voice_consents")
      .insert({
        event_type: event.eventType,
        kind: event.kind,
        phone: event.phone,
        lead_id: event.leadId,
        text_version: event.textVersion,
        text_sha256: event.textSha256,
        page: event.page,
        occurred_at: event.occurredAt,
      })
      .select("*")
      .single();
    if (error || !data) throw new Error(`ai voice consent insert failed: ${error?.message ?? "no row"}`);
    return toEvent(data);
  }

  async history(phone: string) {
    const { data, error } = await this.db.from("outreach_voice_consents").select("*").eq("phone", phone).order("occurred_at", { ascending: true }).limit(200);
    if (error) throw new Error(`ai voice consent lookup failed: ${error.message}`);
    return (data ?? []).map(toEvent);
  }
}

function toEvent(r: Record<string, unknown>): VoiceConsentEvent {
  return {
    id: String(r.id),
    eventType: r.event_type as VoiceConsentEvent["eventType"],
    kind: "ai_voice",
    phone: String(r.phone),
    leadId: (r.lead_id as string | null) ?? null,
    textVersion: String(r.text_version),
    textSha256: String(r.text_sha256),
    page: (r.page as string | null) ?? null,
    occurredAt: String(r.occurred_at),
  };
}

// --- Deciding ------------------------------------------------------------------------------

export type LedgerLookup = { state: "granted" | "revoked" | "none"; eventId?: string };

/** Latest ledger row for a channel name. A revocation sorts after a grant at the same instant. */
export function ledgerState(records: readonly ConsentRecord[], channel: string): LedgerLookup {
  const relevant = records
    .filter((r) => r.channels.includes(channel))
    // Newsletter opt-ins are a different program from deal contact.
    .filter((r) => r.form !== "newsletter")
    .map((r, index) => ({ r, index, at: Date.parse(r.occurredAt) }))
    .sort((a, b) => a.at - b.at || Number(a.r.eventType === "revoked") - Number(b.r.eventType === "revoked") || a.index - b.index);
  const last = relevant.at(-1)?.r;
  if (!last) return { state: "none" };
  return { state: last.eventType === "revoked" ? "revoked" : "granted", eventId: last.id };
}

export type VoiceConsentState = {
  phone: LedgerLookup;
  automated: LedgerLookup;
  aiVoice: { state: "granted" | "revoked" | "none"; eventId?: string };
};

export function aiVoiceState(events: readonly VoiceConsentEvent[]): VoiceConsentState["aiVoice"] {
  const sorted = [...events].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || Number(a.eventType === "revoked") - Number(b.eventType === "revoked"));
  const last = sorted.at(-1);
  if (!last) return { state: "none" };
  return { state: last.eventType === "revoked" ? "revoked" : "granted", eventId: last.id };
}

/**
 * Everything the call plan needs to know about a number's consent. The ledger is
 * read by phone (the same lookup a text uses), so a STOP received by text
 * shows up here as a revoked "autodialer" channel.
 */
export async function loadVoiceConsent(ledger: ConsentReader, aiVoice: VoiceConsentStore | null, phone: string): Promise<VoiceConsentState> {
  const records = await ledger.history("sms", { phone });
  return {
    phone: ledgerState(records, "phone"),
    automated: ledgerState(records, "autodialer"),
    aiVoice: aiVoice ? aiVoiceState(await aiVoice.history(phone)) : { state: "none" },
  };
}
