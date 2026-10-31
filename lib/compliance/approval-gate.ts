// Broker approval gate contract (Global rule 2). Every outbound action —
// e-sign send, CRM write, email — asks the gate first and proceeds only on
// "approved". The real queue (`approvals` table, lib/approvals) lands with
// WS-I; until then the default gate is closed: requests are recorded as
// pending and nothing is sent. A timed-out approval expires and never sends.

export type OutboundActionKind = "esign_send" | "crm_update" | "lender_notice" | "email";

export type OutboundAction = {
  kind: OutboundActionKind;
  /** Stable key: the same logical action always maps to the same key, so it sends at most once. */
  idempotencyKey: string;
  /** One-line description shown to the approving broker. */
  summary: string;
  /** Pre-approved template id when the action renders one (only those may send automatically). */
  templateId?: string;
  payload: Record<string, unknown>;
  requestedBy: string;
};

export type ApprovalDecision =
  | { status: "approved"; approvalId: string; decidedBy: string; decidedAt: Date }
  | { status: "pending"; approvalId?: string }
  | { status: "rejected"; approvalId: string; decidedBy: string; reason?: string }
  | { status: "expired"; approvalId: string };

export interface ApprovalGate {
  /** Request (or look up, by idempotency key) the approval for `action`. */
  request(action: OutboundAction): Promise<ApprovalDecision>;
}

let warned = false;

/** Phase 0 default: no approvals queue exists yet, so nothing is ever sent. */
export const closedApprovalGate: ApprovalGate = {
  async request(action) {
    if (!warned) {
      warned = true;
      console.warn(`[approvals] No approval queue configured; outbound ${action.kind} actions stay pending and are not sent.`);
    }
    return { status: "pending" };
  },
};

export function isApproved(decision: ApprovalDecision): decision is Extract<ApprovalDecision, { status: "approved" }> {
  return decision.status === "approved";
}

/** In-memory gate for tests: decisions are scripted per idempotency key or by a default. */
export class FakeApprovalGate implements ApprovalGate {
  readonly requests: OutboundAction[] = [];
  private readonly decisions = new Map<string, ApprovalDecision>();

  constructor(private readonly defaultStatus: ApprovalDecision["status"] = "approved") {}

  decide(idempotencyKey: string, decision: ApprovalDecision): void {
    this.decisions.set(idempotencyKey, decision);
  }

  async request(action: OutboundAction): Promise<ApprovalDecision> {
    this.requests.push(action);
    const scripted = this.decisions.get(action.idempotencyKey);
    if (scripted) return scripted;
    const approvalId = `appr_${this.requests.length}`;
    const decision: ApprovalDecision =
      this.defaultStatus === "approved"
        ? { status: "approved", approvalId, decidedBy: "broker@test", decidedAt: new Date(0) }
        : this.defaultStatus === "rejected"
          ? { status: "rejected", approvalId, decidedBy: "broker@test" }
          : this.defaultStatus === "expired"
            ? { status: "expired", approvalId }
            : { status: "pending", approvalId };
    this.decisions.set(action.idempotencyKey, decision);
    return decision;
  }
}
