import { EditorSection, type SectionProps } from "./EditorSection";

export function FinancialsSection({ view, write }: SectionProps) {
  return (
    <EditorSection
      description="Annual figures. When a saved spread differs from what is stored, its figure shows under the field. Debt yield, DSCR and cap rate are computed in the panel."
      id="financials"
      view={view}
      write={write}
    />
  );
}
