"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import { saveSubmissionSectionAction, type SectionFormState } from "../actions";

// One editor section's form. The action returns its result instead of
// redirecting, and the form submits from onSubmit (React resets a
// <form action> after every submission, errors included), so a refused save
// keeps everything typed and lists each problem by the field's visible label
// with a link to the field. On success the page has been revalidated: the form
// resets to the saved values and every other section picks up the new
// record version.

export function SectionForm({ dealId, section, version, label, children }: { dealId: string; section: string; version: number | null; label: string; children: React.ReactNode }) {
  const [state, dispatch, pending] = useActionState<SectionFormState, FormData>(saveSubmissionSectionAction, {});
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.at === undefined) return;
    if (state.error) errorRef.current?.focus();
    else formRef.current?.reset();
  }, [state]);

  return (
    <form
      aria-busy={pending || undefined}
      aria-label={label}
      className="grid gap-4 sm:grid-cols-2"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        const data = new FormData(e.currentTarget);
        startTransition(() => dispatch(data));
      }}
      ref={formRef}
    >
      <input name="dealId" type="hidden" value={dealId} />
      <input name="section" type="hidden" value={section} />
      <input name="version" type="hidden" value={version ?? ""} />
      {children}
      <div className="space-y-3 sm:col-span-2">
        <div className={state.error ? "notice-danger rounded-2xl px-4 py-3 text-sm" : "sr-only"} ref={errorRef} role="alert" tabIndex={-1}>
          {state.error ? (
            <div key={state.at}>
              <p>{state.error}</p>
              {state.errors?.length ? (
                <ul className="mt-1 list-disc pl-5">
                  {state.errors.map((e) => (
                    <li key={`${e.name}:${e.message}`}>
                      <a className="font-medium underline underline-offset-2" href={`#field-${e.name}`}>
                        {e.label}
                      </a>
                      : {e.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
        <p className={state.notice ? "notice-success rounded-2xl px-4 py-3 text-sm" : "sr-only"} role="status">
          {state.notice ? <span key={state.at}>{state.notice}</span> : null}
        </p>
        <button className="pill pill-primary min-h-11 max-w-full whitespace-normal text-center" disabled={pending} type="submit">
          {pending ? "Saving…" : `Save ${label.toLowerCase()}`}
        </button>
      </div>
    </form>
  );
}
