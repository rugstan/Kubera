// Credit-box edit form (server component; plain form posting to a server action).

import { Field, Select, Submit } from "@/app/(staff)/deals/ui";
import { ASSET_CLASS_LABELS, assetClasses, lienPositions, recourseKinds, type CreditBox } from "@/lib/agents/lenders/types";
import { DEAL_PROGRAM_LABELS, dealPrograms, type LenderPanelEntry } from "@/lib/deals/types";
import { saveBoxAction } from "../actions";

const dollars = (cents: number | null | undefined) => (cents === null || cents === undefined ? null : String(cents / 100));

function Checks({ legend, name, options, selected }: { legend: string; name: string; options: { value: string; label: string }[]; selected: readonly string[] }) {
  return (
    <fieldset className="sm:col-span-2">
      <legend className="field-label">{legend}</legend>
      <div className="grid gap-1 sm:grid-cols-3">
        {options.map((o) => (
          <label className="flex min-h-11 items-center gap-2 text-sm" key={o.value}>
            <input className="size-4 accent-[var(--color-accent)]" defaultChecked={selected.includes(o.value)} name={name} type="checkbox" value={o.value} /> {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function BoxForm({ box, lenders }: { box: CreditBox | null; lenders: LenderPanelEntry[] }) {
  return (
    <form action={saveBoxAction} className="grid gap-4 sm:grid-cols-2">
      {box ? (
        <>
          <input name="boxId" type="hidden" value={box.id} />
          <input name="recordVersion" type="hidden" value={box.recordVersion} />
        </>
      ) : null}
      <Field defaultValue={box?.label} label="Label" name="label" placeholder="e.g. HUD 232 — West" required />
      <Select
        defaultValue={box?.lenderId ?? ""}
        label="Panel lender"
        name="lenderId"
        options={[{ value: "", label: box ? "Not linked yet" : "Choose a lender" }, ...lenders.map((l) => ({ value: l.id, label: `${l.name}${l.active ? "" : " (inactive)"}` }))]}
      />
      <Checks legend="Programs" name="programs" options={dealPrograms.map((p) => ({ value: p, label: DEAL_PROGRAM_LABELS[p] }))} selected={box?.programs ?? []} />
      <Checks legend="Asset classes (none = any)" name="assetClasses" options={assetClasses.map((a) => ({ value: a, label: ASSET_CLASS_LABELS[a] }))} selected={box?.assetClasses ?? []} />
      <Field defaultValue={box?.states.join(", ")} hint="Two-letter codes, comma separated; empty = nationwide." label="States" name="states" placeholder="CA, NV, AZ" />
      <Select defaultValue={box?.recourse ?? ""} label="Recourse" name="recourse" options={[{ value: "", label: "Not recorded" }, ...recourseKinds.map((r) => ({ value: r, label: r.replace("_", "-") }))]} />
      <Field defaultValue={dollars(box?.minLoanCents)} label="Minimum loan (USD)" name="minLoan" placeholder="2,000,000" />
      <Field defaultValue={dollars(box?.maxLoanCents)} label="Maximum loan (USD)" name="maxLoan" placeholder="40,000,000" />
      <Field defaultValue={box?.maxLtvPct} label="Max LTV (%)" name="maxLtvPct" step="any" type="number" />
      <Field defaultValue={box?.maxLtcPct} label="Max LTC (%)" name="maxLtcPct" step="any" type="number" />
      <Field defaultValue={box?.minDscr} label="Min DSCR (x)" name="minDscr" step="any" type="number" />
      <Field defaultValue={box?.minDebtYieldPct} label="Min debt yield (%)" name="minDebtYieldPct" step="any" type="number" />
      <Checks legend="Lien positions" name="lienPositions" options={lienPositions.map((l) => ({ value: l, label: `${l} lien` }))} selected={box?.lienPositions ?? ["first"]} />
      <Field defaultValue={box?.maxTermMonths} label="Max term (months)" name="maxTermMonths" type="number" />
      <Field defaultValue={box?.maxAmortizationMonths} label="Max amortization (months)" name="maxAmortizationMonths" type="number" />
      <Field defaultValue={box?.maxIoMonths} label="Max interest-only (months)" name="maxIoMonths" type="number" />
      <Field defaultValue={box?.typicalCloseDays} label="Typical days to close" name="typicalCloseDays" type="number" />
      <Field defaultValue={box?.rateMinPct} label="Indicative rate from (%)" name="rateMinPct" step="any" type="number" />
      <Field defaultValue={box?.rateMaxPct} label="Indicative rate to (%)" name="rateMaxPct" step="any" type="number" />
      <Field defaultValue={box?.originationFeePct} label="Typical origination (%)" name="originationFeePct" step="any" type="number" />
      <Field defaultValue={box?.brokerCompensationPct} hint="As the lender states it; the signed fee agreement lives on the lender panel." label="Broker compensation paid (%)" name="brokerCompensationPct" step="any" type="number" />
      <Field defaultValue={box?.franchiseRequirements} label="Franchise / flag requirements" name="franchiseRequirements" />
      <label className="block sm:col-span-2">
        <span className="field-label">Notes</span>
        <textarea className="field min-h-24" defaultValue={box?.notes ?? undefined} name="notes" />
      </label>
      <div className="sm:col-span-2">
        <Submit>{box ? "Save changes" : "Create credit box"}</Submit>
        {box?.status === "approved" ? <p className="mt-2 text-xs text-titanium">Changing the appetite sends the box back to review.</p> : null}
      </div>
    </form>
  );
}
