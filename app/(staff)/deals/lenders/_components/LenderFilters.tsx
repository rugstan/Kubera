import { Fragment } from "react";
import { LENDER_LOAN_TYPE_DESCRIPTIONS, LENDER_LOAN_TYPE_LABELS, lenderLoanTypes, type LenderLoanType } from "@/lib/deals/loan-types";
import { LENDER_SEARCH_MAX, LENDER_SORTS, LENDER_SORT_LABELS, serializeLenderListQuery, type LenderListQuery } from "@/lib/deals/lender-list";
import { Check, Field, LoanTypeFieldset, Select, Submit } from "../../ui";
import { FilterForm, FilterLink } from "./FilterNav";

// The Lender panel's filter form (and the loan-type filter on /lenders): a GET
// next/form, so the URL is the whole state and a filtered view is a link that
// can be shared or bookmarked. The staff area streams behind Suspense and needs
// JavaScript to show its pages, so this form does not promise a no-JS path.
// The keyed fragment remounts the uncontrolled inputs whenever the query
// changes (an applied-filter link removed a chip, the back button), so they
// never show a stale tick; FilterNav then moves focus to the results summary.

export function LenderFilters({
  query,
  counts,
  action = "/deals/lenders",
  full = true,
  amountText = null,
  resultsId,
}: {
  query: LenderListQuery;
  counts: Record<LenderLoanType, number>;
  action?: string;
  full?: boolean;
  /** A loan amount from the URL that could not be read, shown back in the field instead of being dropped. */
  amountText?: string | null;
  /** The results summary's id: a "Skip to results" link on narrow screens jumps past the filters. */
  resultsId?: string;
}) {
  return (
    <Fragment key={`${serializeLenderListQuery(query)}|${amountText ?? ""}`}>
      {resultsId ? (
        <a className="mb-3 inline-flex min-h-11 items-center text-sm text-accent underline sm:sr-only sm:focus:not-sr-only" href={`#${resultsId}`}>
          Skip to results
        </a>
      ) : null}
      <FilterForm action={action} aria-label="Find lenders" className="grid gap-4" role="search" scroll={false}>
        <LoanTypeFieldset counts={counts} legend="Loan type" name="type" selected={query.types} />
        <fieldset>
          <legend className="field-label">Match</legend>
          <div className="mt-1 flex flex-wrap gap-x-5 gap-y-2">
            {(["any", "all"] as const).map((m) => (
              <label className="flex min-h-11 items-center gap-2 text-sm text-ink" key={m}>
                <input className="size-4 accent-[var(--color-accent)]" defaultChecked={query.match === m} name="match" type="radio" value={m} />
                {m === "any" ? "Any selected type" : "All selected types"}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field defaultValue={query.q} hint={full ? "Name, parent company, directory desk, asset type or contact." : "Box label or lender name."} label="Search" maxLength={LENDER_SEARCH_MAX} name="q" type="search" />
          {full ? (
            <Field
              defaultValue={amountText ?? (query.amountCents === null ? "" : String(Math.round(query.amountCents / 100)))}
              hint="For example 2.5m or $2.5MM. Lenders with no size on file stay in."
              inputMode="decimal"
              label="Loan amount (USD)"
              name="amount"
            />
          ) : null}
          {full ? <Select defaultValue={query.sort} label="Sort by" name="sort" options={LENDER_SORTS.map((s) => ({ value: s, label: LENDER_SORT_LABELS[s] }))} /> : null}
          {full ? (
            <div className="flex flex-col justify-end gap-2">
              <Check defaultChecked={query.activeOnly} label="Active lenders only" name="active" />
              <Check defaultChecked={query.lendsInCa} label="Lends in California (confirmed)" name="ca" />
              <Check defaultChecked={query.hasContact} label="Has an email or phone on file" name="contact" />
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Submit>{full ? "Show lenders" : "Show boxes"}</Submit>
          <FilterLink className="pill pill-glass min-h-11" href={action}>
            Clear all
          </FilterLink>
        </div>
        <details>
          <summary className="cursor-pointer text-sm text-accent">What the loan types mean</summary>
          <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
            {lenderLoanTypes.map((t) => (
              <div key={t}>
                <dt className="font-medium text-ink">{LENDER_LOAN_TYPE_LABELS[t]}</dt>
                <dd className="text-titanium">{LENDER_LOAN_TYPE_DESCRIPTIONS[t]}</dd>
              </div>
            ))}
          </dl>
        </details>
      </FilterForm>
    </Fragment>
  );
}
