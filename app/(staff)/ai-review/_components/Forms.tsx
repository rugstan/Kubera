"use client";

import { useActionState, useId } from "react";
import { ANNOTATION_LABELS, ANNOTATION_LABEL_TEXT, FLAG_REASON_MAX, ANNOTATION_NOTE_MAX, type ReviewStatus } from "@/lib/ai/review/types";
import { annotateAction, flagAction, reviewStatusAction, type ReviewState } from "../actions";

function Message({ state, id }: { state: ReviewState; id: string }) {
  if (!state.message) return null;
  return (
    <p id={id} role={state.ok ? "status" : "alert"} className={`mt-2 text-[14px] ${state.ok ? "text-success" : "text-danger"}`}>
      {state.message}
    </p>
  );
}

export function FlagForm({ conversationId, flagged }: { conversationId: string; flagged: boolean }) {
  const [state, action, pending] = useActionState<ReviewState, FormData>(flagAction, {});
  const uid = useId();
  return (
    <form action={action} aria-describedby={state.message ? `${uid}-msg` : undefined}>
      <input type="hidden" name="id" value={conversationId} />
      <input type="hidden" name="flagged" value={flagged ? "false" : "true"} />
      {flagged ? (
        <button type="submit" className="pill pill-glass min-h-11 px-5 py-2 text-[15px]" disabled={pending}>
          Remove flag
        </button>
      ) : (
        <>
          <label htmlFor={`${uid}-reason`} className="field-label">
            Why flag this conversation?
          </label>
          <textarea id={`${uid}-reason`} name="reason" required maxLength={FLAG_REASON_MAX} rows={2} className="field" placeholder="For example: quoted a rate as final" />
          <button type="submit" className="pill pill-primary mt-3 min-h-11 px-5 py-2 text-[15px]" disabled={pending}>
            Flag for review
          </button>
        </>
      )}
      <Message state={state} id={`${uid}-msg`} />
    </form>
  );
}

export function ReviewStatusForm({ conversationId, status }: { conversationId: string; status: ReviewStatus }) {
  const [state, action, pending] = useActionState<ReviewState, FormData>(reviewStatusAction, {});
  const uid = useId();
  const next: { value: ReviewStatus; label: string; primary?: boolean }[] =
    status === "reviewed"
      ? [{ value: "unreviewed", label: "Reopen" }]
      : status === "in_review"
        ? [
            { value: "reviewed", label: "Mark reviewed", primary: true },
            { value: "unreviewed", label: "Release" },
          ]
        : [
            { value: "in_review", label: "Start review" },
            { value: "reviewed", label: "Mark reviewed", primary: true },
          ];
  return (
    <form action={action} aria-describedby={state.message ? `${uid}-msg` : undefined}>
      <input type="hidden" name="id" value={conversationId} />
      <div className="flex flex-wrap gap-3">
        {next.map((n) => (
          <button key={n.value} type="submit" name="status" value={n.value} className={`pill min-h-11 px-5 py-2 text-[15px] ${n.primary ? "pill-primary" : "pill-glass"}`} disabled={pending}>
            {n.label}
          </button>
        ))}
      </div>
      <Message state={state} id={`${uid}-msg`} />
    </form>
  );
}

export function AnnotationForm({ conversationId, messages }: { conversationId: string; messages: { index: number; label: string }[] }) {
  const [state, action, pending] = useActionState<ReviewState, FormData>(annotateAction, {});
  const uid = useId();
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2" aria-describedby={state.message ? `${uid}-msg` : undefined}>
      <input type="hidden" name="id" value={conversationId} />
      <div>
        <label htmlFor={`${uid}-message`} className="field-label">
          About
        </label>
        <select id={`${uid}-message`} name="messageIndex" className="field" defaultValue="">
          <option value="">The whole conversation</option>
          {messages.map((m) => (
            <option key={m.index} value={m.index}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${uid}-label`} className="field-label">
          Label
        </label>
        <select id={`${uid}-label`} name="label" className="field" defaultValue="other">
          {ANNOTATION_LABELS.map((l) => (
            <option key={l} value={l}>
              {ANNOTATION_LABEL_TEXT[l]}
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label htmlFor={`${uid}-note`} className="field-label">
          Note
        </label>
        <textarea id={`${uid}-note`} name="note" required maxLength={ANNOTATION_NOTE_MAX} rows={3} className="field" />
      </div>
      <div className="sm:col-span-2">
        <button type="submit" className="pill pill-primary min-h-11 px-5 py-2 text-[15px]" disabled={pending}>
          Add note
        </button>
        <Message state={state} id={`${uid}-msg`} />
      </div>
    </form>
  );
}
