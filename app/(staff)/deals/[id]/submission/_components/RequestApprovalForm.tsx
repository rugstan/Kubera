"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import { requestSubmissionAction, type RequestFormState } from "../actions";

// The request-approval form (preview page and matching desk). A refusal comes
// back without a reload, so the reason and choices stay as typed; when
// required items are missing and no reason of 20+ characters is given, the
// refusal lists each missing item with a link to fix it. Nothing is locked or
// requested in that case.

export function RequestApprovalForm({ children, label, className }: { children: React.ReactNode; label: string; className?: string }) {
  const [state, dispatch, pending] = useActionState<RequestFormState, FormData>(requestSubmissionAction, {});
  const errorRef = useRef<HTMLDivElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.at === undefined) return;
    (state.error ? errorRef : noticeRef).current?.focus();
  }, [state]);

  return (
    <form
      aria-busy={pending || undefined}
      aria-label={label}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        const data = new FormData(e.currentTarget);
        startTransition(() => dispatch(data));
      }}
    >
      {children}
      <div className={state.error ? "notice-danger mt-4 rounded-2xl px-4 py-3 text-sm" : "sr-only"} ref={errorRef} role="alert" tabIndex={-1}>
        {state.error ? (
          <div key={state.at}>
            <p className="font-medium">{state.error}</p>
            {state.missing?.length ? (
              <ul aria-label="Missing items" className="mt-1 list-disc pl-5">
                {state.missing.map((m) => (
                  <li key={m.id}>
                    <a className="underline underline-offset-2" href={m.href}>
                      {m.label}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
            {state.results?.length ? (
              <ul className="mt-1 list-disc pl-5">
                {state.results.map((r) => (
                  <li key={r.lenderName}>
                    {r.lenderName}: {r.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className={state.notice ? "notice-success mt-4 rounded-2xl px-4 py-3 text-sm" : "sr-only"} ref={noticeRef} role="status" tabIndex={-1}>
        {state.notice ? (
          <div key={state.at}>
            <p className="font-medium">{state.notice}</p>
            {state.results?.length ? (
              <ul className="mt-1 list-disc pl-5">
                {state.results.map((r) => (
                  <li key={r.lenderName}>
                    {r.lenderName}: {r.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </form>
  );
}
