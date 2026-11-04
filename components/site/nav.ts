// Single source for the public header, mobile menu and footer links. Pure data:
// it imports only the family list and labels from `content/programs/types`,
// never `content/programs/index`, so the client header does not ship every
// program's copy. components/trust/pages.test.ts reads this file as source, so
// keep each href a literal `href: "/path"` property.

import { FAMILY_LABELS, PROGRAM_FAMILIES, type ProgramFamily } from "@/content/programs/types";

export type NavLink = { href: string; label: string };

/** The family hubs, in the order of PROGRAM_FAMILIES. */
export const FINANCING_FAMILIES: NavLink[] = PROGRAM_FAMILIES.map((f) => ({
  href: `/financing/${f}`,
  label: FAMILY_LABELS[f],
}));

export const ALL_FINANCING: NavLink = { href: "/financing", label: "All financing programs" };

/** Program pages customers ask for most, shown in the Financing flyout. */
export const POPULAR_PROGRAMS: NavLink[] = [
  { href: "/financing/hud-232", label: "HUD 232" },
  { href: "/financing/hud-223f-multifamily", label: "HUD 223(f) multifamily" },
  { href: "/financing/hud-221d4", label: "HUD 221(d)(4)" },
  { href: "/financing/sba-7a-504-hotel-stack", label: "SBA 7(a) + 504 hotel stack" },
  { href: "/financing/hotel-cmbs", label: "Hotel CMBS" },
  { href: "/financing/bridge-to-hud", label: "Bridge-to-HUD" },
  { href: "/financing/construction-to-permanent", label: "Construction-to-permanent" },
  { href: "/financing/fix-and-flip", label: "Fix-and-flip loans" },
];

/** Plain links in the bar, after the Financing flyout. Glossary, Partners, Insights and Track record live in the footer. */
export const PRIMARY_LINKS: NavLink[] = [
  { href: "/rates", label: "Rates" },
  { href: "/calculators", label: "Calculators" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

/** The one primary call to action. `shortLabel` shows only on phones narrower than 360px. */
export const HEADER_CTA = { href: "/express", label: "Get loan options", shortLabel: "Get options" } as const;

export const SIZER_LINK: NavLink = { href: "/#sizer", label: "Size my loan" };

/** "Book a call" once online scheduling is configured; content/contact.ts `callLink()` picks this or the email fallback. */
export const CALL_LINK: NavLink = { href: "/contact#schedule", label: "Book a call" };

/** The primary call to action for a family's pages: the qualifier opens on that family's step 1. */
export function expressHrefFor(family?: ProgramFamily): string {
  return family ? `${HEADER_CTA.href}?family=${family}` : HEADER_CTA.href;
}

/** The sizer link for a family's pages: the homepage sizer opens on that family's tab (components/sizer/tabs.ts). */
export function sizerLinkFor(family?: ProgramFamily): NavLink {
  return family ? { href: `/?sizer=${family}#sizer`, label: SIZER_LINK.label } : SIZER_LINK;
}

/** Sign-in links in the footer. Both paths are noindex and robots-disallowed. */
export const ACCOUNT_LINKS: NavLink[] = [
  { href: "/portal", label: "Borrower portal" },
  { href: "/login", label: "Staff sign in" },
];
