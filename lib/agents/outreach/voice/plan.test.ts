import { describe, expect, it } from "vitest";
import { DAYTIME, NIGHT } from "../testing";
import { aiVoiceState, ledgerState, type VoiceConsentState } from "./consent";
import { planCall, type CallRequest } from "./plan";
import { AI_VOICE_DISCLOSURE, RECORDING_DISCLOSURE, allScripts, callPrelude, scriptById, scriptFingerprint } from "./scripts";

const granted = { state: "granted", eventId: "ev1" } as const;
const none = { state: "none" } as const;
const revoked = { state: "revoked", eventId: "ev2" } as const;

const consent = (over: Partial<VoiceConsentState> = {}): VoiceConsentState => ({ phone: granted, automated: granted, aiVoice: { state: "granted", eventId: "ai1" }, ...over });

const human: CallRequest = { mode: "human_assisted", to: "(415) 555-0100", scriptId: "human_bridge", record: false, handoffNumber: "+13105550123" };
const ai: CallRequest = { mode: "ai_voice", to: "+14155550100", scriptId: "document_followup", record: false, scriptData: { firstName: "Pat", count: 2 } };
const opts = { configured: true, now: DAYTIME };

describe("call plan: human-assisted", () => {
  it("allows a call with phone consent inside the window", () => {
    const plan = planCall(human, consent({ automated: none, aiVoice: none }), opts);
    expect(plan).toMatchObject({ allowed: true, to: "+14155550100", handoffNumber: "+13105550123", prelude: "" });
  });

  it("needs phone consent on the ledger", () => {
    expect(planCall(human, consent({ phone: none }), opts)).toEqual({ allowed: false, reason: "no_phone_consent" });
    expect(planCall(human, consent({ phone: revoked }), opts)).toEqual({ allowed: false, reason: "phone_consent_revoked" });
  });

  it("does not need AI-voice consent, and a text STOP (automated contact revoked) does not stop an advisor's own call", () => {
    expect(planCall(human, consent({ automated: revoked, aiVoice: none }), opts).allowed).toBe(true);
  });

  it("needs an advisor phone to hand the call to", () => {
    expect(planCall({ ...human, handoffNumber: null }, consent(), opts)).toEqual({ allowed: false, reason: "handoff_number_required" });
    expect(planCall({ ...human, handoffNumber: "12" }, consent(), opts)).toEqual({ allowed: false, reason: "handoff_number_required" });
  });
});

describe("call plan: AI voice", () => {
  it("allows a call only with phone, automated-contact and AI-voice consent", () => {
    const plan = planCall(ai, consent(), opts);
    expect(plan).toMatchObject({ allowed: true, mode: "ai_voice", aiVoiceConsentId: "ai1", consentEventIds: ["ev1", "ev1"] });
  });

  it("opens with the AI disclosure before anything else", () => {
    const plan = planCall({ ...ai, record: true }, consent(), opts);
    if (!plan.allowed) throw new Error("expected allowed");
    expect(plan.prelude.startsWith(AI_VOICE_DISCLOSURE)).toBe(true);
    expect(plan.prelude).toContain(RECORDING_DISCLOSURE);
    expect(plan.prelude.indexOf(AI_VOICE_DISCLOSURE)).toBeLessThan(plan.prelude.indexOf(RECORDING_DISCLOSURE));
    expect(plan.body).toContain("2 items");
    expect(AI_VOICE_DISCLOSURE).toMatch(/AI voice, not a person/);
  });

  it.each([
    ["no AI-voice consent", { aiVoice: none }, "no_ai_voice_consent"],
    ["AI-voice consent withdrawn", { aiVoice: { state: "revoked", eventId: "ai2" } }, "ai_voice_consent_revoked"],
    ["no automated-contact consent", { automated: none }, "no_automated_contact_consent"],
    ["automated contact revoked by a STOP", { automated: revoked }, "automated_contact_revoked"],
    ["no phone consent", { phone: none }, "no_phone_consent"],
  ] as const)("is blocked with %s", (_label, over, reason) => {
    expect(planCall(ai, consent(over as Partial<VoiceConsentState>), opts)).toEqual({ allowed: false, reason });
  });

  it("an AI voice cannot use a human script and a human call cannot use an AI script", () => {
    expect(planCall({ ...ai, scriptId: "human_bridge" }, consent(), opts).allowed).toBe(false);
    expect(planCall({ ...human, scriptId: "document_followup" }, consent(), opts).allowed).toBe(false);
    expect(planCall({ ...ai, scriptId: "nope" }, consent(), opts).allowed).toBe(false);
  });
});

describe("call plan: common rules", () => {
  it("blocks outside the calling window", () => {
    expect(planCall(human, consent(), { configured: true, now: NIGHT })).toEqual({ allowed: false, reason: "outside_calling_window" });
  });

  it("blocks when voice is not configured or the number is invalid", () => {
    expect(planCall(human, consent(), { configured: false, now: DAYTIME })).toEqual({ allowed: false, reason: "voice_not_configured" });
    expect(planCall({ ...human, to: "abc" }, consent(), opts)).toEqual({ allowed: false, reason: "invalid_number" });
    expect(planCall({ ...human, to: null }, consent(), opts)).toEqual({ allowed: false, reason: "invalid_number" });
  });

  it("a recorded call carries the recording disclosure; an unrecorded one does not", () => {
    expect(callPrelude("human_assisted", true)).toBe(RECORDING_DISCLOSURE);
    expect(callPrelude("human_assisted", false)).toBe("");
    expect(RECORDING_DISCLOSURE).toMatch(/will be recorded/);
  });
});

describe("consent state", () => {
  const rec = (eventType: "granted" | "revoked", channels: string[], at: string, form = "qualifier", id = at) => ({ id, eventType, form, channels, occurredAt: at });

  it("the latest ledger row for a channel decides; a revocation wins a tie", () => {
    const rows = [rec("granted", ["phone", "autodialer"], "2026-10-01T00:00:00Z"), rec("revoked", ["sms", "autodialer"], "2026-10-02T00:00:00Z", "sms")];
    expect(ledgerState(rows, "phone").state).toBe("granted");
    expect(ledgerState(rows, "autodialer").state).toBe("revoked");
    const tie = [rec("granted", ["autodialer"], "2026-10-02T00:00:00Z"), rec("revoked", ["autodialer"], "2026-10-02T00:00:00Z", "sms")];
    expect(ledgerState(tie, "autodialer").state).toBe("revoked");
    expect(ledgerState([], "phone").state).toBe("none");
  });

  it("ignores newsletter rows", () => {
    expect(ledgerState([rec("granted", ["phone"], "2026-10-01T00:00:00Z", "newsletter")], "phone").state).toBe("none");
  });

  it("AI-voice consent: latest row decides", () => {
    const e = (eventType: "granted" | "revoked", occurredAt: string) => ({ id: occurredAt, eventType, kind: "ai_voice" as const, phone: "+1", leadId: null, textVersion: "v", textSha256: "a".repeat(64), page: null, occurredAt });
    expect(aiVoiceState([]).state).toBe("none");
    expect(aiVoiceState([e("granted", "2026-10-01T00:00:00Z")]).state).toBe("granted");
    expect(aiVoiceState([e("granted", "2026-10-01T00:00:00Z"), e("revoked", "2026-10-02T00:00:00Z")]).state).toBe("revoked");
    expect(aiVoiceState([e("revoked", "2026-10-02T00:00:00Z"), e("granted", "2026-10-03T00:00:00Z")]).state).toBe("granted");
  });
});

describe("call scripts", () => {
  it("fingerprints name the mode and the disclosures", () => {
    const s = scriptById("document_followup");
    if (!s) throw new Error("missing script");
    expect(scriptFingerprint(s, "ai_voice", true)).not.toBe(scriptFingerprint(s, "ai_voice", false));
    expect(scriptFingerprint(s, "ai_voice", true)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("scripts make no commitments and say nothing about money", () => {
    for (const s of allScripts()) {
      const text = s.body(s.sample);
      expect(text).not.toMatch(/approved|qualified for|guarantee|will call you today|wire|draw|fee/i);
    }
  });
});
