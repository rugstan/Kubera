// Sends the borrower-portal invitation email once a broker approved it.
//
// The approval names the invite only (lib/principals/portal.ts), so the link
// is minted here: the Resend `portal_invite` template goes out through
// lib/notify (which still checks the recipient has not opted out and records
// the notification) with a fresh token, and once it is sent that token
// replaces the invite's token, so the link the issuing broker may have copied
// stops working and exactly one link is live. If the email does not go out,
// the invite keeps its original link.
// The approval queue runs this through ApprovalService.executeOnce, so it
// runs at most once per approval.

import type { ApprovalRecord } from "@/lib/approvals/types";
import type { ApprovalGate } from "@/lib/compliance/approval-gate";
import type { Notifier } from "@/lib/notify/service";
import { hashToken, newPortalToken, portalLinkUrl, PORTAL_INVITE_TEMPLATE } from "./portal";
import type { PortalInviteStore } from "./store";

export type PortalInviteMailDeps = {
  invites: PortalInviteStore;
  /** Builds the notifier with the gate to use for this one message. */
  notifier: (gate: ApprovalGate) => Notifier;
  /** Configured site origin (never a request's Host header). */
  origin: string;
  now: () => Date;
};

/** Gate for a message whose approval was already granted (the record executeOnce checked). */
export function grantedApprovalGate(record: Pick<ApprovalRecord, "id" | "decidedBy" | "decidedAt">): ApprovalGate {
  return {
    async request() {
      return { status: "approved", approvalId: record.id, decidedBy: record.decidedBy ?? "broker", decidedAt: new Date(record.decidedAt ?? Date.now()) };
    },
  };
}

export function isPortalInviteApproval(record: Pick<ApprovalRecord, "templateId" | "kind">): boolean {
  return record.kind === "email" && (record.templateId ?? "").split("@")[0] === PORTAL_INVITE_TEMPLATE;
}

function expiresLabel(iso: string): string {
  return `on ${new Date(iso).toUTCString().replace(/:\d\d GMT$/, " UTC")}`;
}

export type PortalInviteSendResult = { status: "sent" | "skipped" | "not_sent"; ref: string; reason?: string };

/**
 * Sends the invitation for `inviteId` under an approval a broker granted.
 * Callers: the approval executor below, or the issuing action when the gate
 * answered "approved" straight away (it then holds the claimed execution).
 */
export async function sendApprovedPortalInvite(
  deps: PortalInviteMailDeps,
  input: { inviteId: string; approval: Pick<ApprovalRecord, "id" | "decidedBy" | "decidedAt">; requestedBy: string },
): Promise<PortalInviteSendResult> {
  const invite = await deps.invites.get(input.inviteId);
  if (!invite) return { status: "skipped", ref: "skipped:invite_missing" };
  if (invite.consumedAt || invite.revokedAt || Date.parse(invite.expiresAt) <= deps.now().getTime()) return { status: "skipped", ref: "skipped:invite_not_usable" };
  const token = newPortalToken();
  const outcome = await deps.notifier(grantedApprovalGate(input.approval)).send({
    templateId: PORTAL_INVITE_TEMPLATE,
    to: { audience: "borrower", email: invite.email },
    data: { portalUrl: portalLinkUrl(deps.origin, token), expiresLabel: expiresLabel(invite.expiresAt) },
    idempotencyKey: `portal_invite:${invite.id}`,
    dealId: invite.dealId,
    requestedBy: input.requestedBy,
    metadata: { inviteId: invite.id, approvalId: input.approval.id },
  });
  const ref = `notify:${outcome.status}${outcome.notificationId ? `:${outcome.notificationId}` : ""}`;
  if (outcome.status !== "sent") return { status: "not_sent", ref, reason: outcome.reason };
  const rotated = await deps.invites.rotateToken(invite.id, hashToken(token), deps.now());
  return rotated ? { status: "sent", ref } : { status: "sent", ref: `${ref}:link_not_usable`, reason: "the invite was used or revoked while the email was sent" };
}

/** The approval executor for portal invitations: returns the execution reference. */
export function portalInviteExecutor(deps: PortalInviteMailDeps): (record: ApprovalRecord) => Promise<string> {
  return async (record) => {
    const inviteId = typeof record.payload.inviteId === "string" ? record.payload.inviteId : null;
    if (!inviteId) return "skipped:no_invite";
    return (await sendApprovedPortalInvite(deps, { inviteId, approval: record, requestedBy: record.requestedBy })).ref;
  };
}
