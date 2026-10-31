import type { StaffPrincipal } from "@/lib/auth/types";

/** Fee, lender and lead-source figures are for brokers and administrators; analysts work the pipeline, not the books. */
export function canViewReports(principal: Pick<StaffPrincipal, "staffRoles">): boolean {
  return principal.staffRoles.includes("broker") || principal.staffRoles.includes("admin");
}

export const REPORT_VIEWS = ["overview", "fees", "lenders", "sources"] as const;
export type ReportView = (typeof REPORT_VIEWS)[number];

export const REPORT_VIEW_LABELS: Record<ReportView, string> = {
  overview: "Pipeline",
  fees: "Fee forecast",
  lenders: "Lender hit rate",
  sources: "Lead sources",
};

export function parseView(value: unknown): ReportView {
  return (REPORT_VIEWS as readonly string[]).includes(String(value)) ? (value as ReportView) : "overview";
}
