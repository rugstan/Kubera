// Step-up re-authentication for sensitive approvals.
//
// Approving an MLDS (RE 882) send, an SBA Form 159, a lender submission or a
// fee quote needs more than a signed-in session: the approving broker must
// have verified a second factor (TOTP or a passkey) within the last
// REAUTH_MAX_AGE_MS, for this approval and this exact payload. The proof is an
// insert-only row (approval_reauthentications) and the tool runner refuses to
// execute a sensitive approval without a matching proof by the approver.
//
// Where the timestamp comes from: Supabase Auth access tokens carry an `amr`
// claim listing each authentication method with its time; after an MFA
// challenge the "totp" entry is fresh. `freshFactorFromAmr` reads it from
// claims the caller has already verified (lib/auth resolves the session with
// the identity provider before any of this runs).

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApprovalRecord } from "@/lib/approvals/types";
import { DRE_LICENSE_PATTERN } from "@/lib/site";

export const REAUTH_MAX_AGE_MS = 10 * 60_000;
/** Clock skew tolerated between the identity provider and this server. */
export const REAUTH_SKEW_MS = 60_000;

export const REAUTH_METHODS = ["totp", "webauthn"] as const;
export type ReauthMethod = (typeof REAUTH_METHODS)[number];

/** Approval kinds that always need re-authentication. */
export const REAUTH_KINDS: ReadonlySet<string> = new Set(["lender_submission", "fee_quote", "mlds_send", "form159_send"]);

/** e-sign / document payload markers that make an approval sensitive whatever its kind. */
const SENSITIVE_DOCUMENT_RE = /\b(mlds|re[\s_-]?882|mortgage loan disclosure|form[\s_-]?159|sba[\s_-]?159|fee[\s_-]?quote|fee[\s_-]?agreement|engagement[\s_-]?letter|lender[\s_-]?submission|loan[\s_-]?package)\b/i;

function payloadStrings(payload: Record<string, unknown>, depth = 0): string[] {
  if (depth > 3) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(payload)) {
    if (/^(document|documentType|document_type|disclosure|disclosureType|disclosure_type|template|templateId|template_id|form|kind|type|purpose|tool)$/i.test(k) && typeof v === "string") out.push(v);
    else if (v && typeof v === "object" && !Array.isArray(v)) out.push(...payloadStrings(v as Record<string, unknown>, depth + 1));
  }
  return out;
}

/**
 * Whether approving this record needs a step-up. Usable by the approvals UI
 * (to prompt for the second factor) and by the tool runner (to enforce it).
 */
export function requiresReauthentication(record: Pick<ApprovalRecord, "kind" | "payload" | "templateId">): boolean {
  if (REAUTH_KINDS.has(record.kind)) return true;
  if (record.payload.reauthRequired === true) return true;
  const markers = [...payloadStrings(record.payload), record.templateId ?? ""].join(" ").replace(/_/g, " ");
  return SENSITIVE_DOCUMENT_RE.test(markers);
}

export type ReauthProof = {
  id: string;
  createdAt: string;
  approvalId: string;
  userId: string;
  userDre: string;
  method: ReauthMethod;
  verifiedAt: string;
  payloadSha256: string;
  sessionRef: string | null;
  ipHash: string | null;
  userAgent: string | null;
};

export type ReauthCheck = { ok: true; proof: ReauthProof } | { ok: false; reason: "auto_approved" | "not_approved" | "no_proof" | "wrong_user" | "payload_changed" | "stale" };

/**
 * Whether `proofs` satisfy the step-up for an approved record: a proof by the
 * broker who decided it, for this approval id and payload hash, verified no
 * earlier than REAUTH_MAX_AGE_MS before the decision. Auto-approved records
 * never qualify (no person decided).
 */
export function reauthSatisfied(record: ApprovalRecord, proofs: readonly ReauthProof[]): ReauthCheck {
  if (record.status !== "approved") return { ok: false, reason: "not_approved" };
  if (record.autoApproved || !record.decidedBy || !record.decidedAt) return { ok: false, reason: "auto_approved" };
  const decided = Date.parse(record.decidedAt);
  const mine = proofs.filter((p) => p.approvalId === record.id);
  if (!mine.length) return { ok: false, reason: "no_proof" };
  const byApprover = mine.filter((p) => p.userId === record.decidedBy);
  if (!byApprover.length) return { ok: false, reason: "wrong_user" };
  const samePayload = byApprover.filter((p) => p.payloadSha256 === record.payloadSha256);
  if (!samePayload.length) return { ok: false, reason: "payload_changed" };
  const fresh = samePayload.find((p) => Date.parse(p.verifiedAt) >= decided - REAUTH_MAX_AGE_MS);
  return fresh ? { ok: true, proof: fresh } : { ok: false, reason: "stale" };
}

/** Claims shape we read (Supabase Auth: amr = [{ method, timestamp }]). */
export type AmrClaims = { sub?: string; aal?: string; amr?: unknown; session_id?: string };

/**
 * The most recent second factor in already-verified access-token claims, or
 * null. Password, OTP and magic-link entries do not count.
 */
export function freshFactorFromAmr(claims: AmrClaims): { method: ReauthMethod; verifiedAt: Date; sessionRef: string | null } | null {
  if (!Array.isArray(claims.amr)) return null;
  let best: { method: ReauthMethod; verifiedAt: Date } | null = null;
  for (const entry of claims.amr) {
    if (!entry || typeof entry !== "object") continue;
    const { method, timestamp } = entry as { method?: unknown; timestamp?: unknown };
    const m = method === "totp" ? "totp" : method === "webauthn" || method === "passkey" ? "webauthn" : null;
    if (!m || typeof timestamp !== "number" || !Number.isFinite(timestamp)) continue;
    const at = new Date(timestamp * 1000);
    if (!best || at > best.verifiedAt) best = { method: m, verifiedAt: at };
  }
  return best ? { ...best, sessionRef: typeof claims.session_id === "string" ? claims.session_id.slice(0, 200) : null } : null;
}

export interface ReauthStore {
  insert(proof: ReauthProof): Promise<void>;
  forApproval(approvalId: string): Promise<ReauthProof[]>;
}

export class ReauthError extends Error {
  constructor(
    readonly code: "not_required" | "not_pending_or_approved" | "invalid_user" | "stale_factor" | "future_factor" | "wrong_approver",
    message: string,
  ) {
    super(message);
    this.name = "ReauthError";
  }
}

export type StepUp = {
  approval: ApprovalRecord;
  user: { userId: string; dreLicense: string | null };
  factor: { method: ReauthMethod; verifiedAt: Date; sessionRef?: string | null };
  ipHash?: string | null;
  userAgent?: string | null;
};

export class ReauthService {
  constructor(
    private readonly store: ReauthStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Records that a broker re-authenticated for an approval. Call it when the
   * broker approves (or confirms an approved send) with a fresh second factor.
   */
  async record(input: StepUp): Promise<ReauthProof> {
    const { approval, user, factor } = input;
    if (!requiresReauthentication(approval)) throw new ReauthError("not_required", `approval ${approval.id} does not need re-authentication`);
    if (approval.status !== "pending" && approval.status !== "approved") throw new ReauthError("not_pending_or_approved", `approval ${approval.id} is ${approval.status}`);
    if (!user.userId || !user.dreLicense || !DRE_LICENSE_PATTERN.test(user.dreLicense)) throw new ReauthError("invalid_user", "re-authentication needs a licensed broker");
    if (approval.status === "approved" && approval.decidedBy !== user.userId) throw new ReauthError("wrong_approver", "only the approving broker can confirm this send");
    const now = this.now().getTime();
    const at = factor.verifiedAt.getTime();
    if (at > now + REAUTH_SKEW_MS) throw new ReauthError("future_factor", "second-factor time is in the future");
    if (now - at > REAUTH_MAX_AGE_MS) throw new ReauthError("stale_factor", "verify your second factor again");
    const proof: ReauthProof = {
      id: randomUUID(),
      createdAt: new Date(now).toISOString(),
      approvalId: approval.id,
      userId: user.userId,
      userDre: user.dreLicense,
      method: factor.method,
      verifiedAt: new Date(Math.min(at, now)).toISOString(),
      payloadSha256: approval.payloadSha256,
      sessionRef: factor.sessionRef ?? null,
      ipHash: input.ipHash ?? null,
      userAgent: input.userAgent?.slice(0, 512) ?? null,
    };
    await this.store.insert(proof);
    return proof;
  }

  async check(record: ApprovalRecord): Promise<ReauthCheck> {
    return reauthSatisfied(record, await this.store.forApproval(record.id));
  }
}

export class MemoryReauthStore implements ReauthStore {
  readonly rows: ReauthProof[] = [];
  async insert(p: ReauthProof) {
    this.rows.push({ ...p });
  }
  async forApproval(id: string) {
    return this.rows.filter((r) => r.approvalId === id).map((r) => ({ ...r }));
  }
}

type Row = {
  id: string;
  created_at: string;
  approval_id: string;
  user_id: string;
  user_dre: string;
  method: ReauthMethod;
  verified_at: string;
  payload_sha256: string;
  session_ref: string | null;
  ip_hash: string | null;
  user_agent: string | null;
};

export function supabaseReauthStore(db: SupabaseClient): ReauthStore {
  const table = () => db.from("approval_reauthentications");
  return {
    async insert(p) {
      const { error } = await table().insert({
        id: p.id,
        created_at: p.createdAt,
        approval_id: p.approvalId,
        user_id: p.userId,
        user_dre: p.userDre,
        method: p.method,
        verified_at: p.verifiedAt,
        payload_sha256: p.payloadSha256,
        session_ref: p.sessionRef,
        ip_hash: p.ipHash,
        user_agent: p.userAgent,
      });
      if (error) throw new Error(`approval_reauthentications insert failed: ${error.message}`);
    },
    async forApproval(id) {
      const { data, error } = await table()
        .select("id, created_at, approval_id, user_id, user_dre, method, verified_at, payload_sha256, session_ref, ip_hash, user_agent")
        .eq("approval_id", id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(`approval_reauthentications read failed: ${error.message}`);
      return ((data ?? []) as Row[]).map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        approvalId: r.approval_id,
        userId: r.user_id,
        userDre: r.user_dre,
        method: r.method,
        verifiedAt: new Date(r.verified_at).toISOString(),
        payloadSha256: r.payload_sha256,
        sessionRef: r.session_ref,
        ipHash: r.ip_hash,
        userAgent: r.user_agent,
      }));
    },
  };
}
