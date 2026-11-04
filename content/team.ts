// Advisor roster for /team. Entries are data, not copy written by the site:
// every field here must be true and supplied by the person it describes.
//
// Placeholder entries are allowed while profiles are being collected. A
// placeholder's bio starts with `TODO: bio pending`; it renders (clearly marked)
// on preview and development builds so layout can be reviewed, and is hidden
// from production. A licensed role also needs a valid DRE license ID before it
// is shown in production, because California expects the license number on
// first-point-of-contact material (Bus. & Prof. Code § 10140.6).

import { DRE_LICENSE_PATTERN, dreLookupUrl, site } from "@/lib/site";

export type TeamRole = "broker" | "salesperson" | "analyst" | "operations";

/** Roles that hold a DRE license and must show the number. */
export const LICENSED_ROLES: readonly TeamRole[] = ["broker", "salesperson"];

export interface TeamMember {
  slug: string;
  name: string;
  title: string;
  role: TeamRole;
  /** Eight-digit DRE license ID. Leave empty until the licensee confirms it. */
  licenseId: string;
  /** Plain-text bio written by or approved by the person. Start with the placeholder marker until then. */
  bio: string;
  /** Programs or asset types the advisor works on, e.g. "HUD 232". */
  focus: readonly string[];
  /** Public work email, only if the person wants one listed. */
  email?: string;
}

export const BIO_PLACEHOLDER_MARKER = "TODO: bio pending";

export const TEAM: readonly TeamMember[] = [
  {
    slug: "neeli-khanna",
    name: site.designatedOfficer,
    title: "Designated officer and broker",
    role: "broker",
    // Same variable the licensing page uses; empty means "not confirmed yet".
    licenseId: site.dreOfficerLicense,
    bio: `${BIO_PLACEHOLDER_MARKER}. Replace with a bio written or approved by ${site.designatedOfficer}.`,
    focus: [],
  },
];

export function isPlaceholderBio(bio: string): boolean {
  const text = bio.trim();
  return text === "" || text.toUpperCase().startsWith(BIO_PLACEHOLDER_MARKER.toUpperCase());
}

export function isValidLicenseId(id: string): boolean {
  const trimmed = id.trim();
  return DRE_LICENSE_PATTERN.test(trimmed) && !/^0+$/.test(trimmed);
}

export type LicenseDisplay =
  | { kind: "verified"; id: string; lookupUrl: string }
  /** Licensed role without a usable number. Shown as a placeholder outside production; never shown in production. */
  | { kind: "pending" }
  /** Role that does not need a license. */
  | { kind: "none" };

export function licenseDisplay(member: Pick<TeamMember, "role" | "licenseId">): LicenseDisplay {
  if (isValidLicenseId(member.licenseId)) {
    const id = member.licenseId.trim();
    return { kind: "verified", id, lookupUrl: dreLookupUrl(id) };
  }
  return LICENSED_ROLES.includes(member.role) ? { kind: "pending" } : { kind: "none" };
}

export interface TeamViewOptions {
  /** True on a production deployment (see `deploymentEnv`). */
  production: boolean;
}

export interface TeamCard {
  member: TeamMember;
  license: LicenseDisplay;
  /** True when the bio is still a placeholder; only possible outside production. */
  placeholder: boolean;
}

/**
 * Cards to render. Production shows only complete entries: a real bio and, for
 * licensed roles, a valid license number. Other environments show everything
 * and flag what is still missing.
 */
export function teamCards(members: readonly TeamMember[], { production }: TeamViewOptions): TeamCard[] {
  const cards = members.map((member) => ({
    member,
    license: licenseDisplay(member),
    placeholder: isPlaceholderBio(member.bio),
  }));
  if (!production) return cards;
  return cards.filter((c) => !c.placeholder && c.license.kind !== "pending");
}
