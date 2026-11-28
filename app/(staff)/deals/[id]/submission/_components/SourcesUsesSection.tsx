import { Table } from "@/app/(staff)/deals/ui";
import { playbookTrancheSource } from "@/lib/deals/submission/playbooks";
import { SOURCE_KIND_LABELS, USE_KIND_LABELS, type SourceLine, type UseLine } from "@/lib/deals/submission/types";
import { LIST_LIMITS, SOURCE_KIND_OPTIONS, USE_KIND_OPTIONS, inputDefault, type Option } from "../_lib/fields";
import { usd } from "../_lib/format";
import { EditorSection, Facts, type SectionProps } from "./EditorSection";
import { RowHead, RowInput, RowSelect, rowCount } from "./ListRows";

// Sources and uses, line by line. The totals, the difference and the equity
// share are computed (never typed); the loan line must equal the deal's loan.

function Lines({ list, title, lines, options, limit }: { list: "sources" | "uses"; title: string; lines: (SourceLine | UseLine)[]; options: readonly Option[]; limit: number }) {
  const rows = rowCount(lines.length, limit);
  const noun = list === "sources" ? "Source" : "Use";
  return (
    <fieldset className="min-w-0 space-y-2 sm:col-span-2" id={`field-${list}`}>
      <legend className="field-label">{title}</legend>
      <RowHead className="grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)]" cols={["Line", "Amount (USD)", "Note"]} />
      {Array.from({ length: rows }, (_, i) => (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)]" key={i}>
          <RowSelect defaultValue={lines[i]?.kind} label={`${noun} ${i + 1} line`} name={`${list}.${i}.kind`} options={options} />
          <RowInput defaultValue={lines[i] ? inputDefault({ kind: "money", name: "", label: "" }, lines[i]!.amountCents) : ""} label={`${noun} ${i + 1} amount (USD)`} name={`${list}.${i}.amount`} numeric />
          <RowInput defaultValue={lines[i]?.note} label={`${noun} ${i + 1} note`} name={`${list}.${i}.note`} />
        </div>
      ))}
      <p className="text-xs text-titanium">Save to add more lines (up to {limit}). Clear a line&apos;s amount and note to remove it.</p>
    </fieldset>
  );
}

export function SourcesUsesSection({ view, write }: SectionProps) {
  const p = view.ctx.profile;
  const sources = p?.sources ?? [];
  const uses = p?.uses ?? [];
  const s = sources.reduce((a, l) => a + l.amountCents, 0);
  const u = uses.reduce((a, l) => a + l.amountCents, 0);
  const tranche = playbookTrancheSource[view.playbook];
  const loanLine = sources.filter((l) => l.kind === tranche).reduce((a, l) => a + l.amountCents, 0);
  const loan = view.ctx.deal.loanAmountCents;
  return (
    <EditorSection
      description={`The ${SOURCE_KIND_LABELS[tranche].toLowerCase()} line is this loan and must equal the loan amount. Sources must equal uses.`}
      extra={
        <>
          <Lines limit={LIST_LIMITS.sources} lines={sources} list="sources" options={SOURCE_KIND_OPTIONS} title="Sources" />
          <Lines limit={LIST_LIMITS.uses} lines={uses} list="uses" options={USE_KIND_OPTIONS} title="Uses" />
        </>
      }
      extraReadOnly={
        <Table
          empty="No sources or uses yet."
          head={["Line", "Amount"]}
          label="Sources and uses"
          rows={[...sources.map((l) => [`Source: ${SOURCE_KIND_LABELS[l.kind]}${l.note ? ` (${l.note})` : ""}`, usd(l.amountCents)]), ...uses.map((l) => [`Use: ${USE_KIND_LABELS[l.kind]}${l.note ? ` (${l.note})` : ""}`, usd(l.amountCents)])]}
        />
      }
      facts={
        sources.length || uses.length ? (
          <Facts
            note="Corin calculation from the lines below."
            rows={[
              { label: "Total sources / total uses", value: `${usd(s)} / ${usd(u)}` },
              { label: "Sources minus uses", value: s === u ? "Balanced" : usd(s - u) },
              { label: `${SOURCE_KIND_LABELS[tranche]} line vs loan amount`, value: loan === null ? "Loan amount not set" : loanLine === loan ? "Equal" : `${usd(loanLine)} vs ${usd(loan)}` },
            ]}
          />
        ) : undefined
      }
      id="sources_uses"
      view={view}
      write={write}
    />
  );
}
