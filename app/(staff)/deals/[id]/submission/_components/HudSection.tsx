import { EditorSection, type SectionProps } from "./EditorSection";

export function HudSection({ view, write }: SectionProps) {
  return (
    <EditorSection
      description="The HUD program and repairs. HUD-2530 and the lender's reports are collected through the principals file and the checklist."
      id="hud"
      view={view}
      write={write}
    />
  );
}
