import { describe, expect, it } from "vitest";
import { FakeApprovalGate } from "@/lib/compliance/approval-gate";
import { DAYTIME, LEAD_PHONE, makeVoiceHarness, NIGHT } from "../testing";
import { aiVoiceConsentEvent } from "./consent";
import { AI_VOICE_DISCLOSURE, RECORDING_DISCLOSURE } from "./scripts";
import { encodeState, type VoiceEvent } from "./service";

const ADVISOR = "+13105550123";

const humanCall = (over = {}) => ({ idempotencyKey: "call:lead-1:1", mode: "human_assisted" as const, to: LEAD_PHONE, scriptId: "human_bridge", record: false, handoffNumber: ADVISOR, ...over });
const aiCall = (over = {}) => ({ idempotencyKey: "call:lead-1:ai1", mode: "ai_voice" as const, to: LEAD_PHONE, scriptId: "document_followup", record: false, scriptData: { firstName: "Pat", count: 2 }, ...over });

const PRE = ["voice:human_bridge@1", "voice:document_followup@1"];

type H = ReturnType<typeof makeVoiceHarness>;

const ev = (h: H, callId: string, type: string, stage: "dial" | "prelude" | "body", extra: Partial<VoiceEvent> = {}): VoiceEvent => {
  const row = h.voiceStore.rows.find((r) => r.id === callId);
  return { type, callControlId: row?.callControlId ?? null, clientState: Buffer.from(encodeState({ callId, stage })).toString("base64"), ...extra };
};

async function grantAi(h: H, leadId = "lead-1") {
  h.grant({ phone: LEAD_PHONE, leadId });
  await h.aiVoiceConsents.record(aiVoiceConsentEvent({ phone: LEAD_PHONE, now: new Date(DAYTIME.getTime() - 86_400_000), page: "/express" }));
}

describe("placing a call", () => {
  it("does not dial without phone consent", async () => {
    const h = makeVoiceHarness({ preApproved: PRE });
    const out = await h.voice.requestCall(humanCall());
    expect(out).toMatchObject({ status: "blocked", reason: "no_phone_consent" });
    expect(h.client.log).toHaveLength(0);
    expect(h.voiceStore.rows[0]).toMatchObject({ status: "blocked", blockReason: "no_phone_consent" });
  });

  it("does not dial an AI voice with only the form's phone consent", async () => {
    const h = makeVoiceHarness({ preApproved: PRE });
    h.grant({ phone: LEAD_PHONE });
    const out = await h.voice.requestCall(aiCall());
    expect(out).toMatchObject({ status: "blocked", reason: "no_ai_voice_consent" });
    expect(h.client.log).toHaveLength(0);
  });

  it("an SMS STOP blocks an AI-voice call", async () => {
    const h = makeVoiceHarness({ preApproved: PRE });
    await grantAi(h);
    h.stop(LEAD_PHONE);
    expect((await h.voice.requestCall(aiCall())).reason).toBe("automated_contact_revoked");
    expect(h.client.log).toHaveLength(0);
  });

  it("withdrawn AI-voice consent blocks the call", async () => {
    const h = makeVoiceHarness({ preApproved: PRE });
    await grantAi(h);
    await h.aiVoiceConsents.record(aiVoiceConsentEvent({ phone: LEAD_PHONE, eventType: "revoked", now: new Date(DAYTIME.getTime() - 1000), page: "call:abc" }));
    expect((await h.voice.requestCall(aiCall())).reason).toBe("ai_voice_consent_revoked");
  });

  it("does not dial outside the calling window, and dials when retried inside it", async () => {
    const h = makeVoiceHarness({ preApproved: PRE, now: NIGHT });
    h.grant({ phone: LEAD_PHONE });
    expect((await h.voice.requestCall(humanCall())).reason).toBe("outside_calling_window");
    h.clock.now = new Date(NIGHT.getTime() + 15 * 3_600_000);
    const out = await h.voice.requestCall(humanCall());
    expect(out.status).toBe("dialing");
    expect(h.client.types()).toEqual(["dial"]);
  });

  it("does not dial when voice is not configured", async () => {
    const h = makeVoiceHarness({ preApproved: PRE, client: false });
    h.grant({ phone: LEAD_PHONE });
    expect((await h.voice.requestCall(humanCall())).reason).toBe("voice_not_configured");
  });

  it("fails closed when the ledger cannot be read", async () => {
    const h = makeVoiceHarness({ preApproved: PRE });
    h.consent.history = async () => {
      throw new Error("db down");
    };
    expect((await h.voice.requestCall(humanCall())).reason).toBe("consent_lookup_failed");
    expect(h.client.log).toHaveLength(0);
  });

  it("a call that is not pre-approved waits for a broker and never dials until approved", async () => {
    const gate = new FakeApprovalGate("pending");
    const h = makeVoiceHarness({ gate });
    h.grant({ phone: LEAD_PHONE });
    const first = await h.voice.requestCall(humanCall());
    expect(first).toMatchObject({ status: "pending_approval", reason: "approval_pending" });
    expect(h.client.log).toHaveLength(0);
    expect(gate.requests[0]).toMatchObject({ kind: "voice_call", templateId: "voice:human_bridge@1" });
    expect(gate.requests[0]?.summary).not.toContain(LEAD_PHONE);

    gate.decide("outreach:call:lead-1:1", { status: "approved", approvalId: "appr_1", decidedBy: "b", decidedAt: DAYTIME });
    expect((await h.voice.requestCall(humanCall())).status).toBe("dialing");
    expect(h.client.types()).toEqual(["dial"]);
    // The same logical call never dials twice.
    expect((await h.voice.requestCall(humanCall())).reason).toBe("duplicate");
    expect(h.client.types()).toEqual(["dial"]);
  });

  it.each(["rejected", "expired"] as const)("a %s approval never dials", async (status) => {
    const h = makeVoiceHarness({ gate: new FakeApprovalGate(status) });
    h.grant({ phone: LEAD_PHONE });
    const out = await h.voice.requestCall(humanCall());
    expect(out.status).toBe(status);
    expect(h.client.log).toHaveLength(0);
    expect((await h.voice.requestCall(humanCall())).reason).toBe("duplicate");
  });

  it("records a dial failure without throwing", async () => {
    const h = makeVoiceHarness({ preApproved: PRE });
    h.grant({ phone: LEAD_PHONE });
    h.client.failNext = Object.assign(new Error("Telnyx 422"), { name: "VoiceError" }) as never;
    expect(await h.voice.requestCall(humanCall())).toMatchObject({ status: "failed", reason: "dial_failed" });
  });

  it("rejects an invalid number without creating a call", async () => {
    const h = makeVoiceHarness({ preApproved: PRE });
    expect((await h.voice.requestCall(humanCall({ to: "12" }))).reason).toBe("invalid_number");
    expect(h.voiceStore.rows).toHaveLength(0);
  });
});

describe("AI-voice call flow", () => {
  async function dialAi(record: boolean) {
    const h = makeVoiceHarness({ preApproved: PRE });
    await grantAi(h);
    const out = await h.voice.requestCall(aiCall({ record }));
    if (!out.callId) throw new Error("no call");
    return { h, id: out.callId };
  }

  it("says it is an AI voice before anything else, then plays the script and hangs up", async () => {
    const { h, id } = await dialAi(false);
    await h.voice.handleEvent(ev(h, id, "call.answered", "dial"));
    await h.voice.handleEvent(ev(h, id, "call.machine.detection.ended", "dial", { machineResult: "human" }));
    const speak1 = h.client.log.find((l) => l.type === "speak");
    expect(speak1?.text).toBe(AI_VOICE_DISCLOSURE);

    await h.voice.handleEvent(ev(h, id, "call.speak.ended", "prelude"));
    const speaks = h.client.log.filter((l) => l.type === "speak");
    expect(speaks[1]?.text).toContain("2 items");
    expect(speaks[1]?.text).toContain("Hi Pat");
    expect(h.voiceStore.rows[0]?.aiDisclosedAt).not.toBeNull();

    await h.voice.handleEvent(ev(h, id, "call.speak.ended", "body"));
    expect(h.client.types().at(-1)).toBe("hangup");
    await h.voice.handleEvent(ev(h, id, "call.hangup", "body", { hangupCause: "normal_clearing" }));
    expect(h.voiceStore.rows[0]).toMatchObject({ status: "completed", hangupCause: "normal_clearing" });
    expect(h.voiceStore.rows[0]?.endedAt).not.toBeNull();
  });

  it("never starts a recording before the recording disclosure has finished", async () => {
    const { h, id } = await dialAi(true);
    await h.voice.handleEvent(ev(h, id, "call.machine.detection.ended", "dial", { machineResult: "human" }));
    expect(h.client.log.find((l) => l.type === "speak")?.text).toBe(`${AI_VOICE_DISCLOSURE} ${RECORDING_DISCLOSURE}`);
    expect(h.client.types()).not.toContain("startRecording");
    expect(h.voiceStore.rows[0]?.recordingStartedAt).toBeNull();

    await h.voice.handleEvent(ev(h, id, "call.speak.ended", "prelude"));
    const types = h.client.types();
    expect(types.indexOf("startRecording")).toBeGreaterThan(types.indexOf("speak"));
    const row = h.voiceStore.rows[0];
    expect(row?.recordingDisclosedAt).not.toBeNull();
    expect(Date.parse(row?.recordingStartedAt as string)).toBeGreaterThanOrEqual(Date.parse(row?.recordingDisclosedAt as string));
  });

  it("an out-of-order speak-ended for the body cannot start a recording", async () => {
    const { h, id } = await dialAi(true);
    await h.voice.handleEvent(ev(h, id, "call.machine.detection.ended", "dial", { machineResult: "human" }));
    await h.voice.handleEvent(ev(h, id, "call.speak.ended", "body"));
    expect(h.client.types()).not.toContain("startRecording");
    expect(h.client.types()).toContain("hangup");
  });

  it("a redelivered event does not repeat an action", async () => {
    const { h, id } = await dialAi(true);
    const human = ev(h, id, "call.machine.detection.ended", "dial", { machineResult: "human" });
    await h.voice.handleEvent(human);
    await h.voice.handleEvent(human);
    const ended = ev(h, id, "call.speak.ended", "prelude");
    await h.voice.handleEvent(ended);
    await h.voice.handleEvent(ended);
    expect(h.client.log.filter((l) => l.type === "speak")).toHaveLength(2);
    expect(h.client.log.filter((l) => l.type === "startRecording")).toHaveLength(1);
  });

  it("hangs up on a voicemail without leaving a message", async () => {
    const { h, id } = await dialAi(true);
    await h.voice.handleEvent(ev(h, id, "call.answered", "dial"));
    await h.voice.handleEvent(ev(h, id, "call.machine.detection.ended", "dial", { machineResult: "machine" }));
    expect(h.client.types()).toEqual(["dial", "hangup"]);
    expect(h.voiceStore.rows[0]?.status).toBe("voicemail_skipped");
  });

  it("ends the call before anything is said if consent was withdrawn while it rang", async () => {
    const { h, id } = await dialAi(false);
    h.stop(LEAD_PHONE, new Date(h.clock.now.getTime() - 1));
    await h.voice.handleEvent(ev(h, id, "call.machine.detection.ended", "dial", { machineResult: "human" }));
    expect(h.client.types()).toEqual(["dial", "hangup"]);
    expect(h.voiceStore.rows[0]).toMatchObject({ status: "failed", error: "consent revoked before the call connected" });
  });

  it("records the vendor recording id when the recording is saved", async () => {
    const { h, id } = await dialAi(true);
    await h.voice.handleEvent(ev(h, id, "call.recording.saved", "body", { recordingId: "rec_123" }));
    expect(h.voiceStore.rows[0]?.recordingId).toBe("rec_123");
  });

  it("marks an unanswered call", async () => {
    const { h, id } = await dialAi(false);
    await h.voice.handleEvent(ev(h, id, "call.hangup", "dial", { hangupCause: "timeout" }));
    expect(h.voiceStore.rows[0]?.status).toBe("no_answer");
  });

  it("ignores events for calls it does not know", async () => {
    const { h } = await dialAi(false);
    expect(await h.voice.handleEvent({ type: "call.answered", callControlId: "nope", clientState: null })).toMatchObject({ handled: false });
  });

  it("can skip machine detection when turned off", async () => {
    const h = makeVoiceHarness({ preApproved: PRE, waitForMachineDetection: false });
    await grantAi(h);
    const out = await h.voice.requestCall(aiCall());
    await h.voice.handleEvent(ev(h, out.callId as string, "call.answered", "dial"));
    expect(h.client.log.find((l) => l.type === "speak")?.text).toBe(AI_VOICE_DISCLOSURE);
  });
});

describe("advisor-assisted call flow", () => {
  it("plays a recording disclosure, records after it, then transfers to the advisor", async () => {
    const h = makeVoiceHarness({ preApproved: PRE });
    h.grant({ phone: LEAD_PHONE });
    const out = await h.voice.requestCall(humanCall({ record: true }));
    const id = out.callId as string;
    await h.voice.handleEvent(ev(h, id, "call.machine.detection.ended", "dial", { machineResult: "not_sure" }));
    expect(h.client.log.find((l) => l.type === "speak")?.text).toBe(RECORDING_DISCLOSURE);
    await h.voice.handleEvent(ev(h, id, "call.speak.ended", "prelude"));
    await h.voice.handleEvent(ev(h, id, "call.speak.ended", "body"));
    expect(h.client.types()).toEqual(["dial", "speak", "startRecording", "speak", "transfer"]);
    expect(h.client.log.at(-1)).toMatchObject({ type: "transfer", to: ADVISOR });
    expect(h.voiceStore.rows[0]?.status).toBe("transferring");
    // No AI disclosure for a human advisor's call.
    expect(h.client.log.filter((l) => l.type === "speak").map((l) => l.text).join(" ")).not.toContain("AI voice");
  });

  it("an unrecorded advisor call skips straight to the hand-off", async () => {
    const h = makeVoiceHarness({ preApproved: PRE });
    h.grant({ phone: LEAD_PHONE });
    const id = (await h.voice.requestCall(humanCall())).callId as string;
    await h.voice.handleEvent(ev(h, id, "call.machine.detection.ended", "dial", { machineResult: "human" }));
    expect(h.client.types()).toEqual(["dial", "speak"]);
    expect(h.client.log.at(-1)?.text).toContain("connect you to your advisor");
    await h.voice.handleEvent(ev(h, id, "call.speak.ended", "body"));
    expect(h.client.types().at(-1)).toBe("transfer");
    expect(h.client.types()).not.toContain("startRecording");
  });

  it("stops the recording on request and keeps the call going", async () => {
    const h = makeVoiceHarness({ preApproved: PRE });
    h.grant({ phone: LEAD_PHONE });
    const id = (await h.voice.requestCall(humanCall({ record: true }))).callId as string;
    await h.voice.handleEvent(ev(h, id, "call.machine.detection.ended", "dial", { machineResult: "human" }));
    expect(await h.voice.declineRecording(id)).toBe(false);
    await h.voice.handleEvent(ev(h, id, "call.speak.ended", "prelude"));
    expect(await h.voice.declineRecording(id)).toBe(true);
    expect(h.client.types()).toContain("stopRecording");
    expect(h.voiceStore.rows[0]?.recordingStoppedAt).not.toBeNull();
    expect(await h.voice.declineRecording(id)).toBe(false);
  });
});

describe("audit", () => {
  it("logs blocked calls with a reason code and no phone number", async () => {
    const h = makeVoiceHarness({ preApproved: PRE });
    await h.voice.requestCall(humanCall());
    const e = h.audit.events.find((x) => x.agent === "voice");
    expect(e).toMatchObject({ action: "call_plan", reason: "no_phone_consent" });
    expect(JSON.stringify(e)).not.toContain(LEAD_PHONE);
  });
});
