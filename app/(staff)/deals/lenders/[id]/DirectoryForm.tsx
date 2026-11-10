"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import type { DirectoryFormState } from "../../actions";

// A lender-detail form whose server action returns its result instead of
// redirecting, so a validation error keeps everything the user typed: the
// page is not reloaded, the enclosing <details> stays open, and focus moves to
// the message. React resets a <form action> after every submission, errors
// included, so this submits from onSubmit instead. On success the action has
// revalidated the page; the form resets to the saved values (and clears an
// account number field). Messages are fixed strings from the action: never an
// account number, contact detail or label.

export function DirectoryForm({
  action,
  children,
  className,
  label,
}: {
  action: (prev: DirectoryFormState, f: FormData) => Promise<DirectoryFormState>;
  children: React.ReactNode;
  className?: string;
  label?: string;
}) {
  const [state, dispatch, pending] = useActionState<DirectoryFormState, FormData>(action, {});
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (state.at === undefined) return;
    if (state.error) errorRef.current?.focus();
    else formRef.current?.reset();
  }, [state]);

  return (
    <form
      aria-busy={pending || undefined}
      aria-label={label}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        const submitter = (e.nativeEvent as SubmitEvent).submitter;
        const data = new FormData(e.currentTarget, submitter instanceof HTMLElement ? submitter : null);
        startTransition(() => dispatch(data));
      }}
      ref={formRef}
    >
      {children}
      <div className="sm:col-span-2">
        <p className={state.error ? "notice-danger rounded-2xl px-4 py-3 text-sm" : "sr-only"} ref={errorRef} role="alert" tabIndex={-1}>
          {state.error ? <span key={state.at}>{state.error}</span> : null}
        </p>
        <p className={state.notice ? "notice-success rounded-2xl px-4 py-3 text-sm" : "sr-only"} role="status">
          {state.notice ? <span key={state.at}>{state.notice}</span> : null}
        </p>
      </div>
    </form>
  );
}
