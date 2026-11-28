import { ratio } from "../_lib/format";
import { EditorSection, Facts, type SectionProps } from "./EditorSection";

export function SbaSection({ view, write }: SectionProps) {
  const g = view.ctx.spreadFigures.globalCashFlow;
  const owner = view.ctx.profile?.ownerOccupiedPct;
  return (
    <EditorSection
      description="The operating business. Form 1919 and personal statements stay with the principals file and the vault."
      facts={
        <Facts
          note={
            <>
              Owner occupancy is on the <a className="font-medium text-ink underline underline-offset-2" href="#field-ownerOccupiedPct">Property section</a>.
            </>
          }
          rows={[
            { label: "Owner-occupied share", value: owner !== null && owner !== undefined ? `${owner}%` : "Not answered" },
            { label: "Global DSCR (global cash flow spread)", value: g ? `${ratio(g.globalDscr)} as of ${g.asOf}` : "No global cash flow spread saved" },
          ]}
        />
      }
      id="sba"
      view={view}
      write={write}
    />
  );
}
