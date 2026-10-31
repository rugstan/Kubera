"use client";

import { useActionState, useId, useState } from "react";
import { decideApprovalAction, sweepExpiredAction, type DecisionState } from "./actions";

export function DecisionForm({ id, summary, canApprove, approveBlockedReason, canReject }: { id: string; summary: string; canApprove: boolean; approveBlockedReason?: string; canReject: boolean }) {
  const [state, action, pending] = useActionState<DecisionState, FormData>(decideApprovalAction, {});
  const [rejecting, setRejecting] = useState(false);
  const reasonId = useId();
  const blockedId = useId();

  return (
    <div className="mt-4">
      <form action={action} className="flex flex-wrap items-start gap-3">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="decision" value={rejecting ? "reject" : "approve"} />
        {rejecting ? (
          <>
            <div className="w-full">
              <label htmlFor={reasonId} className="field-label">
                Reason for rejecting
              </label>
              <textarea id={reasonId} name="reason" required maxLength={1000} rows={2} className="field" />
            </div>
            <button type="submit" className="pill min-h-11 bg-red-700 px-5 py-2 text-[15px] text-white hover:bg-red-800" disabled={pending}>
              Reject request
            </button>
            <button type="button" className="pill pill-glass min-h-11 px-5 py-2 text-[15px]" onClick={() => setRejecting(false)} disabled={pending}>
              Keep pending
            </button>
          </>
        ) : (
          <>
            <button
              type="submit"
              className="pill pill-primary min-h-11 px-5 py-2 text-[15px] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canApprove || pending}
              aria-describedby={canApprove ? undefined : blockedId}
              aria-label={`Approve: ${summary}`}
            >
              Approve
            </button>
            {canReject ? (
              <button type="button" className="pill pill-glass min-h-11 px-5 py-2 text-[15px]" onClick={() => setRejecting(true)} disabled={pending} aria-label={`Reject: ${summary}`}>
                Reject
              </button>
            ) : null}
          </>
        )}
      </form>
      {!canApprove && approveBlockedReason ? (
        <p id={blockedId} className="mt-2 text-[13px] text-titanium">
          {approveBlockedReason}
        </p>
      ) : null}
      {state.message ? (
        <p role={state.ok ? "status" : "alert"} className={`mt-2 text-[14px] ${state.ok ? "text-accent-hover" : "text-red-800"}`}>
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

export function SweepButton() {
  const [state, action, pending] = useActionState<DecisionState, FormData>(async () => sweepExpiredAction(), {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <button type="submit" className="pill pill-glass min-h-11 px-4 py-2 text-[14px]" disabled={pending}>
        Expire overdue requests
      </button>
      {state.message ? (
        <span role={state.ok ? "status" : "alert"} className="text-[14px] text-titanium">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
