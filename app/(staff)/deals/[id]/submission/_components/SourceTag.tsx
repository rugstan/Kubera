import type { FieldSource } from "@/lib/deals/submission/types";
import { CORIN_CALCULATION, sourceLabel } from "../_lib/format";

// The tag beside every stored value and computed figure: where the number came
// from ("Per borrower", "From document (Sep 30, 2026)", "Entered", ...) or
// "Corin calculation" for a metric. Inputs point aria-describedby at its id so
// a screen reader hears the source with the field.

const TONE: Record<string, string> = {
  borrower: "bg-warning-surface text-warning",
  document: "bg-success-surface text-success",
  spread: "bg-success-surface text-success",
  record: "bg-black/5 text-ink",
  public_record: "bg-black/5 text-ink",
  entered: "bg-black/5 text-ink",
  calculation: "bg-accent/10 text-accent-hover",
};

export function SourceTag({ id, source, calculation, label }: { id?: string; source?: FieldSource | null; calculation?: boolean; label?: string }) {
  const kind = calculation ? "calculation" : (source?.source ?? "entered");
  const text = label ?? (calculation ? CORIN_CALCULATION : sourceLabel(source));
  return (
    <span className={`relative inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 ${TONE[kind] ?? TONE.entered}`} id={id}>
      <span className="sr-only">Source: </span>
      {text}
    </span>
  );
}
