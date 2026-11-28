import { Table } from "@/app/(staff)/deals/ui";
import { LIST_LIMITS, inputDefault } from "../_lib/fields";
import { usd } from "../_lib/format";
import { EditorSection, type SectionProps } from "./EditorSection";
import { RowHead, RowInput, rowCount } from "./ListRows";

// Fannie Mae / Freddie Mac. The unit mix is entered only when no rent-roll
// spread is saved; physical occupancy is the property's occupancy.

export function AgencySection({ view, write }: SectionProps) {
  const mix = view.ctx.profile?.programDetails.agency?.unitMix ?? [];
  const rows = rowCount(mix.length, LIST_LIMITS.unitMix);
  const rentRoll = view.ctx.spreadBundleKinds.includes("rent_roll");
  return (
    <EditorSection
      description={rentRoll ? "A rent-roll spread is saved, so the unit mix comes from it; enter one here only to override it." : "Economic occupancy and the unit mix. Physical occupancy is on the Property section."}
      extra={
        <fieldset className="min-w-0 space-y-2 sm:col-span-2" id="field-programDetails.agency.unitMix">
          <legend className="field-label">Unit mix</legend>
          <RowHead className="grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.2fr)]" cols={["Unit type", "Units", "Average rent (USD / month)"]} />
          {Array.from({ length: rows }, (_, i) => (
            <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.2fr)]" key={i}>
              <RowInput defaultValue={mix[i]?.type} label={`Unit type ${i + 1}`} name={`unitMix.${i}.type`} />
              <RowInput defaultValue={mix[i]?.count} label={`Unit type ${i + 1} units`} name={`unitMix.${i}.count`} numeric />
              <RowInput defaultValue={mix[i] ? inputDefault({ kind: "money", name: "", label: "" }, mix[i]!.avgRentCents) : ""} label={`Unit type ${i + 1} average rent (USD)`} name={`unitMix.${i}.avgRent`} numeric />
            </div>
          ))}
        </fieldset>
      }
      extraReadOnly={<Table empty="No unit mix entered." head={["Unit type", "Units", "Average rent"]} label="Unit mix" rows={mix.map((m) => [m.type, String(m.count), usd(m.avgRentCents)])} />}
      id="agency"
      view={view}
      write={write}
    />
  );
}
