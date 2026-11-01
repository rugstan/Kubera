"use client";

import { useState } from "react";
import { multiple, pctOf, points, usd } from "@/lib/calculators/format";
import { indicativeRates } from "@/lib/calculators/rates";
import { calcSba504, type Sba504Field } from "@/lib/calculators/sba-504";
import type { Benchmarks } from "@/lib/rates";
import { CalcCheckbox, CalcField, CalcLayout, EmptyResults, ExampleButton, RateNote, Stat } from "./ui";
import { useFields } from "./useFields";

export function Sba504Calculator({ benchmarks, asOf, live }: { benchmarks: Benchmarks; asOf: string; live: boolean }) {
  const rates = indicativeRates(benchmarks);
  const f = useFields<Sba504Field>({ projectCost: "", bankRatePct: rates.sbaBankFirst.toFixed(2), cdcRatePct: rates.sba504Debenture.toFixed(2), noi: "" });
  const [specialPurpose, setSpecialPurpose] = useState(true);
  const [newBusiness, setNewBusiness] = useState(false);
  const [higherCap, setHigherCap] = useState(false);

  const outcome = calcSba504({
    projectCost: f.num("projectCost"),
    specialPurpose,
    newBusiness,
    higherCap,
    bankRatePct: f.num("bankRatePct"),
    cdcRatePct: f.num("cdcRatePct"),
    noi: f.optionalNum("noi"),
  });
  const err = (k: Sba504Field) => (!outcome.ok && f.shouldShow(k) ? outcome.errors[k] : undefined);

  return (
    <CalcLayout
      inputs={
        <form className="space-y-5" onSubmit={(e) => e.preventDefault()} aria-label="SBA 504 calculator inputs">
          <CalcField label="Total project cost" prefix="$" value={f.values.projectCost} onChange={(v) => f.set("projectCost", v)} onBlur={() => f.touch("projectCost")} error={err("projectCost")} placeholder="10,000,000" hint="Purchase price or construction cost plus soft costs and closing costs." />
          <fieldset className="space-y-3">
            <legend className="field-label">Project type</legend>
            <CalcCheckbox label="Special-purpose property" checked={specialPurpose} onChange={setSpecialPurpose} hint="Hotels and care facilities add 5 points of equity." />
            <CalcCheckbox label="Start-up business or new construction" checked={newBusiness} onChange={setNewBusiness} hint="Adds another 5 points of equity." />
            <CalcCheckbox label="Energy-efficient or manufacturing project" checked={higherCap} onChange={setHigherCap} hint="Qualifies for the higher debenture cap." />
          </fieldset>
          <div className="grid grid-cols-2 gap-4">
            <CalcField label="Bank first-lien rate" suffix="%" value={f.values.bankRatePct} onChange={(v) => f.set("bankRatePct", v)} onBlur={() => f.touch("bankRatePct")} error={err("bankRatePct")} />
            <CalcField label="Debenture rate" suffix="%" value={f.values.cdcRatePct} onChange={(v) => f.set("cdcRatePct", v)} onBlur={() => f.touch("cdcRatePct")} error={err("cdcRatePct")} />
          </div>
          <CalcField label="Net operating income (annual)" prefix="$" optional value={f.values.noi} onChange={(v) => f.set("noi", v)} onBlur={() => f.touch("noi")} error={err("noi")} hint="Adds coverage including SBA and servicing fees." />
          <ExampleButton onClick={() => f.fill({ ...f.values, projectCost: "10000000", noi: "1100000" })} />
          <RateNote asOf={asOf} live={live}>
            The bank rate starts at the 5-year Treasury plus a mid-range spread ({points(rates.sbaBankFirst)}); the debenture rate at the 10-year Treasury plus its spread ({points(rates.sba504Debenture)}).
          </RateNote>
        </form>
      }
      results={
        outcome.ok ? (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold tracking-tight">Indicative 504 structure</h2>
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Capital stack table">
              <table className="w-full min-w-[420px] border-collapse text-left text-[14px]">
                <caption className="sr-only">Sources of funds for the project</caption>
                <thead>
                  <tr className="border-b border-black/10">
                    <th scope="col" className="py-2 pr-3 font-semibold">Source</th>
                    <th scope="col" className="py-2 pr-3 text-right font-semibold">Amount</th>
                    <th scope="col" className="py-2 pr-3 text-right font-semibold">Share</th>
                    <th scope="col" className="py-2 text-right font-semibold">Monthly P&amp;I</th>
                  </tr>
                </thead>
                <tbody>
                  {outcome.result.tranches.map((t) => (
                    <tr key={t.label} className="border-b border-black/[0.06]">
                      <th scope="row" className="py-2.5 pr-3 font-medium">{t.label}</th>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{usd(t.amount)}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{pctOf(t.share, 0)}</td>
                      <td className="py-2.5 text-right tabular-nums">{usd(t.monthlyPayment)}</td>
                    </tr>
                  ))}
                  <tr>
                    <th scope="row" className="py-2.5 pr-3 font-medium">Borrower equity</th>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{usd(outcome.result.equityRequired)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{pctOf(outcome.result.equityRequired / f.num("projectCost"), 0)}</td>
                    <td className="py-2.5 text-right text-titanium">n/a</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Stat label="Blended rate" value={points(outcome.result.blendedRatePct)} note="Weighted by the bank and debenture amounts." />
              <Stat label="Monthly principal and interest" value={usd(outcome.result.monthlyPrincipalInterest)} note="Both loans, 25-year amortization." />
              <Stat label="Annual SBA and servicing fees" value={usd(outcome.result.annualDebentureFees)} note={`${pctOf(outcome.result.annualDebentureFees / outcome.result.tranches[1].amount, 2)} of the debenture.`} />
              <Stat label="Upfront debenture fees" value={usd(outcome.result.upfrontDebentureFees)} note="Usually financed into the debenture." />
              {outcome.result.dscr !== undefined && (
                <Stat label="Debt service coverage" value={multiple(outcome.result.dscr)} tone={outcome.result.meetsMinimumDscr ? "good" : "warn"} note={`Minimum ${multiple(outcome.result.minDscr)}, including fees.`} />
              )}
            </dl>
            {outcome.result.capBinds && (
              <p className="notice-warning rounded-xl px-4 py-3 text-[14px] leading-relaxed">
                The debenture cap of {usd(outcome.result.debentureCap)} binds, so equity is {usd(outcome.result.equityAboveMinimum)} above the program minimum. A larger bank loan or a 7(a) stack can change that; an advisor can model it.
              </p>
            )}
            <p className="text-[13px] leading-relaxed text-titanium">
              Percentages, caps and fees follow Kubera&apos;s SBA assumptions as of {outcome.result.asOf} (SBA SOP 50 10; confirm the revision in effect at application). The operating company must occupy at least 51% of the property.
            </p>
          </div>
        ) : (
          <EmptyResults>{f.values.projectCost.trim() === "" ? "Enter a project cost to see the bank loan, the SBA debenture, the equity injection and the payments." : "Fix the highlighted fields to see your results."}</EmptyResults>
        )
      }
    />
  );
}
