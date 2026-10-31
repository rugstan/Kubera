"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import type { FieldErrors } from "react-hook-form";
import { Analytics } from "@/components/analytics/Analytics";
import { CheckboxField, ChoiceField, Form, FormAlert, NumericField, RequiredLegend, SelectField, Stepper, TextAreaField, TextField, postJson, useStepHeadingFocus, useZodForm, type FormFailure } from "@/components/forms";
import { NoticeAtCollection } from "@/components/legal/NoticeAtCollection";
import { TurnstileSlot, turnstileHeaders, useTurnstile } from "@/components/security/Turnstile";
import { track } from "@/lib/analytics/client";
import { CONSENT_TEXTS, CURRENT_CONSENT } from "@/lib/consent/texts";
import { site } from "@/lib/site";
import { QualifierResult, type QualifierResponse } from "./QualifierResult";
import {
  ASSETS,
  ASSET_GROUPS,
  EMPTY_VALUES,
  FRANCHISE_TIERS,
  STEPS,
  STEP_FIELDS,
  TIMELINES,
  buildQualifyPayload,
  isConversion,
  isHotel,
  isSenior,
  prefillFromParams,
  qualifierSchema,
  transactionOptions,
  unitLabel,
  type Asset,
  type QualifierValues,
} from "./schema";

// The ledger records this version id with a hash of the exact words shown.
const CONSENT = CONSENT_TEXTS[CURRENT_CONSENT.qualifier];
const FIELD_NAMES = Object.keys(EMPTY_VALUES);

export function Qualifier() {
  const params = useSearchParams();
  const [prefill] = useState(() => prefillFromParams((k) => params.get(k)));
  const [step, setStep] = useState(prefill.assetType ? 1 : 0);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<FormFailure | null>(null);
  const [done, setDone] = useState<QualifierResponse | null>(null);
  const [initialStep] = useState(step);

  const form = useZodForm<QualifierValues>({ schema: (v) => qualifierSchema(v), defaultValues: { ...EMPTY_VALUES, ...prefill } });
  const { trigger, setValue, setError, getValues, watch } = form;
  const turnstile = useTurnstile("qualify");
  const { requestFocus, headingRef } = useStepHeadingFocus();

  const asset = watch("assetType");
  const transaction = watch("transaction");
  const consent = watch("consent");

  useEffect(() => {
    track("qualifier_step_viewed", { step: step + 1, asset: asset || undefined });
    // The step number is the event; the asset is context captured when the step opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Phone becomes required once the contact permission box is ticked; re-check it as the box changes.
  useEffect(() => {
    // Re-check so unticking the box clears the "add a mobile number" message.
    if (form.getFieldState("phone").error) void trigger("phone");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consent]);

  const go = (n: number) => {
    setFailure(null);
    requestFocus();
    setStep(n);
  };

  async function next() {
    const ok = await trigger(STEP_FIELDS[step] as never, { shouldFocus: true });
    if (!ok) {
      track("qualifier_validation_blocked", { step: step + 1, fields: STEP_FIELDS[step]!.filter((f) => form.getFieldState(f as never).invalid).length });
      return;
    }
    go(step + 1);
  }

  function chooseAsset(a: Asset) {
    setValue("assetType", a, { shouldValidate: true });
    // "Construction" and "Conversion" are different options per asset; drop a pick that no longer exists.
    const options = transactionOptions(a).map((o) => o.value as string);
    if (transaction && !options.includes(transaction)) setValue("transaction", "");
    go(1);
  }

  async function submit(values: QualifierValues) {
    setSubmitting(true);
    setFailure(null);
    const token = await turnstile.getToken();
    const result = await postJson<QualifierResponse>("/api/qualify", buildQualifyPayload(values, { textVersion: CONSENT.id, page: location.pathname + location.search }), {
      headers: turnstileHeaders(token),
      fields: FIELD_NAMES,
      labels: { loanAmount: "Loan amount", noi: "NOI", email: "Email", phone: "Phone", firstName: "First name", lastName: "Last name" },
      contactEmail: site.email,
    });
    setSubmitting(false);
    if (result.ok) {
      track("qualifier_submitted", { asset: values.assetType, transaction: values.transaction, qualified: result.data.result.qualified, consent: values.consent });
      requestFocus();
      setDone(result.data);
      return;
    }
    track("qualifier_failed", { reason: result.failure.kind, status: result.failure.status });
    const names = Object.keys(result.failure.fieldErrors);
    for (const name of names) setError(name as never, { type: "server", message: result.failure.fieldErrors[name] });
    // Take the visitor to the step that owns a rejected field (go() clears the banner, so set it after).
    const target = STEP_FIELDS.findIndex((fields) => fields.some((f) => names.includes(f)));
    if (target >= 0 && target !== step) go(target);
    setFailure(result.failure);
  }

  function onInvalid(errors: FieldErrors<QualifierValues>) {
    // Errors on an earlier step: take the visitor back to the first one.
    const target = STEP_FIELDS.findIndex((fields) => fields.some((f) => f in errors));
    if (target >= 0 && target !== step) go(target);
  }

  if (done) return <QualifierResult r={done} firstName={getValues("firstName").trim()} headingRef={headingRef} />;

  return (
    <div>
      <Analytics />
      <div className="mb-6">
        <Stepper steps={STEPS} current={step} label="Qualifier progress" />
      </div>

      <div className="bento p-6 md:p-8">
        <Form form={form} onSubmit={submit} onInvalid={onInvalid}>
          <motion.section key={step} initial={step === initialStep ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }} className="space-y-5" aria-labelledby="qualifier-step-heading">
            {step === 0 && <AssetStep headingRef={headingRef} selected={asset} onChoose={chooseAsset} />}
            {step === 1 && <DealStep headingRef={headingRef} asset={asset} transaction={transaction} />}
            {step === 2 && <TermsStep headingRef={headingRef} />}
            {step === 3 && <ContactStep headingRef={headingRef} turnstile={turnstile} />}
          </motion.section>

          <FormAlert message={failure?.message} className="mt-5" />

          <div className="mt-8 flex items-center justify-between gap-3">
            {step > 0 ? (
              <button type="button" onClick={() => go(step - 1)} className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-[15px] font-medium text-titanium hover:text-ink">
                <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M10 3 5 8l5 5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Back
              </button>
            ) : (
              <span />
            )}
            {step === 1 || step === 2 ? (
              // Distinct keys: React must not reuse the Continue button's DOM node as the submit button,
              // or the same click that advances to the last step would also submit the form.
              <button key="continue" type="button" onClick={() => void next()} className="pill pill-primary !py-2.5">
                Continue
              </button>
            ) : step === 3 ? (
              <button key="submit" type="submit" disabled={submitting} aria-busy={submitting} className="pill pill-primary !py-2.5 disabled:opacity-60">
                {submitting ? "Sending…" : "See my indicative structure"}
              </button>
            ) : null}
          </div>
        </Form>
      </div>
    </div>
  );
}

type HeadingProps = { headingRef: (el: HTMLHeadingElement | null) => void };

function StepHeading({ headingRef, n, children }: HeadingProps & { n: number; children: string }) {
  return (
    <h2 id="qualifier-step-heading" ref={headingRef} tabIndex={-1} className="text-2xl font-semibold outline-none">
      <span className="eyebrow mb-1 block !text-xs">
        Step {n} of {STEPS.length}
      </span>
      {children}
    </h2>
  );
}

function AssetStep({ headingRef, selected, onChoose }: HeadingProps & { selected: Asset | ""; onChoose: (a: Asset) => void }) {
  return (
    <>
      <StepHeading headingRef={headingRef} n={1}>
        What are you financing?
      </StepHeading>
      {ASSET_GROUPS.map((g) => (
        <div key={g} role="group" aria-label={g}>
          <p className="field-label" aria-hidden="true">
            {g}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ASSETS.filter((a) => a.group === g).map((a) => (
              <button
                key={a.value}
                type="button"
                aria-pressed={selected === a.value}
                onClick={() => onChoose(a.value)}
                className={`min-h-14 rounded-2xl border px-3 py-4 text-left text-[15px] font-medium transition hover:border-accent ${selected === a.value ? "border-accent bg-accent/5" : "border-black/20"}`}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function DealStep({ headingRef, asset, transaction }: HeadingProps & { asset: Asset | ""; transaction: string }) {
  const hotel = isHotel(asset);
  const building = transaction === "CONSTRUCTION" || transaction === "CONVERSION";
  const valueLabel = transaction === "PURCHASE" ? "Purchase price" : transaction === "REFINANCE" ? "Estimated value" : "Acquisition or land cost";
  return (
    <>
      <StepHeading headingRef={headingRef} n={2}>
        The numbers
      </StepHeading>
      <RequiredLegend />
      <ChoiceField name="transaction" label="Transaction" required options={transactionOptions(asset)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <NumericField name="loanAmount" label="Loan amount requested" format="money" required placeholder="e.g. 3,000,000" />
        <NumericField name="noi" label={building ? "Projected stabilized NOI" : "Trailing 12-month NOI"} format="money" required placeholder="e.g. 400,000" />
        <NumericField name="value" label={`${valueLabel} (optional)`} format="money" placeholder="e.g. 4,500,000" />
        {(hotel || isConversion(asset)) && (
          <NumericField name="pipBudget" label={`${isConversion(asset) ? "Conversion budget" : "PIP or renovation budget"} (optional)`} format="money" placeholder="e.g. 1,200,000" />
        )}
        {hotel && <NumericField name="adr" label="Average daily rate (ADR)" format="money" required placeholder="e.g. 145" />}
        <NumericField name="unitCount" label={`${unitLabel(asset)}${asset === "COMMERCIAL" ? " (optional)" : ""}`} format="integer" required={asset !== "COMMERCIAL"} placeholder="e.g. 60" />
        <NumericField name="occupancyPct" label={isSenior(asset) ? "Occupancy (census)" : "Occupancy"} format="decimal" suffix="%" required placeholder="e.g. 88" />
        {hotel && <SelectField name="franchiseTier" label="Franchise tier" required placeholder="Select a tier" options={FRANCHISE_TIERS} className="sm:col-span-2" />}
      </div>
    </>
  );
}

function TermsStep({ headingRef }: HeadingProps) {
  return (
    <>
      <StepHeading headingRef={headingRef} n={3}>
        Timing and preferences
      </StepHeading>
      <RequiredLegend />
      <SelectField name="timelineDays" label="When do you need to close?" required placeholder="Select a timeframe" options={TIMELINES} />
      <ChoiceField
        name="ownerOperator"
        label="Will an owner-operator run the property?"
        hint="Your own operating company, not a third-party manager."
        required
        options={[
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ]}
      />
      <div className="space-y-3">
        <CheckboxField name="nonRecourseOnly" label="Non-recourse only" hint="No personal guaranties." />
        <CheckboxField name="green" label="Green or energy-efficient project" />
      </div>
      <TextAreaField name="notes" label="Anything else? (optional)" maxLength={2000} placeholder="Existing debt, maturity date, franchise status, licensing…" />
    </>
  );
}

function ContactStep({ headingRef, turnstile }: HeadingProps & { turnstile: ReturnType<typeof useTurnstile> }) {
  return (
    <>
      <StepHeading headingRef={headingRef} n={4}>
        Where should an advisor reach you?
      </StepHeading>
      <RequiredLegend />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField name="firstName" label="First name" required autoComplete="given-name" />
        <TextField name="lastName" label="Last name" required autoComplete="family-name" />
        <TextField name="email" label="Email" type="email" required autoComplete="email" placeholder="name@company.com" />
        <TextField name="phone" label="Mobile phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="415-555-0100" hint="Optional. Required only if you allow calls or texts below." />
        <TextField name="company" label="Company (optional)" autoComplete="organization" className="sm:col-span-2" />
      </div>
      <CheckboxField name="consent" label={CONSENT.text} />
      <NoticeAtCollection point="qualifier" />
      <TurnstileSlot turnstile={turnstile} />
    </>
  );
}
