import { Section, Submit, Table } from "@/app/(staff)/deals/ui";
import { applyPrefillAction } from "../actions";
import type { FieldSource } from "@/lib/deals/submission/types";
import type { PrefillSuggestions } from "../_lib/data";
import { SourceTag } from "./SourceTag";

// First open, no profile yet: what the lead intake, saved spreads and public
// record already say, shown as suggestions. Nothing is written until staff
// press "Start from these"; each value keeps its source tag afterwards.

/** Sponsor facts carry no source of their own: they always read "Per borrower". */
const PER_BORROWER: FieldSource = { source: "borrower", by: "", at: "" };

export function PrefillPanel({ dealId, prefill, write }: { dealId: string; prefill: PrefillSuggestions; write: boolean }) {
  return (
    <Section description="From the lead intake, saved spreads and the public record. Nothing is saved until you start from them, and each value keeps its source." id="prefill" title="Suggested values">
      <Table
        empty="Nothing to suggest yet: no lead intake, spread or public record is linked to this deal. Start with the sections below."
        head={["Field", "Suggested value", "Source"]}
        label="Suggested values"
        rows={prefill.rows.map((r) => [r.label, r.value, <SourceTag key="s" label={r.tag ?? undefined} source={r.source ?? (r.tag === "Per borrower" ? PER_BORROWER : null)} />])}
      />
      {prefill.notes.length ? (
        <ul aria-label="Not suggested" className="mt-3 list-disc space-y-1 pl-5 text-xs text-titanium">
          {prefill.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
      {write && prefill.rows.length ? (
        <form action={applyPrefillAction} className="mt-4">
          <input name="dealId" type="hidden" value={dealId} />
          <Submit>Start from these</Submit>
        </form>
      ) : null}
    </Section>
  );
}
