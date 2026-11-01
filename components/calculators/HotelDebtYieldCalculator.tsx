"use client";

import { useState } from "react";
import { multiple, pctOf, points, usd } from "@/lib/calculators/format";
import { calcHotelDebtYield, HOTEL_TIERS, HOTEL_TIER_LABELS, type HotelConstraint, type HotelDebtYieldField, type HotelTier } from "@/lib/calculators/hotel-debt-yield";
import { indicativeRates } from "@/lib/calculators/rates";
import type { Benchmarks } from "@/lib/rates";
import { CMBS } from "@/lib/sizing/assumptions";
import { CalcField, CalcLayout, CalcSelect, EmptyResults, ExampleButton, RateNote, Stat } from "./ui";
import { useFields } from "./useFields";

const TIER_OPTIONS = HOTEL_TIERS.map((t) => ({ value: t, label: HOTEL_TIER_LABELS[t] }));
const CONSTRAINT_LABEL: Record<HotelConstraint, string> = { DEBT_YIELD: "the debt yield floor", DSCR: "debt service coverage", LTV: "loan to value" };

export function HotelDebtYieldCalculator({ benchmarks, asOf, live }: { benchmarks: Benchmarks; asOf: string; live: boolean }) {
  const rates = indicativeRates(benchmarks);
  const f = useFields<HotelDebtYieldField>({ keys: "", adr: "", occupancyPct: "", noi: "", loanAmount: "", tier: "", value: "", ratePct: rates.hotelCmbs.toFixed(2) });
  const [tier, setTier] = useState<HotelTier>("PREMIUM_FLAG");

  const outcome = calcHotelDebtYield({
    keys: f.num("keys"),
    adr: f.num("adr"),
    occupancyPct: f.num("occupancyPct"),
    noi: f.num("noi"),
    loanAmount: f.num("loanAmount"),
    tier,
    value: f.optionalNum("value"),
    ratePct: f.num("ratePct"),
  });
  const err = (k: HotelDebtYieldField) => (!outcome.ok && f.shouldShow(k) ? outcome.errors[k] : undefined);
  const blank = ["keys", "adr", "occupancyPct", "noi", "loanAmount"].some((k) => f.values[k as HotelDebtYieldField].trim() === "");

  return (
    <CalcLayout
      inputs={
        <form className="space-y-5" onSubmit={(e) => e.preventDefault()} aria-label="Hotel debt yield calculator inputs">
          <CalcSelect label="Hotel type" value={tier} onChange={(v) => setTier(v as HotelTier)} options={TIER_OPTIONS} hint="Conduit lenders set a different debt yield floor for each." />
          <div className="grid grid-cols-2 gap-4">
            <CalcField label="Keys (rooms)" inputMode="numeric" value={f.values.keys} onChange={(v) => f.set("keys", v)} onBlur={() => f.touch("keys")} error={err("keys")} placeholder="120" />
            <CalcField label="Average daily rate" prefix="$" value={f.values.adr} onChange={(v) => f.set("adr", v)} onBlur={() => f.touch("adr")} error={err("adr")} placeholder="150" />
          </div>
          <CalcField label="Occupancy" suffix="%" value={f.values.occupancyPct} onChange={(v) => f.set("occupancyPct", v)} onBlur={() => f.touch("occupancyPct")} error={err("occupancyPct")} placeholder="70" />
          <CalcField label="Net operating income (trailing 12 months)" prefix="$" value={f.values.noi} onChange={(v) => f.set("noi", v)} onBlur={() => f.touch("noi")} error={err("noi")} placeholder="1,800,000" hint="After the FF&E reserve." />
          <CalcField label="Loan amount" prefix="$" value={f.values.loanAmount} onChange={(v) => f.set("loanAmount", v)} onBlur={() => f.touch("loanAmount")} error={err("loanAmount")} placeholder="15,000,000" />
          <div className="grid grid-cols-2 gap-4">
            <CalcField label="Property value" prefix="$" optional value={f.values.value} onChange={(v) => f.set("value", v)} onBlur={() => f.touch("value")} error={err("value")} />
            <CalcField label="Interest rate" suffix="%" value={f.values.ratePct} onChange={(v) => f.set("ratePct", v)} onBlur={() => f.touch("ratePct")} error={err("ratePct")} />
          </div>
          <ExampleButton onClick={() => f.fill({ ...f.values, keys: "120", adr: "150", occupancyPct: "70", noi: "1800000", loanAmount: "15000000", value: "26000000" })} />
          <RateNote asOf={asOf} live={live}>
            The rate starts at the 10-year Treasury plus the midpoint hotel CMBS spread ({points(rates.hotelCmbs)}); it feeds the coverage check only.
          </RateNote>
        </form>
      }
      results={
        outcome.ok ? (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold">Debt yield</h2>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Stat
                label="Debt yield"
                value={pctOf(outcome.result.debtYield, 2)}
                tone={outcome.result.meetsMinimum ? "good" : "warn"}
                note={outcome.result.meetsMinimum ? `Clears the ${pctOf(outcome.result.minDebtYield, 1)} floor.` : `Below the ${pctOf(outcome.result.minDebtYield, 1)} floor.`}
              />
              <Stat label="Largest loan at the floor" value={usd(outcome.result.maxLoanAtMinDebtYield)} note={`NOI divided by ${pctOf(outcome.result.minDebtYield, 1)}.`} />
              <Stat label="RevPAR" value={usd(outcome.result.revpar)} note="ADR times occupancy." />
              <Stat label="Rooms revenue" value={usd(outcome.result.roomsRevenue)} note="RevPAR times keys times 365." />
              <Stat label="NOI per key" value={usd(outcome.result.noiPerKey)} />
              <Stat label="Loan per key" value={usd(outcome.result.loanPerKey)} />
              <Stat label="Coverage at this rate" value={multiple(outcome.result.dscr)} note={`30-year amortization; CMBS lenders look for about ${multiple(CMBS.minDscr)}.`} />
              {outcome.result.ltv !== undefined && <Stat label="Loan to value" value={pctOf(outcome.result.ltv, 1)} />}
            </dl>
            <div className="rounded-2xl bg-white p-4 text-[14px] leading-relaxed">
              <p className="font-semibold text-ink">
                Largest loan across the CMBS limits: {usd(outcome.result.maxLoan)}
              </p>
              <p className="mt-1 text-titanium">
                {CONSTRAINT_LABEL[outcome.result.bindingConstraint].replace(/^./, (c) => c.toUpperCase())} binds. NOI of {usd(outcome.result.noiNeededForMinDebtYield)} would be needed to clear the debt yield floor on {usd(f.num("loanAmount"))}. A 10% drop in NOI moves debt yield to{" "}
                {pctOf(outcome.result.debtYieldNoiDown10, 2)}; a 10% rise to {pctOf(outcome.result.debtYieldNoiUp10, 2)}.
              </p>
            </div>
            <p className="text-[13px] leading-relaxed text-titanium">Floors, coverage and loan-to-value follow Kubera&apos;s hotel CMBS assumptions as of {outcome.result.asOf}. Each lender sets its own.</p>
          </div>
        ) : (
          <EmptyResults>{blank ? "Enter the keys, rate, occupancy, NOI and a loan amount to see debt yield and the largest loan the CMBS limits allow." : "Fix the highlighted fields to see your results."}</EmptyResults>
        )
      }
    />
  );
}
