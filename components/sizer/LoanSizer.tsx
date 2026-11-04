"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import type { NavLink } from "@/components/site/nav";
import type { Benchmarks } from "@/lib/rates";
import { disclosures } from "@/lib/site";
import { sizeHospitality, sizeSenior, usd } from "@/lib/sizing/programs";
import { sizeConstruction } from "@/lib/sizing/programs/construction";
import { sizeHardMoney } from "@/lib/sizing/programs/hardMoney";
import { hud223a7FlagFromEnv, sizeMultifamilyPlus } from "@/lib/sizing/programs/multifamily";
import type { SizerResult } from "@/lib/sizing/programs/types";
import type { HospitalityInputs, SeniorInputs } from "@/lib/sizing/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { MoneyField, RangeField, Segmented, SelectField, Toggle } from "./fields";
import { ConstructionForm } from "./programs/ConstructionForm";
import { COMMERCIAL_DEFAULT, CONSTRUCTION_DEFAULT, HARD_MONEY_DEFAULT, MULTIFAMILY_DEFAULT } from "./programs/defaults";
import { upd, type FormProps } from "./programs/form";
import { HardMoneyForm } from "./programs/HardMoneyForm";
import { MultifamilyForm } from "./programs/MultifamilyForm";
import { QuoteCarousel } from "./QuoteCarousel";
import { DEFAULT_SIZER_TAB, SIZER_TABS, sizerTabFromParam, type SizerTab as Tab } from "./tabs";

// HUD 223(a)(7) stays behind a build-time flag until a HUD lender confirms the box.
const HUD_223A7_ENABLED = hud223a7FlagFromEnv(process.env.NEXT_PUBLIC_SIZER_HUD_223A7);

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

/**
 * Opens the tab a program page asked for (`/?sizer=construction#sizer`). It
 * renders nothing and sits in its own Suspense boundary, so reading the query
 * string never takes the sizer itself out of the prerendered HTML.
 */
function TabFromQuery({ onTab }: { onTab: (tab: Tab) => void }) {
  const wanted = sizerTabFromParam(useSearchParams().get("sizer"));
  useEffect(() => {
    if (wanted) onTab(wanted);
  }, [wanted, onTab]);
  return null;
}

/** `call` is "Book a call" or, until online scheduling is set up, "Email an advisor" (content/contact.ts `callLink`). */
export function LoanSizer({ benchmarks, live, call }: { benchmarks: Benchmarks; live: boolean; call: NavLink }) {
  const [tab, setTab] = useState<Tab>(DEFAULT_SIZER_TAB);
  const [senior, setSenior] = useState(SENIOR_DEFAULT);
  const [hotel, setHotel] = useState(HOTEL_DEFAULT);
  const [mf, setMf] = useState(MULTIFAMILY_DEFAULT);
  const [cre, setCre] = useState(COMMERCIAL_DEFAULT);
  const [hm, setHm] = useState(HARD_MONEY_DEFAULT);
  const [build, setBuild] = useState(CONSTRUCTION_DEFAULT);

  const result: SizerResult = useMemo(() => {
    if (tab === "senior") return sizeSenior(senior, benchmarks);
    if (tab === "hospitality") return sizeHospitality(hotel, benchmarks);
    if (tab === "hardMoney") return sizeHardMoney(hm, benchmarks);
    if (tab === "construction") return sizeConstruction(build, benchmarks);
    // Commercial and mixed-use size exactly as on the multifamily tab; 223(a)(7) is for HUD apartments only.
    if (tab === "commercial") return sizeMultifamilyPlus(cre, benchmarks, { hud223a7: false });
    return sizeMultifamilyPlus(mf, benchmarks, { hud223a7: HUD_223A7_ENABLED });
  }, [tab, senior, hotel, mf, cre, hm, build, benchmarks]);

  const inputs = { senior, hospitality: hotel, multifamily: mf, commercial: cre, hardMoney: hm, construction: build }[tab];
  const best = result.quotes.find((q) => q.id === result.bestFit);

  const expressHref = useMemo(() => {
    const noi =
      tab === "senior"
        ? senior.noi
        : tab === "hospitality"
          ? hotel.noi
          : tab === "multifamily"
            ? mf.noi
            : tab === "commercial"
              ? cre.noi
              : tab === "construction"
                ? build.stabilizedNoi
                : (hm.stabilizedNoi ?? 0);
    const p = new URLSearchParams({ loan: String(inputs.loanAmount), noi: String(noi) });
    if (tab === "senior") p.set("asset", senior.facilityType === "RCFE" ? "RCFE" : senior.facilityType);
    else if (tab === "hospitality") p.set("asset", hotel.tier === "BOUTIQUE_INDEPENDENT" ? "HOTEL_BOUTIQUE" : "HOTEL_FLAGGED");
    else if (tab === "hardMoney") {
      p.set("asset", hm.propertyType === "RESIDENTIAL_1_4" ? "RESIDENTIAL_2_4" : hm.propertyType);
      p.set("transaction", "HARD_MONEY");
    } else if (tab === "construction") {
      p.set("asset", build.assetType === "HOTEL" ? "HOTEL_FLAGGED" : build.assetType);
      p.set("transaction", "CONSTRUCTION");
    } else if (tab === "commercial") p.set("asset", cre.assetType);
    else p.set("asset", mf.assetType === "MULTIFAMILY" && mf.units < 5 ? "RESIDENTIAL_2_4" : mf.assetType);
    return `/express?${p}`;
  }, [tab, inputs.loanAmount, senior.facilityType, senior.noi, hotel.tier, hotel.noi, mf.assetType, mf.units, mf.noi, cre.assetType, cre.noi, hm.propertyType, hm.stabilizedNoi, build.assetType, build.stabilizedNoi]);

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
      <Suspense fallback={null}>
        <TabFromQuery onTab={setTab} />
      </Suspense>
      {/* Phones and tablets wrap the six tabs onto two rows, so none is cut off or needs a sideways scroll. */}
      <TabsList className="mx-auto flex w-fit max-w-full flex-wrap justify-center gap-1 rounded-[1.375rem] bg-black/[0.05] p-1 lg:flex-nowrap lg:gap-0 lg:rounded-full" aria-label="Asset class">
        {SIZER_TABS.map((t) => (
          <TabsTrigger
            key={t.id}
            value={t.id}
            className={`relative min-h-11 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors md:px-6 ${tab === t.id ? "text-ink" : "text-ink/70 hover:text-ink"}`}
          >
            {tab === t.id && <motion.span layoutId="sizer-tab" className="absolute inset-0 -z-0 rounded-full bg-white shadow-sm" transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
            <span className="relative z-10">{t.label}</span>
          </TabsTrigger>
        ))}
      </TabsList>

      {/* One panel whose value follows the active tab; inputs live in this
          component's state, so switching tabs never loses what was typed. */}
      <TabsContent value={tab} className="mt-10 grid gap-6 lg:grid-cols-[360px_1fr]">
        <aside className="bento h-fit space-y-5 p-6 lg:sticky lg:top-20">
          {tab === "senior" && <SeniorForm v={senior} set={setSenior} />}
          {tab === "hospitality" && <HotelForm v={hotel} set={setHotel} />}
          {tab === "multifamily" && <MultifamilyForm v={mf} set={setMf} hud223a7={HUD_223A7_ENABLED} />}
          {tab === "commercial" && <MultifamilyForm v={cre} set={setCre} hud223a7={false} assets="commercial" />}
          {tab === "hardMoney" && <HardMoneyForm v={hm} set={setHm} />}
          {tab === "construction" && <ConstructionForm v={build} set={setBuild} />}
          <div className="rounded-2xl bg-black/[0.03] p-4">
            <p className="eyebrow !text-xs text-graphite">Underwriting snapshot</p>
            <dl className="mt-2 space-y-1 text-[13px]">
              <div className="flex justify-between"><dt className="text-ink/70">{result.valueEstimated ? "Est. value (from cap rate)" : "Value / cost basis"}</dt><dd className="tabular-nums">{usd(result.value)}</dd></div>
              {result.metrics.map((m) => (
                <div key={m.label} className="flex justify-between"><dt className="text-ink/70">{m.label}</dt><dd className="tabular-nums">{m.value}</dd></div>
              ))}
            </dl>
          </div>
        </aside>

        <div>
          <QuoteCarousel quotes={result.quotes} bestId={result.bestFit} tab={tab} />

          {/* A light card on the canvas section: WhyCorin stays the homepage's only dark surface. */}
          <div className="bento mt-6 flex flex-col items-start justify-between gap-4 p-6 md:flex-row md:items-center">
            <div>
              <p className="text-lg font-semibold text-ink">{best ? `${best.name} looks strongest: ${usd(best.loanAmount)} at ~${best.ratePct.toFixed(2)}%.` : "No structure fits yet — adjust the inputs or talk to us."}</p>
              <p className="mt-1 text-sm text-titanium">
                Rates use {live ? "today's" : "indicative"} Treasury, SOFR, and Prime benchmarks.{" "}
                <Link href="/rates" className="text-accent underline underline-offset-2">See today&rsquo;s rates</Link>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={expressHref} className="pill pill-primary !py-2.5 !text-[15px]">Send this to an advisor</Link>
              <Link href={call.href} className="pill pill-secondary !py-2.5 !text-[15px]">{call.label}</Link>
            </div>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-titanium">{disclosures.indicative}</p>
        </div>
      </TabsContent>
    </Tabs>
  );
}


function SeniorForm({ v, set }: FormProps<SeniorInputs>) {
  const u = upd(set);
  return (
    <>
      <SelectField label="Facility type" value={v.facilityType} onChange={u("facilityType")} options={[
        { value: "RCFE", label: "RCFE / board & care" },
        { value: "ASSISTED_LIVING", label: "Assisted living" },
        { value: "MEMORY_CARE", label: "Memory care" },
        { value: "SNF", label: "Skilled nursing (SNF)" },
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
