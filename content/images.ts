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
// A family, structure or financing page without an image here renders
// without one; nothing else changes.
//
// Every master is 1536 × 1024 (3:2). Crops are CSS only (`aspect-*` with
// `object-cover`), so one `position` serves every crop: the wide crops (2:1
// banners, 16:9 structure pages) only move vertically and use its second
// value; the 4:3 cards only move sideways and use its first. The financing
// page heroes show the whole 3:2 master, so program images need no position.

import type { StaticImageData } from "next/image";
import type { ProgramFamily } from "@/content/programs/types";
import aboutCalifornia from "@/assets/images/about-california.webp";
import familyCommercial from "@/assets/images/family-commercial.webp";
import familyConstruction from "@/assets/images/family-construction.webp";
import familyHardMoney from "@/assets/images/family-hard-money.webp";
import familyHotels from "@/assets/images/family-hotels.webp";
import familyMultifamily from "@/assets/images/family-multifamily.webp";
import familySeniorLiving from "@/assets/images/family-senior-living.webp";
import homeHero from "@/assets/images/home-hero.webp";
import programAcquisitionLoans from "@/assets/images/program-acquisition-loans.webp";
import programAssistedLiving from "@/assets/images/program-assisted-living.webp";
import programBankCreditUnionLoans from "@/assets/images/program-bank-credit-union-loans.webp";
import programBridgeToHud from "@/assets/images/program-bridge-to-hud.webp";
import programCmbsLoans from "@/assets/images/program-cmbs-loans.webp";
import programConstructionLoans from "@/assets/images/program-construction-loans.webp";
import programConstructionToPermanent from "@/assets/images/program-construction-to-permanent.webp";
import programDebtFundBridgeLoans from "@/assets/images/program-debt-fund-bridge-loans.webp";
import programDscrInvestor from "@/assets/images/program-dscr-investor.webp";
import programFannieMaeMultifamily from "@/assets/images/program-fannie-mae-multifamily.webp";
import programFreddieMacMultifamily from "@/assets/images/program-freddie-mac-multifamily.webp";
import programHotelCmbs from "@/assets/images/program-hotel-cmbs.webp";
import programHud221d4 from "@/assets/images/program-hud-221d4.webp";
import programHud223a7 from "@/assets/images/program-hud-223a7.webp";
import programHud223fMultifamily from "@/assets/images/program-hud-223f-multifamily.webp";
import programHud223fSeniorHousing from "@/assets/images/program-hud-223f-senior-housing.webp";
import programHud232 from "@/assets/images/program-hud-232.webp";
import programIndustrialLoans from "@/assets/images/program-industrial-loans.webp";
import programLifeCompanyLoans from "@/assets/images/program-life-company-loans.webp";
import programMedicalOfficeLoans from "@/assets/images/program-medical-office-loans.webp";
import programMezzaninePreferredEquity from "@/assets/images/program-mezzanine-preferred-equity.webp";
import programMixedUseLoans from "@/assets/images/program-mixed-use-loans.webp";
import programMobileHomeParkLoans from "@/assets/images/program-mobile-home-park-loans.webp";
import programMultifamilyBridge from "@/assets/images/program-multifamily-bridge.webp";
import programOfficeLoans from "@/assets/images/program-office-loans.webp";
import programPrivateBridge from "@/assets/images/program-private-bridge.webp";
import programRetailLoans from "@/assets/images/program-retail-loans.webp";
import programSba504Hotel from "@/assets/images/program-sba-504-hotel.webp";
import programSba7a504HotelStack from "@/assets/images/program-sba-7a-504-hotel-stack.webp";
import programSelfStorageLoans from "@/assets/images/program-self-storage-loans.webp";
import programSkilledNursing from "@/assets/images/program-skilled-nursing.webp";
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

/**
 * The family's image in the hero of its financing hub (3:2), on the family's
 * card on the homepage and its row on /financing (4:3, from md and lg), and
 * the fallback for a program page without an image of its own.
 */
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
  commercial: {
    src: familyCommercial,
    alt: "A two-story glass and stone office building beside a single-story flex building with clerestory windows and roll-up doors, across a landscaped plaza",
    // Both buildings span the frame; the 4:3 cards trim the edges evenly.
    position: "50% 55%",
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

// The structure images, named so the program pages below reuse the same
// objects (one file, one alt text) rather than copies.
const assistedLivingHome: SiteImage = {
  src: structureAssistedLiving504,
  alt: "Single-story craftsman-style house with a wide covered porch, an accessible ramp with metal handrails, a front lawn and mature trees",
  position: "55% 85%",
};
const hotelUnderRenovation: SiteImage = {
  src: structureHotel504Pip,
  alt: "Four-story hotel under renovation, one wing behind scaffolding with new facade panels, solar panels on the roof and a covered entrance",
  position: "45% 90%",
};
const memoryCareCourtyard: SiteImage = {
  src: structureMemoryCareBridge,
  alt: "Enclosed garden courtyard of a two-story building with a winding gravel path, a round stone planter, wooden benches and a pergola",
  position: "50% 55%",
};
const motelConversion: SiteImage = {
  src: structureHotelToAssistedLiving,
  alt: "Two-story stucco building with arched walkways and a tile roof, a new entry ramp with handrails being built, and palm trees",
  position: "55% 85%",
};
const apartmentsNearingCompletion: SiteImage = {
  src: structureMultifamilyConstruction,
  alt: "Five-story apartment building nearing completion: warm-white panels and gray weather barrier over a light stone base, solar panels and heat pumps on the roof",
  position: "50% 75%",
};
const apartmentsMidRehab: SiteImage = {
  src: structureInvestorRehab,
  alt: "Two-story apartment building mid-renovation, with scaffolding at one end, new windows on pallets, a covered dumpster and partly primed stucco",
  position: "75% 90%",
};

/**
 * Image for each illustrative structure, keyed by its slug in
 * content/deal-structures.ts (images.test.ts checks every key is one): 16:9 on
 * the structure page, 4:3 on its card on /structures.
 */
export const STRUCTURE_IMAGES: Partial<Record<string, SiteImage>> = {
  "assisted-living-sba-504-refinance": assistedLivingHome,
  "flagged-hotel-sba-504-green-pip": hotelUnderRenovation,
  "memory-care-bridge-to-hud": memoryCareCourtyard,
  "hotel-to-assisted-living-conversion-bridge": motelConversion,
  "multifamily-construction-bank-cpace": apartmentsNearingCompletion,
  "investor-rehab-hard-money": apartmentsMidRehab,
};

export function structureImage(slug: string): SiteImage | null {
  return STRUCTURE_IMAGES[slug] ?? null;
}

/**
 * A program page's own hero image (3:2, uncropped), keyed by its slug in
 * content/programs (images.test.ts checks every key is a program, not a hub).
 * Six reuse the structure image of the same kind of deal; the rest were made
 * for their page (2026-11-05). Hard money is a program that doubles as its
 * family's hub, so it shows the family image.
 */
export const PROGRAM_IMAGES: Partial<Record<string, SiteImage>> = {
  // Reused structure images.
  "fix-and-flip": apartmentsMidRehab,
  "pip-bridge": hotelUnderRenovation,
  "hotel-to-senior-living-conversion": motelConversion,
  "memory-care": memoryCareCourtyard,
  rcfe: assistedLivingHome,
  "c-pace": apartmentsNearingCompletion,
  // Made for the page.
  "acquisition-loans": { src: programAcquisitionLoans, alt: "A single-story multi-tenant office building with stone-clad covered entries and mature oak trees" },
  "assisted-living": { src: programAssistedLiving, alt: "A three-story assisted living residence with balconies, a covered arrival court and a shaded terrace with outdoor chairs" },
  "bank-credit-union-loans": { src: programBankCreditUnionLoans, alt: "A two-story brick and glass professional office building with a landscaped front walk" },
  "bridge-to-hud": { src: programBridgeToHud, alt: "A newly renovated two-story care building with a tile roof, a new entry walk with handrails and young staked trees" },
  "cmbs-loans": { src: programCmbsLoans, alt: "A neighborhood shopping center with an anchor store facade, inline shops and wide landscaped walkways" },
  "construction-loans": { src: programConstructionLoans, alt: "A four-story concrete frame under construction with a tower crane, behind a fenced site with stacked materials" },
  "construction-to-permanent": { src: programConstructionToPermanent, alt: "A newly completed four-story apartment building with fresh lawn, young trees and a short temporary fence at one corner" },
  "debt-fund-bridge-loans": { src: programDebtFundBridgeLoans, alt: "A three-story office building being re-clad in light panels, with a new glass entry under construction" },
  "dscr-investor": { src: programDscrInvestor, alt: "A two-story fourplex with four wood front doors, small balconies and a low front wall on a tree-lined street" },
  "fannie-mae-multifamily": { src: programFannieMaeMultifamily, alt: "An open gate into an apartment courtyard with a lawn, a wood pergola and lounge seating" },
  "freddie-mac-multifamily": { src: programFreddieMacMultifamily, alt: "A row of three-story townhome-style apartments with front stoops and small gardens along a walkway" },
  "hotel-cmbs": { src: programHotelCmbs, alt: "An eight-story limestone and glass hotel tower with a wide drop-off canopy and a landscaped arrival plaza" },
  "hud-221d4": { src: programHud221d4, alt: "A newly built five-story apartment building with balconies, new street trees and fresh landscaping" },
  "hud-223a7": { src: programHud223a7, alt: "Two-story garden apartments with clay tile roofs, cream stucco and mature trees" },
  "hud-223f-multifamily": { src: programHud223fMultifamily, alt: "A three-story garden-style apartment building with breezeway stairs, mature trees and a courtyard lawn" },
  "hud-223f-senior-housing": { src: programHud223fSeniorHousing, alt: "A single-story senior living community with a clay tile roof, covered walkways and mature oak trees across a lawn" },
  "hud-232": { src: programHud232, alt: "A two-story senior care campus with a covered entry canopy, a wide front lawn and garden paths" },
  // The approved alt said "closed loading doors"; "closed" is kept out of every alt (images.test.ts) so none reads as a closed deal.
  "industrial-loans": { src: programIndustrialLoans, alt: "A single-story concrete warehouse with clerestory windows, a row of loading doors and an office corner" },
  "life-company-loans": { src: programLifeCompanyLoans, alt: "A two-story limestone office building with a tall glass entry, clipped hedges and mature oak trees" },
  "medical-office-loans": { src: programMedicalOfficeLoans, alt: "A two-story glass and stone medical office building with a covered drop-off entry and a garden with benches" },
  "mezzanine-preferred-equity": { src: programMezzaninePreferredEquity, alt: "An eight-story glass and stone building nearing completion, with its ground floor behind a low barrier" },
  "mixed-use-loans": { src: programMixedUseLoans, alt: "A four-story mixed-use building with ground-floor shopfronts and apartments with planted balconies above, on a tree-lined sidewalk" },
  "mobile-home-park-loans": { src: programMobileHomeParkLoans, alt: "Rows of manufactured homes with porches and gardens along a quiet lane leading to a clubhouse" },
  "multifamily-bridge": { src: programMultifamilyBridge, alt: "A three-story apartment building mid-renovation, half repainted white, with new windows stacked on pallets" },
  "office-loans": { src: programOfficeLoans, alt: "A four-story office building with a glass curtain wall and stone fins, behind an entry plaza with planters and benches" },
  "private-bridge": { src: programPrivateBridge, alt: "A vacant two-story commercial building with empty glass storefronts and a landscaped frontage" },
  "retail-loans": { src: programRetailLoans, alt: "A single-story row of shops with green awnings, a covered walkway and planters" },
  "sba-504-hotel": { src: programSba504Hotel, alt: "A three-story select-service hotel with a stone and stucco facade and a covered drop-off canopy" },
  "sba-7a-504-hotel-stack": { src: programSba7a504HotelStack, alt: "A two-story courtyard hotel around a pool with loungers, umbrellas and palm trees" },
  "self-storage-loans": { src: programSelfStorageLoans, alt: "A three-story self-storage building with a metal and glass facade above a row of roll-up doors" },
  "skilled-nursing": { src: programSkilledNursing, alt: "A single-story skilled nursing facility with a stone-columned entry canopy and ramps with handrails" },
};

export function programImage(slug: string): SiteImage | null {
  return PROGRAM_IMAGES[slug] ?? null;
}

/**
 * The image in a financing page's hero: the program's own, else its family's,
 * else none. A hub (hard money included) has no program image, so it shows
 * the family's.
 */
export function pageImageFor(entry: { slug: string; family: ProgramFamily }): SiteImage | null {
  return programImage(entry.slug) ?? familyImage(entry.family);
}

/**
 * Financing pages that show no image yet, by slug. Empty since 2026-11-05:
 * every hub and program page has one. images.test.ts fails unless this list
 * is exactly the financing pages without an image, so a page added without
 * an image must be listed here (or given one) for the suite to pass.
 */
export const PENDING_IMAGES: readonly string[] = [];
