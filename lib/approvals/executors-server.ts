import "server-only";
import { crmApprovalExecutors } from "@/lib/agents/crm/server";
import { deskServices } from "@/lib/checklists/server";
import { mldsSendExecutor } from "@/lib/deals/mlds";
import { dealDeskRuntime } from "@/lib/deals/runtime";
import { gatedCrmSink } from "@/lib/disclosures/deal-record";
import { mldsTemplateId } from "@/lib/esign";
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
  executors.push(...crmApprovalExecutors());
  // MLDS (RE 882): sent as soon as a broker approves (with re-authentication); the
  // gate hands the approval out once, and the send is claimed in workflow_effects.
  const desk = dealDeskRuntime();
  if (desk?.esign) {
    const templateId = mldsTemplateId(desk.esign.name);
    if (templateId) {
      executors.push({
        name: "mlds_send",
        matches: (r) => r.kind === "mlds_send",
        run: mldsSendExecutor({ disclosures: desk.disclosures, storage: desk.storage, now: desk.now, provider: desk.esign, gate: desk.gate, effects: desk.effects, templateId, deal: gatedCrmSink(desk.gate) }),
      });
    }
  }
  return executors;
}
