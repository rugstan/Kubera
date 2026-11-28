import Link from "next/link";
import { Badge, Section, Table } from "@/app/(staff)/deals/ui";
import { SECTION_LABELS } from "@/lib/deals/submission/playbooks";
import { ITEM_STATUS_LABEL, SATISFIED_STATUSES } from "@/lib/checklists/types";
import { date } from "../_lib/format";
import type { SectionProps } from "./EditorSection";

// Read-only: the deal checklist's items (the Underwrite level of the meter),
// the clean vault documents that can go into a package, and the third-party
// reports on hand with their dates. Documents are added on the checklist desk.

const STAGE_LABEL = { application: "Application", underwriting: "Underwriting", pre_closing: "Pre-closing" } as const;

export function DocumentsSection({ view }: Pick<SectionProps, "view">) {
  const { ctx } = view;
  const items = ctx.checklistItems.filter((i) => i.stage !== "pre_closing");
  const reports = ctx.construction?.reports ?? [];
  const checklistHref = `/checklists/deal?id=${encodeURIComponent(ctx.deal.id)}`;
  return (
    <Section description="What is in the vault and on the checklist. Add or replace documents on the checklist desk; this view does not change them." id="section-documents" title={SECTION_LABELS.documents}>
      <p className="mb-3 text-sm">
        <Link className="font-medium text-ink underline underline-offset-2" href={checklistHref}>
          Open the deal checklist
        </Link>
      </p>
      <h3 className="text-sm font-semibold text-ink">Checklist items (application and underwriting)</h3>
      <div className="mt-2">
        <Table
          empty="No deal checklist yet. Create one on the checklist desk."
          head={["Item", "Stage", "Required", "Status", "Dated"]}
          label="Checklist items"
          rows={items.map((i) => [
            <a className="text-ink underline underline-offset-2" href={`${checklistHref}#item-${encodeURIComponent(i.id)}`} key="t">
              {i.title}
            </a>,
            STAGE_LABEL[i.stage],
            i.required ? "Required" : "Optional",
            <Badge key="s" tone={SATISFIED_STATUSES.includes(i.status) ? "good" : i.status === "submitted" || i.status === "under_review" ? "neutral" : "warn"}>
              {ITEM_STATUS_LABEL[i.status]}
            </Badge>,
            i.documentDate ? date(i.documentDate) : "—",
          ])}
        />
      </div>
      <h3 className="mt-6 text-sm font-semibold text-ink">Vault documents (malware-scanned)</h3>
      {ctx.vaultDocuments.length ? (
        <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
          {ctx.vaultDocuments.map((d) => (
            <li className="break-words" key={d.id}>
              {d.fileName} <span className="text-xs text-titanium">({d.kind})</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-titanium">{ctx.deal.leadId ? "No clean documents in the vault yet." : "Link the deal to its lead to see its vault documents."}</p>
      )}
      {reports.length ? (
        <>
          <h3 className="mt-6 text-sm font-semibold text-ink">Third-party reports</h3>
          <Table empty="No reports." head={["Report", "Status", "Report date"]} label="Third-party reports" rows={reports.map((r) => [r.reportType.replace(/_/g, " "), r.status.replace(/_/g, " "), r.deliveredAt ? date(r.deliveredAt) : "—"])} />
        </>
      ) : null}
    </Section>
  );
}
