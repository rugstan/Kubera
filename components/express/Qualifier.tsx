"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { MoneyField, RangeField, Segmented, SelectField, Toggle } from "@/components/sizer/fields";
import { NoticeAtCollection } from "@/components/legal/NoticeAtCollection";
import { usd } from "@/lib/sizing/programs";
import { disclosures } from "@/lib/site";
import type { Intake } from "@/lib/validation";
import { DocumentUpload } from "./DocumentUpload";

type Asset = Intake["assetType"];

const ASSETS: { value: Asset; label: string; group: string }[] = [
  { value: "ASSISTED_LIVING", label: "Assisted living", group: "Senior living and care" },
  { value: "MEMORY_CARE", label: "Memory care", group: "Senior living and care" },
  { value: "RCFE", label: "RCFE / board and care", group: "Senior living and care" },
  { value: "SNF", label: "Skilled nursing", group: "Senior living and care" },
  { value: "HOTEL_FLAGGED", label: "Flagged hotel", group: "Hospitality" },
  { value: "HOTEL_BOUTIQUE", label: "Boutique hotel / motel", group: "Hospitality" },
  { value: "HOTEL_TO_SENIOR_CONVERSION", label: "Hotel → senior living", group: "Hospitality" },
  { value: "MULTIFAMILY", label: "Multifamily", group: "Multifamily and CRE" },
  { value: "MIXED_USE", label: "Mixed-use", group: "Multifamily and CRE" },
  { value: "COMMERCIAL", label: "Commercial / bridge", group: "Multifamily and CRE" },
];

const GROUPS = ["Senior living and care", "Hospitality", "Multifamily and CRE"] as const;

const isSenior = (a: Asset) => ["ASSISTED_LIVING", "MEMORY_CARE", "RCFE", "SNF"].includes(a);
const isHotel = (a: Asset) => a === "HOTEL_FLAGGED" || a === "HOTEL_BOUTIQUE";
const unitLabel = (a: Asset) => (isSenior(a) ? "Licensed beds" : isHotel(a) || a === "HOTEL_TO_SENIOR_CONVERSION" ? "Rooms / keys" : a === "COMMERCIAL" ? "Tenants (optional)" : "Units");

const FLAG_COPY: Record<string, string> = {
  OPTIMAL_FOR_HUD_232: "Your request looks like a match for HUD 232's long-term, non-recourse financing, subject to lender underwriting.",
  LOAN_UNDER_3_5M_USE_SBA_504_TO_AVOID_HUD_COSTS: "At this size, SBA 504 often costs less all-in than HUD — no annual HUD audit and lower closing costs.",
  USE_2026_SBA_10M_STACK_FOR_LARGE_HOTEL_OR_CARE_FACILITY: "A combined SBA 7(a) + 504 stack may finance this project with 15–20% down, subject to SBA eligibility and lender approval.",
  NEEDS_STABILIZATION_OR_PIP_BRIDGE_FIRST: "A bridge loan first, then permanent debt once operations stabilize, can often increase proceeds.",
  OPTIMAL_AS_STRUCTURED: "This structure looks workable as submitted. An advisor will test it with lenders.",
};

type Result = {
  leadId: string | null;
  uploadToken: string | null;
  result: {
    program: string | null;
    secondary: string | null;
    flag: string;
    indicativeLoan: number;
    indicativeRatePct: number | null;
    term: string | null;
    recourse: string | null;
    closeTimeline: string | null;
    callScheduled: boolean;
    qualified: boolean;
  };
};

const STEPS = ["Asset", "Deal", "Terms", "Contact"] as const;

export function Qualifier() {
  const params = useSearchParams();
  const initialAsset = ASSETS.find((a) => a.value === params.get("asset"))?.value;
  const [step, setStep] = useState(initialAsset ? 1 : 0);
  const [dir, setDir] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Result | null>(null);

  const [intake, setIntake] = useState({
    assetType: initialAsset ?? ("ASSISTED_LIVING" as Asset),
    transaction: "REFINANCE" as Intake["transaction"],
    loanAmount: Number(params.get("loan")) || 3_000_000,
    noi: Number(params.get("noi")) || 400_000,
    value: 0,
    unitCount: 60,
    occupancyPct: 88,
    adr: 150,
    pipBudget: 0,
    franchiseTier: "PREMIUM_FLAG" as NonNullable<Intake["franchiseTier"]>,
    timelineDays: 90,
    nonRecourseOnly: false,
    green: false,
    ownerOperator: true,
    notes: "",
  });
  const [contact, setContact] = useState({ firstName: "", lastName: "", email: "", phone: "", company: "", consent: false });

  const set = <K extends keyof typeof intake>(k: K) => (v: (typeof intake)[K]) => setIntake((p) => ({ ...p, [k]: v }));
  const go = (n: number) => {
    setDir(n > step ? 1 : -1);
    setStep(n);
  };

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/qualify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intake: {
            ...intake,
            value: intake.value || undefined,
            adr: isHotel(intake.assetType) ? intake.adr : undefined,
            pipBudget: intake.pipBudget || undefined,
            franchiseTier: isHotel(intake.assetType) ? intake.franchiseTier : undefined,
            source: "express",
          },
          contact,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.issues?.[0] ? `Please check ${body.issues[0].path.split(".").pop()}: ${body.issues[0].message}` : body.error ?? "We couldn't send your request. Please try again, or email us.");
      setDone(body as Result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) return <Done r={done} firstName={contact.firstName} />;

  const contactValid = contact.firstName && contact.lastName && /.+@.+\..+/.test(contact.email) && contact.consent;

  return (
    <div>
      <div className="mb-8 text-center">
        <p className="eyebrow">60-second deal qualifier</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">Let&apos;s structure your deal.</h1>
      </div>

      <ol className="mb-6 grid grid-cols-4 gap-2" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s}>
            <div className={`h-1 rounded-full transition-colors ${i <= step ? "bg-accent" : "bg-black/10"}`} />
            <p className={`mt-2 text-[12px] font-medium ${i === step ? "text-ink" : "text-titanium"}`}>{s}</p>
          </li>
        ))}
      </ol>

      <div className="bento overflow-hidden p-6 md:p-8">
        <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.div
            key={step}
            custom={dir}
            initial={{ opacity: 0, x: dir * 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -24 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className="space-y-5"
          >
            {step === 0 && (
              <>
                <h2 className="text-2xl font-semibold">What are you financing?</h2>
                {GROUPS.map((g) => (
                  <div key={g}>
                    <p className="field-label">{g}</p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {ASSETS.filter((a) => a.group === g).map((a) => (
                        <button
                          key={a.value}
                          type="button"
                          onClick={() => { set("assetType")(a.value); go(1); }}
                          className={`rounded-2xl border px-3 py-4 text-left text-[15px] font-medium transition hover:border-accent ${intake.assetType === a.value ? "border-accent bg-accent/5" : "border-black/10"}`}
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}

            {step === 1 && (
              <>
                <h2 className="text-2xl font-semibold">The numbers</h2>
                <Segmented
                  label="Transaction"
                  value={intake.transaction}
                  onChange={set("transaction")}
                  options={[
                    { value: "PURCHASE", label: "Purchase" },
                    { value: "REFINANCE", label: "Refinance" },
                    { value: intake.assetType === "HOTEL_TO_SENIOR_CONVERSION" ? "CONVERSION" : "CONSTRUCTION", label: intake.assetType === "HOTEL_TO_SENIOR_CONVERSION" ? "Conversion" : "Construction" },
                  ]}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <MoneyField label="Loan amount requested" value={intake.loanAmount} onChange={set("loanAmount")} />
                  <MoneyField label={intake.transaction === "CONSTRUCTION" || intake.transaction === "CONVERSION" ? "Projected stabilized NOI" : "Trailing 12-month NOI"} value={intake.noi} onChange={set("noi")} />
                  <MoneyField label={intake.transaction === "PURCHASE" ? "Purchase price" : intake.transaction === "REFINANCE" ? "Estimated value" : "Acquisition / land cost"} value={intake.value} onChange={set("value")} hint="Optional" />
                  {(isHotel(intake.assetType) || intake.assetType === "HOTEL_TO_SENIOR_CONVERSION") && (
                    <MoneyField label={intake.assetType === "HOTEL_TO_SENIOR_CONVERSION" ? "Conversion budget" : "PIP / renovation budget"} value={intake.pipBudget} onChange={set("pipBudget")} />
                  )}
                  {isHotel(intake.assetType) && <MoneyField label="ADR" value={intake.adr} onChange={set("adr")} />}
                </div>
                <RangeField label={unitLabel(intake.assetType)} value={intake.unitCount} onChange={set("unitCount")} min={0} max={400} />
                <RangeField label={isSenior(intake.assetType) ? "Occupancy (census) %" : "Occupancy %"} value={intake.occupancyPct} onChange={set("occupancyPct")} min={0} max={100} />
                {isHotel(intake.assetType) && (
                  <SelectField label="Franchise tier" value={intake.franchiseTier} onChange={set("franchiseTier")} options={[
                    { value: "PREMIUM_FLAG", label: "Marriott · Hilton · IHG · Hyatt" },
                    { value: "ECONOMY_FLAG", label: "Economy / midscale flag" },
                    { value: "BOUTIQUE_INDEPENDENT", label: "Independent" },
                  ]} />
                )}
              </>
            )}

            {step === 2 && (
              <>
                <h2 className="text-2xl font-semibold">Timing and preferences</h2>
                <SelectField
                  label="When do you need to close?"
                  value={String(intake.timelineDays)}
                  onChange={(v) => set("timelineDays")(Number(v))}
                  options={[
                    { value: "21", label: "Within 3 weeks" },
                    { value: "45", label: "30–60 days" },
                    { value: "90", label: "60–90 days" },
                    { value: "150", label: "3–6 months" },
                    { value: "270", label: "6+ months / exploring" },
                  ]}
                />
                <Toggle label="Non-recourse only" hint="No personal guaranties" checked={intake.nonRecourseOnly} onChange={set("nonRecourseOnly")} />
                <Toggle label="Owner-operator" hint="Your operating company runs the business" checked={intake.ownerOperator} onChange={set("ownerOperator")} />
                <Toggle label="Green / energy-efficient" checked={intake.green} onChange={set("green")} />
                <div>
                  <label className="field-label" htmlFor="notes">Anything else? (optional)</label>
                  <textarea id="notes" className="field min-h-24" maxLength={2000} value={intake.notes} onChange={(e) => set("notes")(e.target.value)} placeholder="Existing debt, maturity date, franchise status, licensing…" />
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <h2 className="text-2xl font-semibold">Where should an advisor reach you?</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  {(["firstName", "lastName", "email", "phone", "company"] as const).map((k) => (
                    <div key={k} className={k === "company" ? "sm:col-span-2" : ""}>
                      <label className="field-label" htmlFor={k}>{{ firstName: "First name", lastName: "Last name", email: "Email", phone: "Mobile phone", company: "Company (optional)" }[k]}</label>
                      <input
                        id={k}
                        className="field"
                        type={k === "email" ? "email" : k === "phone" ? "tel" : "text"}
                        autoComplete={{ firstName: "given-name", lastName: "family-name", email: "email", phone: "tel", company: "organization" }[k]}
                        value={contact[k]}
                        onChange={(e) => setContact((c) => ({ ...c, [k]: e.target.value }))}
                      />
                    </div>
                  ))}
                </div>
                <label className="flex items-start gap-3 text-[12px] leading-relaxed text-titanium">
                  <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent)]" checked={contact.consent} onChange={(e) => setContact((c) => ({ ...c, consent: e.target.checked }))} />
                  <span>I agree that Kubera Commercial may contact me about this financing request by phone, text, or email, including by automated means. Consent is not a condition of any service. Message and data rates may apply; reply STOP to opt out.</span>
                </label>
                <NoticeAtCollection point="qualifier" />
                {error && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">{error}</p>}
              </>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="mt-8 flex items-center justify-between">
          <button type="button" onClick={() => go(step - 1)} disabled={step === 0} className="text-[15px] font-medium text-titanium hover:text-ink disabled:invisible">
            ← Back
          </button>
          {step < 3 ? (
            <button type="button" onClick={() => go(step + 1)} className="pill pill-primary !py-2.5">
              Continue
            </button>
          ) : (
            <button type="button" onClick={submit} disabled={!contactValid || submitting} className="pill pill-primary !py-2.5 disabled:opacity-40">
              {submitting ? "Sending…" : "See my indicative structure"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Done({ r, firstName }: { r: Result; firstName: string }) {
  const x = r.result;
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
      <div className="text-center">
        <p className="eyebrow">{x.qualified ? "Indicative match" : "Request received"}</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
          {x.qualified ? `Thanks, ${firstName}. Here's your starting point.` : `Thanks, ${firstName}. An advisor will review this personally.`}
        </h1>
      </div>
      {x.qualified && x.program && (
        <div className="bento p-8">
          <p className="text-sm text-titanium">Indicative program fit</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight">{x.program}</p>
          <p className="mt-3 text-[15px] text-ink/80">{FLAG_COPY[x.flag]}</p>
          <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              ["Indicative loan", usd(x.indicativeLoan)],
              ["Indicative rate", x.indicativeRatePct ? `${x.indicativeRatePct.toFixed(2)}%` : "—"],
              ["Term", x.term ?? "—"],
              ["Typical timeline*", x.closeTimeline ?? "—"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[12px] text-titanium">{k}</dt>
                <dd className="text-[15px] font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          {x.secondary && <p className="mt-5 text-[13px] text-titanium">Alternative we&apos;ll also price: {x.secondary}</p>}
          <p className="mt-4 text-[12px] leading-relaxed text-titanium">* {disclosures.timeline}</p>
        </div>
      )}
      <div className="bento p-6">
        <p className="font-medium">
          {x.callScheduled ? "We've flagged your request for priority review by a senior advisor." : "A licensed advisor will review your request and follow up, usually within one business day."}
        </p>
        <p className="mt-1 text-sm text-titanium">Speed things up by sharing your T-12, rent roll or census, and STR report. Files go to an encrypted, private vault.</p>
        {r.leadId && r.uploadToken ? <DocumentUpload leadId={r.leadId} token={r.uploadToken} /> : null}
      </div>
      <p className="text-[12px] leading-relaxed text-titanium">
        {disclosures.indicative} An indicative match is not a loan approval or commitment; only a lender can approve a loan, in writing.
      </p>
    </motion.div>
  );
}
