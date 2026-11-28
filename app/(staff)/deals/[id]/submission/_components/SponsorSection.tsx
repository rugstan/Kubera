import Link from "next/link";
import { Badge, Table } from "@/app/(staff)/deals/ui";
import { CREDIT_EVENT_LABELS, creditEventKinds } from "@/lib/deals/submission/types";
import { date, usd } from "../_lib/format";
import { EditorSection, Facts, type SectionProps } from "./EditorSection";

// Sponsor summary: what the sponsor states (always "per borrower"; the sponsor
// row has no document sources), the credit-event answers, and a read-only view
// of the principals file. Personal statements, IDs and returns stay in the
// vault; this section never asks for them.

export function SponsorSection({ view, write }: SectionProps) {
  const { ctx } = view;
  const events = ctx.sponsor?.creditEvents ?? {};
  const totals = ctx.guarantorTotals;
  const principals = ctx.principals.filter((p) => p.kind === "individual" || p.roles.includes("borrower_entity"));
  const yes = (b: boolean) => (b ? <Badge tone="good">On file</Badge> : <Badge tone="warn">Missing</Badge>);
  return (
    <EditorSection
      description="Experience and stated strength, as the sponsor gives them. The email shows covenant checks, not dollar figures, unless you choose otherwise. Never name a guarantor in free text."
      extra={
        <fieldset className="min-w-0 rounded-2xl border border-black/10 p-4 sm:col-span-2" id="field-sponsor.creditEvents">
          <legend className="px-1 text-sm font-medium text-ink">Credit events (bankruptcy, foreclosure, judgments, litigation)</legend>
          <p className="mb-3 text-xs text-titanium">Answer each. A yes needs an explanation, which stays behind the share link.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {creditEventKinds.map((k) => {
              const a = events[k];
              return (
                <div className="min-w-0 space-y-2" key={k}>
                  <label className="field-label" htmlFor={`field-sponsor.creditEvents.${k}`}>
                    {CREDIT_EVENT_LABELS[k]}
                  </label>
                  <select className="field" defaultValue={a ? (a.occurred ? "yes" : "no") : ""} id={`field-sponsor.creditEvents.${k}`} name={`sponsor.creditEvents.${k}`}>
                    <option value="">Not answered</option>
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </select>
                  <input
                    aria-label={`${CREDIT_EVENT_LABELS[k]}: explanation if yes`}
                    className="field"
                    defaultValue={a?.explanation ?? ""}
                    id={`field-sponsor.creditEvents.${k}.explanation`}
                    name={`sponsor.creditEvents.${k}.explanation`}
                    placeholder="Explanation if yes"
                    type="text"
                  />
                </div>
              );
            })}
          </div>
        </fieldset>
      }
      extraReadOnly={
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          {creditEventKinds.map((k) => (
            <div key={k}>
              <dt className="text-xs text-titanium">{CREDIT_EVENT_LABELS[k]}</dt>
              <dd className="text-ink">{events[k] ? (events[k]!.occurred ? `Yes: ${events[k]!.explanation ?? ""}` : "No") : "Not answered"}</dd>
            </div>
          ))}
        </dl>
      }
      facts={
        <div className="space-y-3">
          <Facts
            note={
              <>
                Statements, schedules and authorizations are collected on the{" "}
                <Link className="font-medium text-ink underline underline-offset-2" href={`/checklists/deal?id=${ctx.deal.id}#principals`}>
                  principals file
                </Link>
                . Their totals are read live and never copied here.
              </>
            }
            rows={[
              { label: "Guarantors with a PFS on file", value: totals ? `${totals.pfsCount} of ${totals.guarantorCount}${totals.oldestPfsAsOf ? `, oldest ${date(totals.oldestPfsAsOf)}` : ""}` : "None yet" },
              { label: "Combined PFS net worth / liquidity", value: totals ? `${usd(totals.netWorthCents)} / ${usd(totals.liquidityCents)}` : "No PFS on file" },
            ]}
          />
          {principals.length ? (
            <Table
              empty="No principals."
              head={["Principal", "Role", "Ownership", "Guarantor", "PFS", "REO schedule", "Credit authorization"]}
              label="Principals and what is on file"
              rows={principals.map((p) => [
                <span className="font-medium" key="n">
                  {p.legalName}
                </span>,
                p.roles.map((r) => r.replace(/_/g, " ")).join(", "),
                `${Math.round(p.effectivePct * 100) / 100}%`,
                p.isGuarantor ? "Yes" : "No",
                p.kind === "individual" ? (p.hasPfs ? <Badge key="p" tone="good">{p.pfsAsOf ? date(p.pfsAsOf) : "On file"}</Badge> : <Badge key="p" tone="warn">Missing</Badge>) : "—",
                p.kind === "individual" ? yes(p.hasReoSchedule) : "—",
                p.kind === "individual" ? yes(p.hasCreditAuthorization) : "—",
              ])}
            />
          ) : (
            <p className="text-sm text-titanium">No principals on the org chart yet.</p>
          )}
        </div>
      }
      id="sponsor"
      view={view}
      write={write}
    />
  );
}
