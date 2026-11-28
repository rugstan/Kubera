import Link from "next/link";
import { PLAYBOOK_LABELS } from "@/lib/deals/submission/playbooks";
import { playbookOptions } from "../_lib/fields";
import { usd } from "../_lib/format";
import { EditorSection, Facts, type SectionProps } from "./EditorSection";

export function LoanRequestSection({ view, write }: SectionProps) {
  const deal = view.ctx.deal;
  const choose = write && view.allowedPlaybooks.length > 1;
  return (
    <EditorSection
      description="What the borrower is asking for. The assumed rate and amortization only size DSCR; lenders see them as an assumption, not a quote."
      extra={
        choose ? (
          <div className="min-w-0 sm:col-span-2">
            <label className="field-label" htmlFor="field-playbook">
              Playbook
            </label>
            <select aria-describedby="field-playbook-hint" className="field" defaultValue={view.playbook} id="field-playbook" name="playbook">
              {playbookOptions(view.allowedPlaybooks).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-titanium" id="field-playbook-hint">
              Picks the sections and the checks. Changing it hides sections but keeps what they hold.
            </span>
          </div>
        ) : null
      }
      facts={
        <Facts
          note={
            <>
              Loan amount, address, state and borrower stay on the deal record.{" "}
              {write ? (
                <Link className="font-medium text-ink underline underline-offset-2" href={`/deals/${deal.id}#details`}>
                  Edit them on the deal page
                </Link>
              ) : null}
            </>
          }
          rows={[
            { label: "Loan amount (deal record)", value: deal.loanAmountCents !== null ? usd(deal.loanAmountCents) : "Not set" },
            { label: "Borrower (deal record)", value: deal.borrowerName ?? "Not set" },
            ...(choose ? [] : [{ label: "Playbook", value: PLAYBOOK_LABELS[view.playbook] }]),
          ]}
        />
      }
      id="loan_request"
      view={view}
      write={write}
    />
  );
}
