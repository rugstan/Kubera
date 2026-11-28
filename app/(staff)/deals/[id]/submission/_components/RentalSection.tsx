import { EditorSection, type SectionProps } from "./EditorSection";

export function RentalSection({ view, write }: SectionProps) {
  return (
    <EditorSection
      description="Monthly figures for the whole property. DSCR uses the lower of the lease and market rent over PITIA at the assumed terms, computed in the panel."
      id="rental"
      view={view}
      write={write}
    />
  );
}
