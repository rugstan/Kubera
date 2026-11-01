import { NextResponse } from "next/server";
import { sweepMldsClocks, type MldsClockAlert } from "@/lib/deals/mlds-clock";
import { dealDeskRuntime } from "@/lib/deals/runtime";
import { notifyRuntime } from "@/lib/notify/runtime";
import { safeEqual } from "@/lib/security";
import { site } from "@/lib/site";

export const maxDuration = 60;

const NO_STORE = { "cache-control": "no-store" };

/** One staff_alert (pre-approved) per staff address, once per MLDS and clock status. */
async function alertStaff(a: MldsClockAlert): Promise<void> {
  const rt = notifyRuntime();
  for (const address of rt.staff.emails) {
    await rt.notifier.send({
      templateId: "staff_alert",
      to: { audience: "staff", email: address },
      data: { title: a.title, lines: a.lines, link: { href: `${site.siteUrl.replace(/\/$/, "")}${a.path}`, label: "Open the deal" } },
      idempotencyKey: `${a.key}:${address.toLowerCase()}`,
      leadId: a.leadId,
      dealId: a.dealId,
      requestedBy: "system:mlds-clock",
    });
  }
}

// Hourly (vercel.json, `Authorization: Bearer $CRON_SECRET`): pages staff when
// an undelivered MLDS (RE 882) enters its warning window or becomes overdue
// under the B&P §10240 clock. It sends nothing to borrowers and changes no
// disclosure; staff deliver the MLDS from the deal page.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const rt = dealDeskRuntime();
  if (!rt) return NextResponse.json({ ok: true, skipped: "deal-desk-not-configured" }, { headers: NO_STORE });
  try {
    const result = await sweepMldsClocks({ disclosures: rt.disclosures, store: rt.store, now: rt.now, alert: alertStaff });
    return NextResponse.json({ ok: result.failed === 0, checked: result.checked, alerted: result.alerts.length, failed: result.failed }, { status: result.failed ? 500 : 200, headers: NO_STORE });
  } catch (err) {
    console.error("mlds-clock sweep failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "mlds-clock sweep failed" }, { status: 500, headers: NO_STORE });
  }
}
