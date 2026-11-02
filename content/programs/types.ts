// Typed shape of a financing page. Content lives in `content/programs/*.ts`;
// `components/program/*` and `app/(site)/financing/*` only render it.

export const PROGRAM_FAMILIES = ["senior-living", "hotels", "multifamily", "construction", "hard-money"] as const;
export type ProgramFamily = (typeof PROGRAM_FAMILIES)[number];

/**
 * Customer-facing name of each family. Lives here, with no imports, so client
 * components (the header and footer menus) can read it without pulling every
 * program's copy into the browser bundle.
 */
export const FAMILY_LABELS: Record<ProgramFamily, string> = {
  "senior-living": "Senior living",
  hotels: "Hotels",
  multifamily: "Multifamily",
  construction: "Construction",
  "hard-money": "Hard money and bridge",
};

/** One row of a page's facts table. Numbers come from `lib/sizing/assumptions.ts`, never retyped. */
export interface ProgramFact {
  label: string;
  value: string;
  /** Date the underlying figure was last checked (YYYY-MM-DD). */
  asOf: string;
  /** Where the figure comes from (program rule, notice, or Kubera's underwriting assumption). */
  source: string;
  /** True when the figure rests on a rule that changes by notice and must be re-checked with a lender. */
  verify: boolean;
}

export interface ProgramSection {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
}

export interface ProgramFaq {
  question: string;
  answer: string;
}

export interface ProgramEntry {
  /** URL segment under /financing. Unique across programs and hubs. */
  slug: string;
  family: ProgramFamily;
  /** Short display name, used in cards and breadcrumbs. */
  name: string;
  /** Page title without the brand suffix. The rendered title must stay within 60 characters. */
  title: string;
  /** Meta description, 160 characters or fewer. */
  description: string;
  /** One sentence for cards and llms.txt. */
  summary: string;
  /** Definition-first lead paragraph: "<Program> is ...". */
  definition: string;
  facts: ProgramFact[];
  sections: ProgramSection[];
  faq: ProgramFaq[];
  /** Slugs of related program pages (and hubs) for internal linking. */
  related: string[];
  /** schema.org LoanOrCredit `loanType`. */
  loanType: string;
  /** Typical amortization or term in years, when the program has one; feeds `loanTerm`. */
  loanTermYears?: number;
  /** The page doubles as its family's hub (used where a program and a hub share a URL). */
  isHub?: boolean;
}

export interface HubEntry {
  slug: string;
  family: ProgramFamily;
  name: string;
  title: string;
  description: string;
  summary: string;
  definition: string;
  sections: ProgramSection[];
  faq: ProgramFaq[];
  /** Slugs of other pages linked from this hub. */
  related: string[];
}

export type FinancingPage =
  | { kind: "program"; entry: ProgramEntry }
  | { kind: "hub"; entry: HubEntry };
