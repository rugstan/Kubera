import { isOverdue, nextStatuses, MANUAL_STATUSES, type ReportReadiness } from "@/lib/construction/reports";
import { REPORT_LABELS, REPORT_STATUS_LABELS, REPORT_TYPES, type ConstructionReport } from "@/lib/construction/types";
import { addReportAction, orderReportAction, reconcileOrderAction, reportStatusAction } from "../actions";
import { ActionForm, Hidden, SelectField, TextAreaField, TextField } from "./ActionForm";
import { Card, formatDate, Notice, ReportStatusChip } from "./ui";

export function ReportsSection({ projectId, reports, readiness, now }: { projectId: string; reports: ConstructionReport[]; readiness: ReportReadiness; now: Date }) {
  const live = reports.filter((r) => r.status !== "cancelled");
  const addable = REPORT_TYPES.filter((t) => !live.some((r) => r.reportType === t));
  return (
    <Card
      id="reports"
      title="Third-party reports"
      lead="Vendors bill the borrower directly, so no fees are tracked here. Ordering a report asks a broker to approve it first; nothing is sent to a vendor until they do."
    >
      {readiness.ready ? (
        <Notice tone="good" title="All required reports are accepted">
          Reports are ready for closing.
        </Notice>
      ) : (
        <Notice tone="warn" title={`${readiness.blockers.length} required ${readiness.blockers.length === 1 ? "report is" : "reports are"} not accepted yet`}>
          <ul className="list-disc pl-5">
            {readiness.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </Notice>
      )}

      <ul className="mt-5 divide-y divide-black/10">
        {reports.map((r) => (
          <li key={r.id} className={`py-5 ${r.status === "cancelled" ? "opacity-60" : ""}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[17px] font-semibold">{REPORT_LABELS[r.reportType]}</h3>
              <ReportStatusChip status={r.status} overdue={isOverdue(r, now)} />
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-[14px] text-titanium md:grid-cols-4">
              <div>
                <dt className="sr-only">Vendor</dt>
                <dd>{r.vendorName ?? "No vendor yet"}</dd>
              </div>
              <div>
                <dt className="inline">Due </dt>
                <dd className="inline">{formatDate(r.dueAt)}</dd>
              </div>
              <div>
                <dt className="inline">Vendor ref </dt>
                <dd className="inline">{r.vendorReference ?? "none"}</dd>
              </div>
              <div>
                <dt className="inline">Approval </dt>
                <dd className="inline">{r.approvalId ?? "none"}</dd>
              </div>
            </dl>
            {r.notes && <p className="mt-1 text-[14px] text-titanium">{r.notes}</p>}
            <ReportActions projectId={projectId} report={r} />
          </li>
        ))}
      </ul>

      {addable.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-[15px] font-medium text-accent">Add another report type</summary>
          <ActionForm action={addReportAction} submitLabel="Add to tracker" variant="glass" className="mt-3 max-w-md">
            <Hidden name="projectId" value={projectId} />
            <SelectField name="reportType" label="Report" options={addable.map((t) => ({ value: t, label: REPORT_LABELS[t] }))} />
          </ActionForm>
        </details>
      )}
    </Card>
  );
}

function ReportActions({ projectId, report }: { projectId: string; report: ConstructionReport }) {
  if (report.status === "not_ordered" || report.status === "order_blocked") {
    return (
      <details className="mt-3">
        <summary className="cursor-pointer text-[15px] font-medium text-accent">{report.status === "order_blocked" ? "Request the order again" : "Order from a vendor"}</summary>
        <ActionForm action={orderReportAction} submitLabel="Send to broker approval" pendingLabel="Sending" className="mt-3 grid max-w-2xl gap-3 md:grid-cols-2">
          <Hidden name="projectId" value={projectId} />
          <Hidden name="reportId" value={report.id} />
          <TextField name="vendorName" label="Vendor" required defaultValue={report.vendorName} />
          <TextField name="vendorEmail" label="Vendor email" type="email" inputMode="email" defaultValue={report.vendorEmail} />
          <TextField name="vendorReference" label="Vendor file or order number" defaultValue={report.vendorReference} className="md:col-span-2" />
        </ActionForm>
      </details>
    );
  }
  if (report.status === "order_pending_approval") {
    return (
      <ActionForm action={reconcileOrderAction} submitLabel="Check approval status" variant="glass" className="mt-2">
        <Hidden name="projectId" value={projectId} />
        <Hidden name="reportId" value={report.id} />
        <p className="text-[14px] text-titanium">Waiting in the broker approval queue. If the approval is not decided in time it expires and nothing is sent.</p>
      </ActionForm>
    );
  }
  const options = nextStatuses(report.status).filter((s) => MANUAL_STATUSES.includes(s));
  if (options.length === 0) return null;
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-[15px] font-medium text-accent">Update status</summary>
      <ActionForm action={reportStatusAction} submitLabel="Update" className="mt-3 grid max-w-2xl gap-3 md:grid-cols-2">
        <Hidden name="projectId" value={projectId} />
        <Hidden name="reportId" value={report.id} />
        <SelectField name="to" label="New status" options={options.map((s) => ({ value: s, label: REPORT_STATUS_LABELS[s] }))} />
        <TextField name="vendorReference" label="Vendor file or order number" defaultValue={report.vendorReference} />
        <TextField name="documentId" label="Document vault id of the report" hint="Optional. The id of the uploaded report in the document vault." defaultValue={report.documentId} className="md:col-span-2" />
        <TextAreaField name="notes" label="Notes" defaultValue={report.notes} className="md:col-span-2" />
      </ActionForm>
    </details>
  );
}
