// MLDS delivery clock sweep (B&P §10240; counsel gate A).
//
// The RE 882 is due by the earlier of 3 business days after Corin receives
// the completed written loan application or the moment the borrower becomes
// obligated. The deal page shows the clock (lib/deals/service.ts passes it to
// the compliance gates); this sweep pages staff once when an undelivered MLDS
// enters its warning window and once more when it becomes overdue, through
// WS-J's pre-approved staff_alert template. Alerts carry the deal title, the
// due time and a link only (no borrower PII).

import { computeMldsTimer, type MldsTimer } from "@/lib/disclosures/timer";
import type { DisclosureRecord, DisclosureStore } from "@/lib/disclosures/store";
import type { DealDeskStore } from "./store";
import type { Clock } from "./types";

export type MldsClockAlert = {
  /** Idempotency stem: one alert per disclosure and clock status. */
  key: string;
  disclosureId: string;
  dealId: string | null;
  leadId: string | null;
  status: "warning" | "overdue";
  dueAt: string;
  title: string;
  lines: string[];
  path: string;
};

export type MldsClockDeps = {
  disclosures: Pick<DisclosureStore, "listUndeliveredMlds">;
  store: Pick<DealDeskStore, "getDeal">;
  now: Clock;
  /** Delivers one alert to staff (staff_alert); must be idempotent on `alert.key`. */
  alert: (alert: MldsClockAlert) => Promise<void>;
};

const pacific = (d: Date) => d.toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" });

/** The clock for an undelivered MLDS; null for a re-issue (no fresh statutory clock) or a record without an application time. */
export function undeliveredMldsClock(record: DisclosureRecord, now: Date): MldsTimer | null {
  if (!record.applicationCompletedAt || record.supersedesId || record.sentAt) return null;
  return computeMldsTimer({
    applicationCompletedAt: new Date(record.applicationCompletedAt),
    borrowerObligatedAt: record.borrowerObligatedAt ? new Date(record.borrowerObligatedAt) : null,
    now,
  });
}

/** Pages staff for every undelivered MLDS in its warning window or overdue. Returns what was alerted. */
export async function sweepMldsClocks(deps: MldsClockDeps): Promise<{ checked: number; alerts: MldsClockAlert[]; failed: number }> {
  const now = deps.now();
  const records = await deps.disclosures.listUndeliveredMlds();
  const alerts: MldsClockAlert[] = [];
  let failed = 0;
  for (const r of records) {
    const timer = undeliveredMldsClock(r, now);
    if (!timer || (timer.status !== "warning" && timer.status !== "overdue")) continue;
    const deal = r.dealId ? await deps.store.getDeal(r.dealId) : null;
    const name = deal?.title ?? `MLDS ${r.id.slice(0, 8)}`;
    const due = `${pacific(timer.dueAt)} Pacific (${timer.dueReason === "before_obligation" ? "before the borrower is obligated" : "3 business days after the completed application"})`;
    const alert: MldsClockAlert = {
      key: `mlds-clock:${r.id}:${timer.status}`,
      disclosureId: r.id,
      dealId: r.dealId,
      leadId: r.leadId,
      status: timer.status,
      dueAt: timer.dueAt.toISOString(),
      title: timer.status === "overdue" ? `MLDS overdue: ${name}` : `MLDS due soon: ${name}`,
      lines: [
        timer.status === "overdue" ? `The MLDS (RE 882) was due ${due} and has not been delivered (B&P §10240).` : `The MLDS (RE 882) is due ${due}.`,
        `Status: ${r.status.replace(/_/g, " ")}.`,
        "Deliver it before the borrower becomes obligated; nothing goes to the borrower for signature until it is signed.",
      ],
      path: r.dealId ? `/deals/${r.dealId}#mlds` : "/deals",
    };
    try {
      await deps.alert(alert);
      alerts.push(alert);
    } catch (err) {
      failed += 1;
      console.error("[deals] MLDS clock alert failed", r.id, err instanceof Error ? err.message : err);
    }
  }
  return { checked: records.length, alerts, failed };
}
