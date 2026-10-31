import { VoiceError, type DialInput, type DialResult, type VoiceClient } from "./types";

// Telnyx Call Control v2. POST /v2/calls places the call; further commands go to
// /v2/calls/{call_control_id}/actions/{command}. Progress comes back as
// webhooks (call.answered, call.speak.ended, call.hangup, ...) carrying the
// client_state we set, which is how ./webhook.ts finds the call.

export type TelnyxVoiceConfig = {
  apiKey: string;
  /** Call Control application (connection) id. */
  connectionId: string;
  /** Voice-enabled E.164 number to call from. */
  from: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export function telnyxVoiceConfigFromEnv(env: Record<string, string | undefined> = process.env): TelnyxVoiceConfig | null {
  const apiKey = env.TELNYX_API_KEY?.trim();
  const connectionId = env.TELNYX_VOICE_CONNECTION_ID?.trim();
  const from = (env.TELNYX_VOICE_FROM_NUMBER ?? env.TELNYX_FROM_NUMBER)?.trim();
  if (!apiKey || !connectionId || !from) return null;
  return { apiKey, connectionId, from };
}

export class TelnyxVoiceClient implements VoiceClient {
  readonly name = "telnyx" as const;

  constructor(private readonly config: TelnyxVoiceConfig) {}

  get fromNumber(): string {
    return this.config.from;
  }

  private async post(path: string, body: Record<string, unknown>): Promise<unknown> {
    const doFetch = this.config.fetch ?? fetch;
    const res = await doFetch(`${this.config.baseUrl ?? "https://api.telnyx.com"}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.config.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      throw new VoiceError(`Telnyx ${res.status}: ${detail}`, res.status);
    }
    return res.json().catch(() => null);
  }

  async dial(input: DialInput): Promise<DialResult> {
    const body = (await this.post("/v2/calls", {
      connection_id: this.config.connectionId,
      to: input.to,
      from: this.config.from,
      webhook_url: input.webhookUrl,
      client_state: Buffer.from(input.clientState, "utf8").toString("base64"),
      timeout_secs: input.timeoutSecs ?? 30,
      // A voicemail greeting is never played to: the call ends when a machine answers.
      answering_machine_detection: "detect",
    })) as { data?: { call_control_id?: unknown; call_session_id?: unknown } } | null;
    const id = body?.data?.call_control_id;
    if (typeof id !== "string" || !id) throw new VoiceError("Telnyx: no call_control_id in response");
    const session = body?.data?.call_session_id;
    return { callControlId: id, callSessionId: typeof session === "string" ? session : null };
  }

  async speak(callControlId: string, text: string, clientState: string): Promise<void> {
    await this.post(`/v2/calls/${encodeURIComponent(callControlId)}/actions/speak`, {
      payload: text,
      payload_type: "text",
      voice: "female",
      language: "en-US",
      client_state: Buffer.from(clientState, "utf8").toString("base64"),
    });
  }

  async startRecording(callControlId: string): Promise<void> {
    await this.post(`/v2/calls/${encodeURIComponent(callControlId)}/actions/record_start`, { format: "mp3", channels: "dual" });
  }

  async stopRecording(callControlId: string): Promise<void> {
    await this.post(`/v2/calls/${encodeURIComponent(callControlId)}/actions/record_stop`, {});
  }

  async transfer(callControlId: string, to: string): Promise<void> {
    await this.post(`/v2/calls/${encodeURIComponent(callControlId)}/actions/transfer`, { to, from: this.config.from });
  }

  async hangup(callControlId: string): Promise<void> {
    await this.post(`/v2/calls/${encodeURIComponent(callControlId)}/actions/hangup`, {});
  }
}

let warned = false;

/** Telnyx when TELNYX_API_KEY, TELNYX_VOICE_CONNECTION_ID and a from number are set; otherwise null (one log line, calls are skipped). */
export function voiceClientFromEnv(env: Record<string, string | undefined> = process.env): VoiceClient | null {
  const config = telnyxVoiceConfigFromEnv(env);
  if (config) return new TelnyxVoiceClient(config);
  if (!warned) {
    warned = true;
    console.warn("outreach: TELNYX_VOICE_CONNECTION_ID is not set; outbound calls are skipped");
  }
  return null;
}
