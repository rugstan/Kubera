import { describe, expect, it, vi } from "vitest";
import { decodeState, encodeState } from "./service";
import { TelnyxVoiceClient, telnyxVoiceConfigFromEnv } from "./telnyx";
import { VoiceError } from "./types";

function client(responses: { ok?: boolean; status?: number; json?: unknown }[]) {
  const calls: { url: string; body: Record<string, unknown>; auth: string | null }[] = [];
  const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get("authorization") });
    const r = responses.shift() ?? { ok: true, json: {} };
    return { ok: r.ok ?? true, status: r.status ?? 200, json: async () => r.json ?? {}, text: async () => "boom" } as Response;
  });
  return { calls, c: new TelnyxVoiceClient({ apiKey: "key", connectionId: "conn1", from: "+13105550188", fetch: fetchFn as unknown as typeof fetch }) };
}

describe("Telnyx voice client", () => {
  it("reads its config from the environment and is off without a connection id", () => {
    expect(telnyxVoiceConfigFromEnv({ TELNYX_API_KEY: "k", TELNYX_FROM_NUMBER: "+13105550199" })).toBeNull();
    expect(telnyxVoiceConfigFromEnv({ TELNYX_API_KEY: "k", TELNYX_VOICE_CONNECTION_ID: "c", TELNYX_FROM_NUMBER: "+13105550199" })).toMatchObject({ from: "+13105550199", connectionId: "c" });
    expect(telnyxVoiceConfigFromEnv({ TELNYX_API_KEY: "k", TELNYX_VOICE_CONNECTION_ID: "c", TELNYX_VOICE_FROM_NUMBER: "+13105550188", TELNYX_FROM_NUMBER: "+13105550199" })?.from).toBe("+13105550188");
  });

  it("places a call with machine detection, a webhook url and client state", async () => {
    const { c, calls } = client([{ json: { data: { call_control_id: "cc_9", call_session_id: "ss_9" } } }]);
    const out = await c.dial({ to: "+14155550100", clientState: encodeState({ callId: "c1", stage: "dial" }), webhookUrl: "https://kuberacommercial.com/api/webhooks/telnyx-voice" });
    expect(out).toEqual({ callControlId: "cc_9", callSessionId: "ss_9" });
    expect(calls[0]?.url).toBe("https://api.telnyx.com/v2/calls");
    expect(calls[0]?.auth).toBe("Bearer key");
    expect(calls[0]?.body).toMatchObject({ connection_id: "conn1", to: "+14155550100", from: "+13105550188", answering_machine_detection: "detect" });
    expect(decodeState(String(calls[0]?.body.client_state))).toEqual({ callId: "c1", stage: "dial" });
  });

  it("sends call commands to the call's action endpoints", async () => {
    const { c, calls } = client([{}, {}, {}, {}, {}]);
    await c.speak("cc/1", "Hello", encodeState({ callId: "c1", stage: "prelude" }));
    await c.startRecording("cc/1");
    await c.stopRecording("cc/1");
    await c.transfer("cc/1", "+13105550123");
    await c.hangup("cc/1");
    expect(calls.map((x) => x.url.replace("https://api.telnyx.com", ""))).toEqual([
      "/v2/calls/cc%2F1/actions/speak",
      "/v2/calls/cc%2F1/actions/record_start",
      "/v2/calls/cc%2F1/actions/record_stop",
      "/v2/calls/cc%2F1/actions/transfer",
      "/v2/calls/cc%2F1/actions/hangup",
    ]);
    expect(calls[0]?.body).toMatchObject({ payload: "Hello", payload_type: "text" });
    expect(calls[3]?.body).toMatchObject({ to: "+13105550123" });
  });

  it("raises a VoiceError on an API error or a response without a call id", async () => {
    await expect(client([{ ok: false, status: 422 }]).c.hangup("cc1")).rejects.toBeInstanceOf(VoiceError);
    await expect(client([{ json: { data: {} } }]).c.dial({ to: "+1", clientState: "{}", webhookUrl: "https://x" })).rejects.toThrow(/no call_control_id/);
  });

  it("decodes client state from base64 or JSON and rejects junk", () => {
    const raw = encodeState({ callId: "c1", stage: "body" });
    expect(decodeState(Buffer.from(raw).toString("base64"))).toEqual({ callId: "c1", stage: "body" });
    expect(decodeState(raw)).toEqual({ callId: "c1", stage: "body" });
    expect(decodeState("%%%")).toBeNull();
    expect(decodeState(null)).toBeNull();
    expect(decodeState(Buffer.from('{"callId":1}').toString("base64"))).toBeNull();
  });
});
