// The loan sizer's tabs, in the order of PROGRAM_FAMILIES and the menu, and the
// `?sizer=<family>` deep link program pages use (components/site/nav.ts
// `sizerLinkFor`). Pure, so it is unit-tested without a browser.

import { FAMILY_LABELS, PROGRAM_FAMILIES, type ProgramFamily } from "@/content/programs/types";

export type SizerTab = "senior" | "hospitality" | "multifamily" | "commercial" | "construction" | "hardMoney";

const TAB_FOR_FAMILY: Record<ProgramFamily, SizerTab> = {
  "senior-living": "senior",
  hotels: "hospitality",
  multifamily: "multifamily",
  // The commercial tab reuses the multifamily form's commercial and mixed-use sizing.
  commercial: "commercial",
  construction: "construction",
  "hard-money": "hardMoney",
};

/** Tab labels use the family names from the menu, shortened where a tab cannot fit them. */
const LABEL_FOR_FAMILY: Record<ProgramFamily, string> = { ...FAMILY_LABELS, commercial: "Commercial", "hard-money": "Hard money" };

export const SIZER_TABS: readonly { id: SizerTab; label: string }[] = PROGRAM_FAMILIES.map((f) => ({ id: TAB_FOR_FAMILY[f], label: LABEL_FOR_FAMILY[f] }));

export const DEFAULT_SIZER_TAB: SizerTab = "senior";

/** The tab named by `?sizer=<family>`, or undefined when it is missing or unknown. */
export function sizerTabFromParam(raw: string | null | undefined): SizerTab | undefined {
  const family = PROGRAM_FAMILIES.find((f) => f === raw?.trim());
  return family ? TAB_FOR_FAMILY[family] : undefined;
}
