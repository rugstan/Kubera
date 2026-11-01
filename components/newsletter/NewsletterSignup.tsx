"use client";

import { useId, useState } from "react";
import { NoticeAtCollection } from "@/components/legal/NoticeAtCollection";
import { CheckboxField, Form, FormAlert, TextField, postJson, useHydrated, useZodForm, type FormFailure } from "@/components/forms";
import { TurnstileSlot, turnstileHeaders, useTurnstile } from "@/components/security/Turnstile";
import { NEWSLETTER_CONSENT_TEXTS, CURRENT_NEWSLETTER_CONSENT } from "@/lib/newsletter/consent";
import { subscribeSchema } from "@/lib/newsletter/schema";
import { site } from "@/lib/site";

const CONSENT = NEWSLETTER_CONSENT_TEXTS[CURRENT_NEWSLETTER_CONSENT];

type Values = { email: string; consent: boolean };

/**
 * Newsletter signup with double opt-in: submitting sends a confirmation email,
 * and the person is not subscribed until they click its link. Shows the notice
 * at collection and the exact consent wording the ledger records.
 */
export function NewsletterSignup({ source, className = "" }: { source: string; className?: string }) {
  const headingId = useId();
  const [failure, setFailure] = useState<FormFailure | null>(null);
  const hydrated = useHydrated();
  const [done, setDone] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const turnstile = useTurnstile("newsletter");
  const form = useZodForm<Values>({ schema: subscribeSchema, defaultValues: { email: "", consent: false } });

  async function submit(values: Values) {
    setSubmitting(true);
    setFailure(null);
    const token = await turnstile.getToken();
    const result = await postJson<{ message?: string }>(
      "/api/newsletter/subscribe",
      { email: values.email, consent: values.consent, consentMeta: { textVersion: CONSENT.id, page: source } },
      { headers: turnstileHeaders(token), fields: ["email", "consent"], labels: { email: "Email" }, contactEmail: site.email },
    );
    setSubmitting(false);
    if (result.ok) {
      setDone(result.data.message ?? "Check your inbox for a confirmation link. You are not subscribed until you click it.");
      return;
    }
    for (const [name, message] of Object.entries(result.failure.fieldErrors)) form.setError(name as keyof Values, { type: "server", message });
    setFailure(result.failure);
  }

  return (
    <section aria-labelledby={headingId} data-newsletter-signup className={`bento p-6 md:p-8 ${className}`}>
      <h2 id={headingId} className="text-2xl font-semibold tracking-tight">
        Get the Kubera newsletter
      </h2>
      <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-titanium">
        Market notes, program updates and new tools, about once a month. We email a link to confirm your address first.
      </p>

      {done ? (
        <p role="status" className="notice-success mt-5 rounded-xl px-4 py-3 text-[15px]">
          {done}
        </p>
      ) : (
        <Form form={form} onSubmit={submit} className="mt-5 space-y-3" aria-labelledby={headingId}>
          <TextField name="email" label="Email address" type="email" autoComplete="email" inputMode="email" placeholder="you@company.com" required />
          <CheckboxField name="consent" label={CONSENT.text} required />
          <TurnstileSlot turnstile={turnstile} />
          <FormAlert message={failure && Object.keys(failure.fieldErrors).length === 0 ? failure.message : null} />
          <button type="submit" disabled={!hydrated || submitting} className="pill pill-primary disabled:opacity-60">
            {submitting ? "Sending" : "Subscribe"}
          </button>
          <NoticeAtCollection point="newsletter" />
        </Form>
      )}
    </section>
  );
}
