// When each part of the public site last changed in substance (copy, figures
// or structure a reader would notice), as ISO dates. Feeds the sitemap's
// <lastmod> and the "Updated" line on financing, structure, calculator and city
// pages. Update the entry in the same change that edits the page's content;
// layout-only and metadata-only changes do not count. Dates come from the
// repository history, never from the build clock, so every deploy does not
// claim that every page changed.
//
// Articles carry their own `updated` date (content/insights) and are not here.
// /rates is left out: its figures change every business day.

export const CONTENT_UPDATED = {
  home: "2026-11-05",
  express: "2026-11-04",
  partners: "2026-11-05",
  financing: "2026-11-05",
  structures: "2026-11-02",
  calculators: "2026-11-02",
  california: "2026-11-02",
  glossary: "2026-11-02",
  about: "2026-11-04",
  team: "2026-11-06",
  contact: "2026-11-02",
  newsletter: "2026-11-02",
  legal: "2026-11-02",
} as const satisfies Record<string, string>;

const BY_PREFIX: readonly [prefix: string, date: string][] = [
  ["/express", CONTENT_UPDATED.express],
  ["/partners", CONTENT_UPDATED.partners],
  ["/financing", CONTENT_UPDATED.financing],
  ["/structures", CONTENT_UPDATED.structures],
  ["/calculators", CONTENT_UPDATED.calculators],
  ["/california", CONTENT_UPDATED.california],
  ["/glossary", CONTENT_UPDATED.glossary],
  ["/about", CONTENT_UPDATED.about],
  ["/team", CONTENT_UPDATED.team],
  ["/contact", CONTENT_UPDATED.contact],
  ["/newsletter", CONTENT_UPDATED.newsletter],
  ["/privacy", CONTENT_UPDATED.legal],
  ["/terms", CONTENT_UPDATED.legal],
  ["/licensing", CONTENT_UPDATED.legal],
  ["/accessibility", CONTENT_UPDATED.legal],
];

/** Last substantive content change for a site path, or undefined when not tracked here. */
export function contentUpdated(path: string): string | undefined {
  if (path === "/") return CONTENT_UPDATED.home;
  return BY_PREFIX.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))?.[1];
}

/** "November 5, 2026" for an ISO date, independent of the server's time zone. */
export function formatContentDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}
