import { TARGET_STAGE_LABELS, targetStages, type Readiness, type TargetStage } from "@/lib/deals/submission/types";
import type { StageReadiness } from "../_lib/data";

// The lender-ready meter: Screen, Term sheet and Underwrite, each counting the
// required items only, with every missing item linked to the field or
// checklist item that fixes it. Wording says "lender-ready", never "approved"
// or "qualified". Recommended items are listed apart as "would strengthen".

const READY_LABEL: Record<TargetStage, string> = {
  screen: "Lender-ready for a soft quote",
  term_sheet: "Lender-ready for a term sheet",
  underwrite: "Underwriting documents in hand",
};

/** On the editor itself a fix link is just its anchor, so the jump happens in place. */
function local(href: string, samePage?: string): string {
  if (!samePage || !href.startsWith(samePage)) return href;
  const rest = href.slice(samePage.length);
  const hash = rest.indexOf("#");
  return (rest.startsWith("?") || rest.startsWith("#")) && hash >= 0 ? rest.slice(hash) : href;
}

function Stage({ stage, r, limit, H, samePage }: { stage: TargetStage; r: Readiness; limit?: number; H: "h3" | "h4"; samePage?: string }) {
  const met = r.required.filter((i) => i.met).length;
  const missing = r.required.filter((i) => !i.met);
  const shown = limit ? missing.slice(0, limit) : missing;
  const perBorrower = r.required.filter((i) => i.met && i.perBorrower);
  const better = r.recommended.filter((i) => !i.met);
  const docs = stage === "underwrite";
  return (
    <div className="min-w-0" data-stage={stage}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <H className="text-sm font-semibold text-ink">{TARGET_STAGE_LABELS[stage]}</H>
        <span className="text-sm tabular-nums text-ink">
          {met} / {r.required.length}
          {docs ? " documents" : " required"}
        </span>
      </div>
      <div aria-hidden="true" className="mt-1.5 h-2 overflow-hidden rounded-full bg-black/10">
        <div className={`h-2 rounded-full ${r.ready ? "bg-success" : "bg-warning"}`} style={{ width: `${r.score}%` }} />
      </div>
      <p className={`mt-1 text-xs ${r.ready ? "text-success" : "text-titanium"}`}>{r.ready ? READY_LABEL[stage] : `${missing.length} required ${docs ? (missing.length === 1 ? "document" : "documents") : missing.length === 1 ? "item" : "items"} missing`}</p>
      {shown.length ? (
        <ul aria-label={`Missing for ${TARGET_STAGE_LABELS[stage]}`} className="mt-2 space-y-1 text-sm">
          {shown.map((i) => (
            <li className="min-w-0" key={i.id}>
              <a className="font-medium text-ink underline underline-offset-2" href={local(i.fix.href, samePage)}>
                {i.label}
              </a>
              <span className="block text-xs text-titanium">{i.fix.hint}</span>
            </li>
          ))}
          {missing.length > shown.length ? <li className="text-xs text-titanium">and {missing.length - shown.length} more</li> : null}
        </ul>
      ) : null}
      {perBorrower.length && !limit ? <p className="mt-2 text-xs text-warning">Per borrower, not yet verified by a document: {perBorrower.map((i) => i.label).join("; ")}.</p> : null}
      {better.length && !limit ? (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer py-1 font-medium text-accent">Would strengthen the submission ({better.length})</summary>
          <ul className="mt-1 space-y-1">
            {better.map((i) => (
              <li key={i.id}>
                <a className="text-ink underline underline-offset-2" href={local(i.fix.href, samePage)}>
                  {i.label}
                </a>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export function ReadinessMeter({
  readiness,
  limit,
  headingLevel = 2,
  stages = targetStages,
  samePage,
}: {
  readiness: StageReadiness;
  limit?: number;
  headingLevel?: 2 | 3;
  stages?: readonly TargetStage[];
  /** The page the meter is on (the editor's path): its fix links become in-page anchors. */
  samePage?: string;
}) {
  const H = headingLevel === 2 ? "h2" : "h3";
  const stops = readiness.screen.hardStops;
  return (
    <div>
      <H className="text-base font-semibold text-ink">Lender-ready meter</H>
      <p className="mt-1 text-xs text-titanium">Counts required items only. A send with missing items needs a written reason the approving broker sees.</p>
      {stops.length ? (
        <div className="notice-danger mt-3 rounded-xl px-3 py-2 text-sm" role="alert">
          <p className="font-medium">Nothing goes to lenders while:</p>
          <ul className="list-disc pl-5">
            {stops.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-3 space-y-5">
        {stages.map((s) => (
          <Stage H={headingLevel === 2 ? "h3" : "h4"} key={s} limit={limit} r={readiness[s]} samePage={samePage} stage={s} />
        ))}
      </div>
    </div>
  );
}
