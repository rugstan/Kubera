import { usd } from "../_lib/format";
import { EditorSection, Facts, type SectionProps } from "./EditorSection";

// Mezzanine / preferred equity and C-PACE: this tranche is the deal's loan;
// the senior loan is described here. Combined leverage is computed.

export function CapitalStackSection({ view, write }: SectionProps) {
  const loan = view.ctx.deal.loanAmountCents;
  return (
    <EditorSection
      description="The senior loan ahead of this one and where its consent stands."
      facts={<Facts rows={[{ label: "This tranche (the deal's loan amount)", value: loan !== null ? usd(loan) : "Not set" }]} />}
      id="capital_stack"
      view={view}
      write={write}
    />
  );
}
