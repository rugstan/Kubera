// Voice call scaffolding (WS-R). Corin places an outbound call only when:
//   - the consent ledger shows phone consent (and, for an AI voice, automated-
//     contact consent that has not been revoked by a STOP),
//   - an AI voice additionally has its own AI-voice consent on file,
//   - it is inside the calling window,
//   - a broker approved the call through the approval gate, and
//   - the call opens with the required disclosures: an AI voice says it is an
//     automated assistant, and a recorded call says so before any recording
//     starts (California requires every party's consent to record, Penal Code
//     section 632). Recording never starts before the disclosure has played.
// The conversation itself is not built here: a call plays its script, then hands
// off to an advisor's phone or ends. Voice is an extension point, not a bot.

export const VOICE_MODES = ["human_assisted", "ai_voice"] as const;
/** human_assisted: an advisor takes the call (transferred to their phone after the disclosure). ai_voice: an automated voice plays the script. */
export type VoiceMode = (typeof VOICE_MODES)[number];

export const VOICE_CALL_STATUSES = [
  "blocked",
  "pending_approval",
  "rejected",
  "expired",
  "queued",
  "dialing",
  "announcing",
  "speaking",
  "transferring",
  "completed",
  "no_answer",
  "voicemail_skipped",
  "failed",
] as const;
export type VoiceCallStatus = (typeof VOICE_CALL_STATUSES)[number];

export const VOICE_BLOCK_REASONS = [
  "invalid_number",
  "voice_not_configured",
  "no_phone_consent",
  "phone_consent_revoked",
  "no_automated_contact_consent",
  "automated_contact_revoked",
  "no_ai_voice_consent",
  "ai_voice_consent_revoked",
  "outside_calling_window",
  "consent_lookup_failed",
  "handoff_number_required",
] as const;
export type VoiceBlockReason = (typeof VOICE_BLOCK_REASONS)[number];

export type VoiceCallRow = {
  id: string;
  createdAt: string;
  updatedAt: string;
  idempotencyKey: string;
  mode: VoiceMode;
  toNumber: string;
  fromNumber: string | null;
  status: VoiceCallStatus;
  blockReason: VoiceBlockReason | null;
  scriptId: string;
  scriptVersion: number;
  /** The exact script body the call speaks after the disclosures (what the broker approved). */
  bodyText: string | null;
  /** A recording was asked for. It starts only after the recording disclosure has played. */
  recordRequested: boolean;
  aiDisclosedAt: string | null;
  recordingDisclosedAt: string | null;
  recordingStartedAt: string | null;
  recordingStoppedAt: string | null;
  recordingId: string | null;
  leadId: string | null;
  dealId: string | null;
  approvalId: string | null;
  /** Consent ledger rows and AI-voice consent that allowed the call. */
  consentEventIds: string[];
  aiVoiceConsentId: string | null;
  callControlId: string | null;
  callSessionId: string | null;
  /** Advisor phone the call transfers to after the disclosure (human_assisted). */
  handoffNumber: string | null;
  hangupCause: string | null;
  error: string | null;
  endedAt: string | null;
};

export type NewVoiceCall = {
  idempotencyKey: string;
  mode: VoiceMode;
  toNumber: string;
  fromNumber?: string | null;
  scriptId: string;
  scriptVersion: number;
  recordRequested: boolean;
  leadId?: string | null;
  dealId?: string | null;
  handoffNumber?: string | null;
};

export type VoiceCallPatch = Partial<Omit<VoiceCallRow, "id" | "createdAt" | "updatedAt" | "idempotencyKey">>;

export type DialInput = {
  to: string;
  /** Opaque state Telnyx echoes back on every webhook for this call. */
  clientState: string;
  webhookUrl: string;
  /** Seconds to ring before giving up. */
  timeoutSecs?: number;
};

export type DialResult = { callControlId: string; callSessionId: string | null };

export class VoiceError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "VoiceError";
  }
}

export interface VoiceClient {
  readonly name: "telnyx" | "fake";
  readonly fromNumber: string;
  dial(input: DialInput): Promise<DialResult>;
  speak(callControlId: string, text: string, clientState: string): Promise<void>;
  startRecording(callControlId: string): Promise<void>;
  stopRecording(callControlId: string): Promise<void>;
  /** Connects the call to an advisor's phone. */
  transfer(callControlId: string, to: string): Promise<void>;
  hangup(callControlId: string): Promise<void>;
}
