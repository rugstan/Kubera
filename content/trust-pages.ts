// Page-level metadata and sitemap entries for the trust pages (/about, /team,
// /contact, /track-record, /structures). One list feeds the page `metadata`
// exports, `app/sitemap.ts`, `llms.txt` and the tests, so titles, descriptions
// and routes cannot disagree. Titles omit the brand; the root layout appends it.

import type { SitemapRoute } from "@/lib/seo/sitemap-routes";
import { DEAL_STRUCTURES, structurePath } from "./deal-structures";
import { publishableRecords } from "./track-record";

export interface TrustPageMeta {
  path: string;
  title: string;
  description: string;
  priority: number;
}

export const TRUST_PAGES = {
  about: {
    path: "/about",
    title: "About us",
    description: "Kubera Commercial is a licensed California real estate broker that arranges commercial loans. We are not a lender. See our licenses and how we work.",
    priority: 0.7,
  },
  team: {
    path: "/team",
    title: "Our advisors",
    description: "The licensed advisors who lead every Kubera Commercial engagement, with their California DRE license numbers.",
    priority: 0.5,
  },
  contact: {
    path: "/contact",
    title: "Contact",
    description: "Reach Kubera Commercial by email, phone or scheduled call. See which mailbox to use for borrowers, lenders, partners, vendors and compliance.",
    priority: 0.7,
  },
  trackRecord: {
    path: "/track-record",
    title: "Track record",
    description: "How Kubera Commercial reports closed transactions, and where to see representative loan structures in the meantime.",
    priority: 0.5,
  },
  structures: {
    path: "/structures",
    title: "Representative loan structures",
    description: "Illustrative debt structures for senior living, hotels, construction and hard money, showing how HUD, SBA, bridge and private loans are arranged.",
    priority: 0.6,
  },
} as const satisfies Record<string, TrustPageMeta>;

/** Trust pages worth indexing now: /track-record waits for its first published closing (it is noindex until then). */
export function indexedTrustPages(records = publishableRecords()): TrustPageMeta[] {
  return Object.values(TRUST_PAGES).filter((p) => p.path !== TRUST_PAGES.trackRecord.path || records.length > 0);
}

export const trustRoutes: SitemapRoute[] = [
  ...indexedTrustPages().map((p) => ({
    path: p.path,
    title: p.title,
    description: p.description,
    changeFrequency: "monthly" as const,
    priority: p.priority,
    section: "Company" as const,
  })),
  ...DEAL_STRUCTURES.map((s) => ({
    path: structurePath(s.slug),
    title: s.metaTitle,
    description: s.summary,
    changeFrequency: "monthly" as const,
    priority: 0.5,
    section: "Programs" as const,
  })),
];
