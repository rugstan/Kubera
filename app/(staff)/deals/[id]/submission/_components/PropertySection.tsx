import { date } from "../_lib/format";
import { EditorSection, Facts, type SectionProps } from "./EditorSection";

export function PropertySection({ view, write }: SectionProps) {
  const deal = view.ctx.deal;
  const f = view.ctx.propertyFacts;
  return (
    <EditorSection
      description="The collateral. Occupancy needs its as-of date."
      facts={
        <Facts
          note={f ? `A public-record lookup is on file (${date(f.fetchedAt)}); APN, county, flood zone and year built can come from it.` : undefined}
          rows={[
            { label: "Address (deal record)", value: deal.propertyAddress ?? "Not set" },
            { label: "State (deal record)", value: deal.propertyState ?? "Not set" },
          ]}
        />
      }
      id="property"
      view={view}
      write={write}
    />
  );
}
