import { EditorSection, type SectionProps } from "./EditorSection";

export function ValueSection({ view, write }: SectionProps) {
  return (
    <EditorSection
      description="Purchase price on an acquisition; otherwise the as-is value with its source and date. LTV and LTC are computed from these in the panel and cannot be typed."
      id="value"
      view={view}
      write={write}
    />
  );
}
