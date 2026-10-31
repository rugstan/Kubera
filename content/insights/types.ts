// Typed shape of an /insights article. Articles are TypeScript data (no MDX
// build step), so every figure can be computed from lib/sizing/assumptions.ts
// or lib/calculators and cannot drift from the sizer.

export const INSIGHT_CATEGORIES = ["Multifamily", "Senior living", "Hotels", "Underwriting", "California"] as const;
export type InsightCategory = (typeof INSIGHT_CATEGORIES)[number];

export interface InsightSection {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
}

export interface InsightFaq {
  question: string;
  answer: string;
}

export interface InsightLink {
  /** Site path, e.g. `/financing/hud-232` or `/calculators/dscr`. */
  href: string;
  label: string;
}

export interface Insight {
  /** URL segment under /insights. */
  slug: string;
  /** Headline shown as the H1 and in Article markup. */
  title: string;
  /** Short title for `<title>`; the root template appends the brand, so keep it within 39 characters. */
  metaTitle: string;
  /** Meta description, 80 to 160 characters. */
  description: string;
  category: InsightCategory;
  /** ISO dates. `updated` equals `published` until the article is revised. */
  published: string;
  updated: string;
  /** Two or three sentences that stand alone as the answer to the headline. */
  summary: string;
  keyTakeaways: string[];
  sections: InsightSection[];
  faq: InsightFaq[];
  /** Pages the reader should visit next: programs, calculators, glossary. */
  related: InsightLink[];
  /** Primary sources the article relies on (rules, notices, handbooks). */
  sources: string[];
  /** Shows the "draft pending counsel review" notice until NEXT_PUBLIC_LEGAL_APPROVED is "true". */
  legalDraft?: boolean;
}
