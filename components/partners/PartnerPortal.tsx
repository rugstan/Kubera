"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { FieldErrors } from "react-hook-form";
import { Analytics } from "@/components/analytics/Analytics";
import {
  CheckboxField,
  ChipsField,
  ErrorSummary,
  Form,
  FormAlert,
  NumericField,
  RequiredLegend,
  SelectField,
  TextField,
  flattenErrors,
  postJson,
  useZodForm,
  type FormFailure,
} from "@/components/forms";
import { NoticeAtCollection } from "@/components/legal/NoticeAtCollection";
import { TurnstileSlot, turnstileHeaders, useTurnstile } from "@/components/security/Turnstile";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { track } from "@/lib/analytics/client";
import { CONSENT_TEXTS, CURRENT_CONSENT } from "@/lib/consent/texts";
import {
  EMPTY_PARTNER_VALUES,
  FIELD_LABELS,
  LENDER_KINDS,
  LICENSE_TYPES,
  OPERATOR_KINDS,
  SERVICES,
  TYPES,
  TYPE_FIELDS,
  VERTICALS,
  buildPartnerPayload,
  partnerFormSchema,
  type PartnerFormValues,
  type PartnerType,
} from "./schema";

// The ledger records this version id with a hash of the exact words shown.
const CONSENT = CONSENT_TEXTS[CURRENT_CONSENT.partner];
const FIELD_NAMES = Object.keys(EMPTY_PARTNER_VALUES);

export function PartnerPortal() {
  const [type, setType] = useState<PartnerType>("LENDER");
  // The resolver reads this synchronously, so it is updated in the tab handler, not after a render.
  const typeRef = useRef<PartnerType>("LENDER");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [failure, setFailure] = useState<FormFailure | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  const doneRef = useRef<HTMLParagraphElement>(null);
  const turnstile = useTurnstile("partners");

  const form = useZodForm<PartnerFormValues>({ schema: (v) => partnerFormSchema(typeRef.current, v), defaultValues: EMPTY_PARTNER_VALUES, focusError: false });
  const { clearErrors, setError, watch } = form;
  const consent = watch("consent");
  const licenseType = watch("licenseType");

  function selectType(next: PartnerType, opts: { fromHash?: boolean } = {}) {
    if (next === typeRef.current) return;
    typeRef.current = next;
    setType(next);
    setState("idle");
    setFailure(null);
    clearErrors();
    if (!opts.fromHash) track("partner_tab_selected", { type: next });
  }

  useEffect(() => {
    const fromHash = () => {
      const t = TYPES.find((x) => x.hash === window.location.hash.slice(1));
      if (t) selectType(t.id, { fromHash: true });
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
    // selectType only touches refs and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-check dependent rules as their inputs change, but only once an error is showing.
  useEffect(() => {
    if (form.getFieldState("phone").error) void form.trigger("phone");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consent]);
  useEffect(() => {
    if (form.getFieldState("licenseNumber").error) void form.trigger("licenseNumber");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [licenseType]);

  useEffect(() => {
    if (state === "done") doneRef.current?.focus();
  }, [state]);

  function onInvalid(errors: FieldErrors<PartnerFormValues>) {
    track("partner_validation_blocked", { type, fields: flattenErrors(errors).length });
    setFocusSignal((n) => n + 1);
  }

  async function submit(values: PartnerFormValues) {
    setState("sending");
    setFailure(null);
    const token = await turnstile.getToken();
    const result = await postJson("/api/partners", buildPartnerPayload(type, values, { textVersion: CONSENT.id, page: location.pathname + location.search }), {
      headers: turnstileHeaders(token),
      fields: FIELD_NAMES,
      labels: FIELD_LABELS,
      contactEmail: "partners@kuberacommercial.com",
    });
    if (result.ok) {
      track("partner_submitted", { type, consent: values.consent });
      setState("done");
      return;
    }
    track("partner_failed", { type, reason: result.failure.kind, status: result.failure.status });
    setState("idle");
    setFailure(result.failure);
    const here = new Set<string>(TYPE_FIELDS[type]);
    for (const [name, message] of Object.entries(result.failure.fieldErrors)) {
      if (here.has(name) || name in FIELD_LABELS) setError(name as never, { type: "server", message });
    }
    setFocusSignal((n) => n + 1);
  }

  const active = TYPES.find((t) => t.id === type)!;

  return (
    <Tabs
      value={type}
      onValueChange={(v) => {
        const t = TYPES.find((x) => x.id === v);
        if (!t) return;
        selectType(t.id);
        history.replaceState(null, "", `#${t.hash}`);
      }}
    >
      <Analytics />
      <TabsList className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Partner type">
        {TYPES.map((t) => (
          <TabsTrigger key={t.id} id={t.hash} value={t.id} className={`bento min-h-11 p-4 text-left transition md:p-5 ${type === t.id ? "ring-2 ring-accent" : "hover:-translate-y-0.5"}`}>
            <span className="block text-[15px] font-semibold md:text-[17px]">{t.title}</span>
            <span className="mt-1.5 hidden text-[13px] leading-snug text-titanium md:block">{t.blurb}</span>
          </TabsTrigger>
        ))}
      </TabsList>

      {/* id/aria-labelledby: the tabs carry hash ids so /partners#lender deep links work. */}
      <TabsContent value={type} aria-labelledby={active.hash} className="mt-6">
        {state === "done" ? (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="bento p-8 text-center md:p-10" role="status">
            <p ref={doneRef} tabIndex={-1} className="text-3xl font-semibold tracking-tight outline-none">
              You&apos;re in the queue.
            </p>
            <p className="mx-auto mt-3 max-w-lg text-titanium">
              A member of our capital markets team reviews every {active.title.toLowerCase().replace(/s$/, "")} registration. We&apos;ll follow up by email
              {type === "REFERRAL" ? " with your agreement and a secure W-9 link" : ""}.
            </p>
          </motion.div>
        ) : (
          <motion.div key={type} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
            <Form form={form} onSubmit={submit} onInvalid={onInvalid} className="bento space-y-8 p-5 md:p-10" aria-labelledby="partner-form-title">
              <section className="space-y-4">
                <div>
                  <h2 id="partner-form-title" className="text-xl font-semibold">
                    {active.title}
                  </h2>
                  <p className="mt-1.5 text-[13px] leading-snug text-titanium md:hidden">{active.blurb}</p>
                </div>
                <RequiredLegend />
                <ErrorSummary labels={FIELD_LABELS} focusSignal={focusSignal} subject="registration" />
                <FormAlert message={failure?.message} />
                <div className="grid gap-4 md:grid-cols-3">
                  <TextField name="firstName" label="First name" required autoComplete="given-name" />
                  <TextField name="lastName" label="Last name" required autoComplete="family-name" />
                  <TextField name="email" label="Email" type="email" required autoComplete="email" placeholder="name@company.com" />
                  <TextField name="phone" label="Phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="415-555-0100" hint="Optional. Required only if you allow calls or texts below." />
                  <TextField
                    name="organization"
                    label={type === "REFERRAL" ? "Brokerage (optional)" : type === "VENDOR" ? "Company" : "Organization"}
                    required={type !== "REFERRAL"}
                    autoComplete="organization"
                    className="md:col-span-2"
                  />
                </div>
              </section>

              {type === "LENDER" && <LenderFields />}
              {type === "REFERRAL" && <ReferralFields licenseType={licenseType} />}
              {type === "OPERATOR" && <OperatorFields />}
              {type === "VENDOR" && <VendorFields />}

              <CheckboxField name="consent" label={CONSENT.text} />

              <NoticeAtCollection point="partner" />
              <TurnstileSlot turnstile={turnstile} />
              <button type="submit" disabled={state === "sending"} aria-busy={state === "sending"} className="pill pill-primary disabled:opacity-60">
                {state === "sending" ? "Submitting…" : "Submit registration"}
              </button>
            </Form>
          </motion.div>
        )}
      </TabsContent>
    </Tabs>
  );
}

function LenderFields() {
  return (
    <section className="grid gap-4 md:grid-cols-3">
      <SelectField name="lenderKind" label="Lender type" required placeholder="Select a lender type" options={LENDER_KINDS} />
      <NumericField name="minLoan" label="Min loan" format="money" required placeholder="e.g. 1,000,000" />
      <NumericField name="maxLoan" label="Max loan" format="money" required placeholder="e.g. 25,000,000" />
      <ChipsField name="verticals" label="Appetite" hint="Optional. Choose every asset class you lend on." options={VERTICALS} className="md:col-span-3" />
      <NumericField name="maxLtv" label="Max LTV / LTC" format="decimal" suffix="%" required placeholder="e.g. 75" />
      <NumericField name="minDscr" label="Min DSCR (optional)" format="decimal" placeholder="e.g. 1.25" />
      <NumericField name="minDebtYield" label="Min debt yield (optional)" format="decimal" suffix="%" placeholder="e.g. 9" />
      <TextField name="flagRequirements" label="Franchise flag requirements (optional)" placeholder="e.g. Marriott, Hilton select-service only" className="md:col-span-2" />
      <NumericField name="brokerFeeProtectionPct" label="Broker compensation you pay" format="decimal" suffix="%" required placeholder="e.g. 1" hint="Enter 0 if you pay none." />
      <TextField name="states" label="States / markets (optional)" placeholder="CA, AZ, NV…" className="md:col-span-2" />
      <TextField name="website" label="Website (optional)" type="url" inputMode="url" autoComplete="url" placeholder="https://" />
    </section>
  );
}

function ReferralFields({ licenseType }: { licenseType: string }) {
  const needsNumber = Boolean(licenseType) && licenseType !== "UNLICENSED_REFERRAL";
  return (
    <section className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <SelectField name="licenseType" label="License" required placeholder="Select a license type" options={LICENSE_TYPES} />
        <TextField name="licenseNumber" label={needsNumber ? "License #" : "License # (optional)"} required={needsNumber} />
        <TextField name="markets" label="Markets served (optional)" />
      </div>
      <CheckboxField
        boxed
        required
        name="acceptsAgreement"
        label="I agree to receive and review Kubera Commercial's Non-Circumvention & Fee Split Agreement. Referral and co-brokerage compensation is paid only as permitted by California law (Bus. & Prof. Code § 10137) and is subject to review by our designated officer; finder arrangements with unlicensed parties are limited to introductions. A W-9 is collected by secure link after approval."
      />
    </section>
  );
}

function OperatorFields() {
  return (
    <section className="grid gap-4 md:grid-cols-3">
      <SelectField name="operatorKind" label="Operator type" required placeholder="Select an operator type" options={OPERATOR_KINDS} />
      <NumericField name="unitsUnderManagement" label="Beds / keys under management" format="integer" required placeholder="e.g. 240" />
      <TextField name="markets" label="Markets (optional)" />
      <TextField name="licenseNumbers" label="Facility license #s, CDSS / CDPH (optional)" className="md:col-span-2" />
      <TextField name="flagsApproved" label="Franchise flags you manage (optional)" />
    </section>
  );
}

function VendorFields() {
  return (
    <section className="space-y-4">
      <ChipsField name="services" label="Services" required hint="Choose every service you provide." options={SERVICES} />
      <div className="grid gap-4 md:grid-cols-3">
        <TextField name="markets" label="Markets (optional)" className="md:col-span-2" />
        <NumericField name="typicalTurnaroundDays" label="Typical turnaround, days (optional)" format="integer" placeholder="e.g. 10" />
      </div>
    </section>
  );
}
