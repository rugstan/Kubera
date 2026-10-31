import type { ReportBundle } from "@/lib/reporting/build";
import { CsvLink, DataTable, Panel, Stat, pct, usd } from "./ui";
import { SpendForm } from "./SpendForm";

export function SourcesView({ r }: { r: ReportBundle }) {
  const { rows, totals } = r.sources;
  return (
    <div className="grid gap-5">
      <section aria-label="Lead source summary" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Leads" value={String(totals.leads)} hint={`Created in the ${r.window.label.toLowerCase()}`} />
        <Stat label="Deals opened" value={String(totals.deals)} hint={`${pct(totals.leadToDealPct)} of leads; ${totals.won} closed`} />
        <Stat label="Booked net fees" value={usd(totals.bookedNetCents)} hint="Earned, invoiced and settled, after partner shares" />
        <Stat label="Marketing spend" value={usd(totals.spendCents)} hint={totals.roiPct === null ? "Record spend below to see return" : `Return ${pct(totals.roiPct)} on booked net`} />
      </section>

      <Panel
        title="By lead source"
        description="Follows the leads created in the period through the deals they became and the fees those deals booked. Return is booked net fees less spend, as a share of spend; expected adds the stage-weighted outlook on the same deals."
        action={<CsvLink report="sources" range={r.window.key} />}
      >
        <DataTable
          label="Lead-source return on spend"
          columns={[
            { header: "Source" },
            { header: "Leads", align: "right" },
            { header: "Deals", align: "right" },
            { header: "Closed", align: "right" },
            { header: "Lead to deal", align: "right" },
            { header: "Booked net", align: "right" },
            { header: "Expected net", align: "right" },
            { header: "Spend", align: "right" },
            { header: "Per lead", align: "right" },
            { header: "Per closed deal", align: "right" },
            { header: "Return", align: "right" },
          ]}
          rows={rows.map((s) => [
            s.source,
            s.leads,
            s.deals,
            s.won,
            pct(s.leadToDealPct),
            usd(s.bookedNetCents),
            usd(s.expectedNetCents),
            s.spendRecorded ? usd(s.spendCents) : "Not recorded",
            s.costPerLeadCents === null ? "—" : usd(s.costPerLeadCents),
            s.costPerWonDealCents === null ? "—" : usd(s.costPerWonDealCents),
            pct(s.roiPct),
          ])}
          empty="No leads or deals in this period."
        />
        <p className="mt-3 text-[13px] text-titanium">Deals with no lead behind them (entered by hand, or opened from a take-out) appear as &quot;(no lead)&quot;.</p>
      </Panel>

      <Panel title="Record marketing spend" description="What Kubera spent on a lead source over a period. A period that crosses the report dates is counted by days.">
        <SpendForm />
      </Panel>
    </div>
  );
}
