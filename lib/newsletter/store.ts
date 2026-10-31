import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// Delivery state for newsletter subscribers (public.newsletter_subscribers).
// The consent ledger, not this table, is the evidence of consent.

export type SubscriberStatus = "pending" | "confirmed" | "unsubscribed";

export type Subscriber = {
  id: string;
  /** Lower-cased. */
  email: string;
  status: SubscriberStatus;
  sourcePage: string | null;
  consentTextVersion: string;
  signupConsentEventId: string | null;
  confirmedConsentEventId: string | null;
  confirmationSentAt: string | null;
  confirmationCount: number;
  confirmedAt: string | null;
  unsubscribedAt: string | null;
  resendContactId: string | null;
  audienceSyncedAt: string | null;
  audienceError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NewSubscriber = Pick<Subscriber, "email" | "sourcePage" | "consentTextVersion" | "signupConsentEventId">;
export type SubscriberPatch = Partial<Omit<Subscriber, "id" | "email" | "createdAt" | "updatedAt">>;

export interface SubscriberStore {
  findByEmail(email: string): Promise<Subscriber | null>;
  findById(id: string): Promise<Subscriber | null>;
  create(input: NewSubscriber): Promise<Subscriber>;
  update(id: string, patch: SubscriberPatch): Promise<Subscriber>;
}

// --- In-memory fake (tests, and local runs without Supabase) -----------------------

export class MemorySubscriberStore implements SubscriberStore {
  readonly rows = new Map<string, Subscriber>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async findByEmail(email: string) {
    for (const row of this.rows.values()) if (row.email === email) return { ...row };
    return null;
  }

  async findById(id: string) {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }

  async create(input: NewSubscriber) {
    if (await this.findByEmail(input.email)) throw new Error("duplicate email");
    const at = this.now().toISOString();
    const row: Subscriber = {
      id: randomUUID(),
      email: input.email,
      status: "pending",
      sourcePage: input.sourcePage,
      consentTextVersion: input.consentTextVersion,
      signupConsentEventId: input.signupConsentEventId,
      confirmedConsentEventId: null,
      confirmationSentAt: null,
      confirmationCount: 0,
      confirmedAt: null,
      unsubscribedAt: null,
      resendContactId: null,
      audienceSyncedAt: null,
      audienceError: null,
      createdAt: at,
      updatedAt: at,
    };
    this.rows.set(row.id, row);
    return { ...row };
  }

  async update(id: string, patch: SubscriberPatch) {
    const row = this.rows.get(id);
    if (!row) throw new Error(`subscriber ${id} not found`);
    const next = { ...row, ...patch, updatedAt: this.now().toISOString() };
    this.rows.set(id, next);
    return { ...next };
  }
}

// --- Supabase ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

const COLUMNS: Record<keyof SubscriberPatch, string> = {
  status: "status",
  sourcePage: "source_page",
  consentTextVersion: "consent_text_version",
  signupConsentEventId: "signup_consent_event_id",
  confirmedConsentEventId: "confirmed_consent_event_id",
  confirmationSentAt: "confirmation_sent_at",
  confirmationCount: "confirmation_count",
  confirmedAt: "confirmed_at",
  unsubscribedAt: "unsubscribed_at",
  resendContactId: "resend_contact_id",
  audienceSyncedAt: "audience_synced_at",
  audienceError: "audience_error",
};

function toRow(patch: SubscriberPatch): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(patch)) out[COLUMNS[key as keyof SubscriberPatch]] = value;
  return out;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

function fromRow(r: Row): Subscriber {
  return {
    id: String(r.id),
    email: String(r.email),
    status: r.status as SubscriberStatus,
    sourcePage: str(r.source_page),
    consentTextVersion: String(r.consent_text_version),
    signupConsentEventId: str(r.signup_consent_event_id),
    confirmedConsentEventId: str(r.confirmed_consent_event_id),
    confirmationSentAt: str(r.confirmation_sent_at),
    confirmationCount: Number(r.confirmation_count ?? 0),
    confirmedAt: str(r.confirmed_at),
    unsubscribedAt: str(r.unsubscribed_at),
    resendContactId: str(r.resend_contact_id),
    audienceSyncedAt: str(r.audience_synced_at),
    audienceError: str(r.audience_error),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export class SupabaseSubscriberStore implements SubscriberStore {
  constructor(private readonly db: SupabaseClient) {}

  private async find(column: "email" | "id", value: string): Promise<Subscriber | null> {
    const { data, error } = await this.db.from("newsletter_subscribers").select("*").eq(column, value).maybeSingle();
    if (error) throw new Error(`newsletter lookup failed: ${error.message}`);
    return data ? fromRow(data as Row) : null;
  }

  findByEmail(email: string) {
    return this.find("email", email);
  }

  findById(id: string) {
    return this.find("id", id);
  }

  async create(input: NewSubscriber) {
    const { data, error } = await this.db
      .from("newsletter_subscribers")
      .insert({
        email: input.email,
        source_page: input.sourcePage,
        consent_text_version: input.consentTextVersion,
        signup_consent_event_id: input.signupConsentEventId,
      })
      .select("*")
      .single();
    if (error || !data) {
      // A concurrent signup for the same address won the unique index; use its row.
      if (error?.code === "23505") {
        const existing = await this.findByEmail(input.email);
        if (existing) return existing;
      }
      throw new Error(`newsletter insert failed: ${error?.message ?? "no row"}`);
    }
    return fromRow(data as Row);
  }

  async update(id: string, patch: SubscriberPatch) {
    const { data, error } = await this.db.from("newsletter_subscribers").update(toRow(patch)).eq("id", id).select("*").single();
    if (error || !data) throw new Error(`newsletter update failed: ${error?.message ?? "no row"}`);
    return fromRow(data as Row);
  }
}
