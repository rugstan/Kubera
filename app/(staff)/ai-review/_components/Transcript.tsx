import { GUARDRAIL_CATEGORY_LABELS } from "@/lib/ai/guardrails";
import { ANNOTATION_LABEL_TEXT, type Annotation, type GuardrailEventRecord } from "@/lib/ai/review/types";
import type { StoredMessage } from "@/lib/conversations/store";

const timeFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Los_Angeles" });
export const when = (iso: string | null | undefined): string => (iso ? timeFmt.format(new Date(iso)) : "—");

/** The transcript, with guardrail hits and staff notes under the message they belong to. Plain text only (never HTML). */
export function Transcript({ messages, events, annotations }: { messages: StoredMessage[]; events: GuardrailEventRecord[]; annotations: Annotation[] }) {
  return (
    <ol className="grid gap-4" aria-label="Conversation">
      {messages.map((m, i) => {
        const hits = events.filter((e) => e.messageIndex === i);
        const notes = annotations.filter((a) => a.messageIndex === i);
        const isUser = m.role === "user";
        return (
          <li key={i} id={`message-${i}`} className={`rounded-2xl border p-4 ${isUser ? "border-hairline bg-white" : "border-black/10 bg-canvas"}`}>
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-titanium">
              <strong className="font-semibold text-ink">{isUser ? "Borrower" : "Kubera AI"}</strong>
              <span>Message {i + 1}</span>
              <time dateTime={m.at}>{when(m.at)}</time>
              {m.role === "assistant" && m.model ? <span>{m.model}</span> : null}
              {m.role === "assistant" && m.stopReason !== "end_turn" ? <span className="badge-gold rounded-full px-2 py-0.5 text-[12px] font-medium">Stopped: {m.stopReason}</span> : null}
              {m.role === "user" && m.mode === "term_sheet" ? <span className="rounded-full bg-black/5 px-2 py-0.5 text-[12px] font-medium text-ink">Term sheet request</span> : null}
            </div>
            <p className="mt-2 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink">{m.content}</p>
            {m.role === "assistant" && m.guardrail ? (
              <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[13px] text-amber-950" role="note">
                Output guardrail {m.guardrail.mode === "enforce" ? "rewrote" : "flagged"} {m.guardrail.count} {m.guardrail.count === 1 ? "sentence" : "sentences"} in this reply:{" "}
                {m.guardrail.categories.map((c) => GUARDRAIL_CATEGORY_LABELS[c as keyof typeof GUARDRAIL_CATEGORY_LABELS] ?? c).join(", ")}.
              </p>
            ) : null}
            {hits.length > 0 ? (
              <details className="mt-2 text-[13px]">
                <summary className="cursor-pointer font-medium text-accent">What the model wrote (internal)</summary>
                <ul className="mt-2 grid gap-2">
                  {hits.map((h) => (
                    <li key={h.id} className="rounded-xl bg-white p-3">
                      <span className="font-medium text-ink">{GUARDRAIL_CATEGORY_LABELS[h.category]}</span> <span className="text-titanium">({h.ruleId}, {h.replaced ? "replaced" : "left as written"})</span>
                      <blockquote className="mt-1 border-l-2 border-black/15 pl-3 text-ink">{h.excerpt}</blockquote>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-titanium">The borrower did not see these sentences when the guardrail was enforcing.</p>
              </details>
            ) : null}
            {notes.length > 0 ? <Notes notes={notes} /> : null}
          </li>
        );
      })}
    </ol>
  );
}

export function Notes({ notes }: { notes: Annotation[] }) {
  return (
    <ul className="mt-3 grid gap-2" aria-label="Staff notes">
      {notes.map((n) => (
        <li key={n.id} className="rounded-xl border border-black/10 bg-white p-3 text-[14px]">
          <span className="rounded-full bg-black/5 px-2 py-0.5 text-[12px] font-medium text-ink">{ANNOTATION_LABEL_TEXT[n.label]}</span>{" "}
          <span className="text-titanium">
            {n.authorLabel}, <time dateTime={n.createdAt}>{when(n.createdAt)}</time>
          </span>
          <p className="mt-1 whitespace-pre-wrap text-ink">{n.note}</p>
        </li>
      ))}
    </ul>
  );
}
