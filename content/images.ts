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
// A family or structure without an image here renders without one; nothing
// else changes.
//
// Every master is 1536 × 1024 (3:2). Crops are CSS only (`aspect-*` with
// `object-cover`), so one `position` serves every crop: the wide crops (2:1
// banners, 16:9 structure pages) only move vertically and use its second
// value; the 4:3 cards only move sideways and use its first.

import type { StaticImageData } from "next/image";
import type { ProgramFamily } from "@/content/programs/types";
import aboutCalifornia from "@/assets/images/about-california.webp";
import familyConstruction from "@/assets/images/family-construction.webp";
import familyHardMoney from "@/assets/images/family-hard-money.webp";
import familyHotels from "@/assets/images/family-hotels.webp";
import familyMultifamily from "@/assets/images/family-multifamily.webp";
import familySeniorLiving from "@/assets/images/family-senior-living.webp";
import homeHero from "@/assets/images/home-hero.webp";
import structureAssistedLiving504 from "@/assets/images/structure-assisted-living-sba-504-refinance.webp";
import structureHotel504Pip from "@/assets/images/structure-flagged-hotel-sba-504-green-pip.webp";
import structureHotelToAssistedLiving from "@/assets/images/structure-hotel-to-assisted-living-conversion-bridge.webp";
import structureInvestorRehab from "@/assets/images/structure-investor-rehab-hard-money.webp";
import structureMemoryCareBridge from "@/assets/images/structure-memory-care-bridge-to-hud.webp";
import structureMultifamilyConstruction from "@/assets/images/structure-multifamily-construction-bank-cpace.webp";

export type SiteImage = {
  src: StaticImageData;
  /** Plain description of what is in the picture. */
  alt: string;
  /** CSS object-position for crops (the subject's centre), e.g. "60% 55%". */
  position?: string;
};

/** Homepage hero, below the facts row: 2:1 from md, 4:3 on phones. */
export const HOME_HERO_IMAGE: SiteImage = {
  src: homeHero,
  alt: "Four-story light stucco apartment building with recessed balconies beside a two-story courtyard building, with olive trees and lavender along the sidewalk",
  position: "50% 45%",
};

/** Banner under the /about header, 2:1. */
export const ABOUT_IMAGE: SiteImage = {
  src: aboutCalifornia,
  alt: "Aerial view of a suburban neighborhood with low-rise apartment buildings, a single-story courtyard community, tree-lined streets and dry hills beyond",
  position: "50% 40%",
};

/** Banner on each financing hub page (2:1) and the family's card on the homepage (4:3, from md). */
export const FAMILY_IMAGES: Partial<Record<ProgramFamily, SiteImage>> = {
  "senior-living": {
    src: familySeniorLiving,
    alt: "Single-story assisted living building with a metal roof and a covered entry walk on slim columns, framed by olive trees, lavender and grasses",
    position: "50% 80%",
  },
  hotels: {
    src: familyHotels,
    alt: "Limestone and glass hotel at dusk with a covered drop-off, a warmly lit lobby and olive trees at the entrance",
    position: "50% 55%",
  },
  multifamily: {
    src: familyMultifamily,
    alt: "Contemporary four-story apartment buildings with glass balconies, stone and brick facades, and a landscaped walkway",
    position: "62% 55%",
  },
  construction: {
    src: familyConstruction,
    alt: "Wood-framed apartment building under construction on a concrete podium, with a tower crane, stacked lumber and a fenced site",
    position: "30% 45%",
  },
  "hard-money": {
    src: familyHardMoney,
    alt: "Renovated two-story apartment building with light stucco, wood slat panels, an open stair and a new drought-tolerant front garden",
    position: "50% 85%",
  },
};

export function familyImage(family: ProgramFamily): SiteImage | null {
  return FAMILY_IMAGES[family] ?? null;
}

/**
 * Image for each illustrative structure, keyed by its slug in
 * content/deal-structures.ts (images.test.ts checks every key is one): 16:9 on
 * the structure page, 4:3 on its card on /structures.
 */
export const STRUCTURE_IMAGES: Partial<Record<string, SiteImage>> = {
  "assisted-living-sba-504-refinance": {
    src: structureAssistedLiving504,
    alt: "Single-story craftsman-style house with a wide covered porch, an accessible ramp with metal handrails, a front lawn and mature trees",
    position: "55% 85%",
  },
  "flagged-hotel-sba-504-green-pip": {
    src: structureHotel504Pip,
    alt: "Four-story hotel under renovation, one wing behind scaffolding with new facade panels, solar panels on the roof and a covered entrance",
    position: "45% 90%",
  },
  "memory-care-bridge-to-hud": {
    src: structureMemoryCareBridge,
    alt: "Enclosed garden courtyard of a two-story building with a winding gravel path, a round stone planter, wooden benches and a pergola",
    position: "50% 55%",
  },
  "hotel-to-assisted-living-conversion-bridge": {
    src: structureHotelToAssistedLiving,
    alt: "Two-story stucco building with arched walkways and a tile roof, a new entry ramp with handrails being built, and palm trees",
    position: "55% 85%",
  },
  "multifamily-construction-bank-cpace": {
    src: structureMultifamilyConstruction,
    alt: "Five-story apartment building nearing completion: warm-white panels and gray weather barrier over a light stone base, solar panels and heat pumps on the roof",
    position: "50% 75%",
  },
  "investor-rehab-hard-money": {
    src: structureInvestorRehab,
    alt: "Two-story apartment building mid-renovation, with scaffolding at one end, new windows on pallets, a covered dumpster and partly primed stucco",
    position: "75% 90%",
  },
};

export function structureImage(slug: string): SiteImage | null {
  return STRUCTURE_IMAGES[slug] ?? null;
}
