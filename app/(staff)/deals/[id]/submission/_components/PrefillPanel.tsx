import { Section, Submit, Table } from "@/app/(staff)/deals/ui";
import { applyPrefillAction } from "../actions";
import type { PrefillSuggestions } from "../_lib/data";
import { SourceTag } from "./SourceTag";

// First open, no profile yet: what the lead intake, saved spreads and public
// record already say, shown as suggestions. Nothing is written until staff
// press "Start from these"; each value keeps its source tag afterwards.

export function PrefillPanel({ dealId, prefill, write }: { dealId: string; prefill: PrefillSuggestions; write: boolean }) {
  return (
    <Section description="From the lead intake, saved spreads and the public record. Nothing is saved until you start from them, and each value keeps its source." id="prefill" title="Suggested values">
      <Table
        empty="Nothing to suggest yet: no lead intake, spread or public record is linked to this deal. Start with the sections below."
        head={["Field", "Suggested value", "Source"]}
        label="Suggested values"
        rows={prefill.rows.map((r) => [r.label, r.value, <SourceTag key="s" source={r.source} />])}
      />
      {write && prefill.rows.length ? (
        <form action={applyPrefillAction} className="mt-4">
          <input name="dealId" type="hidden" value={dealId} />
          <Submit>Start from these</Submit>
        </form>
      ) : null}
    </Section>
  );
}
