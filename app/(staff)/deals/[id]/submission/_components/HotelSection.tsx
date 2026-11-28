import { date, pct, usd } from "../_lib/format";
import { EditorSection, Facts, type SectionProps } from "./EditorSection";

// Hotel CMBS and PIP bridge. Keys are the property's size in keys; the
// management company is on the sponsor section.

export function HotelSection({ view, write }: SectionProps) {
  const str = view.ctx.spreadFigures.hotelStr;
  const p = view.ctx.profile;
  return (
    <EditorSection
      description="Brand, performance and the property improvement plan. PIP cost per key is computed in the panel."
      facts={
        <Facts
          note={
            <>
              Keys come from the property size; the management company from the <a className="font-medium text-ink underline underline-offset-2" href="#section-sponsor">sponsor section</a>.
            </>
          }
          rows={[
            { label: "Keys", value: p?.sizeUnit === "keys" && p.sizeCount !== null ? String(p.sizeCount) : "Set the size in keys on the Property section" },
            { label: "Management company", value: view.ctx.sponsor?.managementCompany ?? "Not set" },
            ...(str ? [{ label: `STR report (${date(str.asOf)})`, value: `${pct(str.occupancyPct)} occupancy · ADR ${usd(str.adrCents)} · RevPAR ${usd(str.revparCents)}${str.revparIndex !== null ? ` · index ${str.revparIndex}` : ""}` }] : []),
          ]}
        />
      }
      id="hotel"
      view={view}
      write={write}
    />
  );
}
