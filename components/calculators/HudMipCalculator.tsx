"use client";

import { useState } from "react";
import { multiple, pctOf, points, usd } from "@/lib/calculators/format";
import { calcHudMip, HUD_MIP_PROGRAMS, hudMipProgram, type HudMipField, type HudMipProgramId } from "@/lib/calculators/hud-mip";
import { indicativeRates } from "@/lib/calculators/rates";
import type { Benchmarks } from "@/lib/rates";
import { CalcField, CalcLayout, CalcSelect, EmptyResults, ExampleButton, RateNote, Stat } from "./ui";
import { useFields } from "./useFields";

const PROGRAM_OPTIONS = HUD_MIP_PROGRAMS.map((p) => ({ value: p.id, label: p.label }));

export function HudMipCalculator({ benchmarks, asOf, live }: { benchmarks: Benchmarks; asOf: string; live: boolean }) {
  const rates = indicativeRates(benchmarks);
  const [programId, setProgramId] = useState<HudMipProgramId>("223f");
  const program = hudMipProgram(programId);
  const f = useFields<HudMipField>({ loanAmount: "", program: "", ratePct: rates.hudMultifamily.toFixed(2), termYears: "", noi: "" });

  function chooseProgram(id: string) {
    const next = hudMipProgram(id as HudMipProgramId);
    setProgramId(next.id);
    f.set("ratePct", (next.family === "senior-living" ? rates.hud232 : rates.hudMultifamily).toFixed(2));
    f.set("termYears", "");
  }

  const outcome = calcHudMip({
    loanAmount: f.num("loanAmount"),
    program: programId,
    ratePct: f.num("ratePct"),
    termYears: f.optionalNum("termYears"),
    noi: f.optionalNum("noi"),
  });
  const err = (k: HudMipField) => (!outcome.ok && f.shouldShow(k) ? outcome.errors[k] : undefined);

  return (
    <CalcLayout
      inputs={
        <form className="space-y-5" onSubmit={(e) => e.preventDefault()} aria-label="HUD MIP calculator inputs">
          <CalcSelect label="HUD program" value={programId} onChange={chooseProgram} options={PROGRAM_OPTIONS} hint={`Annual MIP ${pctOf(program.annualMip, 2)}, upfront ${pctOf(program.upfrontMip, 2)}. Maximum term ${program.termYears} years.`} />
          <CalcField label="Loan amount" prefix="$" value={f.values.loanAmount} onChange={(v) => f.set("loanAmount", v)} onBlur={() => f.touch("loanAmount")} error={err("loanAmount")} placeholder="10,000,000" />
          <div className="grid grid-cols-2 gap-4">
            <CalcField label="Interest rate" suffix="%" value={f.values.ratePct} onChange={(v) => f.set("ratePct", v)} onBlur={() => f.touch("ratePct")} error={err("ratePct")} />
            <CalcField label="Term (years)" optional inputMode="numeric" value={f.values.termYears} onChange={(v) => f.set("termYears", v)} onBlur={() => f.touch("termYears")} error={err("termYears")} placeholder={String(program.termYears)} />
          </div>
          <CalcField label="Net operating income (annual)" prefix="$" optional value={f.values.noi} onChange={(v) => f.set("noi", v)} onBlur={() => f.touch("noi")} error={err("noi")} hint="Adds coverage with and without the premium." />
          <ExampleButton onClick={() => f.fill({ ...f.values, loanAmount: "10000000", noi: "900000", termYears: "" })} />
          <RateNote asOf={asOf} live={live}>
            The rate starts at the 10-year Treasury plus the midpoint HUD spread ({points(program.family === "senior-living" ? rates.hud232 : rates.hudMultifamily)}).
          </RateNote>
        </form>
      }
      results={
        outcome.ok ? (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold tracking-tight">Mortgage insurance premium</h2>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Stat label="Year-one annual MIP" value={usd(outcome.result.yearOneMip)} note={`${usd(outcome.result.yearOneMonthlyMip)} a month on the average balance.`} />
              <Stat label="Upfront MIP" value={usd(outcome.result.upfrontMip)} note={`${pctOf(outcome.result.program.upfrontMip, 2)} of the loan, due at closing or financed.`} />
              <Stat label="Principal and interest" value={usd(outcome.result.monthlyPrincipalInterest)} note="Per month." />
              <Stat label="Payment with MIP" value={usd(outcome.result.monthlyPaymentWithMip)} note="Per month, year one." />
              <Stat label="MIP over ten years" value={usd(outcome.result.tenYearMip)} note="Falls each year as the loan amortizes." />
              <Stat label="All-in rate, year one" value={points(outcome.result.allInRatePct)} note={`Note rate plus ${points(outcome.result.mipAsRatePoints)} of premium.`} />
              {outcome.result.dscrWithMip !== undefined && outcome.result.dscrBeforeMip !== undefined && (
                <Stat label="Coverage with MIP" value={multiple(outcome.result.dscrWithMip)} note={`${multiple(outcome.result.dscrBeforeMip)} before the premium.`} />
              )}
            </dl>
            <div className="space-y-2 text-[13px] leading-relaxed text-titanium">
              <p>
                {outcome.result.program.source}. Figures as of {outcome.result.asOf}; confirm the current premium with a HUD lender before relying on it.
              </p>
              <p>Green certification no longer lowers the HUD premium.</p>
            </div>
          </div>
        ) : (
          <EmptyResults>{f.values.loanAmount.trim() === "" ? "Enter a loan amount to see the premium, the monthly payment and how the premium falls as the loan pays down." : "Fix the highlighted fields to see your results."}</EmptyResults>
        )
      }
    />
  );
}
