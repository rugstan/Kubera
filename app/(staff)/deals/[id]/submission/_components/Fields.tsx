import type { SponsorProfile, SubmissionContext, SubmissionProfile } from "@/lib/deals/submission/types";
import { inputDefault, readValue, sourceKeyFor, type Entry, type FieldDef } from "../_lib/fields";
import { date, pct, usd } from "../_lib/format";
import { SourceTag } from "./SourceTag";

// Inputs and read-only rows for the editor's field definitions (_lib/fields.ts).
// Every input carries id="field-<name>" (the readiness fix links land there),
// a visible label, and aria-describedby pointing at its hint and source tag.

export type Stored = { profile: SubmissionProfile | null; sponsor: SponsorProfile | null };

/** Settings and staff notes carry no source tag. */
const NO_SOURCE = new Set(["maskAddress", "sponsor.emailFinancialsMode", "sponsor.notes"]);

const fieldId = (name: string) => `field-${name}`;
const isSet = (v: unknown) => v !== null && v !== undefined && v !== "";

function tagFor(def: FieldDef, stored: Stored, value: unknown) {
  if (NO_SOURCE.has(def.name) || !isSet(value)) return null;
  // Sponsor values have no field_sources entry: they are what the sponsor stated.
  if (def.name.startsWith("sponsor.")) return { source: { source: "borrower" as const, by: "", at: "" } };
  const key = sourceKeyFor(def.name);
  return { source: key ? (stored.profile?.fieldSources[key] ?? null) : null };
}

/** A saved spread figure that differs from what is stored, shown under the input so the difference is visible. */
function spreadNote(name: string, ctx: SubmissionContext | undefined, value: unknown): string | null {
  const s = ctx?.spreads;
  if (!s) return null;
  const pick: Record<string, [number | null, (n: number) => string]> = {
    noiInPlaceCents: [s.noiCents, usd],
    revenueCents: [s.revenueCents, usd],
    expensesCents: [s.expensesCents, usd],
    occupancyPct: [s.occupancyPct, (n) => pct(n)],
  };
  const hit = pick[name];
  if (!hit || hit[0] === null || hit[0] === value) return null;
  return `Saved spread${s.asOf ? ` (${date(s.asOf)})` : ""}: ${hit[1](hit[0])}`;
}

export function FieldInput({ def, stored, ctx }: { def: FieldDef; stored: Stored; ctx?: SubmissionContext }) {
  const value = readValue(def.name, stored.profile, stored.sponsor);
  const id = fieldId(def.name);
  const hintId = def.hint ? `${id}-hint` : null;
  const tag = tagFor(def, stored, value);
  const tagId = tag ? `${id}-source` : null;
  const note = spreadNote(def.name, ctx, value);
  const noteId = note ? `${id}-spread` : null;
  const describedBy = [hintId, tagId, noteId].filter(Boolean).join(" ") || undefined;
  const initial = inputDefault(def, value);
  const wrap = def.wide || def.kind === "textarea" || def.kind === "check" ? "sm:col-span-2" : "";

  if (def.kind === "check") {
    return (
      <div className={wrap}>
        <label className="flex items-start gap-2 text-sm text-ink" htmlFor={id}>
          <input aria-describedby={describedBy} className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]" defaultChecked={initial === "on"} id={id} name={def.name} type="checkbox" value="on" />
          <span>{def.label}</span>
        </label>
        {def.hint ? (
          <span className="mt-1 block text-xs text-titanium" id={hintId ?? undefined}>
            {def.hint}
          </span>
        ) : null}
      </div>
    );
  }

  let control: React.ReactNode;
  const common = { "aria-describedby": describedBy, className: "field", id, name: def.name };
  switch (def.kind) {
    case "enum":
    case "bool": {
      const options = def.kind === "bool" ? [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] : (def.options ?? []);
      control = (
        <select {...common} defaultValue={initial}>
          {def.noBlank ? null : <option value="">Not answered</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    }
    case "textarea":
      control = <textarea {...common} defaultValue={initial} maxLength={def.maxLength} rows={4} />;
      break;
    case "date":
      control = <input {...common} defaultValue={initial} type="date" />;
      break;
    default: {
      const numeric = def.kind === "money" || def.kind === "signed_money" || def.kind === "int" || def.kind === "decimal" || def.kind === "pct";
      control = <input {...common} autoComplete="off" defaultValue={initial} inputMode={numeric ? (def.kind === "int" ? "numeric" : "decimal") : undefined} maxLength={def.maxLength} spellCheck={numeric ? false : undefined} type="text" />;
    }
  }
  return (
    <div className={`min-w-0 ${wrap}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <label className="field-label" htmlFor={id}>
          {def.label}
        </label>
        {tag ? <SourceTag id={tagId ?? undefined} source={tag.source} /> : null}
      </div>
      {control}
      {def.hint ? (
        <span className="mt-1 block text-xs text-titanium" id={hintId ?? undefined}>
          {def.hint}
        </span>
      ) : null}
      {note ? (
        <span className="mt-1 block text-xs text-warning" id={noteId ?? undefined}>
          {note}
        </span>
      ) : null}
    </div>
  );
}

export function EntryInputs({ entries, stored, ctx }: { entries: readonly Entry[]; stored: Stored; ctx?: SubmissionContext }) {
  return (
    <>
      {entries.map((e) =>
        e.kind === "group" ? (
          <fieldset className="min-w-0 rounded-2xl border border-black/10 p-4 sm:col-span-2" id={fieldId(e.name)} key={e.name}>
            <legend className="px-1 text-sm font-medium text-ink">{e.legend}</legend>
            {e.hint ? <p className="mb-3 text-xs text-titanium">{e.hint}</p> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              {e.fields.map((d) => (
                <FieldInput ctx={ctx} def={d} key={d.name} stored={stored} />
              ))}
            </div>
          </fieldset>
        ) : (
          <FieldInput ctx={ctx} def={e} key={e.name} stored={stored} />
        ),
      )}
    </>
  );
}

/** The stored value as text, or null when unanswered. */
export function displayValue(def: FieldDef, value: unknown): string | null {
  if (!isSet(value)) return null;
  switch (def.kind) {
    case "money":
    case "signed_money":
      return usd(Number(value));
    case "pct":
      return pct(Number(value), 2).replace(/\.00%$/, "%");
    case "date":
      return date(String(value));
    case "bool":
    case "check":
      return value === true ? "Yes" : "No";
    case "enum":
      return def.options?.find((o) => o.value === value)?.label ?? String(value);
    default:
      return String(value);
  }
}

/** What an analyst (read-only access) sees instead of the form. */
export function ReadOnlyEntries({ entries, stored }: { entries: readonly Entry[]; stored: Stored }) {
  const defs = entries.flatMap((e) => (e.kind === "group" ? e.fields.map((d) => ({ ...d, label: `${e.legend}: ${d.label}` })) : [e]));
  const rows = defs.flatMap((d) => {
    const value = readValue(d.name, stored.profile, stored.sponsor);
    const shown = displayValue(d, value);
    return shown === null ? [] : [{ d, shown, tag: tagFor(d, stored, value) }];
  });
  if (!rows.length) return <p className="text-sm text-titanium">Nothing entered yet.</p>;
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {rows.map(({ d, shown, tag }) => (
        <div className={`min-w-0 ${d.kind === "textarea" ? "sm:col-span-2" : ""}`} id={fieldId(d.name)} key={d.name}>
          <dt className="text-xs text-titanium">{d.label}</dt>
          <dd className="mt-0.5 flex flex-wrap items-baseline gap-2 break-words text-ink">
            <span className="min-w-0 whitespace-pre-line">{shown}</span>
            {tag ? <SourceTag source={tag.source} /> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
