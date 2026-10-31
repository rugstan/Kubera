import type { ReportBundle } from "@/lib/reporting/build";
import { BOOKED_STATUSES } from "@/lib/reporting/fees";
import { Bar, CsvLink, DataTable, Panel, Pill, Stat, usd } from "./ui";

export function FeesView({ r }: { r: ReportBundle }) {
  const { booked, outlook } = r.fees;
  const maxMonth = Math.max(1, ...booked.byMonth.map((m) => m.grossCents));
  const recon = r.reconciliation;
  return (
    <div className="grid gap-5">
      <p className="max-w-3xl text-[14px] text-titanium">
        Kubera&apos;s own compensation as recorded in the fee ledger, paid by the borrower or the lender on the closing statement. Kubera never holds or
        moves loan funds. Void entries are never counted.
      </p>
      <section aria-label="Fee summary" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={`Booked income, ${r.window.label.toLowerCase()}`} value={usd(booked.total.grossCents)} hint={`${booked.entries} ledger ${booked.entries === 1 ? "entry" : "entries"}`} />
        <Stat label="Partner shares" value={usd(booked.total.partnerSharesCents)} hint="Co-broker and referral splits Kubera owes" />
        <Stat label="Booked net" value={usd(booked.total.netCents)} hint={`${usd(booked.incomeByStatus.settled)} settled`} />
        <Stat label="Expected from here" value={usd(outlook.expectedNetCents)} hint="Receivable plus stage-weighted projections, net of partner shares" />
      </section>

      <Panel title="Booked by month" description="Earned, invoiced and settled entries by the day they were earned (Pacific time)." action={<CsvLink report="fees" range={r.window.key} />}>
        <DataTable
          label="Booked fees by month"
          columns={[{ header: "Month" }, { header: "Income", align: "right" }, { header: "" }, { header: "Partner shares", align: "right" }, { header: "Net", align: "right" }, { header: "Settled", align: "right" }]}
          rows={booked.byMonth.map((m) => [m.month, usd(m.grossCents), <Bar key={m.month} value={m.grossCents} max={maxMonth} />, usd(m.partnerSharesCents), usd(m.netCents), usd(m.settledCents)])}
        />
        <p className="mt-3 text-[13px] text-titanium">
          By status: {BOOKED_STATUSES.map((s) => `${s} ${usd(booked.incomeByStatus[s])}`).join(", ")}.
        </p>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="By fee type">
          <DataTable
            label="Booked fees by type"
            columns={[{ header: "Type" }, { header: "Income", align: "right" }, { header: "Partner shares", align: "right" }]}
            rows={booked.byKind.map((k) => [k.label, usd(k.grossCents), usd(k.partnerSharesCents)])}
          />
        </Panel>
        <Panel title="By program">
          <DataTable
            label="Booked fees by program"
            columns={[{ header: "Program" }, { header: "Income", align: "right" }, { header: "Net", align: "right" }]}
            rows={booked.byProgram.map((p) => [p.label, usd(p.grossCents), usd(p.netCents)])}
          />
        </Panel>
      </div>

      <Panel
        title="Outlook"
        description={`Receivable is earned or invoiced and not yet settled: ${usd(outlook.receivableCents)}. Projected fees are weighted by how far along their deal is, so a fee on a deal in intake counts for little and one at firm commitment for most of its value.`}
      >
        <DataTable
          label="Projected fees by deal stage"
          columns={[{ header: "Deal stage" }, { header: "Deals", align: "right" }, { header: "Weight", align: "right" }, { header: "Projected", align: "right" }, { header: "Weighted", align: "right" }, { header: "Partner shares (weighted)", align: "right" }]}
          rows={outlook.byStage.map((s) => [s.label, s.deals, `${s.probabilityPct}%`, usd(s.projectedCents), usd(s.weightedCents), usd(s.partnerSharesWeightedCents)])}
          empty="No projected fees."
        />
        <dl className="mt-4 grid gap-x-8 gap-y-1 text-[14px] sm:grid-cols-2">
          <div className="flex justify-between gap-3">
            <dt className="text-titanium">Receivable</dt>
            <dd className="tabular-nums text-ink">{usd(outlook.receivableCents)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-titanium">Weighted projected</dt>
            <dd className="tabular-nums text-ink">{usd(outlook.weightedProjectedCents)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-titanium">Expected income</dt>
            <dd className="tabular-nums text-ink">{usd(outlook.expectedGrossCents)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-titanium">Partner shares owed (receivable + weighted)</dt>
            <dd className="tabular-nums text-ink">{usd(outlook.receivablePartnerSharesCents + outlook.weightedPartnerSharesCents)}</dd>
          </div>
        </dl>
        <details className="mt-4 text-[14px]">
          <summary className="cursor-pointer font-medium text-accent">How the weights are set</summary>
          <p className="mt-2 max-w-3xl text-titanium">
            The weights are a planning assumption, not a prediction and not a commitment to anyone. Change them in lib/reporting/fees.ts as the desk&apos;s own
            funnel history builds up. A stage the table does not know is weighted {r.fees.assumptions.defaultBp / 100}%.
          </p>
          <ul className="mt-2 grid gap-x-6 sm:grid-cols-2">
            {Object.entries(r.fees.assumptions.stageProbabilityBp).map(([stage, bp]) => (
              <li key={stage} className="flex justify-between gap-3 text-ink">
                <span>{stage.replace(/_/g, " ")}</span>
                <span className="tabular-nums">{bp / 100}%</span>
              </li>
            ))}
          </ul>
        </details>
      </Panel>

      <Panel title="Reconciles with the ledger" description="Every figure above is recomputed from the raw ledger rows and compared.">
        <p className="flex flex-wrap items-center gap-2 text-[14px]" role="status">
          {recon.ok ? <Pill tone="good">All {recon.checks.length} checks match</Pill> : <Pill tone="warn">{recon.checks.filter((c) => !c.ok).length} of {recon.checks.length} checks do not match</Pill>}
          <span className="text-titanium">{r.fees.voidedEntries} void {r.fees.voidedEntries === 1 ? "entry" : "entries"} ({usd(r.fees.voidedCents)}) left out.</span>
        </p>
        <details className="mt-3 text-[14px]" open={!recon.ok}>
          <summary className="cursor-pointer font-medium text-accent">Show the checks</summary>
          <div className="mt-2">
            <DataTable
              label="Reconciliation checks"
              columns={[{ header: "Check" }, { header: "Ledger", align: "right" }, { header: "Report", align: "right" }, { header: "Result" }]}
              rows={recon.checks.map((c) => [
                <span key={c.name}>
                  {c.name}
                  {c.detail ? <span className="block text-[13px] font-normal text-titanium">{c.detail}</span> : null}
                </span>,
                c.expectedCents === null ? "—" : usd(c.expectedCents),
                c.actualCents === null ? "—" : usd(c.actualCents),
                c.ok ? <Pill key="ok" tone="good">Match</Pill> : <Pill key="bad" tone="warn">Does not match</Pill>,
              ])}
            />
          </div>
        </details>
      </Panel>
    </div>
  );
}
