import { isApproved, type ApprovalGate } from "@/lib/compliance/approval-gate";
import type { TemplateDef } from "./templates";
import type { Channel } from "./types";

// Approval gate for outbound notifications (Global rule 2). A template the
// broker pre-approved sends automatically; anything else is requested through
// the approval queue and sends only on "approved". Pending, rejected and
// expired decisions never send.

/**
 * Templates the broker has pre-approved beyond the built-in registry flags:
 * NOTIFY_PREAPPROVED_TEMPLATES="milestone_update@1,document_request@1".
 * The version is part of the entry, so a reworded template needs a new entry.
 */
export function preApprovedFromEnv(env: Record<string, string | undefined> = process.env): ReadonlySet<string> {
  return new Set(
    (env.NOTIFY_PREAPPROVED_TEMPLATES ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isPreApproved(template: TemplateDef, extra: ReadonlySet<string> = new Set()): boolean {
  return template.preApproved || extra.has(`${template.id}@${template.version}`);
}

export type Authorization =
  | { ok: true; via: "pre_approved" | "broker_approval"; approvalId?: string }
  | { ok: false; status: "pending_approval" | "rejected" | "expired"; approvalId?: string };

export type AuthorizeInput = {
  template: TemplateDef;
  channel: Channel;
  gate: ApprovalGate;
  preApproved?: ReadonlySet<string>;
  idempotencyKey: string;
  /** One line for the approving broker. */
  summary: string;
  /** What the broker reviews: recipient, template data, lead reference. */
  payload: Record<string, unknown>;
  requestedBy: string;
};

export async function authorizeSend(input: AuthorizeInput): Promise<Authorization> {
  if (isPreApproved(input.template, input.preApproved)) return { ok: true, via: "pre_approved" };

  const decision = await input.gate.request({
    kind: "email",
    idempotencyKey: input.idempotencyKey,
    summary: input.summary,
    templateId: `${input.template.id}@${input.template.version}`,
    payload: { channel: input.channel, ...input.payload },
    requestedBy: input.requestedBy,
  });
  if (isApproved(decision)) return { ok: true, via: "broker_approval", approvalId: decision.approvalId };
  if (decision.status === "rejected") return { ok: false, status: "rejected", approvalId: decision.approvalId };
  if (decision.status === "expired") return { ok: false, status: "expired", approvalId: decision.approvalId };
  return { ok: false, status: "pending_approval", approvalId: decision.approvalId };
}
