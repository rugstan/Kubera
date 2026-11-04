"use client";

import { useActionState, useId } from "react";
import { recordSpendAction, type SpendState } from "../actions";

export function SpendForm() {
  const [state, action, pending] = useActionState<SpendState, FormData>(recordSpendAction, {});
  const id = useId();
  const messageId = `${id}-message`;
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-describedby={state.message ? messageId : undefined}>
      <div>
        <label htmlFor={`${id}-source`} className="field-label">
          Lead source
        </label>
        <input id={`${id}-source`} name="source" required maxLength={80} className="field" placeholder="google_ads" autoComplete="off" />
      </div>
      <div>
        <label htmlFor={`${id}-start`} className="field-label">
          First day
        </label>
        <input id={`${id}-start`} name="periodStart" type="date" required className="field" />
      </div>
      <div>
        <label htmlFor={`${id}-end`} className="field-label">
          Last day
        </label>
        <input id={`${id}-end`} name="periodEnd" type="date" required className="field" />
      </div>
      <div>
        <label htmlFor={`${id}-amount`} className="field-label">
          Amount spent (USD)
        </label>
        <input id={`${id}-amount`} name="amount" inputMode="decimal" required className="field" placeholder="2,500.00" autoComplete="off" />
      </div>
      <div className="flex items-end">
        <button type="submit" className="pill pill-primary min-h-11 w-full px-5 py-2 text-[15px]" disabled={pending}>
          Record spend
        </button>
      </div>
      <div className="sm:col-span-2 lg:col-span-5">
        <label htmlFor={`${id}-note`} className="field-label">
          Note (optional)
        </label>
        <input id={`${id}-note`} name="note" maxLength={300} className="field" placeholder="Campaign or invoice reference" autoComplete="off" />
      </div>
      {state.message ? (
        <p id={messageId} role={state.ok ? "status" : "alert"} className={`text-[14px] sm:col-span-2 lg:col-span-5 ${state.ok ? "text-success" : "text-danger"}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
