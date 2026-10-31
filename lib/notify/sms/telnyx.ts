import { SmsError, type OutboundSms, type SmsClient, type SmsSendResult } from "./types";

// Telnyx Messaging API v2 (10DLC registered number or messaging profile).
// POST /v2/messages with a Bearer API key; the response carries data.id.

export type TelnyxConfig = {
  apiKey: string;
  /** E.164 number registered to the 10DLC campaign. */
  from: string;
  messagingProfileId?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export function telnyxConfigFromEnv(env: Record<string, string | undefined> = process.env): TelnyxConfig | null {
  const apiKey = env.TELNYX_API_KEY?.trim();
  const from = env.TELNYX_FROM_NUMBER?.trim();
  if (!apiKey || !from) return null;
  return { apiKey, from, messagingProfileId: env.TELNYX_MESSAGING_PROFILE_ID?.trim() || undefined };
}

export class TelnyxSmsClient implements SmsClient {
  readonly name = "telnyx" as const;

  constructor(private readonly config: TelnyxConfig) {}

  get fromNumber(): string {
    return this.config.from;
  }

  async send(sms: OutboundSms): Promise<SmsSendResult> {
    const doFetch = this.config.fetch ?? fetch;
    const res = await doFetch(`${this.config.baseUrl ?? "https://api.telnyx.com"}/v2/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.config.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: this.config.from,
        to: sms.to,
        text: sms.text,
        type: "SMS",
        ...(this.config.messagingProfileId ? { messaging_profile_id: this.config.messagingProfileId } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      throw new SmsError(`Telnyx ${res.status}: ${detail}`, res.status);
    }
    const body = (await res.json().catch(() => null)) as { data?: { id?: unknown } } | null;
    const id = body?.data?.id;
    if (typeof id !== "string" || !id) throw new SmsError("Telnyx: no message id in response");
    return { providerMessageId: id };
  }
}
