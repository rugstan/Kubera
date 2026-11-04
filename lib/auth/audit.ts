// Staff audit trail (append-only `staff_audit_events`). Document views and
// approval decisions are recorded before they take effect: if the audit write
// fails, the action fails closed. Sign-in events are best effort.

import type { SupabaseClient } from "@supabase/supabase-js";

export const AUDIT_ACTIONS = [
  "auth.sign_in",
  "auth.sign_in_failed",
  "auth.mfa_enrolled",
  "auth.mfa_verified",
  "auth.mfa_failed",
  "auth.sign_out",
  "auth.access_denied",
  "document.view",
  "approval.approve",
  "approval.reject",
  "approval.cancel",
  "approval.expire",
  // Privacy admin (lib/privacy/staff.ts): written before the read or change takes effect.
  "privacy.view",
  "privacy.export",
  "privacy.acknowledge",
  "privacy.verify",
  "privacy.complete",
  "privacy.deny",
  "privacy.withdraw",
  "privacy.legal_hold_set",
  "privacy.legal_hold_release",
  "privacy.step_up_failed",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditEvent = {
  actorId: string | null;
  actorLabel: string;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  ipHash?: string;
  userAgent?: string;
  detail?: Record<string, unknown>;
};

export interface AuditSink {
  record(event: AuditEvent): Promise<void>;
}

const clip = (s: string | undefined, n: number) => (s === undefined ? undefined : s.slice(0, n));

export function supabaseAuditSink(db: SupabaseClient): AuditSink {
  return {
    async record(e) {
      const { error } = await db.from("staff_audit_events").insert({
        actor_id: e.actorId,
        actor_label: clip(e.actorLabel, 200) || "unknown",
        action: e.action,
        target_type: clip(e.targetType, 60) ?? null,
        target_id: clip(e.targetId, 200) ?? null,
        ip_hash: clip(e.ipHash, 64) ?? null,
        user_agent: clip(e.userAgent, 512) ?? null,
        detail: e.detail ?? {},
      });
      if (error) throw new Error(`audit write failed: ${error.message}`);
    },
  };
}

export class MemoryAuditSink implements AuditSink {
  readonly events: (AuditEvent & { at: Date })[] = [];
  failNext = false;

  async record(e: AuditEvent): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("audit write failed");
    }
    this.events.push({ ...e, at: new Date() });
  }
}

/** Best-effort audit for non-gating events (sign-in telemetry). */
export async function auditQuietly(sink: AuditSink, event: AuditEvent): Promise<void> {
  try {
    await sink.record(event);
  } catch (err) {
    console.error("[audit]", event.action, err instanceof Error ? err.message : err);
  }
}
