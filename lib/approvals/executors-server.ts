import "server-only";
import { deskServices } from "@/lib/checklists/server";
import { notifierWithGate } from "@/lib/notify/runtime";
import { isPortalInviteApproval, portalInviteExecutor, type PortalInviteMailDeps } from "@/lib/principals/portal-mail";
import { site } from "@/lib/site";
import type { ApprovalExecutor } from "./executors";

// Executors for approvals that send as soon as a broker approves them. Loaded
// lazily by lib/approvals/server.ts (so the approvals queue never imports the
// desks at module load).

/** Portal invitation mail on the desk's invite store and the notification runtime; null without Supabase. */
export function portalInviteMailDeps(): PortalInviteMailDeps | null {
  const desk = deskServices();
  return desk ? { invites: desk.invites, notifier: notifierWithGate, origin: site.siteUrl, now: () => new Date() } : null;
}

export function approvalExecutors(): ApprovalExecutor[] {
  const executors: ApprovalExecutor[] = [];
  const portal = portalInviteMailDeps();
  if (portal) executors.push({ name: "portal_invite", matches: isPortalInviteApproval, run: portalInviteExecutor(portal) });
  return executors;
}
