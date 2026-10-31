"use client";

import { useActionState, useId, useState } from "react";
import { approveExtractionAction, rejectExtractionAction, type ReviewState } from "./actions";

export type ReviewField = {
  key: string;
  label: string;
  value: string;
  confidence: number | null;
  evidence: string | null;
  source: string | null;
  required: boolean;
  low: boolean;
};

const pct = (c: number | null) => (c === null ? "not found" : `${Math.round(c * 100)}%`);

export function ReviewForm({ id, title, fields }: { id: string; title: string; fields: ReviewField[] }) {
  const [state, approve, approving] = useActionState<ReviewState, FormData>(approveExtractionAction, {});
  const [rejectState, reject, rejecting] = useActionState<ReviewState, FormData>(rejectExtractionAction, {});
  const [showReject, setShowReject] = useState(false);
  const notesId = useId();
  const reasonId = useId();
  const pending = approving || rejecting;

  return (
    <div className="mt-4">
      <form action={approve}>
        <input type="hidden" name="id" value={id} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-[14px]">
            <caption className="sr-only">Extracted fields for {title}</caption>
            <thead>
              <tr className="border-b border-hairline text-[13px] text-titanium">
                <th scope="col" className="py-2 pr-3 font-medium">
                  Field
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Value
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Confidence
                </th>
                <th scope="col" className="py-2 font-medium">
                  Evidence
                </th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => {
                const inputId = `${id}-${f.key}`;
                return (
                  <tr key={f.key} className={`border-b border-hairline align-top ${f.low ? "bg-amber-50" : ""}`}>
                    <th scope="row" className="py-2 pr-3 font-medium text-ink">
                      <label htmlFor={inputId}>
                        {f.label}
                        {f.required ? <span className="sr-only"> (required)</span> : null}
                      </label>
                      {f.low ? <span className="ml-2 rounded-full bg-amber-200 px-2 py-0.5 text-[12px] font-medium text-amber-950">Check</span> : null}
                    </th>
                    <td className="py-2 pr-3">
                      <input id={inputId} name={`f.${f.key}`} defaultValue={f.value} className="field min-w-40" autoComplete="off" />
                    </td>
                    <td className="py-2 pr-3 text-titanium">{pct(f.confidence)}</td>
                    <td className="py-2 text-titanium">{f.evidence ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3">
          <label htmlFor={notesId} className="field-label">
            Review note (optional)
          </label>
          <textarea id={notesId} name="notes" rows={2} maxLength={2000} className="field" />
        </div>
        <div className="mt-3 flex flex-wrap gap-3">
          <button type="submit" className="pill pill-primary min-h-11 px-5 py-2 text-[15px] disabled:opacity-50" disabled={pending} aria-label={`Approve with these values: ${title}`}>
            Approve with these values
          </button>
          {!showReject ? (
            <button type="button" className="pill pill-glass min-h-11 px-5 py-2 text-[15px]" onClick={() => setShowReject(true)} disabled={pending} aria-label={`Reject extraction: ${title}`}>
              Reject
            </button>
          ) : null}
        </div>
        {state.message ? (
          <p role={state.ok ? "status" : "alert"} className={`mt-2 text-[14px] ${state.ok ? "text-accent-hover" : "text-red-800"}`}>
            {state.message}
          </p>
        ) : null}
      </form>
      {showReject ? (
        <form action={reject} className="mt-4 grid gap-3">
          <input type="hidden" name="id" value={id} />
          <div>
            <label htmlFor={reasonId} className="field-label">
              Reason for rejecting
            </label>
            <textarea id={reasonId} name="reason" required maxLength={1000} rows={2} className="field" />
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="submit" className="pill min-h-11 bg-red-700 px-5 py-2 text-[15px] text-white hover:bg-red-800" disabled={pending}>
              Reject extraction
            </button>
            <button type="button" className="pill pill-glass min-h-11 px-5 py-2 text-[15px]" onClick={() => setShowReject(false)} disabled={pending}>
              Keep in queue
            </button>
          </div>
          {rejectState.message ? (
            <p role={rejectState.ok ? "status" : "alert"} className="text-[14px] text-red-800">
              {rejectState.message}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
