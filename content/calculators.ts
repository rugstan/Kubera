// Copy and metadata for the four calculators under /calculators. The numbers
// behind them live in lib/calculators (which reads lib/sizing/assumptions.ts);
// this file holds only words: titles, the definition-first lead, how the math
// works, and the FAQ that feeds FAQPage markup.

import type { SitemapRoute } from "@/lib/seo/sitemap-routes";
import { AGENCY, CMBS, HUD, SBA } from "@/lib/sizing/assumptions";

export const CALCULATORS_BASE = "/calculators";

export interface CalculatorFaq {
  question: string;
  answer: string;
}

export interface CalculatorPage {
  slug: "dscr" | "hud-mip" | "sba-504" | "hotel-debt-yield";
  /** Short name used in cards and breadcrumbs. */
  name: string;
  /** Page title without the brand suffix (the root template appends it; keep the result within 60 characters). */
  title: string;
  /** Meta description, 160 characters or fewer. */
  description: string;
  /** One sentence for cards and llms.txt. */
  summary: string;
  /** Definition-first lead: starts by saying what the measure is. */
  definition: string;
  /** What the calculator does and the formula behind it. */
  howItWorks: string[];
  /** Plain-English guidance on reading the result. */
  readingTheResult: string[];
  faq: CalculatorFaq[];
  /** Financing page slugs under /financing. */
  relatedPrograms: string[];
  /** Glossary term anchors. */
  relatedTerms: string[];
}

const pct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`;
const x = (n: number) => `${n.toFixed(2)}x`;

export const CALCULATORS: readonly CalculatorPage[] = [
  {
    slug: "dscr",
    name: "DSCR calculator",
    title: "DSCR calculator for commercial loans",
    description: "Free DSCR calculator: find debt service coverage, debt yield and the largest loan your net operating income supports at a lender's required coverage.",
    summary: "Coverage, debt yield and maximum loan from net operating income, rate and amortization.",
    definition:
      "Debt service coverage ratio (DSCR) is a property's annual net operating income divided by its annual loan payments. A DSCR of 1.25x means the property earns $1.25 for every $1.00 it owes the lender each year. Most commercial lenders set a minimum, and on many deals coverage, not loan-to-value, is the limit that decides how much you can borrow.",
    howItWorks: [
      "Enter net operating income, the loan amount, the interest rate and the amortization. The calculator finds the level monthly payment, multiplies by twelve for annual debt service, and divides income by that figure. Set the amortization to zero for an interest-only loan.",
      "It also works backward: dividing income by the required coverage gives the debt service the property can carry, and dividing that by the loan constant (annual payment per dollar borrowed) gives the largest loan at that rate and amortization.",
      "Use the lender type menu to start from a typical minimum: " +
        `HUD Section 232 ${x(HUD.section232.refi.minDscr)}, HUD market-rate multifamily ${x(HUD.multifamily.s223f.minDscr)}, agency multifamily ${x(AGENCY.minDscr)}, SBA ${x(SBA.minDscr)} and hotel CMBS ${x(CMBS.minDscr)}. These are Corin's sizing assumptions; each lender sets its own.`,
    ],
    readingTheResult: [
      "If coverage is below the minimum, three levers help: a smaller loan, a longer amortization, or a lower rate. Interest-only periods raise coverage during the interest-only years, but lenders usually test coverage on the amortizing payment as well.",
      "Coverage is only as good as the income behind it. Lenders re-underwrite income, so expect them to adjust vacancy, management fees and reserves before they run the ratio.",
    ],
    faq: [
      { question: "What is a good DSCR for a commercial loan?", answer: `It depends on the program. Corin's sizing assumptions use ${x(HUD.multifamily.s223f.minDscr)} for HUD market-rate multifamily, ${x(AGENCY.minDscr)} for agency multifamily, ${x(SBA.minDscr)} for SBA, ${x(HUD.section232.refi.minDscr)} for HUD Section 232 senior housing and ${x(CMBS.minDscr)} for hotel CMBS. Each lender sets its own minimum, and many want more cushion than the minimum.` },
      { question: "How is DSCR different from debt yield?", answer: "DSCR compares income to the loan payment, so it depends on the interest rate and amortization. Debt yield compares income to the loan balance and ignores rate and amortization, which is why lenders use it as a second check." },
      { question: "Does an interest-only loan improve DSCR?", answer: "It raises coverage while the loan is interest-only, because there is no principal in the payment. Many lenders size on the amortizing payment anyway, so check which payment your lender tests." },
      { question: "Which income should I enter?", answer: "Use net operating income: rents and other property income less operating expenses, before debt service, income taxes and depreciation. A lender will re-underwrite it, so a conservative figure gives a more realistic answer." },
      { question: "Is this a quote?", answer: "No. The result is an indicative estimate for discussion. It is not a commitment to lend or a rate lock, and lenders make their own underwriting decisions." },
    ],
    relatedPrograms: ["hud-232", "hud-223f-multifamily", "fannie-mae-multifamily", "dscr-investor", "hotel-cmbs"],
    relatedTerms: ["dscr", "noi", "debt-yield", "loan-constant", "amortization"],
  },
  {
    slug: "hud-mip",
    name: "HUD MIP calculator",
    title: "HUD mortgage insurance (MIP) calculator",
    description: "Estimate the HUD mortgage insurance premium for 223(f), 221(d)(4) and Section 232 loans: upfront and annual MIP, the payment with MIP and the ten-year cost.",
    summary: "Upfront and annual HUD mortgage insurance premium and the payment with MIP.",
    definition:
      "The HUD mortgage insurance premium (MIP) is the fee a borrower pays for FHA insurance on a HUD-insured multifamily or healthcare loan. It has two parts: an upfront premium paid at closing, and an annual premium charged as a percentage of the average outstanding principal balance and collected monthly with the payment.",
    howItWorks: [
      `For multifamily programs (223(f), 221(d)(4)) the calculator uses a flat ${pct(HUD.multifamily.mip.annual, 2)} annual premium and a ${pct(HUD.multifamily.mip.upfront, 2)} upfront premium. The flat rate follows Federal Register 2025-18379 for applications on or after ${HUD.multifamily.mip.effectiveForApplicationsOnOrAfter}. The upfront figure rests on a secondary source, so confirm it with a HUD lender.`,
      `For Section 232 it uses the schedule in Corin's assumptions: ${pct(HUD.section232.refi.annualMip, 2)} annual on a refinance or purchase and ${pct(HUD.section232.newConstruction.annualMip, 2)} on new construction, with ${pct(HUD.section232.refi.upfrontMip, 2)} upfront. Whether the flat ${pct(HUD.multifamily.mip.annual, 2)} notice reaches Section 232 has not been confirmed, so treat the 232 rows as figures to verify.`,
      "The annual premium is charged on the average balance for each year, so it falls as the loan amortizes. The calculator walks the amortization schedule month by month and shows year one, the first ten years and the full term.",
    ],
    readingTheResult: [
      "Year one is the highest premium year. Compare the all-in rate (note rate plus premium) across programs rather than the note rate alone, and remember HUD loans also carry the lender's financing fee, third-party reports and an annual audit.",
      "Green certification no longer lowers the HUD premium, so do not count on a green discount when you compare structures.",
    ],
    faq: [
      { question: "What is the HUD MIP for a 223(f) loan?", answer: `Corin's assumptions use a flat ${pct(HUD.multifamily.mip.annual, 2)} annual premium for FHA multifamily applications on or after ${HUD.multifamily.mip.effectiveForApplicationsOnOrAfter}, from Federal Register 2025-18379, plus an upfront premium that is configurable (default ${pct(HUD.multifamily.mip.upfront, 2)}). Confirm the current figures with a HUD lender.` },
      { question: "Does a green building lower my MIP?", answer: "No. The 2025 notice removed the green, affordable and broadly affordable premium categories for multifamily, so green certification no longer lowers the HUD MIP." },
      { question: "Is the MIP the same for Section 232 senior housing?", answer: `Not in Corin's assumptions. Section 232 is not changed by Mortgagee Letter 2025-03, and the calculator uses ${pct(HUD.section232.refi.annualMip, 2)} annual for refinances and ${pct(HUD.section232.newConstruction.annualMip, 2)} for new construction. Whether the flat multifamily notice reaches Section 232 has not been confirmed.` },
      { question: "Why does the premium fall each year?", answer: "HUD charges the annual premium on the average outstanding principal balance for the year. As the loan amortizes the balance shrinks, so the premium does too." },
      { question: "Is the upfront MIP paid in cash?", answer: "It is due at closing and is often funded as part of the closing costs or financed into the loan, depending on the structure. Your HUD lender will show how it is handled." },
    ],
    relatedPrograms: ["hud-232", "hud-223f-multifamily", "hud-221d4", "hud-223a7", "bridge-to-hud"],
    relatedTerms: ["mip", "hud-232", "hud-223f", "hud-221d4", "dscr"],
  },
  {
    slug: "sba-504",
    name: "SBA 504 calculator",
    title: "SBA 504 loan and debenture calculator",
    description: "Model an SBA 504 loan: the bank first lien, the CDC debenture, your equity injection, blended rate, payments and coverage for a project cost.",
    summary: "Bank, debenture and equity split for an SBA 504 project, with payments and coverage.",
    definition:
      "An SBA 504 loan is a fixed-rate, long-term loan for owner-occupied commercial real estate and major equipment, structured as two loans: a first lien from a bank for about half of the project and a second lien from a Certified Development Company (CDC) debenture, backed by the SBA, for up to about 40%. The borrower contributes the rest as equity.",
    howItWorks: [
      `The calculator starts from total project cost. The bank first lien is ${pct(SBA.bankFirstPct)} of cost. Equity is ${pct(SBA.equity.base)} as a base, plus ${pct(SBA.equity.specialPurpose)} for special-purpose property such as hotels and care facilities, plus ${pct(SBA.equity.newBusiness)} for a start-up or new construction. The debenture is what remains, up to a cap of $${(SBA.cdcCap / 1_000_000).toFixed(1)}M, or $${(SBA.cdcCapGreen / 1_000_000).toFixed(1)}M for energy-efficient and manufacturing projects.`,
      `Both loans are priced on a ${SBA.bankAmortYears}-year amortization. The debenture rate defaults to the 10-year Treasury plus a mid-range spread and the bank rate to the 5-year Treasury plus a spread; overwrite either. Ongoing SBA, CDC servicing and related fees (${pct(SBA.annualDebentureFees, 2)} a year on the debenture) are added to debt service before coverage is measured against the ${x(SBA.minDscr)} minimum.`,
    ],
    readingTheResult: [
      "If the debenture cap binds, the table shows how much more equity the structure needs. A larger bank first lien or an SBA 7(a) stack are the usual alternatives; the 7(a) plus 504 combination is covered on the hotel stack page.",
      "SBA program rules change by SOP revision, so confirm the revision in effect when you apply. The operating company must occupy at least 51% of the property.",
    ],
    faq: [
      { question: "How much equity does an SBA 504 hotel loan need?", answer: `Corin's assumptions use ${pct(SBA.equity.base)} as a base, ${pct(SBA.equity.specialPurpose)} more for special-purpose property such as hotels, and ${pct(SBA.equity.newBusiness)} more for a start-up or new construction, so ${pct(SBA.equity.base + SBA.equity.specialPurpose)} for an existing hotel purchase and ${pct(SBA.equity.base + SBA.equity.specialPurpose + SBA.equity.newBusiness)} for ground-up. Confirm against the SOP in effect at application.` },
      { question: "What is the maximum SBA 504 debenture?", answer: `The standard cap in Corin's assumptions is $${(SBA.cdcCap / 1_000_000).toFixed(1)}M per project, and $${(SBA.cdcCapGreen / 1_000_000).toFixed(1)}M for energy-efficient and manufacturing projects. Rules change by SOP revision, so confirm the current caps.` },
      { question: "Is the 504 rate fixed?", answer: "The CDC debenture is fixed for its term. The bank first lien is priced separately by the bank and may be fixed or adjustable." },
      { question: "Does the borrower need a personal guaranty?", answer: "Yes. The SBA requires personal guaranties from owners of 20% or more, so 504 is not a non-recourse program." },
      { question: "Is this a quote?", answer: "No. It is an indicative estimate. A bank and a CDC underwrite the actual loan, and rates are set when the debenture is sold." },
    ],
    relatedPrograms: ["sba-504-hotel", "sba-7a-504-hotel-stack", "hotel-cmbs", "pip-bridge"],
    relatedTerms: ["sba-504", "cdc", "debenture", "equity-injection", "dscr"],
  },
  {
    slug: "hotel-debt-yield",
    name: "Hotel debt yield calculator",
    title: "Hotel debt yield and loan size calculator",
    description: "Calculate a hotel's debt yield, RevPAR and loan per key, and see the largest CMBS loan across the debt yield, coverage and loan-to-value limits.",
    summary: "Debt yield, RevPAR and the largest hotel CMBS loan across the three limits.",
    definition:
      "Debt yield is a property's annual net operating income divided by the loan amount, expressed as a percentage. For a hotel it answers a simple question: if the lender had to take the property back, what return would the loan earn on income alone? Conduit (CMBS) lenders set a minimum debt yield by hotel type, and it often limits proceeds before loan-to-value does.",
    howItWorks: [
      "Enter keys, average daily rate, occupancy and trailing-12 net operating income (after the FF&E reserve), then the loan you are considering. The calculator multiplies ADR by occupancy for RevPAR, multiplies RevPAR by keys and 365 for rooms revenue, and divides NOI by the loan for debt yield.",
      `It then tests the loan against the three limits Corin assumes for hotel CMBS: a debt yield floor that depends on hotel type (${pct(CMBS.minDebtYield.PREMIUM_FLAG, 1)} premium flag, ${pct(CMBS.minDebtYield.ECONOMY_FLAG, 1)} economy flag, ${pct(CMBS.minDebtYield.BOUTIQUE_INDEPENDENT, 1)} boutique or independent), a ${x(CMBS.minDscr)} coverage minimum on a ${CMBS.amortYears}-year amortization at the rate you enter, and a ${pct(CMBS.maxLtv)} maximum loan-to-value if you provide a value. The smallest of the three is the binding constraint.`,
    ],
    readingTheResult: [
      "A debt yield below the floor means a smaller loan, more NOI, or a different structure. Bridge and SBA programs use different tests, so a hotel that misses the CMBS floor may still fit another box.",
      "The 10% NOI swing shows how fragile the margin is. Hotel income moves with demand, so lenders pay close attention to the trailing-12 trend.",
    ],
    faq: [
      { question: "What is a good debt yield for a hotel loan?", answer: `In Corin's CMBS assumptions the floor is ${pct(CMBS.minDebtYield.PREMIUM_FLAG, 1)} for premium-flag hotels, ${pct(CMBS.minDebtYield.ECONOMY_FLAG, 1)} for economy-flag hotels and ${pct(CMBS.minDebtYield.BOUTIQUE_INDEPENDENT, 1)} for boutique or independent hotels. Individual lenders vary.` },
      { question: "How is debt yield calculated?", answer: "Divide annual net operating income by the loan amount. A $1.8M NOI on a $15M loan is a 12.0% debt yield." },
      { question: "Why do CMBS lenders use debt yield?", answer: "It ignores interest rate, amortization and cap rate, so it compares loans on income and balance alone. That makes it a steadier test than coverage when rates move or when values are uncertain." },
      { question: "What is RevPAR?", answer: "Revenue per available room: average daily rate multiplied by occupancy. A $150 ADR at 70% occupancy is a $105 RevPAR." },
      { question: "What if my hotel misses the floor?", answer: "Options include a smaller loan, a bridge loan while income stabilizes, an SBA 504 structure for an owner-operator, or a PIP bridge for a hotel being renovated. An advisor can compare them." },
    ],
    relatedPrograms: ["hotel-cmbs", "pip-bridge", "sba-504-hotel", "hotels"],
    relatedTerms: ["debt-yield", "revpar", "adr", "pip", "cmbs"],
  },
];

export function getCalculator(slug: string): CalculatorPage | undefined {
  return CALCULATORS.find((c) => c.slug === slug);
}

export function calculatorPath(slug: string): string {
  return `${CALCULATORS_BASE}/${slug}`;
}

export const CALCULATORS_INDEX = {
  title: "Commercial real estate loan calculators",
  description: "Free calculators for DSCR, HUD mortgage insurance, SBA 504 and hotel debt yield, plus construction and hard money sizers on the same Corin assumptions.",
} as const;

export const calculatorRoutes: SitemapRoute[] = [
  {
    path: CALCULATORS_BASE,
    title: CALCULATORS_INDEX.title,
    description: CALCULATORS_INDEX.description,
    changeFrequency: "monthly",
    priority: 0.7,
    section: "Tools",
  },
  ...CALCULATORS.map(
    (c): SitemapRoute => ({
      path: calculatorPath(c.slug),
      title: c.name,
      description: c.summary,
      changeFrequency: "monthly",
      priority: 0.7,
      section: "Tools",
    }),
  ),
];
