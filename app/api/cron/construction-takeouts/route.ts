import { NextResponse } from "next/server";
import { getConstructionDeps } from "@/lib/construction/server";
import { sweepTakeoutTriggers } from "@/lib/construction/service";
import { safeEqual } from "@/lib/security";

export const maxDuration = 120;

const NO_STORE = { "cache-control": "no-store" };

// Daily (vercel.json, `Authorization: Bearer $CRON_SECRET`): evaluates every
// construction project on a refinance path and records take-out triggers
// (conversion, lease-up, maturity). It opens no deals: staff review the trigger
// on the project and open the refinance deal from there.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const deps = getConstructionDeps();
  if (!deps) return NextResponse.json({ ok: true, skipped: "construction-not-configured" }, { headers: NO_STORE });
  try {
    const result = await sweepTakeoutTriggers(deps, "system:cron");
    return NextResponse.json({ ok: true, checked: result.checked, triggered: result.triggered.length }, { headers: NO_STORE });
  } catch (err) {
    console.error("construction-takeouts sweep failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "construction-takeouts sweep failed" }, { status: 500, headers: NO_STORE });
  }
}
