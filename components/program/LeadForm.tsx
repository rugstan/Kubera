"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CheckboxField, ChoiceField, Form, FormAlert, NumericField, RequiredLegend, SelectField, TextAreaField, TextField, postJson, useHydrated, useZodForm, type FormFailure } from "@/components/forms";
import { NoticeAtCollection } from "@/components/legal/NoticeAtCollection";
import { AiUseNotice } from "@/components/privacy/AiUseNotice";
import { TurnstileSlot, turnstileHeaders, useTurnstile } from "@/components/security/Turnstile";
import { expressHrefFor } from "@/components/site/nav";
import type { ProgramFamily } from "@/content/programs/types";
import { track } from "@/lib/analytics/client";
import { CONSENT_TEXTS, CURRENT_CONSENT } from "@/lib/consent/texts";
import { site } from "@/lib/site";
import { EMPTY_LEAD, LEAD_FIELDS, LEAD_FORM_ANCHOR, LEAD_TIMELINES, LEAD_TRANSACTIONS, buildLeadPayload, leadFormSchema, leadPreset, propertyTypeOptions, type LeadFormValues } from "./lead-form";

// The short request form on every financing page. It posts to /api/qualify as
// `kind: "quick"`, so it passes the same bot, origin and rate checks and lands
// in the same lead, consent and CRM records as the qualifier. The consent box
// shows the qualifier's exact wording, recorded under the qualifier's version.
const CONSENT = CONSENT_TEXTS[CURRENT_CONSENT.qualifier];

export function LeadForm({ family, slug }: { family: ProgramFamily; slug: string }) {
  const hydrated = useHydrated();
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<FormFailure | null>(null);
  const [done, setDone] = useState<{ firstName: string; consent: boolean } | null>(null);
  const doneHeading = useRef<HTMLHeadingElement>(null);
  const form = useZodForm<LeadFormValues>({ schema: (v) => leadFormSchema(v), defaultValues: { ...EMPTY_LEAD, ...leadPreset(slug, family) } });
  const { setError, watch, trigger, getFieldState } = form;
  const turnstile = useTurnstile("qualify");
  const consent = watch("consent");

  // Phone becomes required once the contact permission box is ticked; re-check it as the box changes.
  useEffect(() => {
    if (getFieldState("phone").error) void trigger("phone");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consent]);

  // Keyboard and screen-reader users land on the confirmation, not a button that no longer exists.
  useEffect(() => {
    if (done) doneHeading.current?.focus();
  }, [done]);

  async function submit(values: LeadFormValues) {
    setSubmitting(true);
    setFailure(null);
    const token = await turnstile.getToken();
    const result = await postJson("/api/qualify", buildLeadPayload(values, slug, { textVersion: CONSENT.id, page: location.pathname }), {
      headers: turnstileHeaders(token),
      fields: LEAD_FIELDS,
      labels: { loanAmount: "Loan amount", email: "Email", phone: "Phone", firstName: "First name", lastName: "Last name", assetType: "Property type", transaction: "Transaction", timelineDays: "Timing" },
      contactEmail: site.email,
    });
    setSubmitting(false);
    if (result.ok) {
      track("lead_form_submitted", { family, asset: values.assetType, transaction: values.transaction, consent: values.consent });
      setDone({ firstName: values.firstName.trim(), consent: values.consent });
      return;
    }
    track("lead_form_failed", { family, reason: result.failure.kind, status: result.failure.status });
    for (const [name, message] of Object.entries(result.failure.fieldErrors)) setError(name as never, { type: "server", message });
    setFailure(result.failure);
  }

  return (
    <section id={LEAD_FORM_ANCHOR} aria-labelledby="request-heading" className="bento mt-14 scroll-mt-24 p-6 sm:p-8 md:p-10" data-lead-form={slug}>
      {done ? (
        <div>
          <p className="eyebrow">Request received</p>
          <h2 id="request-heading" ref={doneHeading} tabIndex={-1} className="mt-3 text-2xl font-semibold outline-none md:text-3xl">
            Thanks{done.firstName ? `, ${done.firstName}` : ""}. A licensed advisor will follow up.
          </h2>
          <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-ink/85">
            An advisor reviews every request personally and replies by email{done.consent ? ", or by phone or text as you allowed" : ""}, usually within one business day. Timing is not
            guaranteed, and nothing here is a loan offer or a commitment to lend.
          </p>
          <p className="mt-6 text-[15px] text-titanium">Want indicative numbers now? Answer a few more questions about the deal.</p>
          <div className="mt-3">
            <Link href={expressHrefFor(family)} className="pill pill-primary max-w-full whitespace-normal text-center">
              Get full loan options
            </Link>
          </div>
        </div>
      ) : (
        <>
          <h2 id="request-heading" className="text-2xl font-semibold md:text-3xl">
            Send your deal to an advisor
          </h2>
          <p className="mt-3 max-w-2xl text-[16px] text-titanium">
            A few basics are enough to start. A licensed Corin advisor reviews your request and follows up by email, or by phone if you allow it below. No credit check, and no obligation.
          </p>
          <Form form={form} onSubmit={submit} aria-labelledby="request-heading" className="mt-6 space-y-5">
            <RequiredLegend />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField name="assetType" label="Property type" required placeholder="Select a property type" options={propertyTypeOptions(family)} />
              <NumericField name="loanAmount" label="Approximate loan amount" format="money" required placeholder="e.g. 3,000,000" />
            </div>
            <ChoiceField name="transaction" label="Transaction" required options={LEAD_TRANSACTIONS} />
            <SelectField name="timelineDays" label="When do you need to close?" required placeholder="Select a timeframe" options={LEAD_TIMELINES} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField name="firstName" label="First name" required autoComplete="given-name" />
              <TextField name="lastName" label="Last name" required autoComplete="family-name" />
              <TextField name="email" label="Email" type="email" required autoComplete="email" placeholder="name@company.com" />
              <TextField name="phone" label="Mobile phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="415-555-0100" hint="Optional. Required only if you allow calls or texts below." />
              <TextField name="company" label="Company (optional)" autoComplete="organization" className="sm:col-span-2" />
            </div>
            <TextAreaField name="notes" label="Anything else? (optional)" maxLength={2000} placeholder="Location, current debt, maturity date, what you are trying to do…" />
            <CheckboxField name="consent" label={CONSENT.text} />
            <NoticeAtCollection point="qualifier" />
            <AiUseNotice context="qualifier" />
            <TurnstileSlot turnstile={turnstile} />
            <FormAlert message={failure?.message} />
            <div>
              <button type="submit" disabled={!hydrated || submitting} aria-busy={submitting} className="pill pill-primary min-w-0 !whitespace-normal text-center !py-2.5 disabled:opacity-60">
                {submitting ? "Sending…" : "Send to an advisor"}
              </button>
            </div>
          </Form>
        </>
      )}
    </section>
  );
}
