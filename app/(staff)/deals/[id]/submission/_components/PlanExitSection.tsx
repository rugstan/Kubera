import { LIST_LIMITS } from "../_lib/fields";
import { EditorSection, type SectionProps } from "./EditorSection";
import { RowHead, RowInput, rowCount } from "./ListRows";

// The plan, the exit, the highlights and the known issues. These used to be
// typed fresh on every send; stored here, every lender reads the same words.

export function PlanExitSection({ view, write }: SectionProps) {
  const p = view.ctx.profile;
  const risks = p?.risks ?? [];
  const highlights = p?.highlights ?? [];
  const rows = rowCount(risks.length, LIST_LIMITS.risks, 2);
  return (
    <EditorSection
      description="Exit fields are required for short-term loans. State the weak spot plainly, with its mitigant."
      extra={
        <>
          <div className="min-w-0 sm:col-span-2">
            <label className="field-label" htmlFor="field-highlights">
              Highlights (one per line, up to {LIST_LIMITS.highlights})
            </label>
            <textarea className="field" defaultValue={highlights.join("\n")} id="field-highlights" name="highlights" rows={3} />
          </div>
          <fieldset className="min-w-0 space-y-2 sm:col-span-2" id="field-risks">
            <legend className="field-label">Known issues and mitigants</legend>
            <RowHead className="grid-cols-2" cols={["Issue", "Mitigant"]} />
            {Array.from({ length: rows }, (_, i) => (
              <div className="grid gap-2 sm:grid-cols-2" key={i}>
                <RowInput defaultValue={risks[i]?.risk} label={`Known issue ${i + 1}`} name={`risks.${i}.risk`} />
                <RowInput defaultValue={risks[i]?.mitigant} label={`Known issue ${i + 1} mitigant`} name={`risks.${i}.mitigant`} />
              </div>
            ))}
          </fieldset>
        </>
      }
      extraReadOnly={
        <div className="space-y-3 text-sm">
          {highlights.length ? (
            <div>
              <p className="text-xs text-titanium">Highlights</p>
              <ul className="list-disc pl-5 text-ink">
                {highlights.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {risks.length ? (
            <div>
              <p className="text-xs text-titanium">Known issues and mitigants</p>
              <ul className="list-disc pl-5 text-ink">
                {risks.map((r) => (
                  <li key={r.risk}>
                    {r.risk}: {r.mitigant}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      }
      id="plan_exit"
      view={view}
      write={write}
    />
  );
}
