// Demo approval queue for fake-auth mode (local development and e2e). The
// deal ids match the demo pipeline in app/(staff)/pipeline/demo.ts.

import type { ApprovalService } from "./service";
import { payloadHash } from "./hash";
import type { MemoryApprovalStore } from "./store";

export const DEMO_DEAL_IDS = {
  seniorLiving: "10000000-0000-4000-8000-000000000001",
  hotel: "10000000-0000-4000-8000-000000000002",
  multifamily: "10000000-0000-4000-8000-000000000003",
  hardMoney: "10000000-0000-4000-8000-000000000004",
} as const;

export async function seedDemoApprovals(service: ApprovalService, store: MemoryApprovalStore, now = new Date()): Promise<void> {
  await service.request({
    kind: "email",
    idempotencyKey: "demo:email:document-request:sunrise:v1",
    summary: "Email the borrower a document request for Sunrise Senior Living (T-12, census, rent roll)",
    payload: { to: "borrower@example.com", template: "document_request", items: ["T12", "CENSUS", "RENT_ROLL"] },
    requestedBy: "agent:document-chaser",
    dealId: DEMO_DEAL_IDS.seniorLiving,
    ttlMinutes: 20 * 60,
  });
  await service.request({
    kind: "lender_submission",
    idempotencyKey: "demo:lender_submission:harbor-inn:v1",
    summary: "Send the Harbor Inn SBA 504 package to three lenders on the hotel panel",
    payload: { lenders: ["Lender A", "Lender B", "Lender C"], package: "harbor-inn-504-v2.pdf" },
    requestedBy: "agent:lender-matching",
    dealId: DEMO_DEAL_IDS.hotel,
    ttlMinutes: 3 * 24 * 60,
  });
  await service.request({
    kind: "crm_update",
    idempotencyKey: "demo:crm_update:oak-terrace:stage:v1",
    summary: "Move Oak Terrace Apartments to Term sheet in Twenty",
    payload: { stage: "term_sheet" },
    requestedBy: "agent:crm",
    dealId: DEMO_DEAL_IDS.multifamily,
    ttlMinutes: 8 * 60,
  });
  // Requested yesterday and never decided: it expires and never sends.
  const yesterday = new Date(now.getTime() - 26 * 3600_000);
  const payload = { to: "+15555550100", template: "milestone_update" };
  await store.insertIfAbsent(
    {
      kind: "sms",
      idempotencyKey: "demo:sms:milestone:maple-flip:v1",
      summary: "Text the borrower a milestone update for the Maple Street fix-and-flip",
      templateId: null,
      payload,
      payloadSha256: payloadHash(payload),
      requestedBy: "agent:notifications",
      requestedByUser: null,
      dealId: DEMO_DEAL_IDS.hardMoney,
      leadId: null,
      status: "pending",
      expiresAt: new Date(yesterday.getTime() + 2 * 3600_000).toISOString(),
      decidedAt: null,
      decidedBy: null,
      decidedByLabel: null,
      decidedByDre: null,
      decisionReason: null,
      autoApproved: false,
    },
    yesterday,
  );
}
