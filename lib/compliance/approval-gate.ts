// Broker approval gate contract (Global rule 2). Every outbound action —
// e-sign send, CRM write, email — asks the gate first and proceeds only on
// "approved". The real queue (`approvals` table, lib/approvals) lands with
// WS-I; until then the default gate is closed: requests are recorded as
// pending and nothing is sent. A timed-out approval expires and never sends.

/**
 * lender_submission, mlds_send, form159_send and fee_quote are sensitive: the
 * approving broker must re-authenticate (lib/agents/core/reauth.ts) before
 * they are approved or sent.
 */
export type OutboundActionKind = "esign_send" | "crm_update" | "lender_notice" | "email" | "sms" | "lender_submission" | "mlds_send" | "form159_send" | "fee_quote";

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
  /** The requesting staff member's user id (approvals.requested_by_user): the queue refuses to let them approve their own override. */
  requestedByUser?: string;
};

export type ApprovalDecision =
  /** From peek(): `executedAt` is set when the approved action was already carried out (claimed). */
  | { status: "approved"; approvalId: string; decidedBy: string; decidedAt: Date; executedAt?: Date }
  /** `reauth_required`: approved, but the approving broker's step-up proof is missing or stale, so nothing may be sent. */
  | { status: "pending"; approvalId?: string; reason?: "reauth_required" }
  | { status: "rejected"; approvalId: string; decidedBy: string; reason?: string }
  | { status: "expired"; approvalId: string };

export interface ApprovalGate {
  /**
   * Request (or look up, by idempotency key) the approval for `action`. An
   * "approved" answer is handed out once: it claims the execution, so call this
   * only right before the action is actually carried out.
   */
  request(action: OutboundAction): Promise<ApprovalDecision>;
  /**
   * Request (or look up) the approval WITHOUT claiming it: for showing status,
   * or when nothing can be sent right now (no mailer configured). An "approved"
   * answer here authorizes nothing; call request() immediately before sending.
   */
  peek?(action: OutboundAction): Promise<ApprovalDecision>;
  /**
   * Closes the pending request for `idempotencyKey` (its action will never be
   * carried out: the submission was superseded or withdrawn), so nobody
   * approves it later. True when a pending request was closed; false when
   * there was none or it was already decided. A gate without it leaves the
   * request in the queue, where approving it sends nothing.
   */
  withdraw?(idempotencyKey: string, reason: string, by: string): Promise<boolean>;
}

/** The gate's non-claiming answer; a gate that cannot peek reports pending (never consumes an approval). */
export async function peekApproval(gate: ApprovalGate, action: OutboundAction): Promise<ApprovalDecision> {
  return gate.peek ? gate.peek(action) : { status: "pending" };
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
  async peek(action) {
    return closedApprovalGate.request(action);
  },
};

export function isApproved(decision: ApprovalDecision): decision is Extract<ApprovalDecision, { status: "approved" }> {
  return decision.status === "approved";
}

/** In-memory gate for tests: decisions are scripted per idempotency key or by a default. */
export class FakeApprovalGate implements ApprovalGate {
  readonly requests: OutboundAction[] = [];
  /** Non-claiming lookups (peek). */
  readonly peeks: OutboundAction[] = [];
  /** Requests closed through withdraw(). */
  readonly withdrawals: { idempotencyKey: string; reason: string; by: string }[] = [];
  private readonly decisions = new Map<string, ApprovalDecision>();

  constructor(private readonly defaultStatus: ApprovalDecision["status"] = "approved") {}

  decide(idempotencyKey: string, decision: ApprovalDecision): void {
    this.decisions.set(idempotencyKey, decision);
  }

  async request(action: OutboundAction): Promise<ApprovalDecision> {
    this.requests.push(action);
    return this.decisionFor(action, `appr_${this.requests.length}`);
  }

  /** Same scripted answer as request(); the fake never claims, so peeks and requests agree. */
  async peek(action: OutboundAction): Promise<ApprovalDecision> {
    this.peeks.push(action);
    return this.decisionFor(action, `appr_peek_${this.peeks.length}`);
  }

  /** Closes a pending (or not yet asked) key: later requests and peeks for it answer rejected. */
  async withdraw(idempotencyKey: string, reason: string, by: string): Promise<boolean> {
    const current = this.decisions.get(idempotencyKey);
    if (current && current.status !== "pending") return false;
    this.withdrawals.push({ idempotencyKey, reason, by });
    this.decisions.set(idempotencyKey, { status: "rejected", approvalId: current?.approvalId ?? `appr_withdrawn_${this.withdrawals.length}`, decidedBy: by, reason });
    return true;
  }

  private decisionFor(action: OutboundAction, approvalId: string): ApprovalDecision {
    const scripted = this.decisions.get(action.idempotencyKey);
    if (scripted) return scripted;
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
