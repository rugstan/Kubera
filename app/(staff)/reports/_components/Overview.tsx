import Link from "next/link";
import type { ReportBundle } from "@/lib/reporting/build";
import { Bar, CsvLink, DataTable, Panel, Stat, days, pct, usd0 } from "./ui";

export function Overview({ r }: { r: ReportBundle }) {
  const { pipeline, funnel, timeInStage } = r;
  const maxStage = Math.max(1, ...pipeline.byStage.map((s) => s.open));
  const maxFunnel = Math.max(1, ...funnel.map((f) => f.reached));
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <section aria-label="Pipeline summary" className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open deals" value={String(pipeline.openDeals)} hint="Active, on hold or held for counsel" />
        <Stat label="Requested loan volume" value={usd0(pipeline.openAmountCents)} hint="Size of the loans requested; Kubera does not hold or move it" />
        <Stat label={`Closed in ${r.window.label.toLowerCase()}`} value={String(pipeline.outcomes.won)} hint={usd0(pipeline.outcomes.wonAmountCents)} />
        <Stat
          label="Win rate"
          value={pct(pipeline.outcomes.winRatePct)}
          hint={`${pipeline.outcomes.won} closed, ${pipeline.outcomes.lost} lost, ${pipeline.outcomes.withdrawn} withdrawn`}
        />
      </section>

      <Panel title="Open deals by stage" description="Where every open deal sits now, in lifecycle order." action={<CsvLink report="pipeline" range={r.window.key} />}>
        <DataTable
          label="Open deals by stage"
          columns={[{ header: "Stage" }, { header: "Deals", align: "right" }, { header: "" }, { header: "Requested volume", align: "right" }]}
          rows={pipeline.byStage.map((s) => [s.label, s.open, <Bar key={s.stage} value={s.open} max={maxStage} />, usd0(s.openAmountCents)])}
          empty="No open deals."
        />
      </Panel>

      <Panel title="By program" description={`Open deals now, and deals settled in the ${r.window.label.toLowerCase()}.`}>
        <DataTable
          label="Pipeline by program"
          columns={[{ header: "Program" }, { header: "Open", align: "right" }, { header: "Open volume", align: "right" }, { header: "Closed", align: "right" }, { header: "Lost", align: "right" }, { header: "Withdrawn", align: "right" }]}
          rows={pipeline.byProgram.map((p) => [p.label, p.open, usd0(p.openAmountCents), p.won, p.lost, p.withdrawn])}
          empty="No deals yet."
        />
      </Panel>

      <Panel title="Funnel" description={`Of the deals opened in the ${r.window.label.toLowerCase()}, how many reached each milestone.`}>
        <DataTable
          label="Deal funnel"
          columns={[{ header: "Milestone" }, { header: "Deals", align: "right" }, { header: "" }, { header: "From previous", align: "right" }]}
          rows={funnel.map((f) => [f.label, f.reached, <Bar key={f.stage} value={f.reached} max={maxFunnel} />, pct(f.conversionPct)])}
          empty="No deals opened in this period."
        />
      </Panel>

      <Panel
        title="Time in stage"
        description={`Days a deal spent in each stage, for stays that ended in the ${r.window.label.toLowerCase()}, and how long the deals there now have waited.`}
        action={<CsvLink report="time-in-stage" range={r.window.key} />}
      >
        <DataTable
          label="Time in stage"
          columns={[
            { header: "Stage" },
            { header: "Stays", align: "right" },
            { header: "Mean days", align: "right" },
            { header: "Median days", align: "right" },
            { header: "90th percentile", align: "right" },
            { header: "Deals there now", align: "right" },
            { header: "Longest wait (days)", align: "right" },
          ]}
          rows={timeInStage.rows.map((s) => [s.label, s.completed, days(s.meanDays), days(s.medianDays), days(s.p90Days), s.open, days(s.oldestOpenDays)])}
          empty="No stage history yet."
        />
        <h3 className="mt-6 text-[15px] font-semibold text-ink">Waiting longer than usual</h3>
        <p className="mt-1 text-[13px] text-titanium">More than twice the stage median once it has three stays to go on; otherwise more than 30 days.</p>
        <div className="mt-3">
          <DataTable
            label="Deals waiting longer than usual"
            columns={[{ header: "Deal" }, { header: "Stage" }, { header: "Days there", align: "right" }, { header: "Stage median", align: "right" }]}
            rows={timeInStage.aging.map((a) => [
              <Link key={a.dealId} href={`/deals/${a.dealId}`} className="text-accent underline underline-offset-2">
                {a.title}
              </Link>,
              a.label,
              a.days,
              days(a.medianDays),
            ])}
            empty="Nothing is waiting longer than usual."
          />
        </div>
      </Panel>
    </div>
  );
}
