// Every photo on the public site, in one place. The plan, rules and prompts
// are in docs/images/image-plan.md and docs/images/chatgpt-prompts.md; keep
// them in step with this file.
//
// The images show the kind of property Corin Commercial finances, never a
// property it financed, a client or the team. So:
//   - alt text describes what is in the picture and never claims it is a
//     Corin deal, a client's building or a real place;
//   - no people, vehicles, signs or text in any image.
// The site carries no image disclosure line (owner decision, 2026-11-04).
// A family without an image here renders without one; nothing else changes.

import type { StaticImageData } from "next/image";
import type { ProgramFamily } from "@/content/programs/types";
import familyMultifamily from "@/assets/images/family-multifamily.webp";

export type SiteImage = {
  src: StaticImageData;
  /** Plain description of what is in the picture. */
  alt: string;
  /** CSS object-position for crops (the subject's centre), e.g. "60% 55%". */
  position?: string;
};

/** Banner on each financing hub page (and, once all five exist, the homepage family cards). */
export const FAMILY_IMAGES: Partial<Record<ProgramFamily, SiteImage>> = {
  multifamily: {
    src: familyMultifamily,
    alt: "Contemporary four-story apartment buildings with glass balconies, stone and brick facades, and a landscaped walkway",
    position: "62% 55%",
  },
};

export function familyImage(family: ProgramFamily): SiteImage | null {
  return FAMILY_IMAGES[family] ?? null;
}
