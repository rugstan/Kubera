import type { ApprovalRecord } from "@/lib/approvals/types";

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
