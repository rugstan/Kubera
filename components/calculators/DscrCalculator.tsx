"use client";

import { useState } from "react";
import { calcDscr, DSCR_PRESETS, type DscrField } from "@/lib/calculators/dscr";
import { multiple, pctOf, points, usd } from "@/lib/calculators/format";
import { indicativeRates, type IndicativeRates } from "@/lib/calculators/rates";
import type { Benchmarks } from "@/lib/rates";
import { CalcField, CalcLayout, CalcSelect, EmptyResults, ExampleButton, RateNote, Stat } from "./ui";
import { useFields } from "./useFields";

const PRESET_OPTIONS = [{ value: "custom", label: "Custom" }, ...DSCR_PRESETS.map((p) => ({ value: p.id, label: `${p.label} (${p.targetDscr.toFixed(2)}x)` }))];

export function DscrCalculator({ benchmarks, asOf, live }: { benchmarks: Benchmarks; asOf: string; live: boolean }) {
  const rates: IndicativeRates = indicativeRates(benchmarks);
  const f = useFields<DscrField>({ noi: "", loanAmount: "", ratePct: rates.agency.toFixed(2), amortYears: "30", targetDscr: "1.25", value: "" });
  const [preset, setPreset] = useState("custom");

  function choosePreset(id: string) {
    setPreset(id);
    const p = DSCR_PRESETS.find((x) => x.id === id);
    if (!p) return;
    f.set("targetDscr", String(p.targetDscr));
    f.set("amortYears", String(p.amortYears));
  }

  const outcome = calcDscr({
    noi: f.num("noi"),
    loanAmount: f.num("loanAmount"),
    ratePct: f.num("ratePct"),
    amortYears: f.num("amortYears"),
    targetDscr: f.num("targetDscr"),
    value: f.optionalNum("value"),
  });
  const err = (k: DscrField) => (!outcome.ok && f.shouldShow(k) ? outcome.errors[k] : undefined);
  const blank = f.values.noi.trim() === "" || f.values.loanAmount.trim() === "";

  return (
    <CalcLayout
      inputs={
        <form className="space-y-5" onSubmit={(e) => e.preventDefault()} aria-label="DSCR calculator inputs">
          <CalcSelect label="Lender type" value={preset} onChange={choosePreset} options={PRESET_OPTIONS} hint="Fills in a typical minimum coverage and amortization. You can change either." />
          <CalcField label="Net operating income (annual)" prefix="$" value={f.values.noi} onChange={(v) => f.set("noi", v)} onBlur={() => f.touch("noi")} error={err("noi")} placeholder="900,000" />
          <CalcField label="Loan amount" prefix="$" value={f.values.loanAmount} onChange={(v) => f.set("loanAmount", v)} onBlur={() => f.touch("loanAmount")} error={err("loanAmount")} placeholder="10,000,000" />
          <div className="grid grid-cols-2 gap-4">
            <CalcField label="Interest rate" suffix="%" value={f.values.ratePct} onChange={(v) => f.set("ratePct", v)} onBlur={() => f.touch("ratePct")} error={err("ratePct")} />
            <CalcField label="Amortization (years)" value={f.values.amortYears} onChange={(v) => f.set("amortYears", v)} onBlur={() => f.touch("amortYears")} error={err("amortYears")} inputMode="numeric" hint="Enter 0 for interest-only." />
          </div>
          <CalcField label="Required coverage" suffix="x" value={f.values.targetDscr} onChange={(v) => f.set("targetDscr", v)} onBlur={() => f.touch("targetDscr")} error={err("targetDscr")} />
          <CalcField label="Property value" prefix="$" optional value={f.values.value} onChange={(v) => f.set("value", v)} onBlur={() => f.touch("value")} error={err("value")} hint="Adds loan-to-value." />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ExampleButton onClick={() => f.fill({ noi: "900000", loanAmount: "10000000", ratePct: rates.agency.toFixed(2), amortYears: "30", targetDscr: "1.25", value: "15000000" })} />
          </div>
          <RateNote asOf={asOf} live={live}>
            The rate starts at the 10-year Treasury plus the midpoint agency spread ({points(rates.agency)}).
          </RateNote>
        </form>
      }
      results={
        outcome.ok ? (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold">Your coverage</h2>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Stat
                label="Debt service coverage"
                value={multiple(outcome.result.dscr)}
                tone={outcome.result.meetsTarget ? "good" : "warn"}
                note={outcome.result.meetsTarget ? `Meets the ${multiple(f.num("targetDscr"))} target.` : `Below the ${multiple(f.num("targetDscr"))} target.`}
              />
              <Stat label="Annual debt service" value={usd(outcome.result.annualDebtService)} note={`${usd(outcome.result.monthlyPayment)} a month`} />
              <Stat label="Debt yield" value={pctOf(outcome.result.debtYield, 2)} note="NOI divided by the loan." />
              {outcome.result.ltv !== undefined && <Stat label="Loan to value" value={pctOf(outcome.result.ltv, 1)} />}
              <Stat label="Largest loan at the target" value={usd(outcome.result.maxLoanAtTarget)} note="At this rate and amortization." />
              <Stat
                label={outcome.result.noiCushion >= 0 ? "NOI cushion" : "NOI shortfall"}
                value={usd(Math.abs(outcome.result.noiCushion))}
                tone={outcome.result.noiCushion >= 0 ? "good" : "warn"}
                note={`The loan needs ${usd(outcome.result.noiNeededForTarget)} of NOI at the target.`}
              />
            </dl>
            <p className="text-[14px] leading-relaxed text-titanium">
              NOI could fall about {pctOf(outcome.result.noiDeclineToBreakEven, 0)} before coverage reaches 1.00x.
            </p>
          </div>
        ) : (
          <EmptyResults>{blank ? "Enter net operating income and a loan amount to see coverage, debt yield and the largest loan the income supports." : "Fix the highlighted fields to see your results."}</EmptyResults>
        )
      }
    />
  );
}
