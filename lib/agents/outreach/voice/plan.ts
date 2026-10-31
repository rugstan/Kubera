import { toE164 } from "@/lib/notify/phone";
import { insideSmsWindow } from "@/lib/notify/quiet-hours";
import type { VoiceConsentState } from "./consent";
import { callPrelude, scriptById, type ScriptData, type VoiceScript } from "./scripts";
import type { VoiceBlockReason, VoiceMode } from "./types";

// The compliance decision for one outbound call, as a pure function. A call is
// allowed only when every rule passes; the first failing rule is the reason.
//
//   any call           valid number, voice provider configured, calling window
//                      (the texting window: 8 a.m. Pacific to 9 p.m. Eastern),
//                      phone consent on the ledger and not revoked
//   human_assisted     an advisor's phone to hand off to
//   ai_voice           also automated-contact consent (an SMS STOP revokes it)
//                      and a separate AI-voice consent that has not been revoked

export type CallRequest = {
  mode: VoiceMode;
  to: string | null | undefined;
  scriptId: string;
  /** Record the call (after the recording disclosure). */
  record: boolean;
  /** Advisor phone for a human_assisted hand-off. */
  handoffNumber?: string | null;
  scriptData?: ScriptData;
};

export type CallPlan =
  | {
      allowed: true;
      to: string;
      mode: VoiceMode;
      script: VoiceScript;
      record: boolean;
      handoffNumber: string | null;
      /** Spoken first: the AI-voice disclosure, then the recording disclosure. Empty for an unrecorded human call. */
      prelude: string;
      body: string;
      consentEventIds: string[];
      aiVoiceConsentId: string | null;
    }
  | { allowed: false; reason: VoiceBlockReason };

export function planCall(req: CallRequest, consent: VoiceConsentState, opts: { configured: boolean; now: Date }): CallPlan {
  const to = toE164(req.to);
  if (!to) return { allowed: false, reason: "invalid_number" };
  const script = scriptById(req.scriptId);
  if (!script || !script.modes.includes(req.mode)) return { allowed: false, reason: "voice_not_configured" };
  if (!opts.configured) return { allowed: false, reason: "voice_not_configured" };

  let handoff: string | null = null;
  if (req.mode === "human_assisted") {
    handoff = toE164(req.handoffNumber);
    if (!handoff) return { allowed: false, reason: "handoff_number_required" };
  }

  if (consent.phone.state === "revoked") return { allowed: false, reason: "phone_consent_revoked" };
  if (consent.phone.state !== "granted") return { allowed: false, reason: "no_phone_consent" };

  if (req.mode === "ai_voice") {
    if (consent.automated.state === "revoked") return { allowed: false, reason: "automated_contact_revoked" };
    if (consent.automated.state !== "granted") return { allowed: false, reason: "no_automated_contact_consent" };
    if (consent.aiVoice.state === "revoked") return { allowed: false, reason: "ai_voice_consent_revoked" };
    if (consent.aiVoice.state !== "granted") return { allowed: false, reason: "no_ai_voice_consent" };
  }

  if (!insideSmsWindow(opts.now)) return { allowed: false, reason: "outside_calling_window" };

  return {
    allowed: true,
    to,
    mode: req.mode,
    script,
    record: req.record,
    handoffNumber: handoff,
    prelude: callPrelude(req.mode, req.record),
    body: script.body(req.scriptData ?? {}),
    consentEventIds: [consent.phone.eventId, ...(req.mode === "ai_voice" ? [consent.automated.eventId] : [])].filter((x): x is string => Boolean(x)),
    aiVoiceConsentId: req.mode === "ai_voice" ? (consent.aiVoice.eventId ?? null) : null,
  };
}
