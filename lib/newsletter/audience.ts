// The Resend audience behind the newsletter. Broadcasts are composed and sent
// from the Resend dashboard (or API) to this audience from the `news.`
// subdomain; this client only keeps the audience in step with consent: a
// confirmed address is added, an unsubscribed one is flagged. It never sends a
// message. Real client over REST (no SDK), in-memory fake for tests, and
// nothing at all when the key or audience id is missing.

export type AudienceContact = { email: string; unsubscribed: boolean };
export type AudienceResult = { contactId: string | null };

export class AudienceError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AudienceError";
  }
}

export interface AudienceClient {
  readonly name: "resend" | "fake";
  /** Creates the contact or updates its unsubscribed flag. Idempotent. */
  upsert(contact: AudienceContact): Promise<AudienceResult>;
}

// --- Resend ------------------------------------------------------------------------------

export type ResendAudienceConfig = { apiKey: string; audienceId: string; baseUrl?: string; fetch?: typeof fetch };

export function resendAudienceConfigFromEnv(env: Record<string, string | undefined> = process.env): ResendAudienceConfig | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const audienceId = env.RESEND_AUDIENCE_ID?.trim();
  return apiKey && audienceId ? { apiKey, audienceId } : null;
}

export class ResendAudienceClient implements AudienceClient {
  readonly name = "resend" as const;

  constructor(private readonly config: ResendAudienceConfig) {}

  private async call(method: "POST" | "PATCH", path: string, body: unknown): Promise<Response> {
    const doFetch = this.config.fetch ?? fetch;
    return doFetch(`${this.config.baseUrl ?? "https://api.resend.com"}/audiences/${encodeURIComponent(this.config.audienceId)}/contacts${path}`, {
      method,
      headers: { authorization: `Bearer ${this.config.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  }

  async upsert(contact: AudienceContact): Promise<AudienceResult> {
    const created = await this.call("POST", "", { email: contact.email, unsubscribed: contact.unsubscribed });
    if (created.ok) {
      const body = (await created.json().catch(() => null)) as { id?: unknown } | null;
      return { contactId: typeof body?.id === "string" ? body.id : null };
    }
    // The address is already in the audience: update its flag instead.
    if (created.status === 400 || created.status === 409 || created.status === 422) {
      const updated = await this.call("PATCH", `/${encodeURIComponent(contact.email)}`, { unsubscribed: contact.unsubscribed });
      if (updated.ok) {
        const body = (await updated.json().catch(() => null)) as { id?: unknown } | null;
        return { contactId: typeof body?.id === "string" ? body.id : null };
      }
      throw new AudienceError(`Resend audience update ${updated.status}: ${(await updated.text().catch(() => "")).slice(0, 200)}`, updated.status);
    }
    throw new AudienceError(`Resend audience create ${created.status}: ${(await created.text().catch(() => "")).slice(0, 200)}`, created.status);
  }
}

// --- Fake --------------------------------------------------------------------------------

export class FakeAudienceClient implements AudienceClient {
  readonly name = "fake" as const;
  readonly contacts = new Map<string, { id: string; unsubscribed: boolean }>();
  /** When set, the next call rejects with this error. */
  failNext: AudienceError | null = null;

  async upsert(contact: AudienceContact): Promise<AudienceResult> {
    if (this.failNext) {
      const err = this.failNext;
      this.failNext = null;
      throw err;
    }
    const existing = this.contacts.get(contact.email);
    const id = existing?.id ?? `fake_contact_${this.contacts.size + 1}`;
    this.contacts.set(contact.email, { id, unsubscribed: contact.unsubscribed });
    return { contactId: id };
  }
}

let warned = false;

/** Resend when RESEND_API_KEY and RESEND_AUDIENCE_ID are set; otherwise null (one log line, nothing crashes). */
export function audienceClientFromEnv(env: Record<string, string | undefined> = process.env): AudienceClient | null {
  const config = resendAudienceConfigFromEnv(env);
  if (config) return new ResendAudienceClient(config);
  if (!warned) {
    warned = true;
    console.warn("newsletter: RESEND_AUDIENCE_ID is not set; confirmed subscribers are recorded but not added to a Resend audience");
  }
  return null;
}
