"use client";

import { useActionState } from "react";
import { issueInviteAction, type InviteState } from "../actions";

// Issues a borrower-portal magic link. The link is shown here once (it is not
// stored and never travels in a URL the desk redirects to).

export function InviteForm({ dealId, principals }: { dealId: string; principals: { id: string; name: string; email: string | null }[] }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(issueInviteAction, {});
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[2fr_2fr_auto] sm:items-end">
      <input type="hidden" name="dealId" value={dealId} />
      <div>
        <label className="field-label" htmlFor="inv-principal">For</label>
        <select id="inv-principal" name="principalId" className="field">
          <option value="">Deal contact (all borrower items)</option>
          {principals.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.email ? ` (${p.email})` : ""}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="field-label" htmlFor="inv-email">Email (used when the principal has none on file)</label>
        <input id="inv-email" name="email" type="email" required className="field" />
      </div>
      <button type="submit" className="pill pill-primary !py-2 !text-[15px]" disabled={pending}>
        {pending ? "Creating…" : "Create link"}
      </button>
      <div aria-live="polite" className="sm:col-span-3">
        {state.error ? (
          <p role="alert" className="text-[14px] text-red-900">
            {state.error}
          </p>
        ) : null}
        {state.url ? (
          <div className="rounded-xl border border-accent/40 bg-accent/5 p-3 text-[14px]">
            <p>{state.message}</p>
            <label className="field-label mt-2" htmlFor="inv-url">Portal link (single use)</label>
            <input id="inv-url" readOnly value={state.url} className="field font-mono text-[13px]" onFocus={(e) => e.currentTarget.select()} />
          </div>
        ) : null}
      </div>
    </form>
  );
}
