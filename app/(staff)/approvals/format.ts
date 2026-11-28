import type { ApprovalRecord } from "@/lib/approvals/types";
import { TARGET_STAGE_LABELS, isTargetStage } from "@/lib/deals/submission/types";

/**
 * What the approving broker needs to see on a lender submission, read from the
 * approval's hashed payload: what the lender is asked for, the required items
 * still missing (by label) and the written reason to send anyway, the facts
 * outside the lender's recorded box, and a link to the current draft (the
 * live preview, which is not what is being approved: the card shows the
 * stored email and the locked summary for that). `readinessChecked` is false on submissions requested before the
 * readiness gate (their payload has no readiness fields), so the card does not
 * claim nothing is missing.
 */
export type SubmissionApprovalDetails = {
  stageLabel: string | null;
  readinessChecked: boolean;
  missing: string[];
  overrideReason: string | null;
  fitExceptions: string[];
  /** The lender override's own reason (an unranked or out-of-box lender). */
  lenderOverrideReason: string | null;
  /** Fair-lending flags on the staff-typed text, and whether staff confirmed them (null on requests made before the check). */
  neutralCopy: { flags: { topic: string; term: string }[]; confirmed: boolean } | null;
  /** The live preview of the deal as it is now ("current draft"); never the approved content. */
  draftHref: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const texts = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : []);

function neutralCopyOf(v: unknown): SubmissionApprovalDetails["neutralCopy"] {
  if (!v || typeof v !== "object") return null;
  const o = v as { flags?: unknown; confirmed?: unknown };
  const flags = Array.isArray(o.flags) ? o.flags.flatMap((f) => (f && typeof f === "object" && typeof (f as { term?: unknown }).term === "string" ? [{ topic: String((f as { topic?: unknown }).topic ?? ""), term: (f as { term: string }).term }] : [])) : [];
  return { flags, confirmed: o.confirmed === true };
}

export function lenderSubmissionDetails(r: Pick<ApprovalRecord, "kind" | "payload" | "dealId">, labelFor: (requirementId: string) => string = (id) => id): SubmissionApprovalDetails | null {
  if (r.kind !== "lender_submission") return null;
  const p = r.payload ?? {};
  const dealId = text(p.dealId) ?? r.dealId;
  const lenderId = text(p.lenderId);
  const stage = isTargetStage(p.targetStage) ? p.targetStage : null;
  const fit = (p.lenderFit ?? p.fit) as { exceptions?: unknown } | null | undefined;
  const query = [lenderId && UUID.test(lenderId) ? `lender=${lenderId}` : null, stage ? `stage=${stage}` : null].filter(Boolean).join("&");
  return {
    stageLabel: stage ? TARGET_STAGE_LABELS[stage] : null,
    readinessChecked: Array.isArray(p.readinessMissing),
    missing: texts(p.readinessMissing).map(labelFor),
    overrideReason: text(p.overrideReason),
    fitExceptions: texts(fit?.exceptions ?? p.fitExceptions),
    lenderOverrideReason: text(p.lenderOverrideReason),
    neutralCopy: neutralCopyOf(p.neutralCopy),
    draftHref: dealId && UUID.test(dealId) ? `/deals/${dealId}/submission/preview${query ? `?${query}` : ""}` : null,
  };
}

/** "Expires in 3 h 20 min" / "Expired" for a pending request. */
export function relativeExpiry(expiresAt: string, now: Date): string {
  const ms = Date.parse(expiresAt) - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "Expired";
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `Expires in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    const rest = minutes % 60;
    return rest ? `Expires in ${hours} h ${rest} min` : `Expires in ${hours} h`;
  }
  return `Expires in ${Math.floor(hours / 24)} days`;
}

export function statusLabel(r: Pick<ApprovalRecord, "status" | "autoApproved" | "executedAt">): string {
  switch (r.status) {
    case "approved":
      return `${r.autoApproved ? "Approved (pre-approved template)" : "Approved"}${r.executedAt ? " · sent" : ""}`;
    case "rejected":
      return "Rejected · not sent";
    case "expired":
      return "Expired · never sent";
    case "cancelled":
      return "Cancelled · not sent";
    default:
      return "Waiting";
  }
}
