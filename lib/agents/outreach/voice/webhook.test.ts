import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { DAYTIME } from "../testing";
import { encodeState } from "./service";
import { handleVoiceWebhook, toVoiceEvent, type VoiceWebhookDeps } from "./webhook";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUBLIC_KEY_B64 = (publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(-32).toString("base64");
const ts = () => String(Math.floor(DAYTIME.getTime() / 1000));

function signed(body: unknown, opts: { key?: KeyObject; timestamp?: string; raw?: string } = {}): Request {
  const raw = opts.raw ?? JSON.stringify(body);
  const timestamp = opts.timestamp ?? ts();
  const signature = sign(null, Buffer.from(`${timestamp}|${raw}`), opts.key ?? privateKey).toString("base64");
  return new Request("https://kuberacommercial.com/api/webhooks/telnyx-voice", {
    method: "POST",
    headers: { "content-type": "application/json", "telnyx-signature-ed25519": signature, "telnyx-timestamp": timestamp },
    body: raw,
  });
}

const event = (type: string, payload: Record<string, unknown> = {}) => ({
  data: { event_type: type, payload: { call_control_id: "cc_1", client_state: Buffer.from(encodeState({ callId: "call-1", stage: "prelude" })).toString("base64"), ...payload } },
});

const deps = (over: Partial<VoiceWebhookDeps> = {}) => {
  const handleEvent = vi.fn(async () => ({ handled: true }));
  return { handleEvent, deps: { publicKey: PUBLIC_KEY_B64, service: { handleEvent }, now: () => DAYTIME, ...over } satisfies VoiceWebhookDeps };
};

describe("voice webhook", () => {
  it("is unavailable until TELNYX_PUBLIC_KEY is set", async () => {
    const { deps: d, handleEvent } = deps({ publicKey: undefined });
    expect((await handleVoiceWebhook(signed(event("call.answered")), d)).status).toBe(503);
    expect(handleEvent).not.toHaveBeenCalled();
  });

  it("rejects an invalid or missing signature before reading the event", async () => {
    const { deps: d, handleEvent } = deps();
    const other = generateKeyPairSync("ed25519").privateKey;
    expect((await handleVoiceWebhook(signed(event("call.answered"), { key: other }), d)).status).toBe(401);
    expect((await handleVoiceWebhook(new Request("https://x.test", { method: "POST", body: JSON.stringify(event("call.answered")) }), d)).status).toBe(401);
    expect((await handleVoiceWebhook(signed(event("call.answered"), { timestamp: String(Number(ts()) - 3600) }), d)).status).toBe(401);
    expect(handleEvent).not.toHaveBeenCalled();
  });

  it("rejects a body larger than the limit", async () => {
    const { deps: d } = deps();
    const big = "x".repeat(200 * 1024);
    expect((await handleVoiceWebhook(signed(null, { raw: JSON.stringify({ pad: big }) }), d)).status).toBe(413);
  });

  it("passes a verified event to the call service", async () => {
    const { deps: d, handleEvent } = deps();
    const res = await handleVoiceWebhook(signed(event("call.speak.ended")), d);
    expect(res.status).toBe(200);
    expect(handleEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "call.speak.ended", callControlId: "cc_1" }));
  });

  it("acknowledges a signed payload it cannot parse", async () => {
    const { deps: d, handleEvent } = deps();
    const res = await handleVoiceWebhook(signed(null, { raw: "not json" }), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ignored: true });
    expect(handleEvent).not.toHaveBeenCalled();
  });

  it("answers 500 when processing fails so Telnyx retries", async () => {
    const { deps: d } = deps({ service: { handleEvent: async () => Promise.reject(new Error("db down")) } });
    expect((await handleVoiceWebhook(signed(event("call.answered")), d)).status).toBe(500);
  });

  it("maps machine detection, hangup and recording fields", () => {
    expect(toVoiceEvent(event("call.machine.detection.ended", { result: "machine" }) as never)).toMatchObject({ machineResult: "machine" });
    expect(toVoiceEvent(event("call.machine.detection.ended", { result: "weird" }) as never).machineResult).toBeNull();
    expect(toVoiceEvent(event("call.hangup", { hangup_cause: "busy" }) as never)).toMatchObject({ hangupCause: "busy" });
    expect(toVoiceEvent(event("call.recording.saved", { recording_id: "rec_1" }) as never)).toMatchObject({ recordingId: "rec_1" });
  });
});
