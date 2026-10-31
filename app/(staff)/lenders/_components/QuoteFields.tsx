// Quote term inputs shared by "add a quote" and the review form for parsed quotes.

import { Select } from "@/app/(staff)/deals/ui";
import { bindingConstraints, prepayKinds, recourseKinds, type QuoteTerms } from "@/lib/agents/lenders/types";
import type { LenderPanelEntry } from "@/lib/deals/types";

const dollars = (cents: number | null | undefined) => (cents === null || cents === undefined || cents === 0 ? null : String(cents / 100));
const opt = (n: number | null | undefined) => (n === null || n === undefined ? null : n);
const nonZero = (n: number | null | undefined) => (n ? n : null);

type FieldProps = { idPrefix: string; label: string; name: string; type?: string; defaultValue?: string | number | null; required?: boolean; placeholder?: string; step?: string; hint?: string };

/** Text input whose hint id carries a per-form prefix (several quote forms share a page). */
function QField({ idPrefix, label, name, type = "text", defaultValue, required, placeholder, step, hint }: FieldProps) {
  const hintId = hint ? `${idPrefix}-${name}-hint` : undefined;
  return (
    <label className="block">
      <span className="field-label">
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </span>
      <input aria-describedby={hintId} className="field" defaultValue={defaultValue ?? undefined} name={name} placeholder={placeholder} required={required} step={step} type={type} />
      {hint ? (
        <span className="mt-1 block text-xs text-titanium" id={hintId}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export function QuoteFields({ terms, lenders, lenderId, flagged = [], idPrefix }: { terms: QuoteTerms | null; lenders: LenderPanelEntry[]; lenderId: string | null; flagged?: readonly string[]; idPrefix: string }) {
  const t = terms;
  const hint = (field: string) => (flagged.includes(field) ? "Check this value: parsed with low confidence." : undefined);
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Select defaultValue={lenderId ?? ""} label="Panel lender" name="lenderId" options={[{ value: "", label: "Not on the panel" }, ...lenders.map((l) => ({ value: l.id, label: l.name }))]} />
      <QField idPrefix={idPrefix} defaultValue={t?.lenderName} hint={hint("lender")} label="Lender name (if not on the panel)" name="lenderName" />
      <QField idPrefix={idPrefix} defaultValue={dollars(t?.loanAmountCents)} hint={hint("loanAmount")} label="Loan amount (USD)" name="loanAmount" required />
      <Select defaultValue={t?.rateType ?? "fixed"} label="Rate type" name="rateType" options={[{ value: "fixed", label: "Fixed" }, { value: "floating", label: "Floating" }]} />
      <QField idPrefix={idPrefix} defaultValue={t?.ratePct || null} hint={hint("ratePct")} label="All-in note rate (%)" name="ratePct" required step="any" type="number" />
      <QField idPrefix={idPrefix} defaultValue={t?.indexName} label="Index (floating)" name="indexName" placeholder="SOFR" />
      <QField idPrefix={idPrefix} defaultValue={opt(t?.spreadBps)} label="Spread (bps)" name="spreadBps" type="number" />
      <QField idPrefix={idPrefix} defaultValue={opt(t?.rateFloorPct)} label="Rate floor (%)" name="rateFloorPct" step="any" type="number" />
      <QField idPrefix={idPrefix} defaultValue={t?.termMonths || null} hint={hint("termMonths")} label="Term (months)" name="termMonths" required type="number" />
      <QField idPrefix={idPrefix} defaultValue={opt(t?.amortizationMonths)} hint="Blank = interest-only to maturity." label="Amortization (months)" name="amortizationMonths" type="number" />
      <QField idPrefix={idPrefix} defaultValue={nonZero(t?.ioMonths)} label="Interest-only (months)" name="ioMonths" type="number" />
      <QField idPrefix={idPrefix} defaultValue={nonZero(t?.originationFeePct)} hint={hint("originationFeePct")} label="Origination (%)" name="originationFeePct" step="any" type="number" />
      <QField idPrefix={idPrefix} defaultValue={dollars(t?.lenderFeesCents)} hint={hint("lenderFees")} label="Lender fees (USD)" name="lenderFees" />
      <QField idPrefix={idPrefix} defaultValue={dollars(t?.thirdPartyCostsCents)} label="Third-party reports (USD)" name="thirdPartyCosts" />
      <QField idPrefix={idPrefix} defaultValue={dollars(t?.brokerFeeCents)} hint="Only a borrower-paid broker fee; lender-paid compensation is not a borrower cost." label="Borrower-paid broker fee (USD)" name="brokerFee" />
      <QField idPrefix={idPrefix} defaultValue={dollars(t?.upfrontReservesCents)} label="Reserves funded at closing (USD)" name="upfrontReserves" />
      <QField idPrefix={idPrefix} defaultValue={dollars(t?.monthlyReservesCents)} label="Monthly reserve deposits (USD)" name="monthlyReserves" />
      <QField idPrefix={idPrefix} defaultValue={nonZero(t?.exitFeePct)} label="Exit fee (%)" name="exitFeePct" step="any" type="number" />
      <Select defaultValue={t?.prepay.kind ?? "none"} label="Prepayment" name="prepayKind" options={prepayKinds.map((p) => ({ value: p, label: p.replace(/_/g, " ") }))} />
      <QField idPrefix={idPrefix} defaultValue={t?.prepay.schedule.join("-") || null} label="Step-down schedule (%)" name="prepaySchedule" placeholder="5-4-3-2-1" />
      <QField idPrefix={idPrefix} defaultValue={opt(t?.prepay.months)} label="Lockout / minimum interest (months)" name="prepayMonths" type="number" />
      <QField idPrefix={idPrefix} defaultValue={nonZero(t?.mipUpfrontPct)} label="Upfront MIP (%)" name="mipUpfrontPct" step="any" type="number" />
      <QField idPrefix={idPrefix} defaultValue={nonZero(t?.mipAnnualPct)} label="Annual MIP (%)" name="mipAnnualPct" step="any" type="number" />
      <Select defaultValue={t?.recourse ?? ""} label="Recourse" name="recourse" options={[{ value: "", label: "Not stated" }, ...recourseKinds.map((r) => ({ value: r, label: r.replace("_", "-") }))]} />
      <QField idPrefix={idPrefix} defaultValue={opt(t?.maxLtvPct)} label="Max LTV (%)" name="maxLtvPct" step="any" type="number" />
      <QField idPrefix={idPrefix} defaultValue={opt(t?.minDscr)} label="Min DSCR (x)" name="minDscr" step="any" type="number" />
      <QField idPrefix={idPrefix} defaultValue={opt(t?.minDebtYieldPct)} label="Min debt yield (%)" name="minDebtYieldPct" step="any" type="number" />
      <Select defaultValue={t?.bindingConstraint ?? ""} label="Binding constraint" name="bindingConstraint" options={[{ value: "", label: "Not stated" }, ...bindingConstraints.map((b) => ({ value: b, label: b.replace("_", " ") }))]} />
      <QField idPrefix={idPrefix} defaultValue={opt(t?.timelineDays)} label="Days to close (lender's estimate)" name="timelineDays" type="number" />
      <QField idPrefix={idPrefix} defaultValue={t?.expiresOn} label="Quote expires" name="expiresOn" type="date" />
      <label className="block sm:col-span-3">
        <span className="field-label">Other terms</span>
        <textarea className="field min-h-20" defaultValue={t?.notes ?? undefined} name="notes" />
      </label>
    </div>
  );
}
