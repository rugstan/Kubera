import { isApproved, type ApprovalGate, type OutboundAction } from "@/lib/compliance/approval-gate";
import type { ConsentReader } from "@/lib/notify/consent";
import { maskPhone, toE164 } from "@/lib/notify/phone";
import { safeRecord, type OutreachAuditSink } from "../audit";
import { loadVoiceConsent, type VoiceConsentStore } from "./consent";
import { planCall, type CallRequest } from "./plan";
import { callPrelude, scriptById, scriptFingerprint } from "./scripts";
import type { VoiceStore } from "./store";
import type { VoiceBlockReason, VoiceCallRow, VoiceCallStatus, VoiceClient } from "./types";

// Places and drives outbound calls. requestCall() decides (consent, window,
// approval) and dials; handleEvent() advances the call from Telnyx webhooks:
//
//   dialing --answered/human--> announcing --prelude played--> speaking
//        --body played--> transferring (advisor) | hung up
//
// The disclosures play first, a recording starts only after its disclosure has
// finished, a voicemail is hung up on without leaving a message, and consent is
// re-checked when the person answers.

export type VoiceDeps = {
  client: VoiceClient | null;
  store: VoiceStore;
  consent: ConsentReader;
  aiVoiceConsents: VoiceConsentStore | null;
  gate: ApprovalGate;
  /** "voice:<script>@<version>" entries a broker pre-approved (OUTREACH_PREAPPROVED_TEMPLATES). */
  preApproved?: ReadonlySet<string>;
  audit?: OutreachAuditSink;
  /** Where Telnyx posts call events. */
  webhookUrl: string;
  /** Wait for answering-machine detection before speaking (default true). */
  waitForMachineDetection?: boolean;
  now?: () => Date;
};

export type CallRequestInput = CallRequest & {
  /** Stable per logical call, e.g. `call:<lead>:docs:1`. */
  idempotencyKey: string;
  leadId?: string | null;
  dealId?: string | null;
  requestedBy?: string;
};

export type CallOutcome = {
  status: VoiceCallStatus;
  callId?: string;
  reason?: VoiceBlockReason | "approval_pending" | "approval_rejected" | "approval_expired" | "dial_failed" | "duplicate";
  detail?: string;
};

type ClientState = { callId: string; stage: "dial" | "prelude" | "body" };

export const encodeState = (s: ClientState) => JSON.stringify(s);
export function decodeState(raw: string | null | undefined): ClientState | null {
  if (!raw) return null;
  try {
    const json = JSON.parse(/^[A-Za-z0-9+/=]+$/.test(raw) && !raw.startsWith("{") ? Buffer.from(raw, "base64").toString("utf8") : raw) as Partial<ClientState>;
    return typeof json.callId === "string" && (json.stage === "dial" || json.stage === "prelude" || json.stage === "body") ? { callId: json.callId, stage: json.stage } : null;
  } catch {
    return null;
  }
}

const NOT_ANSWERED = ["timeout", "no_answer", "busy", "originator_cancel", "call_rejected", "user_busy"];
const RETRYABLE: readonly VoiceCallStatus[] = ["blocked", "pending_approval"];
const LIVE: readonly VoiceCallStatus[] = ["dialing", "announcing", "speaking", "transferring"];

export class VoiceService {
  private readonly now: () => Date;

  constructor(private readonly deps: VoiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  private audit(row: Pick<VoiceCallRow, "id" | "leadId" | "dealId" | "scriptId" | "scriptVersion" | "approvalId">, action: "call_plan" | "call_event", reason: string, detail?: Record<string, unknown>) {
    return safeRecord(this.deps.audit, {
      at: this.now().toISOString(),
      agent: "voice",
      action,
      kind: "voice_call",
      reason,
      dealId: row.dealId,
      leadId: row.leadId,
      templateId: row.scriptId,
      templateVersion: row.scriptVersion,
      approvalId: row.approvalId,
      messageId: row.id,
      ...(detail ? { detail } : {}),
    });
  }

  async requestCall(req: CallRequestInput): Promise<CallOutcome> {
    const to = toE164(req.to);
    if (!to) return { status: "blocked", reason: "invalid_number" };
    const { client } = this.deps;

    const { row: claimed, fresh } = await this.deps.store.claim({
      idempotencyKey: req.idempotencyKey,
      mode: req.mode,
      toNumber: to,
      fromNumber: client?.fromNumber ?? null,
      scriptId: req.scriptId,
      scriptVersion: 1,
      recordRequested: req.record,
      leadId: req.leadId ?? null,
      dealId: req.dealId ?? null,
      handoffNumber: toE164(req.handoffNumber),
    });
    let row = claimed;
    if (!fresh) {
      if (!RETRYABLE.includes(row.status)) return { status: row.status, callId: row.id, reason: "duplicate" };
      const reopened = await this.deps.store.transition(row.id, RETRYABLE, { status: "queued", blockReason: null, error: null });
      if (!reopened) return { status: row.status, callId: row.id, reason: "duplicate" };
      row = reopened;
    }
    const id = row.id;

    // 1. The compliance decision.
    let consent;
    try {
      consent = await loadVoiceConsent(this.deps.consent, this.deps.aiVoiceConsents, to);
    } catch (err) {
      console.error("outreach: voice consent lookup failed; not calling", err instanceof Error ? err.message : err);
      await this.deps.store.transition(id, ["queued"], { status: "blocked", blockReason: "consent_lookup_failed" });
      return { status: "blocked", callId: id, reason: "consent_lookup_failed" };
    }
    const plan = planCall(req, consent, { configured: Boolean(client), now: this.now() });
    if (!plan.allowed) {
      await this.deps.store.transition(id, ["queued"], { status: "blocked", blockReason: plan.reason });
      await this.audit(row, "call_plan", plan.reason, { status: "blocked" });
      return { status: "blocked", callId: id, reason: plan.reason };
    }
    row = await this.deps.store.update(id, { scriptVersion: plan.script.version, consentEventIds: plan.consentEventIds, aiVoiceConsentId: plan.aiVoiceConsentId, bodyText: plan.body });

    // 2. The broker approval gate.
    let approvalId: string | null = null;
    const scriptKey = `voice:${plan.script.id}@${plan.script.version}`;
    if (!this.deps.preApproved?.has(scriptKey)) {
      const action: OutboundAction = {
        kind: "voice_call" as OutboundAction["kind"],
        idempotencyKey: `outreach:${req.idempotencyKey}`,
        summary: `Outbound ${plan.mode === "ai_voice" ? "AI-voice" : "advisor"} call (${plan.script.id}) to ${maskPhone(plan.to)}${plan.record ? ", recorded" : ""}`.slice(0, 300),
        templateId: scriptKey,
        payload: {
          mode: plan.mode,
          to: plan.to,
          scriptId: plan.script.id,
          scriptVersion: plan.script.version,
          templateBodySha256: scriptFingerprint(plan.script, plan.mode, plan.record),
          record: plan.record,
          prelude: plan.prelude,
          body: plan.body,
          handoffNumber: plan.handoffNumber ? maskPhone(plan.handoffNumber) : null,
          leadId: req.leadId ?? null,
          dealId: req.dealId ?? null,
        },
        requestedBy: req.requestedBy ?? "agent:voice",
      };
      let decision;
      try {
        decision = await this.deps.gate.request(action);
      } catch (err) {
        console.error("outreach: call approval request failed; not calling", err instanceof Error ? err.message : err);
        await this.deps.store.transition(id, ["queued"], { status: "pending_approval", error: "approval request could not be recorded; will retry" });
        return { status: "pending_approval", callId: id, reason: "approval_pending" };
      }
      if (!isApproved(decision)) {
        const status = decision.status === "rejected" ? "rejected" : decision.status === "expired" ? "expired" : "pending_approval";
        const reason = status === "rejected" ? "approval_rejected" : status === "expired" ? "approval_expired" : "approval_pending";
        await this.deps.store.transition(id, ["queued"], { status, approvalId: decision.status === "pending" ? (decision.approvalId ?? null) : decision.approvalId });
        await this.audit({ ...row, approvalId: "approvalId" in decision ? (decision.approvalId ?? null) : null }, "call_plan", reason);
        return { status, callId: id, reason };
      }
      approvalId = decision.approvalId;
    }

    // 3. Dial.
    try {
      if (!client) throw new Error("voice provider is not configured");
      const dialed = await client.dial({ to: plan.to, clientState: encodeState({ callId: id, stage: "dial" }), webhookUrl: this.deps.webhookUrl });
      await this.deps.store.transition(id, ["queued"], { status: "dialing", approvalId, callControlId: dialed.callControlId, callSessionId: dialed.callSessionId });
      await this.audit({ ...row, approvalId }, "call_plan", "dialed", { mode: plan.mode, record: plan.record });
      return { status: "dialing", callId: id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("outreach: dial failed", message);
      await this.deps.store.transition(id, ["queued"], { status: "failed", approvalId, error: message.slice(0, 1000) });
      return { status: "failed", callId: id, reason: "dial_failed", detail: message.slice(0, 300) };
    }
  }

  // --- Webhook-driven progress ---------------------------------------------------------------

  async handleEvent(event: VoiceEvent): Promise<{ handled: boolean; note?: string }> {
    const state = decodeState(event.clientState);
    const row = (state ? await this.deps.store.get(state.callId) : null) ?? (event.callControlId ? await this.deps.store.findByControlId(event.callControlId) : null);
    if (!row) return { handled: false, note: "unknown call" };
    if (event.callControlId && row.callControlId && row.callControlId !== event.callControlId) return { handled: false, note: "call id mismatch" };

    switch (event.type) {
      case "call.answered":
        // Wait for answering-machine detection unless it is turned off.
        return this.deps.waitForMachineDetection === false ? this.begin(row) : { handled: true, note: "waiting for machine detection" };
      case "call.machine.detection.ended":
        if (event.machineResult === "machine") return this.skipVoicemail(row);
        return this.begin(row);
      case "call.speak.ended":
        return state?.stage === "prelude" ? this.preludePlayed(row) : state?.stage === "body" ? this.bodyPlayed(row) : { handled: true, note: "speak ended (no stage)" };
      case "call.recording.saved":
        if (event.recordingId) await this.deps.store.update(row.id, { recordingId: event.recordingId });
        return { handled: true };
      case "call.hangup":
        return this.hungUp(row, event.hangupCause ?? null);
      default:
        return { handled: true, note: `ignored ${event.type}` };
    }
  }

  private async fail(row: VoiceCallRow, from: readonly VoiceCallStatus[], error: string): Promise<{ handled: boolean; note: string }> {
    await this.deps.store.transition(row.id, from, { status: "failed", error, endedAt: this.now().toISOString() });
    if (row.callControlId) await this.deps.client?.hangup(row.callControlId).catch(() => undefined);
    await this.audit(row, "call_event", "call_failed", { error });
    return { handled: true, note: error };
  }

  /** The person answered (or machine detection said human): re-check consent, then play the disclosures. */
  private async begin(row: VoiceCallRow) {
    const { client } = this.deps;
    if (!client || !row.callControlId) return { handled: false, note: "no voice client" };
    if (row.status !== "dialing") return { handled: true, note: "already started" };

    // A STOP or revocation that arrived while the phone rang ends the call before anything is said.
    try {
      const consent = await loadVoiceConsent(this.deps.consent, this.deps.aiVoiceConsents, row.toNumber);
      const revoked = consent.phone.state === "revoked" || (row.mode === "ai_voice" && (consent.automated.state === "revoked" || consent.aiVoice.state === "revoked"));
      if (revoked) return this.fail(row, ["dialing"], "consent revoked before the call connected");
    } catch {
      return this.fail(row, ["dialing"], "consent lookup failed before the call connected");
    }

    const prelude = callPrelude(row.mode, row.recordRequested);
    const moved = await this.deps.store.transition(row.id, ["dialing"], { status: "announcing" });
    if (!moved) return { handled: true, note: "already started" };
    try {
      if (prelude) await client.speak(row.callControlId, prelude, encodeState({ callId: row.id, stage: "prelude" }));
      else return this.preludePlayed(moved);
    } catch (err) {
      return this.fail(moved, ["announcing"], err instanceof Error ? err.message : "speak failed");
    }
    return { handled: true };
  }

  /** Disclosures finished: only now may a recording start, then the script body plays. */
  private async preludePlayed(row: VoiceCallRow) {
    const { client } = this.deps;
    if (!client || !row.callControlId) return { handled: false, note: "no voice client" };
    const at = this.now().toISOString();
    const moved = await this.deps.store.transition(row.id, ["announcing"], {
      status: "speaking",
      ...(row.mode === "ai_voice" ? { aiDisclosedAt: at } : {}),
      ...(row.recordRequested ? { recordingDisclosedAt: at } : {}),
    });
    if (!moved) return { handled: true, note: "already past the disclosures" };
    try {
      if (moved.recordRequested && moved.recordingDisclosedAt) {
        await client.startRecording(moved.callControlId as string);
        await this.deps.store.update(moved.id, { recordingStartedAt: this.now().toISOString() });
      }
      // The body is the exact text a broker approved, stored when the call was planned.
      await client.speak(moved.callControlId as string, moved.bodyText ?? "", encodeState({ callId: moved.id, stage: "body" }));
    } catch (err) {
      return this.fail(moved, ["speaking"], err instanceof Error ? err.message : "call command failed");
    }
    return { handled: true };
  }

  private async bodyPlayed(row: VoiceCallRow) {
    const { client } = this.deps;
    if (!client || !row.callControlId) return { handled: false, note: "no voice client" };
    try {
      if (row.mode === "human_assisted" && row.handoffNumber) {
        const moved = await this.deps.store.transition(row.id, ["speaking"], { status: "transferring" });
        if (moved) await client.transfer(row.callControlId, row.handoffNumber);
      } else {
        await client.hangup(row.callControlId);
      }
    } catch (err) {
      return this.fail(row, ["speaking", "transferring"], err instanceof Error ? err.message : "call command failed");
    }
    return { handled: true };
  }

  /** A machine picked up: hang up without leaving a message. */
  private async skipVoicemail(row: VoiceCallRow) {
    const moved = await this.deps.store.transition(row.id, ["dialing"], { status: "voicemail_skipped", endedAt: this.now().toISOString() });
    if (moved && row.callControlId) await this.deps.client?.hangup(row.callControlId).catch(() => undefined);
    if (moved) await this.audit(row, "call_event", "voicemail_skipped");
    return { handled: true, note: moved ? "voicemail skipped" : "already handled" };
  }

  private async hungUp(row: VoiceCallRow, cause: string | null) {
    const unanswered = row.status === "dialing";
    const status: VoiceCallStatus = !unanswered || cause === "normal_clearing" ? "completed" : cause && NOT_ANSWERED.includes(cause) ? "no_answer" : "failed";
    const moved = await this.deps.store.transition(row.id, LIVE, { status, hangupCause: cause, endedAt: this.now().toISOString() });
    if (moved) await this.audit(row, "call_event", status, { cause });
    return { handled: true, note: moved ? status : "already ended" };
  }

  /**
   * The person asked not to be recorded: stop the recording now. The recording
   * is ended, the call continues, and the stop time is kept on the call.
   */
  async declineRecording(callId: string): Promise<boolean> {
    const row = await this.deps.store.get(callId);
    if (!row?.callControlId || !row.recordingStartedAt || row.recordingStoppedAt) return false;
    await this.deps.client?.stopRecording(row.callControlId);
    await this.deps.store.update(row.id, { recordingStoppedAt: this.now().toISOString() });
    await this.audit(row, "call_event", "recording_declined");
    return true;
  }
}

export type VoiceEventType =
  | "call.initiated"
  | "call.answered"
  | "call.machine.detection.ended"
  | "call.speak.started"
  | "call.speak.ended"
  | "call.recording.saved"
  | "call.hangup"
  | string;

export type VoiceEvent = {
  type: VoiceEventType;
  callControlId: string | null;
  /** Raw client_state from the webhook (base64 or JSON). */
  clientState: string | null;
  machineResult?: "human" | "machine" | "not_sure" | null;
  hangupCause?: string | null;
  recordingId?: string | null;
};
