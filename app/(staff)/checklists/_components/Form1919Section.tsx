import type { Form1919Prefill } from "@/lib/principals/form1919";
import { Badge, Card, usd } from "./ui";

// SBA Form 1919 prefill: what Corin can hand the lender of record from the
// chart and the portal, and what is still missing. Tax ids and birth dates
// show only as "on file"; the lender collects them on the signed form.

export function Form1919Section({ prefill }: { prefill: Form1919Prefill }) {
  const a = prefill.applicant;
  return (
    <Card id="form-1919" title="SBA Form 1919 prefill" actions={<Badge tone={prefill.complete ? "good" : "warn"}>{prefill.complete ? "Complete" : `${prefill.missing.length} missing`}</Badge>}>
      <dl className="grid gap-x-6 gap-y-2 text-[14px] sm:grid-cols-2">
        <div>
          <dt className="text-ink/80">Applicant</dt>
          <dd>{a.legalName ?? "—"} {a.formationState ? `(${a.formationState})` : ""}</dd>
        </div>
        <div>
          <dt className="text-ink/80">Loan request</dt>
          <dd>{usd(a.loanAmount)}</dd>
        </div>
      </dl>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-[14px]">
          <thead className="text-[13px] text-ink/80">
            <tr>
              <th scope="col" className="py-2 pr-3 font-medium">Owner or controlling person</th>
              <th scope="col" className="py-2 pr-3 font-medium">Share</th>
              <th scope="col" className="py-2 pr-3 font-medium">Tax id / DOB</th>
              <th scope="col" className="py-2 font-medium">Missing or flagged</th>
            </tr>
          </thead>
          <tbody>
            {prefill.owners.map((o) => (
              <tr key={o.principalId} className="border-t border-black/10 align-top">
                <td className="py-2 pr-3">
                  {o.name}
                  {o.title ? <span className="block text-[12px] text-ink/80">{o.title}</span> : null}
                </td>
                <td className="py-2 pr-3">{o.ownershipPct}%</td>
                <td className="py-2 pr-3">{o.kind === "individual" ? `${o.taxIdOnFile ? "on file" : "missing"} / ${o.dateOfBirthOnFile ? "on file" : "missing"}` : "entity"}</td>
                <td className="py-2">
                  {[...o.missing, ...o.yesAnswers.map((y) => `“Yes”: ${y}`)].join(" · ") || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {prefill.missing.length ? <p className="mt-3 text-[13px] text-ink/80">Still needed: {prefill.missing.join("; ")}.</p> : null}
    </Card>
  );
}
