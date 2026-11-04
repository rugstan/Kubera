import { NextResponse } from "next/server";
import { getApprovalService } from "@/lib/approvals/server";
import { safeEqual } from "@/lib/security";

export const maxDuration = 60;

// Housekeeping (vercel.json, every 15 minutes, `Authorization: Bearer $CRON_SECRET`):
// marks pending approvals past their deadline as expired, which also wakes the
// workflows waiting on them. Expiry is already enforced on every read and
// decision, so a missed run never lets an expired approval send.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  const service = await getApprovalService();
  if (!service) return NextResponse.json({ ok: true, skipped: "approvals-not-configured" }, { headers: { "cache-control": "no-store" } });
  try {
    const expired = await service.expireDue();
    return NextResponse.json({ ok: true, expired: expired.length }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("approvals-expire failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "approvals-expire failed" }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
