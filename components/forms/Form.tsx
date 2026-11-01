"use client";

import { useEffect, useRef, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { FormProvider, useFormState, type FieldErrors, type FieldValues, type SubmitErrorHandler, type SubmitHandler, type UseFormReturn } from "react-hook-form";
import { fieldId } from "./ids";

const subscribeNever = () => () => {};

/**
 * False on the server and during hydration, true once React has hydrated the
 * tree. Until then the browser owns the form and a native submit would bypass
 * the JSON submit path, so submit buttons stay disabled until this is true.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

export function Form<V extends FieldValues>({
  form,
  onSubmit,
  onInvalid,
  children,
  className,
  "aria-labelledby": labelledBy,
}: {
  form: UseFormReturn<V>;
  onSubmit: SubmitHandler<V>;
  onInvalid?: SubmitErrorHandler<V>;
  children: ReactNode;
  className?: string;
  "aria-labelledby"?: string;
}) {
  const hydrated = useHydrated();
  return (
    <FormProvider {...form}>
      {/*
        noValidate: inline, accessible messages replace the browser's pop-up bubbles.
        method="post": these forms only submit through JavaScript (handleSubmit + postJson).
        If the browser ever submits natively (before hydration, or a script chunk failed to
        load), field values must not land in the URL, where they would reach request logs,
        browser history, analytics and Referer headers.
      */}
      <form
        method="post"
        noValidate
        className={className}
        aria-labelledby={labelledBy}
        data-hydrated={hydrated ? "true" : "false"}
        onSubmit={(e: FormEvent) => void form.handleSubmit(onSubmit, onInvalid)(e)}
      >
        {/*
          Until hydration the browser would submit natively. A form's first submit button is
          its default button, and a disabled default button blocks implicit submission (Enter
          in a text field), including on steps that render no submit button of their own.
          Consumers disable their visible submit buttons with useHydrated() as well.
        */}
        {!hydrated && <button type="submit" disabled hidden aria-hidden="true" tabIndex={-1} />}
        {!hydrated && (
          <noscript>
            <p className="notice-danger rounded-xl px-4 py-3 text-sm">This form needs JavaScript. Turn it on in your browser, then reload the page to send it.</p>
          </noscript>
        )}
        {children}
      </form>
    </FormProvider>
  );
}

export function RequiredLegend({ className = "" }: { className?: string }) {
  return (
    <p className={`text-xs text-titanium ${className}`}>
      <span aria-hidden="true" className="text-danger">
        *
      </span>{" "}
      <span>indicates a required field.</span>
    </p>
  );
}

/** Banner for a failure that is not tied to one field (server down, rate limit, verification). */
export function FormAlert({ message, className = "" }: { message: string | null | undefined; className?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className={`notice-danger rounded-xl px-4 py-3 text-sm ${className}`}>
      {message}
    </p>
  );
}

type Flat = { name: string; message: string };

export function flattenErrors(errors: FieldErrors, prefix = ""): Flat[] {
  const out: Flat[] = [];
  for (const [key, value] of Object.entries(errors)) {
    if (!value || typeof value !== "object") continue;
    const name = prefix ? `${prefix}.${key}` : key;
    const v = value as { message?: unknown; type?: unknown; ref?: unknown };
    if (typeof v.message === "string" && v.message) out.push({ name, message: v.message });
    else if (!("ref" in v) && !("type" in v)) out.push(...flattenErrors(value as FieldErrors, name));
  }
  return out;
}

/** Moves keyboard focus to the control (or the first control inside a group) behind an error. */
export function focusField(name: string): void {
  const el = document.getElementById(fieldId(name));
  if (!el) return;
  const target = el.matches("input,select,textarea,button") ? el : el.querySelector<HTMLElement>("input,select,textarea,button");
  (target ?? el).focus();
}

/**
 * Lists every error after a failed submit and takes focus, so a screen-reader
 * user hears how many problems there are and can jump to each. Use it on long
 * forms; short stepped forms focus the first invalid control instead.
 */
export function ErrorSummary({ labels, focusSignal, subject = "submission" }: { labels: Record<string, string>; focusSignal: number; subject?: string }) {
  const { errors, submitCount } = useFormState();
  const ref = useRef<HTMLDivElement>(null);
  const items = flattenErrors(errors);
  const show = submitCount > 0 && items.length > 0;

  // Focus once per failed submit. The error list appears a moment after the signal (react-hook-form
  // publishes submitCount after calling onInvalid), so wait for both.
  const handled = useRef(0);
  useEffect(() => {
    if (show && focusSignal > handled.current) {
      handled.current = focusSignal;
      ref.current?.focus();
    }
  }, [focusSignal, show]);

  if (!show) return null;
  return (
    <div ref={ref} tabIndex={-1} role="group" aria-labelledby="error-summary-title" className="notice-danger rounded-2xl p-4">
      <h2 id="error-summary-title" className="text-[15px] font-semibold">
        {items.length === 1 ? `There is 1 problem with your ${subject}` : `There are ${items.length} problems with your ${subject}`}
      </h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
        {items.map((i) => (
          <li key={i.name}>
            <a
              href={`#${fieldId(i.name)}`}
              className="font-medium underline underline-offset-2"
              onClick={(e) => {
                e.preventDefault();
                focusField(i.name);
              }}
            >
              {labels[i.name] ?? i.name}
            </a>
            : {i.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Progress for a multi-step form: an ordered list with aria-current="step" on the active step. */
export function Stepper({ steps, current, label = "Progress" }: { steps: readonly string[]; current: number; label?: string }) {
  return (
    <nav aria-label={label}>
      <ol className="grid gap-2" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((s, i) => {
          const state = i < current ? "completed" : i === current ? "current" : "upcoming";
          return (
            <li key={s} aria-current={i === current ? "step" : undefined}>
              <div className={`h-1.5 rounded-full transition-colors ${i <= current ? "bg-accent" : "bg-black/15"}`} aria-hidden="true" />
              <p className={`mt-2 text-xs font-medium ${i === current ? "text-ink" : "text-titanium"}`}>
                {s}
                <span className="sr-only">
                  {" "}
                  (step {i + 1} of {steps.length}, {state})
                </span>
              </p>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Focus management for step changes. Call `requestFocus()` when the step
 * changes, and spread `ref` on the new step's heading (tabIndex -1): the
 * callback ref focuses it the moment it mounts, so keyboard and screen-reader
 * users land on the new step instead of a button that no longer exists.
 */
export function useStepHeadingFocus() {
  const pending = useRef(false);
  return {
    requestFocus: () => {
      pending.current = true;
    },
    headingRef: (el: HTMLHeadingElement | null) => {
      if (el && pending.current) {
        pending.current = false;
        el.focus();
      }
    },
  };
}
