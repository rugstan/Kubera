import type { SubmissionView } from "../_lib/data";

// The section list with a status dot each: red when something required for a
// soft quote is missing there, amber when only term-sheet items are, green
// when both are complete. The dot's meaning is also in text for screen readers.

export function sectionStatus(view: SubmissionView, id: string): { tone: "bad" | "warn" | "good"; text: string } {
  const screen = view.readiness.screen.required.filter((i) => i.section === id && !i.met).length;
  const term = view.readiness.term_sheet.required.filter((i) => i.section === id && !i.met).length;
  if (screen) return { tone: "bad", text: `${screen} missing for a soft quote` };
  if (term) return { tone: "warn", text: `${term} missing for a term sheet` };
  return { tone: "good", text: "complete" };
}

const DOT = { bad: "bg-danger", warn: "bg-warning", good: "bg-success" } as const;

export function SectionNav({ view }: { view: SubmissionView }) {
  return (
    <nav aria-label="Submission sections">
      <ul className="flex flex-wrap gap-2 xl:flex-col xl:gap-1">
        {view.sections.map((s) => {
          const st = sectionStatus(view, s.id);
          return (
            <li key={s.id}>
              <a className="inline-flex min-h-11 items-center gap-2 rounded-full border border-black/10 bg-white px-3 text-sm text-ink hover:border-black/30 xl:w-full xl:rounded-xl" href={`#section-${s.id}`}>
                <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${DOT[st.tone]}`} />
                <span>{s.label}</span>
                <span className="sr-only">: {st.text}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
