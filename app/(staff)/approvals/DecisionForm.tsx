"use client";

import { useActionState, useId, useState } from "react";
import { decideApprovalAction, sweepExpiredAction, type DecisionState } from "./actions";

export function DecisionForm({
  id,
  summary,
  canApprove,
  approveBlockedReason,
  canReject,
  stepUp = false,
}: {
  id: string;
  summary: string;
  canApprove: boolean;
  approveBlockedReason?: string;
  canReject: boolean;
  /** Sensitive send (MLDS, Form 159, lender submission, fee quote): approving needs a fresh authenticator code. */
  stepUp?: boolean;
}) {
  const [state, action, pending] = useActionState<DecisionState, FormData>(decideApprovalAction, {});
  const [rejecting, setRejecting] = useState(false);
  const reasonId = useId();
  const blockedId = useId();
  const codeId = useId();
  const codeHintId = useId();

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
            <button type="submit" className="pill min-h-11 bg-danger px-5 py-2 text-[15px] text-white hover:bg-danger/90" disabled={pending}>
              Reject request
            </button>
            <button type="button" className="pill pill-glass min-h-11 px-5 py-2 text-[15px]" onClick={() => setRejecting(false)} disabled={pending}>
              Keep pending
            </button>
          </>
        ) : (
          <>
            {stepUp && canApprove ? (
              <div className="w-full">
                <label htmlFor={codeId} className="field-label">
                  Authenticator code
                </label>
                <p id={codeHintId} className="mb-1.5 text-[13px] text-titanium">
                  This sends a sensitive document. Confirm it is you with the current code from your authenticator app.
                </p>
                <input
                  id={codeId}
                  name="totp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                  className="field max-w-48 tracking-[0.3em]"
                  aria-describedby={codeHintId}
                />
              </div>
            ) : null}
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
        <p role={state.ok ? "status" : "alert"} className={`mt-2 text-[14px] ${state.ok ? "text-success" : "text-danger"}`}>
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
