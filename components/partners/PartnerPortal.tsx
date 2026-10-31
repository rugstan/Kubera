"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { NoticeAtCollection } from "@/components/legal/NoticeAtCollection";
import { TurnstileSlot, turnstileHeaders, useTurnstile } from "@/components/security/Turnstile";
import { MoneyField, SelectField } from "@/components/sizer/fields";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { CONSENT_TEXTS, CURRENT_CONSENT } from "@/lib/consent/texts";

type PartnerType = "LENDER" | "REFERRAL" | "OPERATOR" | "VENDOR";

// The ledger records this version id with a hash of the exact words shown.
const CONSENT = CONSENT_TEXTS[CURRENT_CONSENT.partner];

const TYPES: { id: PartnerType; hash: string; title: string; blurb: string }[] = [
  { id: "LENDER", hash: "lender", title: "Wholesale lenders", blurb: "Banks, debt funds, CMBS desks, SBA CDCs and 7(a) lenders, HUD MAP/LEAN lenders. Register your current credit box and broker compensation terms." },
  { id: "REFERRAL", hash: "referral", title: "Referral brokers", blurb: "Real estate brokers, hotel brokers, and affiliates. Co-broker or refer deals under a signed non-circumvention and fee-split agreement." },
  { id: "OPERATOR", hash: "operator", title: "Operators", blurb: "RCFE, assisted living, memory care, SNF, and hotel management operators — introduced to owners who need HUD-compliant or franchise-accepted management." },
  { id: "VENDOR", hash: "vendor", title: "Third-party vendors", blurb: "MAI healthcare and hospitality appraisers, HVS/STR analysts, Phase I ESA, PCNA engineers, CPAs. Receive RFPs when a deal needs your reports." },
];

const VERTICALS = [
  { value: "SENIOR_LIVING", label: "Senior living & care" },
  { value: "HOSPITALITY", label: "Hospitality" },
  { value: "MULTIFAMILY", label: "Multifamily" },
  { value: "COMMERCIAL", label: "Commercial" },
  { value: "CONSTRUCTION", label: "Construction" },
] as const;

const SERVICES = [
  { value: "MAI_APPRAISAL_HEALTHCARE", label: "MAI appraisal — healthcare" },
  { value: "MAI_APPRAISAL_HOSPITALITY", label: "MAI appraisal — hospitality" },
  { value: "HVS_STR_FEASIBILITY", label: "HVS / STR feasibility" },
  { value: "PHASE_I_ESA", label: "Phase I ESA" },
  { value: "PCNA", label: "PCNA / property condition" },
  { value: "CPA_AUDIT", label: "CPA / HUD audit" },
  { value: "LEGAL", label: "Legal" },
  { value: "TITLE_ESCROW", label: "Title & escrow" },
] as const;

function Text({ label, value, onChange, type = "text", required, className = "", placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean; className?: string; placeholder?: string }) {
  const id = `p-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className={className}>
      <label htmlFor={id} className="field-label">{label}{required && <span className="text-accent"> *</span>}</label>
      <input id={id} className="field" type={type} value={value} onChange={(e) => onChange(e.target.value)} required={required} placeholder={placeholder} />
    </div>
  );
}

function Chips<T extends string>({ label, options, value, onChange }: { label: string; options: readonly { value: T; label: string }[]; value: T[]; onChange: (v: T[]) => void }) {
  return (
    <fieldset>
      <legend className="field-label">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = value.includes(o.value);
          return (
            <button key={o.value} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
              className={`rounded-full border px-3 py-1.5 text-[13px] font-medium transition ${on ? "border-accent bg-accent/10 text-accent-hover" : "border-black/10 text-ink/70 hover:border-black/25"}`}>
              {o.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function PartnerPortal() {
  const [type, setType] = useState<PartnerType>("LENDER");
  const [contact, setContact] = useState({ firstName: "", lastName: "", email: "", phone: "", company: "", consent: false });
  const turnstile = useTurnstile("partners");
  const [f, setF] = useState<Record<string, unknown>>({});
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fromHash = () => {
      const t = TYPES.find((x) => x.hash === window.location.hash.slice(1));
      if (t) setType(t.id);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  const field = <T,>(k: string, fallback: T) => [(f[k] as T) ?? fallback, (v: T) => setF((p) => ({ ...p, [k]: v }))] as const;
  const c = (k: keyof typeof contact) => (v: string) => setContact((p) => ({ ...p, [k]: v }));

  const [organization, setOrganization] = field("organization", "");
  const [lenderKind, setLenderKind] = field("lenderKind", "BANK");
  const [minLoan, setMinLoan] = field("minLoan", 1_000_000);
  const [maxLoan, setMaxLoan] = field("maxLoan", 25_000_000);
  const [verticals, setVerticals] = field<string[]>("verticals", []);
  const [maxLtv, setMaxLtv] = field("maxLtv", "75");
  const [minDscr, setMinDscr] = field("minDscr", "1.25");
  const [minDebtYield, setMinDebtYield] = field("minDebtYield", "");
  const [flagRequirements, setFlagRequirements] = field("flagRequirements", "");
  const [states, setStates] = field("states", "");
  const [feePct, setFeePct] = field("brokerFeeProtectionPct", "1");
  const [website, setWebsite] = field("website", "");
  const [licenseType, setLicenseType] = field("licenseType", "CA_DRE_BROKER");
  const [licenseNumber, setLicenseNumber] = field("licenseNumber", "");
  const [markets, setMarkets] = field("markets", "");
  const [acceptsAgreement, setAcceptsAgreement] = field("acceptsAgreement", false);
  const [operatorKind, setOperatorKind] = field("operatorKind", "RCFE_ASSISTED_LIVING");
  const [licenseNumbers, setLicenseNumbers] = field("licenseNumbers", "");
  const [units, setUnits] = field("unitsUnderManagement", "");
  const [flagsApproved, setFlagsApproved] = field("flagsApproved", "");
  const [services, setServices] = field<string[]>("services", []);
  const [turnaround, setTurnaround] = field("typicalTurnaroundDays", "");

  function payload() {
    const base = { partnerType: type, contact };
    const num = (v: unknown) => (v === "" || v === undefined ? undefined : Number(v));
    switch (type) {
      case "LENDER":
        return { ...base, organization, website, lenderKind, minLoan, maxLoan, verticals, states, maxLtv: num(maxLtv), minDscr: num(minDscr), minDebtYield: num(minDebtYield), flagRequirements, brokerFeeProtectionPct: num(feePct) };
      case "REFERRAL":
        return { ...base, organization, licenseType, licenseNumber, marketsServed: markets, acceptsAgreement };
      case "OPERATOR":
        return { ...base, organization, operatorKind, licenseNumbers, unitsUnderManagement: num(units) ?? 0, flagsApproved, markets };
      case "VENDOR":
        return { ...base, organization, services, markets, typicalTurnaroundDays: num(turnaround) };
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setError(null);
    try {
      const token = await turnstile.getToken();
      const res = await fetch("/api/partners", {
        method: "POST",
        headers: { "content-type": "application/json", ...turnstileHeaders(token) },
        body: JSON.stringify({ ...payload(), consentMeta: { textVersion: CONSENT.id, page: location.pathname + location.search } }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.issues?.[0] ? `Please check ${body.issues[0].path.split(".").pop()}: ${body.issues[0].message}` : body.error ?? "We couldn't send your registration. Please try again, or email partners@kuberacommercial.com.");
      setState("done");
    } catch (err) {
      setError((err as Error).message);
      setState("idle");
    }
  }

  const active = TYPES.find((t) => t.id === type)!;

  return (
    <Tabs
      value={type}
      onValueChange={(v) => {
        const t = TYPES.find((x) => x.id === v);
        if (!t) return;
        setType(t.id);
        setState("idle");
        history.replaceState(null, "", `#${t.hash}`);
      }}
    >
      <TabsList className="grid gap-3 md:grid-cols-4" aria-label="Partner type">
        {TYPES.map((t) => (
          <TabsTrigger key={t.id} id={t.hash} value={t.id}
            className={`bento p-5 text-left transition ${type === t.id ? "ring-2 ring-accent" : "hover:-translate-y-0.5"}`}>
            <span className="block text-[17px] font-semibold">{t.title}</span>
            <span className="mt-1.5 block text-[13px] leading-snug text-titanium">{t.blurb}</span>
          </TabsTrigger>
        ))}
      </TabsList>

      {/* id/aria-labelledby: the tabs carry hash ids so /partners#lender deep links work. */}
      <TabsContent value={type} aria-labelledby={active.hash} className="mt-6">
      <AnimatePresence mode="wait">
        {state === "done" ? (
          <motion.div key="done" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="bento p-10 text-center" role="status">
            <p className="text-3xl font-semibold tracking-tight">You&apos;re in the queue.</p>
            <p className="mx-auto mt-3 max-w-lg text-titanium">
              A member of our capital markets team reviews every {active.title.toLowerCase().replace(/s$/, "")} registration. We&apos;ll follow up by email{type === "REFERRAL" ? " with your agreement and a secure W-9 link" : ""}.
            </p>
          </motion.div>
        ) : (
          <motion.form key={type} onSubmit={submit} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="bento space-y-8 p-6 md:p-10">
            <section>
              <h2 className="text-xl font-semibold">{active.title}</h2>
              <div className="mt-5 grid gap-4 md:grid-cols-3">
                <Text label="First name" value={contact.firstName} onChange={c("firstName")} required />
                <Text label="Last name" value={contact.lastName} onChange={c("lastName")} required />
                <Text label="Email" type="email" value={contact.email} onChange={c("email")} required />
                <Text label="Phone" type="tel" value={contact.phone} onChange={c("phone")} />
                <Text label={type === "REFERRAL" ? "Brokerage (optional)" : "Organization"} value={organization} onChange={setOrganization} required={type !== "REFERRAL"} className="md:col-span-2" />
              </div>
            </section>

            {type === "LENDER" && (
              <section className="grid gap-4 md:grid-cols-3">
                <SelectField label="Lender type" value={lenderKind} onChange={setLenderKind} options={[
                  { value: "BANK", label: "Bank / credit union" },
                  { value: "DEBT_FUND", label: "Debt fund" },
                  { value: "CMBS_DESK", label: "CMBS conduit desk" },
                  { value: "SBA_CDC", label: "SBA 504 CDC" },
                  { value: "SBA_7A_LENDER", label: "SBA 7(a) lender" },
                  { value: "HUD_LENDER", label: "HUD MAP / LEAN lender" },
                  { value: "LIFE_CO", label: "Life company" },
                  { value: "PRIVATE", label: "Private lender" },
                ]} />
                <MoneyField label="Min loan" value={minLoan} onChange={setMinLoan} />
                <MoneyField label="Max loan" value={maxLoan} onChange={setMaxLoan} />
                <div className="md:col-span-3"><Chips label="Appetite" options={VERTICALS} value={verticals} onChange={setVerticals} /></div>
                <Text label="Max LTV / LTC %" value={maxLtv} onChange={setMaxLtv} required />
                <Text label="Min DSCR" value={minDscr} onChange={setMinDscr} />
                <Text label="Min debt yield %" value={minDebtYield} onChange={setMinDebtYield} />
                <Text label="Franchise flag requirements" value={flagRequirements} onChange={setFlagRequirements} placeholder="e.g. Marriott, Hilton select-service only" className="md:col-span-2" />
                <Text label="Broker compensation you pay (%)" value={feePct} onChange={setFeePct} required />
                <Text label="States / markets" value={states} onChange={setStates} placeholder="CA, AZ, NV…" className="md:col-span-2" />
                <Text label="Website" type="url" value={website} onChange={setWebsite} placeholder="https://" />
              </section>
            )}

            {type === "REFERRAL" && (
              <section className="space-y-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <SelectField label="License" value={licenseType} onChange={setLicenseType} options={[
                    { value: "CA_DRE_BROKER", label: "California DRE broker" },
                    { value: "CA_DRE_SALESPERSON", label: "California DRE salesperson" },
                    { value: "OTHER_STATE_LICENSE", label: "Other state license" },
                    { value: "HOTEL_BROKER", label: "Hotel / business broker" },
                    { value: "UNLICENSED_REFERRAL", label: "Not licensed (finder)" },
                  ]} />
                  <Text label="License #" value={licenseNumber} onChange={setLicenseNumber} />
                  <Text label="Markets served" value={markets} onChange={setMarkets} />
                </div>
                <label className="flex items-start gap-3 rounded-2xl bg-black/[0.03] p-4 text-[13px] leading-relaxed text-ink/80">
                  <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent)]" checked={acceptsAgreement} onChange={(e) => setAcceptsAgreement(e.target.checked)} required />
                  <span>
                    I agree to receive and review Kubera Commercial&apos;s Non-Circumvention &amp; Fee Split Agreement. Referral and co-brokerage compensation is paid only as permitted by California law (Bus. &amp; Prof. Code § 10137) and is subject to review by our designated officer; finder arrangements with unlicensed parties are limited to introductions. A W-9 is collected by secure link after approval.
                  </span>
                </label>
              </section>
            )}

            {type === "OPERATOR" && (
              <section className="grid gap-4 md:grid-cols-3">
                <SelectField label="Operator type" value={operatorKind} onChange={setOperatorKind} options={[
                  { value: "RCFE_ASSISTED_LIVING", label: "RCFE / assisted living" },
                  { value: "MEMORY_CARE", label: "Memory care" },
                  { value: "SNF", label: "Skilled nursing" },
                  { value: "HOTEL_MANAGEMENT", label: "Hotel management" },
                ]} />
                <Text label="Beds / keys under management" type="number" value={units} onChange={setUnits} required />
                <Text label="Markets" value={markets} onChange={setMarkets} />
                <Text label="Facility license #s (CDSS / CDPH)" value={licenseNumbers} onChange={setLicenseNumbers} className="md:col-span-2" />
                <Text label="Franchise flags you manage" value={flagsApproved} onChange={setFlagsApproved} />
              </section>
            )}

            {type === "VENDOR" && (
              <section className="space-y-4">
                <Chips label="Services" options={SERVICES} value={services} onChange={setServices} />
                <div className="grid gap-4 md:grid-cols-3">
                  <Text label="Markets" value={markets} onChange={setMarkets} className="md:col-span-2" />
                  <Text label="Typical turnaround (days)" type="number" value={turnaround} onChange={setTurnaround} />
                </div>
              </section>
            )}

            <label className="flex items-start gap-3 text-[12px] leading-relaxed text-titanium">
              <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent)]" checked={contact.consent} onChange={(e) => setContact((p) => ({ ...p, consent: e.target.checked }))} />
              <span>{CONSENT.text}</span>
            </label>

            <NoticeAtCollection point="partner" />
            <TurnstileSlot turnstile={turnstile} />
            {error && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">{error}</p>}
            <button type="submit" disabled={state === "sending"} className="pill pill-primary disabled:opacity-50">
              {state === "sending" ? "Submitting…" : "Submit registration"}
            </button>
          </motion.form>
        )}
      </AnimatePresence>
      </TabsContent>
    </Tabs>
  );
}
