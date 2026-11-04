import { REPORT_LABELS } from "@/lib/construction/types";
import { VENDOR_CADENCE, type CadenceConfig } from "./cadence";
import { chase, type ChaseDeps, type ChaseResult } from "./chase";
import type { VendorOrderContext } from "./sources";

// Vendor order tracking nudges. A third-party report (seismic PML, plan-and-cost
// review, BPO, PCNA, Phase I) that is with a vendor and approaching or past its
// due date gets a status nudge by email, a few days before the due date or, when
// the order has no due date, several days after it was placed. Nudges stop when
// the report is delivered, accepted or cancelled. The vendor bills the borrower
// directly; nothing here concerns fees or payments.

const DAY = 86_400_000;
/** First nudge this many days before the due date. */
export const NUDGE_LEAD_DAYS = 3;
/** With no due date, first nudge this many days after the order. */
export const NUDGE_NO_DUE_DATE_DAYS = 5;

export type VendorNudgeDeps = Omit<ChaseDeps, "now"> & { now?: () => Date; cadence?: CadenceConfig };

export type VendorNudgeResult = ChaseResult & { reportId: string; dealId: string | null };

const placeOf = (o: VendorOrderContext) => [o.project.name, [o.project.city, o.project.state].filter(Boolean).join(" ")].filter(Boolean).join(", ") || o.project.propertyAddress || null;

export function nudgeAnchor(order: VendorOrderContext): Date {
  const { report } = order;
  if (report.dueAt) return new Date(Date.parse(report.dueAt) - NUDGE_LEAD_DAYS * DAY);
  return new Date(Date.parse(report.orderedAt ?? report.createdAt) + NUDGE_NO_DUE_DATE_DAYS * DAY);
}

export async function nudgeVendor(order: VendorOrderContext, deps: VendorNudgeDeps): Promise<VendorNudgeResult> {
  const now = deps.now ?? (() => new Date());
  const { report, project } = order;
  const label = REPORT_LABELS[report.reportType];
  const overdue = Boolean(report.dueAt) && Date.parse(report.dueAt as string) < now().getTime();
  const waitingOnVendor = report.status === "ordered" || report.status === "in_progress" || report.status === "revision_requested";

  const result = await chase(
    {
      agent: "vendor_nudges",
      kind: "vendor_nudge",
      keyPrefix: `vendornudge:${report.id}`,
      subjectKey: `report:${report.id}`,
      dealId: project.dealId,
      leadId: project.leadId,
      cadence: deps.cadence ?? { ...VENDOR_CADENCE },
      anchor: nudgeAnchor(order),
      outstanding: waitingOnVendor ? 1 : 0,
      recipient: report.vendorEmail ? { audience: "vendor", email: report.vendorEmail } : null,
      email: {
        templateId: "vendor_nudge_email",
        data: (round) => ({
          vendorName: report.vendorName,
          reportLabel: label,
          propertyRef: placeOf(order),
          vendorReference: report.vendorReference,
          dueDate: report.dueAt ? report.dueAt.slice(0, 10) : null,
          overdue,
          reminderNumber: round,
        }),
      },
      sms: null,
      escalation: {
        kind: "vendor_unresponsive",
        title: `${label} order is not moving${project.name ? ` (${project.name})` : ""}`,
        lines: [
          report.vendorEmail ? `The vendor has not delivered after ${deps.cadence?.maxRounds ?? VENDOR_CADENCE.maxRounds} nudges.` : "There is no vendor email on the order, so no nudge can be sent.",
          "Call the vendor or ask the borrower to follow up, and update the order on the construction desk.",
        ],
      },
      requestedBy: "agent:vendor_nudges",
    },
    { ...deps, now },
  );
  return { ...result, reportId: report.id, dealId: project.dealId };
}
