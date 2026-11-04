import type { SupabaseClient } from "@supabase/supabase-js";
import { maskPhone, phoneVariants } from "./phone";

// Mirrors an SMS opt-out into Twenty (`person.smsOptOut`), the field brokers
// and the outreach agents read. The consent ledger stays the source of truth:
// every notification checks it, so a Twenty outage never lets a text through.
//
// A person is located by (1) the leads/consent rows that tie the phone number
// to a Twenty person id, then (2) a Twenty search on the common phone formats.
// Writes use Twenty's REST API directly; the opt-out is an internal compliance
// sync of a flag the person asked for, not an outbound communication, so it is
// not held for broker approval.

export interface SmsOptOutSink {
  /** Sets `smsOptOut` on every Twenty person matching the phone. Returns how many records changed. */
  setOptOut(phoneE164: string, optOut: boolean): Promise<{ updated: number }>;
}

/** Finds Twenty person ids already known for a phone number (from leads / consent rows). */
export type PersonIdResolver = (phoneE164: string) => Promise<string[]>;

/** Twenty person ids already tied to a phone number through the consent ledger and the leads table. */
export function supabaseKnownPersonIds(db: SupabaseClient | null): PersonIdResolver {
  return async (phone) => {
    if (!db) return [];
    const { data: consent } = await db.from("consent_events").select("lead_id").eq("phone", phone).not("lead_id", "is", null).limit(50);
    const leadIds = [...new Set((consent ?? []).map((r) => r.lead_id as string))];
    if (leadIds.length === 0) return [];
    const { data: leads } = await db.from("leads").select("twenty_person_id").in("id", leadIds).not("twenty_person_id", "is", null);
    return [...new Set((leads ?? []).map((r) => r.twenty_person_id as string))];
  };
}

export type TwentyOptOutConfig = {
  baseUrl: string;
  apiKey: string;
  resolveKnownPersonIds?: PersonIdResolver;
  fetch?: typeof fetch;
};

export function twentyOptOutConfigFromEnv(env: Record<string, string | undefined> = process.env): Pick<TwentyOptOutConfig, "baseUrl" | "apiKey"> | null {
  const baseUrl = env.TWENTY_API_URL?.trim().replace(/\/$/, "");
  const apiKey = env.TWENTY_API_KEY?.trim();
  return baseUrl && apiKey ? { baseUrl, apiKey } : null;
}

export class TwentyOptOutSink implements SmsOptOutSink {
  constructor(private readonly config: TwentyOptOutConfig) {}

  private async call(method: "GET" | "PATCH", path: string, body?: unknown): Promise<unknown> {
    const doFetch = this.config.fetch ?? fetch;
    const res = await doFetch(`${this.config.baseUrl}/rest/${path}`, {
      method,
      headers: { authorization: `Bearer ${this.config.apiKey}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Twenty ${method} /${path}: ${res.status}`);
    return res.json();
  }

  private async searchByPhone(phone: string): Promise<string[]> {
    const ids = new Set<string>();
    for (const variant of phoneVariants(phone)) {
      const filter = encodeURIComponent(`phones.primaryPhoneNumber[eq]:"${variant.replace(/"/g, "")}"`);
      const res = (await this.call("GET", `people?filter=${filter}&limit=10`)) as { data?: { people?: { id?: string }[] } };
      for (const p of res.data?.people ?? []) if (p.id) ids.add(p.id);
      if (ids.size > 0) break;
    }
    return [...ids];
  }

  async setOptOut(phoneE164: string, optOut: boolean): Promise<{ updated: number }> {
    const ids = new Set<string>(await (this.config.resolveKnownPersonIds?.(phoneE164) ?? Promise.resolve([])));
    if (ids.size === 0) for (const id of await this.searchByPhone(phoneE164)) ids.add(id);
    if (ids.size === 0) {
      console.warn(`notify: no Twenty person found for ${maskPhone(phoneE164)}; opt-out is recorded in the consent ledger only`);
      return { updated: 0 };
    }
    let updated = 0;
    for (const id of ids) {
      await this.call("PATCH", `people/${encodeURIComponent(id)}`, { smsOptOut: optOut });
      updated += 1;
    }
    return { updated };
  }
}

/** In-memory sink for tests. */
export class MemoryOptOutSink implements SmsOptOutSink {
  readonly calls: { phone: string; optOut: boolean }[] = [];
  failWith: Error | null = null;
  /** Phones with a Twenty person; null means every phone has one. */
  people: Set<string> | null = null;

  async setOptOut(phoneE164: string, optOut: boolean) {
    if (this.failWith) throw this.failWith;
    this.calls.push({ phone: phoneE164, optOut });
    return { updated: !this.people || this.people.has(phoneE164) ? 1 : 0 };
  }
}

let warned = false;

/** Twenty when TWENTY_API_URL / TWENTY_API_KEY are set; otherwise null (logged once). */
export function optOutSinkFromEnv(resolveKnownPersonIds?: PersonIdResolver, env: Record<string, string | undefined> = process.env): SmsOptOutSink | null {
  const config = twentyOptOutConfigFromEnv(env);
  if (config) return new TwentyOptOutSink({ ...config, resolveKnownPersonIds });
  if (!warned) {
    warned = true;
    console.warn("notify: Twenty CRM is not configured; SMS opt-outs are recorded in the consent ledger only");
  }
  return null;
}
