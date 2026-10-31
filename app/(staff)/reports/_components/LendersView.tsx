import type { ReportBundle } from "@/lib/reporting/build";
import { MIN_SAMPLE } from "@/lib/reporting/lenders";
import { CsvLink, DataTable, Panel, Pill, Stat, days, pct } from "./ui";

export function LendersView({ r }: { r: ReportBundle }) {
  const { rows, totals } = r.lenders;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <section aria-label="Lender summary" className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Packages sent" value={String(totals.sent)} hint={`${totals.requested} requested, ${totals.stoppedAtGate} stopped at the approval gate`} />
        <Stat label="Term sheets" value={String(totals.termSheets)} hint={`${totals.declined} declined, ${totals.awaiting} waiting`} />
        <Stat label="Hit rate" value={pct(totals.hitRatePct)} hint="Term sheets as a share of packages sent" />
        <Stat label="Average response" value={totals.avgResponseDays === null ? "—" : `${totals.avgResponseDays} days`} hint={`${pct(totals.responseRatePct)} of packages answered`} />
      </section>
      <Panel
        title="By lender"
        description={`Packages sent in the ${r.window.label.toLowerCase()}. Every package goes out only after a broker approves it. Rates on fewer than ${MIN_SAMPLE} packages are small-sample guesses.`}
        action={<CsvLink report="lenders" range={r.window.key} />}
      >
        <DataTable
          label="Lender hit rate"
          columns={[
            { header: "Lender" },
            { header: "Sent", align: "right" },
            { header: "Term sheets", align: "right" },
            { header: "Declined", align: "right" },
            { header: "Waiting", align: "right" },
            { header: "Hit rate", align: "right" },
            { header: "Answered", align: "right" },
            { header: "Avg days to answer", align: "right" },
            { header: "Closed deals", align: "right" },
            { header: "Stopped at gate", align: "right" },
          ]}
          rows={rows.map((l) => [
            <span key={l.lenderId}>
              {l.name} {l.brokerFriendly ? <Pill tone="good">Broker-friendly</Pill> : null}
            </span>,
            l.sent,
            l.termSheets,
            l.declined,
            l.awaiting,
            <span key="hit">
              {pct(l.hitRatePct)} {l.lowSample && l.sent > 0 ? <span className="text-[12px] text-titanium">(small sample)</span> : null}
            </span>,
            pct(l.responseRatePct),
            days(l.avgResponseDays),
            l.closedDealsWithTermSheet,
            l.stoppedAtGate,
          ])}
          empty="No lender outreach in this period."
        />
        <p className="mt-3 text-[13px] text-titanium">Closed deals counts deals that closed after this lender gave a term sheet on them; a deal with several term sheets counts for each lender.</p>
      </Panel>
    </div>
  );
}
