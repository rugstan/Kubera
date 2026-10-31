// Broker approval queue (Global rule 2). Every outbound action an agent or
// workflow takes is requested here first and runs only once approved:
//
//   request ──► pending ──► approved ──► executed (exactly once)
//                  │ ├────► rejected
//                  │ ├────► cancelled
//                  └─┴────► expired   (timed out: never sends)
//
// Only templates a broker pre-approved (approval_templates) are approved
// automatically. Requests are idempotent: the same logical action always
// carries the same key and maps to one approval row and at most one send.

export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "expired", "cancelled"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/** Known action kinds with their labels. Other workstreams may add kinds matching KIND_PATTERN. */
export const APPROVAL_KIND_LABELS: Record<string, string> = {
  email: "Email",
  sms: "Text message",
  voice_call: "Phone call",
  esign_send: "E-sign send",
  crm_update: "CRM update",
  lender_notice: "Lender notice",
  lender_submission: "Lender submission",
  fee_quote: "Fee quote",
  third_party_write: "Third-party write",
};

export const KIND_PATTERN = /^[a-z][a-z0-9_]{1,47}$/;

export function kindLabel(kind: string): string {
  return APPROVAL_KIND_LABELS[kind] ?? kind.replace(/_/g, " ");
}

export type ApprovalRecord = {
  id: string;
  createdAt: string;
  kind: string;
  idempotencyKey: string;
  summary: string;
  templateId: string | null;
  payload: Record<string, unknown>;
  payloadSha256: string;
  requestedBy: string;
  requestedByUser: string | null;
  dealId: string | null;
  leadId: string | null;
  status: ApprovalStatus;
  expiresAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  decidedByLabel: string | null;
  decidedByDre: string | null;
  decisionReason: string | null;
  autoApproved: boolean;
  executedAt: string | null;
  executionRef: string | null;
};

export type ApprovalTemplate = {
  templateId: string;
  kind: string;
  description: string;
  bodySha256: string;
  approvedBy: string;
  approvedByDre: string;
  approvedAt: string;
  revokedAt: string | null;
};

/** Who decided. Approvals need a broker's DRE license number on record. */
export type Approver = {
  userId: string;
  label: string;
  dreLicense: string | null;
};

export type ApprovalListFilter = {
  status?: ApprovalStatus | ApprovalStatus[];
  dealId?: string;
  limit?: number;
};
