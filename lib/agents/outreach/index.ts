// Lead & document chasers (WS-R). Public surface for the routes, the workflow
// registration and the staff app. Server wiring is in ./runtime.ts (server-only).

export { runOutreachSweep, type SweepDeps, type SweepSummary } from "./sweep";
export { speedToLead, SPEED_TO_LEAD_SLA_MS, type SpeedToLeadResult } from "./speed-to-lead";
export { remindDocuments, nudgeClosing, CLOSING_STAGES } from "./reminders";
export { nudgeVendor } from "./vendor-nudges";
export { OutreachSender, type OutreachSend, type SenderDeps } from "./sender";
export { handleSpeedToLead, handleSweep, handleCallRequest } from "./handlers";
export { speedToLeadWorkflow, outreachSweepWorkflow, OUTREACH_EVENTS, leadScoredSchema } from "./workflow";
export { VoiceService, type CallRequestInput, type CallOutcome } from "./voice/service";
export { handleVoiceWebhook } from "./voice/webhook";
export { aiVoiceConsentEvent, AI_VOICE_CONSENT_TEXT } from "./voice/consent";
