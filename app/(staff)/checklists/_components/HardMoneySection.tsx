import type { HmUnderwriting } from "@/lib/checklists/hm-underwriting";
import { saveHmAction } from "../actions";
import { formatScopeLines, formatTrackRecordLines } from "../_lib/hm-lines";
import { Card, pct, usd } from "./ui";

function Field({ id, label, name, defaultValue, type = "text" }: { id: string; label: string; name: string; defaultValue?: string | number; type?: string }) {
  return (
    <div>
      <label className="field-label" htmlFor={id}>{label}</label>
      <input id={id} name={name} type={type} defaultValue={defaultValue} inputMode={type === "text" ? "decimal" : undefined} className="field" />
    </div>
  );
}

export function HardMoneySection({ dealId, file }: { dealId: string; file: HmUnderwriting | null }) {
  const m = file?.metrics;
  return (
    <Card id="hard-money" title="Hard money file">
      <p className="mb-4 text-[13px] text-ink/80">The private lender funds as lender of record and administers any rehab holdback; this file supports the package Kubera presents.</p>
      {m ? (
        <div className="mb-5 grid gap-3 text-[14px] sm:grid-cols-4">
          <p>Rehab budget <strong className="block text-[17px]">{usd(m.rehabBudget)}</strong></p>
          <p>Total cost <strong className="block text-[17px]">{usd(m.totalCost)}</strong></p>
          <p>LTC / LTARV <strong className="block text-[17px]">{pct(m.ltc)} / {pct(m.ltarv)}</strong></p>
          <p>Tier ({m.verifiedProjects} verified) <strong className="block text-[17px]">{m.tier.toLowerCase()} · max {usd(m.maxLoan)}</strong></p>
          {m.flags.length ? (
            <ul className="list-disc pl-5 text-[13px] text-warning sm:col-span-4">
              {m.flags.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <form action={saveHmAction} className="grid gap-3 sm:grid-cols-4">
        <input type="hidden" name="dealId" value={dealId} />
        <input type="hidden" name="version" value={file?.version ?? ""} />
        <div>
          <label className="field-label" htmlFor="hm-strategy">Strategy</label>
          <select id="hm-strategy" name="strategy" defaultValue={file?.strategy ?? "FIX_AND_FLIP"} className="field">
            <option value="FIX_AND_FLIP">Fix and flip</option>
            <option value="BRIDGE">Bridge</option>
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="hm-purpose">Purpose</label>
          <select id="hm-purpose" name="purpose" defaultValue={file?.purpose ?? "PURCHASE"} className="field">
            <option value="PURCHASE">Purchase</option>
            <option value="REFINANCE">Refinance</option>
          </select>
        </div>
        <Field id="hm-price" label="Purchase price" name="purchasePrice" defaultValue={file?.purchasePrice} />
        <Field id="hm-asis" label="As-is value" name="asIsValue" defaultValue={file?.asIsValue} />
        <Field id="hm-arv" label="After-repair value" name="arv" defaultValue={file?.arv} />
        <div>
          <label className="field-label" htmlFor="hm-arvsrc">ARV source</label>
          <select id="hm-arvsrc" name="arvSource" defaultValue={file?.arvSource ?? "comparable_sales"} className="field">
            <option value="appraisal">Appraisal</option>
            <option value="bpo">Broker price opinion</option>
            <option value="comparable_sales">Comparable sales</option>
            <option value="sponsor_estimate">Sponsor estimate</option>
          </select>
        </div>
        <Field id="hm-loan" label="Requested loan" name="requestedLoanAmount" defaultValue={file?.requestedLoanAmount} />
        <Field id="hm-cont" label="Contingency %" name="contingencyPct" defaultValue={file?.contingencyPct ?? 10} />
        <div className="sm:col-span-4">
          <label className="field-label" htmlFor="hm-scope">Scope of work — one line each: category | description | cost | weeks | licensed (yes/no)</label>
          <textarea id="hm-scope" name="scopeOfWork" rows={4} defaultValue={file ? formatScopeLines(file.scopeOfWork) : ""} className="field font-mono text-[13px]" />
        </div>
        <div className="sm:col-span-4">
          <label className="field-label" htmlFor="hm-track">Track record — address | strategy | purchase date | price | rehab | exit date | exit type | exit value | role | verified</label>
          <textarea id="hm-track" name="trackRecord" rows={4} defaultValue={file ? formatTrackRecordLines(file.trackRecord) : ""} className="field font-mono text-[13px]" />
        </div>
        <div>
          <label className="field-label" htmlFor="hm-exit">Exit</label>
          <select id="hm-exit" name="exitType" defaultValue={file?.exitPlan.type ?? "sale"} className="field">
            <option value="sale">Sale</option>
            <option value="refinance">Refinance</option>
          </select>
        </div>
        <Field id="hm-months" label="Exit in (months)" name="exitMonths" defaultValue={file?.exitPlan.targetMonths ?? 12} />
        <Field id="hm-sale" label="Expected sale price" name="expectedSalePrice" defaultValue={file?.exitPlan.expectedSalePrice} />
        <Field id="hm-refi" label="Refinance loan" name="refinanceLoanAmount" defaultValue={file?.exitPlan.refinanceLoanAmount} />
        <div className="sm:col-span-2">
          <label className="field-label" htmlFor="hm-refiprog">Take-out program</label>
          <input id="hm-refiprog" name="refinanceProgram" defaultValue={file?.exitPlan.refinanceProgram} className="field" />
        </div>
        <div className="sm:col-span-2">
          <label className="field-label" htmlFor="hm-notes">Notes</label>
          <input id="hm-notes" name="notes" defaultValue={file?.notes} className="field" />
        </div>
        <button type="submit" className="pill pill-primary !py-2 !text-[15px] sm:col-span-4 sm:justify-self-start">Save hard money file</button>
      </form>
    </Card>
  );
}
