import type { ConversionView } from "@/lib/construction/service";
import { STABILIZATION } from "@/lib/construction/conversion";
import {
  HUD_COST_CERT_LABELS,
  HUD_COST_CERT_STATUSES,
  PAYOFF_LABELS,
  PAYOFF_STATUSES,
  PHASE_LABELS,
  PROJECT_PHASES,
  type ConstructionProject,
} from "@/lib/construction/types";
import { conversionAction, leaseUpAction, phaseAction, takeoutAction } from "../actions";
import { ActionForm, Hidden, SelectField, TextAreaField, TextField } from "./ActionForm";
import { Card, Chip, formatDate, Notice, Stat } from "./ui";

const REASON_TEXT = {
  stabilized_occupancy: "Stabilized occupancy",
  maturity_runway: "Loan maturity is close",
  extension_deadline: "Extension deadline is close",
  manual: "Started by staff",
} as const;

export function ConversionSection({ project, view }: { project: ConstructionProject; view: ConversionView }) {
  const { conversion, metrics, evaluation, takeout, snapshots } = view;
  const hud = conversion.takeoutPath === "hud_conversion";
  return (
    <>
      <Card
        id="project-phase"
        title="Where the project is"
        lead="Corin's work ends at closing and resumes at conversion. The lender of record funds and administers the construction loan."
      >
        <ActionForm action={phaseAction} submitLabel="Update phase" variant="glass" className="max-w-md">
          <Hidden name="projectId" value={project.id} />
          <SelectField name="phase" label="Phase" defaultValue={project.phase} options={PROJECT_PHASES.map((p) => ({ value: p, label: PHASE_LABELS[p] }))} />
        </ActionForm>
      </Card>

      <Card
        id="conversion"
        title="Conversion and payoff"
        lead={hud ? "This HUD loan converts in place at final endorsement after HUD approves the cost certification. No refinance is needed." : "Tracks the certificate of occupancy, the construction loan's dates and the status of the take-out lender paying it off."}
      >
        <ActionForm action={conversionAction} submitLabel="Save conversion details" className="grid gap-4 md:grid-cols-3">
          <Hidden name="projectId" value={project.id} />
          <TextField name="coDate" label="Certificate of occupancy date" type="date" defaultValue={conversion.coDate} />
          <TextField name="unitsTotal" label="Total units" type="number" inputMode="numeric" defaultValue={conversion.unitsTotal} />
          <SelectField
            name="takeoutPath"
            label="How the loan is taken out"
            defaultValue={conversion.takeoutPath}
            options={[
              { value: "refinance", label: "Refinance with a permanent lender" },
              { value: "hud_conversion", label: "HUD converts in place" },
            ]}
          />
          <TextField name="loanMaturityDate" label="Construction loan maturity" type="date" defaultValue={conversion.loanMaturityDate} />
          <TextField name="extensionDeadline" label="Extension option deadline" type="date" defaultValue={conversion.extensionDeadline} />
          <SelectField
            name="hudCostCertStatus"
            label="HUD cost certification"
            defaultValue={conversion.hudCostCertStatus}
            options={HUD_COST_CERT_STATUSES.map((s) => ({ value: s, label: HUD_COST_CERT_LABELS[s] }))}
            hint={hud ? undefined : "Applies to HUD loans that convert in place."}
          />
          <SelectField name="payoffStatus" label="Payoff" defaultValue={conversion.payoffStatus} options={PAYOFF_STATUSES.map((s) => ({ value: s, label: PAYOFF_LABELS[s] }))} />
          <TextField name="payoffTargetDate" label="Target payoff date" type="date" defaultValue={conversion.payoffTargetDate} />
          <TextAreaField name="notes" label="Notes" defaultValue={conversion.notes} className="md:col-span-3" />
        </ActionForm>
        <p className="mt-3 text-[13px] text-titanium">
          Payoff is recorded only when the lender of record confirms it. Corin does not receive, hold or send payoff funds.
        </p>
      </Card>

      <Card
        id="leaseup"
        title="Lease-up"
        lead={`Stabilized means at least ${STABILIZATION.occupancyPct}% occupied for ${STABILIZATION.sustainedDays} days. Confirm the take-out lender's own test before telling a borrower they are ready.`}
        action={metrics.stabilized ? <Chip tone="good">Stabilized</Chip> : <Chip tone="neutral">Not stabilized</Chip>}
      >
        {metrics.asOf ? (
          <dl className="grid grid-cols-2 gap-5 md:grid-cols-4">
            <Stat label="Occupied" value={`${metrics.occupancyPct}%`} note={`${metrics.unitsOccupied} of ${metrics.unitsTotal} units, as of ${formatDate(metrics.asOf)}`} />
            <Stat label="Leased" value={`${metrics.leasedPct}%`} note={`${metrics.unitsLeased} units`} />
            <Stat label="Absorption" value={metrics.absorptionPerMonth === null ? "Needs 2 weeks of data" : `${metrics.absorptionPerMonth} units / month`} />
            <Stat
              label={metrics.stabilized ? "Stabilized since" : "Projected stabilization"}
              value={formatDate(metrics.stabilized ? metrics.stabilizedSince : metrics.projectedStabilizationDate)}
              note={metrics.stabilized ? undefined : `${metrics.daysAtThreshold} of ${STABILIZATION.sustainedDays} days at target`}
            />
          </dl>
        ) : (
          <p className="text-[15px] text-titanium">No snapshots yet. Add the first one below.</p>
        )}
        {metrics.stale && metrics.asOf && <p className="mt-3 text-[14px] text-warning">The latest snapshot is more than {STABILIZATION.staleSnapshotDays} days old.</p>}

        <ActionForm action={leaseUpAction} submitLabel="Save snapshot" className="mt-6 grid gap-4 md:grid-cols-5">
          <Hidden name="projectId" value={project.id} />
          <TextField name="asOf" label="As of" type="date" required />
          <TextField name="unitsLeased" label="Units leased" type="number" inputMode="numeric" required />
          <TextField name="unitsOccupied" label="Units occupied" type="number" inputMode="numeric" required />
          <TextField name="avgMonthlyRent" label="Average monthly rent" inputMode="decimal" hint="Per occupied unit" />
          <TextField name="noiT3Annualized" label="Trailing 3-month NOI, annualized" inputMode="decimal" />
        </ActionForm>

        {snapshots.length > 0 && (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-[14px]">
              <caption className="sr-only">Lease-up snapshots</caption>
              <thead className="text-titanium">
                <tr>
                  <th scope="col" className="py-2 pr-4 font-medium">As of</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Leased</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Occupied</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Avg rent</th>
                  <th scope="col" className="py-2 font-medium">T3 NOI (annualized)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/10">
                {[...snapshots].reverse().map((s) => (
                  <tr key={s.id}>
                    <td className="py-2 pr-4">{formatDate(s.asOf)}</td>
                    <td className="py-2 pr-4">{s.unitsLeased}</td>
                    <td className="py-2 pr-4">{s.unitsOccupied}</td>
                    <td className="py-2 pr-4">{s.avgMonthlyRent === null ? "n/a" : `$${s.avgMonthlyRent.toLocaleString("en-US")}`}</td>
                    <td className="py-2">{s.noiT3Annualized === null ? "n/a" : `$${s.noiT3Annualized.toLocaleString("en-US")}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card id="takeout" title="Take-out refinance" lead="When the loan is ready to be taken out, open a new refinance deal. Lender outreach on that deal still needs broker approval.">
        <ul className="space-y-1 text-[15px] text-titanium">
          {evaluation.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>

        {takeout ? (
          <div className="mt-5 space-y-4">
            <Notice tone={takeout.status === "triggered" ? "warn" : takeout.status === "deal_created" ? "good" : "neutral"} title={takeout.status === "triggered" ? "Take-out trigger is open" : takeout.status === "deal_created" ? "Refinance deal opened" : "Trigger dismissed"}>
              <p>{takeout.reasons.map((r) => REASON_TEXT[r]).join("; ") || "No reason recorded"}.</p>
              {takeout.suggestedPrograms.length > 0 && <p className="mt-1">Programs to approach: {takeout.suggestedPrograms.map((p) => p.replaceAll("_", " ")).join(", ")}.</p>}
              {takeout.newDealId && <p className="mt-1">New deal id: {takeout.newDealId}</p>}
            </Notice>
            {takeout.status === "triggered" && (
              <div className="flex flex-wrap gap-3">
                <ActionForm action={takeoutAction} submitLabel="Open refinance deal" pendingLabel="Opening">
                  <Hidden name="projectId" value={project.id} />
                  <Hidden name="intent" value="create_deal" />
                </ActionForm>
                <ActionForm action={takeoutAction} submitLabel="Dismiss" variant="glass">
                  <Hidden name="projectId" value={project.id} />
                  <Hidden name="intent" value="dismiss" />
                </ActionForm>
              </div>
            )}
            {takeout.status === "dismissed" && (
              <ActionForm action={takeoutAction} submitLabel="Reopen" variant="glass">
                <Hidden name="projectId" value={project.id} />
                <Hidden name="intent" value="manual" />
              </ActionForm>
            )}
          </div>
        ) : evaluation.applicable ? (
          <div className="mt-5 flex flex-wrap gap-3">
            <ActionForm action={takeoutAction} submitLabel="Re-run the check" variant="glass">
              <Hidden name="projectId" value={project.id} />
              <Hidden name="intent" value="evaluate" />
            </ActionForm>
            <ActionForm action={takeoutAction} submitLabel="Start the take-out now" variant="glass">
              <Hidden name="projectId" value={project.id} />
              <Hidden name="intent" value="manual" />
            </ActionForm>
          </div>
        ) : null}
      </Card>
    </>
  );
}
