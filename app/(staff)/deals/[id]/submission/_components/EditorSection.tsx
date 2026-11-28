import { Section } from "@/app/(staff)/deals/ui";
import { SECTION_LABELS } from "@/lib/deals/submission/playbooks";
import type { SectionId } from "@/lib/deals/submission/types";
import type { SubmissionView } from "../_lib/data";
import { fieldsOf, readValue, visibleEntries } from "../_lib/fields";
import { EntryInputs, ReadOnlyEntries } from "./Fields";
import { SectionForm } from "./SectionForm";

// The frame every editor section shares: the card with id="section-<id>" (the
// fix links' anchor), a line of context, and either the section's form (write
// access) or its values read-only (analysts). `facts` is read-only context
// shown above the form (figures from the deal record or another desk);
// `extra` is more inputs inside the form (lists such as sources and uses);
// `extraReadOnly` is how those lists read without write access.

export type SectionProps = { view: SubmissionView; write: boolean };

/** Stored lists a section's extra inputs show (they are not in its field definitions). */
function listState(id: SectionId, view: SubmissionView): unknown {
  const p = view.ctx.profile;
  switch (id) {
    case "sources_uses":
      return [p?.sources, p?.uses];
    case "plan_exit":
      return [p?.highlights, p?.risks];
    case "tenancy":
      return p?.programDetails.tenancy?.topTenants;
    case "agency":
      return p?.programDetails.agency?.unitMix;
    case "sponsor":
      return view.ctx.sponsor?.creditEvents;
    default:
      return null;
  }
}

/**
 * A short digest of what a section's inputs start from. React applies a new
 * defaultValue to a mounted <select> or checkbox only on mount, so the inputs
 * remount when (and only when) their stored values change: after "Start from
 * these" or this section's save. Other sections keep unsaved typing, and the
 * form itself (with its "saved" message) stays mounted.
 */
function inputsKey(id: SectionId, view: SubmissionView, entries: ReturnType<typeof visibleEntries>): string {
  const s = JSON.stringify([view.playbook, fieldsOf(entries).map((d) => readValue(d.name, view.ctx.profile, view.ctx.sponsor) ?? null), listState(id, view)]);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return `${id}-${h.toString(36)}-${s.length}`;
}

export function EditorSection({
  id,
  view,
  write,
  description,
  facts,
  extra,
  extraReadOnly,
}: SectionProps & { id: SectionId; description?: string; facts?: React.ReactNode; extra?: React.ReactNode; extraReadOnly?: React.ReactNode }) {
  const entries = visibleEntries(id, view.playbook);
  const stored = { profile: view.ctx.profile, sponsor: view.ctx.sponsor };
  const version = id === "sponsor" ? (view.ctx.sponsor?.recordVersion ?? null) : (view.ctx.profile?.recordVersion ?? null);
  return (
    <Section description={description} id={`section-${id}`} title={SECTION_LABELS[id]}>
      {facts ? <div className="mb-4">{facts}</div> : null}
      {write ? (
        <SectionForm dealId={view.ctx.deal.id} label={SECTION_LABELS[id]} section={id} version={version}>
          <div className="contents" key={inputsKey(id, view, entries)}>
            <EntryInputs ctx={view.ctx} entries={entries} stored={stored} />
            {extra}
          </div>
        </SectionForm>
      ) : (
        <div className="space-y-4">
          <ReadOnlyEntries entries={entries} stored={stored} />
          {extraReadOnly}
        </div>
      )}
    </Section>
  );
}

/** A short definition list of read-only facts (deal record, other desks). */
export function Facts({ rows, note }: { rows: { label: string; value: React.ReactNode }[]; note?: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-black/[0.03] p-4 text-sm">
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {rows.map((r) => (
          <div className="min-w-0" key={r.label}>
            <dt className="text-xs text-titanium">{r.label}</dt>
            <dd className="break-words text-ink">{r.value}</dd>
          </div>
        ))}
      </dl>
      {note ? <p className="mt-2 text-xs text-titanium">{note}</p> : null}
    </div>
  );
}
