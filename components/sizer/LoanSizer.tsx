"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { openCommandBar } from "@/components/ask/events";
import type { Benchmarks } from "@/lib/rates";
import { disclosures } from "@/lib/site";
import { sizeHospitality, sizeMultifamily, sizeSenior, usd } from "@/lib/sizing/programs";
import type { HospitalityInputs, MultifamilyInputs, SeniorInputs, SizingResult } from "@/lib/sizing/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { MoneyField, RangeField, Segmented, SelectField, Toggle } from "./fields";
import { QuoteCard } from "./QuoteCard";

type Tab = "senior" | "hospitality" | "multifamily";

const TABS: { id: Tab; label: string; short: string }[] = [
  { id: "senior", label: "Senior Living & Care", short: "Senior Living" },
  { id: "hospitality", label: "Hospitality & Hotels", short: "Hotels" },
  { id: "multifamily", label: "Multifamily & CRE", short: "Multifamily" },
];

const SENIOR_DEFAULT: SeniorInputs = {
  facilityType: "ASSISTED_LIVING",
  beds: 58,
  occupancyPct: 91,
  loanAmount: 2_500_000,
  noi: 420_000,
  value: 3_400_000,
  transaction: "REFINANCE",
  nonRecourseOnly: false,
  green: false,
};

const HOTEL_DEFAULT: HospitalityInputs = {
  keys: 110,
  tier: "PREMIUM_FLAG",
  loanAmount: 14_500_000,
  noi: 2_050_000,
  adr: 159,
  occupancyPct: 74,
  pipBudget: 2_200_000,
  value: 16_000_000,
  transaction: "PURCHASE",
  nonRecourseOnly: false,
  green: true,
};

const MF_DEFAULT: MultifamilyInputs = {
  assetType: "MULTIFAMILY",
  units: 120,
  sqft: 110_000,
  loanAmount: 20_000_000,
  noi: 1_750_000,
  value: 29_000_000,
  totalCost: undefined,
  transaction: "REFINANCE",
  affordable: false,
  green: false,
};

export function LoanSizer({ benchmarks, live }: { benchmarks: Benchmarks; live: boolean }) {
  const [tab, setTab] = useState<Tab>("senior");
  const [senior, setSenior] = useState(SENIOR_DEFAULT);
  const [hotel, setHotel] = useState(HOTEL_DEFAULT);
  const [mf, setMf] = useState(MF_DEFAULT);

  const result: SizingResult = useMemo(() => {
    if (tab === "senior") return sizeSenior(senior, benchmarks);
    if (tab === "hospitality") return sizeHospitality(hotel, benchmarks);
    return sizeMultifamily(mf, benchmarks);
  }, [tab, senior, hotel, mf, benchmarks]);

  const inputs = tab === "senior" ? senior : tab === "hospitality" ? hotel : mf;
  const best = result.quotes.find((q) => q.id === result.bestFit);

  const dealContext = () =>
    JSON.stringify({
      vertical: TABS.find((t) => t.id === tab)?.label,
      inputs,
      estimatedValue: Math.round(result.value),
      bestFit: best && { program: best.name, loanAmount: best.loanAmount, noteRatePct: Number(best.ratePct.toFixed(2)), term: best.termLabel, amortization: best.amortLabel, recourse: best.recourse, annualFee: best.annualFee, annualAudit: best.annualAudit, closingCosts: Math.round(best.closingCosts), tranches: best.tranches.map((t) => ({ label: t.label, amount: Math.round(t.amount), ratePct: Number(t.ratePct.toFixed(2)) })) },
      alternatives: result.quotes.filter((q) => q.eligible && q.id !== best?.id).map((q) => ({ program: q.name, loanAmount: q.loanAmount, noteRatePct: Number(q.ratePct.toFixed(2)) })),
      benchmarks,
    });

  const expressHref = useMemo(() => {
    const p = new URLSearchParams({ loan: String(inputs.loanAmount), noi: String(inputs.noi) });
    if (tab === "senior") p.set("asset", senior.facilityType === "RCFE" ? "RCFE" : senior.facilityType);
    else if (tab === "hospitality") p.set("asset", hotel.tier === "BOUTIQUE_INDEPENDENT" ? "HOTEL_BOUTIQUE" : "HOTEL_FLAGGED");
    else p.set("asset", mf.assetType);
    return `/express?${p}`;
  }, [tab, inputs, senior.facilityType, hotel.tier, mf.assetType]);

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
      <TabsList className="mx-auto flex w-fit max-w-full overflow-x-auto rounded-full bg-black/[0.05] p-1" aria-label="Asset class">
        {TABS.map((t) => (
          <TabsTrigger
            key={t.id}
            value={t.id}
            className={`relative min-h-11 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors md:px-6 ${tab === t.id ? "text-ink" : "text-ink/70 hover:text-ink"}`}
          >
            {tab === t.id && <motion.span layoutId="sizer-tab" className="absolute inset-0 -z-0 rounded-full bg-white shadow-sm" transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
            <span className="relative z-10"><span className="hidden sm:inline">{t.label}</span><span className="sm:hidden">{t.short}</span></span>
          </TabsTrigger>
        ))}
      </TabsList>

      {/* One panel whose value follows the active tab; inputs live in this
          component's state, so switching tabs never loses what was typed. */}
      <TabsContent value={tab} className="mt-10 grid gap-6 lg:grid-cols-[360px_1fr]">
        <aside className="bento h-fit space-y-5 p-6 lg:sticky lg:top-20">
          {tab === "senior" && <SeniorForm v={senior} set={setSenior} />}
          {tab === "hospitality" && <HotelForm v={hotel} set={setHotel} />}
          {tab === "multifamily" && <MultifamilyForm v={mf} set={setMf} />}
          <div className="rounded-2xl bg-black/[0.03] p-4">
            <p className="eyebrow !text-xs">Underwriting snapshot</p>
            <dl className="mt-2 space-y-1 text-[13px]">
              <div className="flex justify-between"><dt className="text-ink/70">{result.valueEstimated ? "Est. value (from cap rate)" : "Value / cost basis"}</dt><dd className="tabular-nums">{usd(result.value)}</dd></div>
              {result.metrics.map((m) => (
                <div key={m.label} className="flex justify-between"><dt className="text-ink/70">{m.label}</dt><dd className="tabular-nums">{m.value}</dd></div>
              ))}
            </dl>
          </div>
        </aside>

        <div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {result.quotes.map((q, i) => (
              <QuoteCard key={`${tab}-${q.id}`} q={q} best={q.id === result.bestFit} index={i} />
            ))}
          </div>

          <div className="mt-6 flex flex-col items-start justify-between gap-4 rounded-3xl bg-ink p-6 text-white md:flex-row md:items-center">
            <div>
              <p className="text-lg font-semibold">{best ? `${best.name} looks strongest: ${usd(best.loanAmount)} at ~${best.ratePct.toFixed(2)}%.` : "No structure fits yet — adjust the inputs or talk to us."}</p>
              <p className="text-sm text-white/60">Rates use {live ? "today's" : "indicative"} Treasury, SOFR, and Prime benchmarks.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!best}
                data-ask-entry
                onClick={() => openCommandBar({ mode: "term_sheet", dealContext: dealContext(), prompt: `Draft an indicative term sheet for the ${best?.name} structure.`, autoSubmit: true })}
                className="pill bg-white !py-2.5 !text-[15px] text-ink hover:bg-white/90 disabled:opacity-40"
              >
                Generate term sheet
              </button>
              <Link href={expressHref} className="pill pill-primary !py-2.5 !text-[15px]">Get real terms</Link>
            </div>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-titanium">{disclosures.indicative}</p>
        </div>
      </TabsContent>
    </Tabs>
  );
}

type FormProps<T> = { v: T; set: (fn: (prev: T) => T) => void };
const upd = <T,>(set: FormProps<T>["set"]) => <K extends keyof T>(k: K) => (val: T[K]) => set((p) => ({ ...p, [k]: val }));

function SeniorForm({ v, set }: FormProps<SeniorInputs>) {
  const u = upd(set);
  return (
    <>
      <SelectField label="Facility type" value={v.facilityType} onChange={u("facilityType")} options={[
        { value: "RCFE", label: "RCFE / Board & Care" },
        { value: "ASSISTED_LIVING", label: "Assisted Living" },
        { value: "MEMORY_CARE", label: "Memory Care" },
        { value: "SNF", label: "Skilled Nursing (SNF)" },
      ]} />
      <Segmented label="Transaction" value={v.transaction} onChange={u("transaction")} options={[
        { value: "PURCHASE", label: "Purchase" },
        { value: "REFINANCE", label: "Refi" },
        { value: "NEW_CONSTRUCTION", label: "Build" },
      ]} />
      <RangeField label="Licensed beds" value={v.beds} onChange={u("beds")} min={6} max={200} />
      <RangeField label="Occupancy (census) %" value={v.occupancyPct} onChange={u("occupancyPct")} min={40} max={100} />
      <MoneyField label="Loan amount" value={v.loanAmount} onChange={u("loanAmount")} hint="$1M – $50M" />
      <MoneyField label="Stabilized NOI" value={v.noi} onChange={u("noi")} />
      <MoneyField label={v.transaction === "NEW_CONSTRUCTION" ? "Total project cost" : v.transaction === "PURCHASE" ? "Purchase price" : "As-is value"} value={v.value ?? 0} onChange={(n) => set((p) => ({ ...p, value: n || undefined }))} hint="Leave blank to estimate from an 8.5% cap rate" />
      <Toggle label="Non-recourse only" hint="Excludes structures needing personal guaranties" checked={v.nonRecourseOnly} onChange={u("nonRecourseOnly")} />
      <Toggle label="Green certification" hint="Energy Star / LEED / NGBS" checked={v.green} onChange={u("green")} />
    </>
  );
}

function HotelForm({ v, set }: FormProps<HospitalityInputs>) {
  const u = upd(set);
  return (
    <>
      <SelectField label="Franchise tier" value={v.tier} onChange={u("tier")} options={[
        { value: "PREMIUM_FLAG", label: "Marriott · Hilton · IHG · Hyatt" },
        { value: "ECONOMY_FLAG", label: "Economy / midscale flag" },
        { value: "BOUTIQUE_INDEPENDENT", label: "Boutique / independent" },
      ]} />
      <Segmented label="Transaction" value={v.transaction} onChange={u("transaction")} options={[
        { value: "PURCHASE", label: "Purchase" },
        { value: "REFINANCE", label: "Refi" },
        { value: "CONSTRUCTION", label: "Build" },
      ]} />
      <RangeField label="Rooms / keys" value={v.keys} onChange={u("keys")} min={20} max={300} />
      <div className="grid grid-cols-2 gap-3">
        <MoneyField label="ADR" value={v.adr} onChange={u("adr")} />
        <RangeField label="Occupancy %" value={v.occupancyPct} onChange={u("occupancyPct")} min={30} max={100} />
      </div>
      <MoneyField label="Loan amount" value={v.loanAmount} onChange={u("loanAmount")} hint="$2M – $40M" />
      <MoneyField label="Trailing 12-month NOI" value={v.noi} onChange={u("noi")} />
      <MoneyField label={v.transaction === "CONSTRUCTION" ? "Total project cost" : v.transaction === "PURCHASE" ? "Purchase price" : "As-is value"} value={v.value ?? 0} onChange={(n) => set((p) => ({ ...p, value: n || undefined }))} hint="Leave blank to estimate from tier cap rate" />
      <MoneyField label="PIP renovation budget" value={v.pipBudget} onChange={u("pipBudget")} />
      <Toggle label="Non-recourse only" checked={v.nonRecourseOnly} onChange={u("nonRecourseOnly")} />
      <Toggle label="Energy-efficient project" hint="May qualify for the $5.5M green 504 cap" checked={v.green} onChange={u("green")} />
    </>
  );
}

function MultifamilyForm({ v, set }: FormProps<MultifamilyInputs>) {
  const u = upd(set);
  const construction = v.transaction === "CONSTRUCTION";
  return (
    <>
      <SelectField label="Asset type" value={v.assetType} onChange={u("assetType")} options={[
        { value: "MULTIFAMILY", label: "Multifamily" },
        { value: "MIXED_USE", label: "Mixed-use" },
        { value: "COMMERCIAL", label: "Commercial (office, retail, industrial)" },
      ]} />
      <Segmented label="Transaction" value={v.transaction} onChange={u("transaction")} options={[
        { value: "PURCHASE", label: "Purchase" },
        { value: "REFINANCE", label: "Refi" },
        { value: "CONSTRUCTION", label: "Build" },
      ]} />
      {v.assetType === "COMMERCIAL" ? (
        <RangeField label="Rentable sq ft" value={v.sqft} onChange={u("sqft")} min={5_000} max={500_000} step={1_000} />
      ) : (
        <RangeField label="Units" value={v.units} onChange={u("units")} min={5} max={500} />
      )}
      <MoneyField label="Loan amount" value={v.loanAmount} onChange={u("loanAmount")} />
      <MoneyField label={construction ? "As-stabilized NOI" : "In-place NOI"} value={v.noi} onChange={u("noi")} />
      <MoneyField label={construction ? "As-stabilized value" : "As-is value"} value={v.value ?? 0} onChange={(n) => set((p) => ({ ...p, value: n || undefined }))} hint="Leave blank to estimate from cap rate" />
      {construction && <MoneyField label="Total project cost (for LTC)" value={v.totalCost ?? 0} onChange={(n) => set((p) => ({ ...p, totalCost: n || undefined }))} />}
      <Toggle label="Affordable / LIHTC" checked={v.affordable} onChange={u("affordable")} />
      <Toggle label="Green certification" hint="Unlocks 0.25% HUD Green MIP" checked={v.green} onChange={u("green")} />
    </>
  );
}
