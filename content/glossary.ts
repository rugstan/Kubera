// Glossary of commercial real estate finance terms for /glossary. Each entry
// is a definition first, written to stand alone (it is also emitted as a
// DefinedTerm in the page's DefinedTermSet markup). Figures come from
// lib/sizing/assumptions.ts and lib/rules/california, never retyped.

import { AB1482, PROP13 } from "@/lib/rules/california";
import type { SitemapRoute } from "@/lib/seo/sitemap-routes";
import { disclosures } from "@/lib/site";
import { AGENCY, CMBS, HUD, SBA } from "@/lib/sizing/assumptions";

export const GLOSSARY_PATH = "/glossary";

export const GLOSSARY_CATEGORIES = ["Underwriting", "Loan terms", "Programs", "Property types", "California"] as const;
export type GlossaryCategory = (typeof GLOSSARY_CATEGORIES)[number];

export interface GlossaryTerm {
  /** Anchor id on the page and key for cross references. */
  slug: string;
  /** The term as displayed, spelled out. */
  term: string;
  /** Common abbreviation or alternate name, if any. */
  alias?: string;
  category: GlossaryCategory;
  /** One to three sentences. Starts with what the thing is. */
  definition: string;
  /** Other glossary slugs worth reading next. */
  related?: string[];
  /** Financing page slug under /financing, or a calculator path starting with /calculators. */
  learnMore?: string;
}

const pct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`;
const x = (n: number) => `${n.toFixed(2)}x`;

export const GLOSSARY: readonly GlossaryTerm[] = [
  {
    slug: "adr",
    term: "Average daily rate",
    alias: "ADR",
    category: "Property types",
    definition: "Average daily rate is a hotel's rooms revenue divided by the number of rooms sold. It measures price, while occupancy measures volume; multiplied together they give RevPAR.",
    related: ["revpar", "debt-yield"],
    learnMore: "/calculators/hotel-debt-yield",
  },
  {
    slug: "ab-1482",
    term: "Tenant Protection Act of 2019",
    alias: "AB 1482",
    category: "California",
    definition: `AB 1482 is the California statute (Civil Code section 1947.12) that limits annual rent increases on covered residential units to ${AB1482.basePct}% plus the regional change in the Consumer Price Index, capped at ${AB1482.maxPct}%. It also requires just cause to evict after 12 months of tenancy. Units whose certificate of occupancy is less than ${AB1482.newConstructionYears} years old are exempt on a rolling basis, and the statute is scheduled to sunset on ${AB1482.sunsetDate} unless extended.`,
    related: ["rent-stabilization", "prop-13"],
  },
  {
    slug: "amortization",
    term: "Amortization",
    category: "Loan terms",
    definition: "Amortization is the schedule on which a loan's principal is repaid through regular payments. A 30-year amortization spreads repayment over 360 months, and a loan can have a shorter term than its amortization, which leaves a balloon payment at maturity.",
    related: ["balloon-payment", "interest-only", "loan-constant"],
    learnMore: "/calculators/dscr",
  },
  {
    slug: "assisted-living",
    term: "Assisted living facility",
    category: "Property types",
    definition: "An assisted living facility is a residential community that provides help with daily activities such as bathing, dressing and medication, without the round-the-clock nursing care of a skilled nursing facility. In California most are licensed as residential care facilities for the elderly.",
    related: ["rcfe", "memory-care", "snf"],
    learnMore: "assisted-living",
  },
  {
    slug: "balloon-payment",
    term: "Balloon payment",
    category: "Loan terms",
    definition: "A balloon payment is the unpaid principal due in one lump sum when a loan matures, because the amortization is longer than the term. A loan with a 10-year term and 30-year amortization has a balloon at the end of year ten, which the borrower normally repays by refinancing or selling.",
    related: ["amortization", "bridge-loan"],
  },
  {
    slug: "bridge-loan",
    term: "Bridge loan",
    category: "Programs",
    definition: "A bridge loan is short-term financing, often interest-only and floating-rate, that covers a property until it can be refinanced into permanent debt or sold. Typical uses are acquisition, renovation and lease-up before a refinance into HUD, agency or bank debt.",
    related: ["pip", "sofr", "stabilization", "interest-only"],
    learnMore: "private-bridge",
  },
  {
    slug: "broker",
    term: "Real estate broker (loan broker)",
    category: "California",
    definition: "A real estate broker who arranges loans is a licensed intermediary who negotiates a loan between a borrower and a lender for compensation. The broker does not make the loan, fund it or service it; the lender makes the credit decision and funds as lender of record. In California the broker must hold a real estate broker license from the Department of Real Estate.",
    related: ["mlds", "term-sheet"],
  },
  {
    slug: "cap-rate",
    term: "Capitalization rate",
    alias: "Cap rate",
    category: "Underwriting",
    definition: "A capitalization rate is a property's annual net operating income divided by its value or price. It is a quick measure of the income return an unleveraged buyer earns, and lenders use it to estimate value when an appraisal is not yet available.",
    related: ["noi", "ltv", "debt-yield"],
  },
  {
    slug: "cash-out-refinance",
    term: "Cash-out refinance",
    category: "Loan terms",
    definition: `A cash-out refinance replaces an existing loan with a larger one and pays the difference to the borrower. Programs often allow less leverage on cash-out than on a rate-and-term refinance; for example, Corin's HUD 223(f) assumptions cap cash-out at ${pct(HUD.multifamily.s223f.cashOutMaxLtv)} loan-to-value.`,
    related: ["ltv", "hud-223f"],
  },
  {
    slug: "cdc",
    term: "Certified Development Company",
    alias: "CDC",
    category: "Programs",
    definition: "A Certified Development Company is a nonprofit lender certified by the U.S. Small Business Administration to deliver the SBA 504 program in its region. The CDC makes the second-lien loan, funded by an SBA-backed debenture, alongside a bank's first-lien loan.",
    related: ["sba-504", "debenture", "equity-injection"],
    learnMore: "sba-504-hotel",
  },
  {
    slug: "cmbs",
    term: "Commercial mortgage-backed securities",
    alias: "CMBS",
    category: "Programs",
    definition: `Commercial mortgage-backed securities are bonds backed by a pool of commercial mortgages. A CMBS (conduit) loan is originated to be pooled, is usually non-recourse apart from standard carve-outs, and is typically fixed-rate. Corin's hotel assumptions are a ${CMBS.termYears}-year term, ${CMBS.amortYears}-year amortization, up to ${pct(CMBS.maxLtv)} loan-to-value and a minimum ${x(CMBS.minDscr)} coverage.`,
    related: ["defeasance", "debt-yield", "non-recourse"],
    learnMore: "hotel-cmbs",
  },
  {
    slug: "construction-loan",
    term: "Construction loan",
    category: "Programs",
    definition: "A construction loan is short-term financing that funds the building or substantial renovation of a property, sized on the lesser of loan-to-cost and the value once complete. The lender controls the money and releases it as work progresses; Corin arranges these loans but has no role in disbursements.",
    related: ["ltc", "interest-reserve", "ltarv"],
    learnMore: "construction-loans",
  },
  {
    slug: "debenture",
    term: "SBA debenture",
    category: "Programs",
    definition: "A debenture is the bond sold to investors to fund the SBA 504 second-lien loan made by a Certified Development Company. Its rate is fixed for the life of the loan and set when the debenture is sold.",
    related: ["cdc", "sba-504"],
    learnMore: "/calculators/sba-504",
  },
  {
    slug: "debt-yield",
    term: "Debt yield",
    category: "Underwriting",
    definition: "Debt yield is a property's annual net operating income divided by the loan amount. Unlike coverage, it does not depend on the interest rate or amortization, so lenders use it as a second check on how much income stands behind each dollar of loan.",
    related: ["dscr", "noi", "cmbs"],
    learnMore: "/calculators/hotel-debt-yield",
  },
  {
    slug: "defeasance",
    term: "Defeasance",
    category: "Loan terms",
    definition: "Defeasance is a way to prepay a CMBS loan by replacing the property as collateral with a portfolio of U.S. Treasury securities that produces the same payments. The borrower pays for the securities, so the cost rises as interest rates fall.",
    related: ["yield-maintenance", "cmbs", "prepayment-penalty"],
  },
  {
    slug: "dscr",
    term: "Debt service coverage ratio",
    alias: "DSCR",
    category: "Underwriting",
    definition: `Debt service coverage ratio is annual net operating income divided by annual loan payments. A ratio of 1.25x means income is 125% of the payment. Corin's sizing assumptions use ${x(HUD.multifamily.s223f.minDscr)} for HUD market-rate multifamily, ${x(AGENCY.minDscr)} for agency multifamily, ${x(SBA.minDscr)} for SBA, ${x(HUD.section232.refi.minDscr)} for HUD Section 232 and ${x(CMBS.minDscr)} for hotel CMBS.`,
    related: ["noi", "debt-yield", "loan-constant"],
    learnMore: "/calculators/dscr",
  },
  {
    slug: "equity-injection",
    term: "Equity injection",
    category: "Programs",
    definition: `An equity injection is the cash a borrower must put into a project. For SBA 504, Corin's assumptions use ${pct(SBA.equity.base)} as a base, ${pct(SBA.equity.specialPurpose)} more for special-purpose property such as hotels and care facilities, and ${pct(SBA.equity.newBusiness)} more for a start-up or new construction.`,
    related: ["sba-504", "ltc"],
    learnMore: "/calculators/sba-504",
  },
  {
    slug: "ff-e-reserve",
    term: "FF&E reserve",
    category: "Property types",
    definition: "An FF&E reserve is money set aside each year, usually a percentage of hotel revenue, to replace furniture, fixtures and equipment. Lenders deduct it from income when they calculate the net operating income they underwrite.",
    related: ["noi", "pip"],
  },
  {
    slug: "fannie-mae-dus",
    term: "Fannie Mae multifamily",
    alias: "DUS",
    category: "Programs",
    definition: `Fannie Mae multifamily loans are made by lenders authorized under the Delegated Underwriting and Servicing (DUS) program and sold to Fannie Mae. Corin's small-balance assumptions are up to ${pct(AGENCY.maxLtv)} loan-to-value and ${x(AGENCY.minDscr)} coverage with a 30-year amortization; real deals often land at lower leverage because coverage binds.`,
    related: ["freddie-mac", "dscr", "ltv"],
    learnMore: "fannie-mae-multifamily",
  },
  {
    slug: "freddie-mac",
    term: "Freddie Mac multifamily",
    category: "Programs",
    definition: "Freddie Mac multifamily loans are made by Optigo network lenders and purchased by Freddie Mac. Like Fannie Mae, they are long-term, fixed-rate or floating-rate loans on stabilized apartment properties, with pricing set over Treasury or SOFR.",
    related: ["fannie-mae-dus", "dscr"],
    learnMore: "freddie-mac-multifamily",
  },
  {
    slug: "hard-money",
    term: "Hard money loan",
    category: "Programs",
    definition: "A hard money loan is a short-term, asset-based loan from a private lender, underwritten mainly on the property's value and the exit plan rather than the borrower's income. Rates, points and fees are higher than bank or agency debt in exchange for speed and flexibility. Private lenders fund as lender of record.",
    related: ["bridge-loan", "ltarv", "interest-only"],
    learnMore: "hard-money",
  },
  {
    slug: "hud-221d4",
    term: "HUD 221(d)(4)",
    category: "Programs",
    definition: `HUD Section 221(d)(4) is an FHA-insured loan for new construction or substantial rehabilitation of multifamily housing with five or more units. Corin's assumptions are ${pct(HUD.multifamily.s221d4.maxLtc)} loan-to-cost and ${x(HUD.multifamily.s221d4.minDscr)} for market-rate projects, a ${HUD.multifamily.s221d4.termYears}-year term, and Davis-Bacon prevailing wages during construction.`,
    related: ["hud-223f", "mip", "ltc"],
    learnMore: "hud-221d4",
  },
  {
    slug: "hud-223a7",
    term: "HUD 223(a)(7)",
    category: "Programs",
    definition: "HUD Section 223(a)(7) is a streamlined refinance of an existing FHA-insured loan. The new principal is capped by the original insured amount and the unpaid balance plus eligible costs, and the borrower's new payment may not exceed the current one.",
    related: ["hud-223f", "mip"],
    learnMore: "hud-223a7",
  },
  {
    slug: "hud-223f",
    term: "HUD 223(f)",
    category: "Programs",
    definition: `HUD Section 223(f) is an FHA-insured, fixed-rate, fully amortizing loan to purchase or refinance an existing apartment property (or, under Section 232, a care facility). For market-rate multifamily Corin's assumptions are ${pct(HUD.multifamily.s223f.maxLtv)} loan-to-value, ${x(HUD.multifamily.s223f.minDscr)} coverage and a ${HUD.multifamily.s223f.termYears}-year term (HUD Mortgagee Letter 2025-03).`,
    related: ["mip", "hud-232", "hud-221d4", "dscr"],
    learnMore: "hud-223f-multifamily",
  },
  {
    slug: "hud-232",
    term: "HUD Section 232",
    category: "Programs",
    definition: `HUD Section 232 is the FHA program that insures loans on skilled nursing facilities, assisted living, residential care and board-and-care homes. Corin's refinance assumptions are ${pct(HUD.section232.refi.maxLtv)} loan-to-value, ${x(HUD.section232.refi.minDscr)} coverage and a ${HUD.section232.refi.termYears}-year term. Section 232 was not changed by Mortgagee Letter 2025-03.`,
    related: ["mip", "snf", "rcfe", "assisted-living"],
    learnMore: "hud-232",
  },
  {
    slug: "interest-only",
    term: "Interest-only period",
    category: "Loan terms",
    definition: "An interest-only period is a stretch of the loan, often the first one to five years, when the borrower pays interest but no principal. Payments are lower during the period and rise when amortization starts. Lenders often test coverage on the amortizing payment as well.",
    related: ["amortization", "dscr", "bridge-loan"],
  },
  {
    slug: "interest-reserve",
    term: "Interest reserve",
    category: "Loan terms",
    definition: "An interest reserve is a portion of a construction or bridge loan set aside to pay the loan's own interest while the property is built or leased up. The lender holds and applies the reserve; it is sized into the loan, so it increases the amount borrowed.",
    related: ["construction-loan", "stabilization", "ltc"],
  },
  {
    slug: "loan-constant",
    term: "Loan constant",
    category: "Underwriting",
    definition: "A loan constant is the annual debt service on a loan divided by the loan amount. A 6.00% loan amortized over 30 years has a constant of about 7.19%. Dividing income by the required coverage and then by the constant gives the largest loan the income supports.",
    related: ["dscr", "amortization"],
    learnMore: "/calculators/dscr",
  },
  {
    slug: "ltarv",
    term: "Loan to after-repair value",
    alias: "LTARV",
    category: "Underwriting",
    definition: "Loan to after-repair value is the loan amount divided by the property's projected value once planned renovations are finished. Fix-and-flip and bridge lenders use it alongside loan-to-cost, and usually lend the lesser of the two.",
    related: ["ltv", "ltc", "hard-money"],
    learnMore: "fix-and-flip",
  },
  {
    slug: "ltc",
    term: "Loan to cost",
    alias: "LTC",
    category: "Underwriting",
    definition: `Loan to cost is the loan amount divided by the total project cost, including land, construction and soft costs. HUD 221(d)(4) market-rate loans in Corin's assumptions go to ${pct(HUD.multifamily.s221d4.maxLtc)} of cost, and construction lenders also test the loan against value when complete.`,
    related: ["ltv", "ltarv", "construction-loan"],
  },
  {
    slug: "ltv",
    term: "Loan to value",
    alias: "LTV",
    category: "Underwriting",
    definition: "Loan to value is the loan amount divided by the property's appraised value or purchase price, whichever the lender uses. A lower ratio means more borrower equity and less risk to the lender, so programs set a maximum.",
    related: ["ltc", "ltarv", "cap-rate"],
  },
  {
    slug: "memory-care",
    term: "Memory care",
    category: "Property types",
    definition: "Memory care is specialized housing and support for people with Alzheimer's disease or other forms of dementia, usually in a secured setting with trained staff. In California it is typically provided within a licensed residential care facility for the elderly.",
    related: ["rcfe", "assisted-living", "hud-232"],
    learnMore: "memory-care",
  },
  {
    slug: "mezzanine-debt",
    term: "Mezzanine debt",
    category: "Loan terms",
    definition: "Mezzanine debt is a loan secured by a pledge of the ownership interests in the borrower rather than by a lien on the real property. It sits behind the senior mortgage and costs more, and because it is not secured by real property it raises different California regulatory questions, so counsel should review any structure that includes it.",
    related: ["preferred-equity", "ltv"],
  },
  {
    slug: "mip",
    term: "Mortgage insurance premium",
    alias: "MIP",
    category: "Programs",
    definition: `The mortgage insurance premium is the fee for FHA insurance on a HUD loan, paid upfront and as an annual percentage of the average outstanding balance. Corin's assumptions use a flat ${pct(HUD.multifamily.mip.annual, 2)} annual premium for HUD multifamily applications on or after ${HUD.multifamily.mip.effectiveForApplicationsOnOrAfter}; green certification no longer lowers it.`,
    related: ["hud-223f", "hud-221d4", "hud-232"],
    learnMore: "/calculators/hud-mip",
  },
  {
    slug: "mlds",
    term: "Mortgage Loan Disclosure Statement",
    alias: "MLDS, RE 882",
    category: "California",
    definition: `A Mortgage Loan Disclosure Statement (DRE form RE 882) is the written disclosure a California real estate broker gives a borrower on a loan the broker arranges that is secured by real property. It sets out estimated costs, the broker's compensation and the loan terms. ${disclosures.mlds}`,
    related: ["broker", "term-sheet"],
  },
  {
    slug: "noi",
    term: "Net operating income",
    alias: "NOI",
    category: "Underwriting",
    definition: "Net operating income is a property's income from rents and other operations less its operating expenses, before debt service, income taxes and depreciation. Lenders re-underwrite it, adjusting vacancy, management fees and reserves, before they size a loan.",
    related: ["dscr", "cap-rate", "debt-yield", "ff-e-reserve"],
  },
  {
    slug: "non-recourse",
    term: "Non-recourse loan",
    category: "Loan terms",
    definition: "A non-recourse loan limits the lender's remedy on default to the property that secures it, so the borrower is not personally liable for the balance. Standard carve-outs, often called bad-boy guaranties, make a guarantor liable for acts such as fraud, misapplied funds or voluntary bankruptcy. Programs such as HUD and CMBS are non-recourse with carve-outs; SBA loans require personal guaranties.",
    related: ["cmbs", "hud-232", "sba-504"],
  },
  {
    slug: "pip",
    term: "Property improvement plan",
    alias: "PIP",
    category: "Property types",
    definition: "A property improvement plan is the list of renovations a hotel franchisor requires when a property changes hands, is renewed or converts to a new brand. A PIP bridge loan funds the purchase and the planned renovations together, sized on cost, until the hotel can refinance.",
    related: ["bridge-loan", "ff-e-reserve", "revpar"],
    learnMore: "pip-bridge",
  },
  {
    slug: "preferred-equity",
    term: "Preferred equity",
    category: "Loan terms",
    definition: "Preferred equity is an investment in the borrower's ownership that is paid before common equity. It fills the gap between senior debt and the sponsor's equity and, unlike a mortgage, is not secured by a lien on the real property.",
    related: ["mezzanine-debt", "ltc"],
  },
  {
    slug: "prepayment-penalty",
    term: "Prepayment penalty",
    category: "Loan terms",
    definition: "A prepayment penalty is a fee for repaying a loan before maturity. Common forms are a declining percentage (for example 5-4-3-2-1), yield maintenance and defeasance. Bridge loans often use a minimum interest period instead.",
    related: ["yield-maintenance", "defeasance"],
  },
  {
    slug: "prop-13",
    term: "Proposition 13 reassessment",
    alias: "Prop 13",
    category: "California",
    definition: `Proposition 13 limits California property tax to about ${PROP13.baseRatePct}% of assessed value plus local charges that voters have authorized, and caps annual growth in assessed value at ${PROP13.maxAnnualIncreasePct}%. A sale or other change in ownership resets the assessed value to the purchase price, so a buyer's tax bill can be much higher than the seller's, which lenders account for in underwriting.`,
    related: ["noi", "ab-1482"],
  },
  {
    slug: "rcfe",
    term: "Residential care facility for the elderly",
    alias: "RCFE",
    category: "Property types",
    definition: "A residential care facility for the elderly is a California licensed home or community, regulated by the Department of Social Services, that provides room, board and help with daily activities to people age 60 and over. Assisted living and memory care in California are generally licensed as RCFEs.",
    related: ["assisted-living", "memory-care", "hud-232"],
    learnMore: "rcfe",
  },
  {
    slug: "rent-stabilization",
    term: "Rent stabilization",
    category: "California",
    definition: "Rent stabilization is a local law, such as the City of Los Angeles Rent Stabilization Ordinance, that limits annual rent increases on covered units. It applies in addition to, or instead of, the statewide cap in AB 1482, and the local cap is usually lower, so lenders underwrite rents and growth by jurisdiction.",
    related: ["ab-1482", "noi"],
  },
  {
    slug: "revpar",
    term: "Revenue per available room",
    alias: "RevPAR",
    category: "Property types",
    definition: "Revenue per available room is a hotel's rooms revenue divided by the number of rooms available, which equals average daily rate multiplied by occupancy. It is the standard measure of a hotel's performance against its competitive set.",
    related: ["adr", "noi", "debt-yield"],
    learnMore: "/calculators/hotel-debt-yield",
  },
  {
    slug: "sba-504",
    term: "SBA 504 loan",
    category: "Programs",
    definition: `An SBA 504 loan is a fixed-rate loan for owner-occupied commercial real estate, structured as a bank first lien of about ${pct(SBA.bankFirstPct)} of the project, a CDC debenture for most of the rest, and borrower equity. The operating business must occupy at least 51% of the property, and owners of 20% or more give personal guaranties.`,
    related: ["cdc", "debenture", "equity-injection", "sba-7a"],
    learnMore: "sba-504-hotel",
  },
  {
    slug: "sba-7a",
    term: "SBA 7(a) loan",
    category: "Programs",
    definition: `An SBA 7(a) loan is a bank loan partly backed by a U.S. Small Business Administration guaranty, usually floating-rate and tied to Prime. It can finance real estate, working capital or a business purchase, and can be combined with a 504 loan in a stack; Corin models combined SBA exposure up to $${(SBA.combinedExposureCap / 1_000_000).toFixed(0)}M for that structure.`,
    related: ["sba-504", "equity-injection"],
    learnMore: "sba-7a-504-hotel-stack",
  },
  {
    slug: "snf",
    term: "Skilled nursing facility",
    alias: "SNF",
    category: "Property types",
    definition: "A skilled nursing facility provides round-the-clock nursing and medical care, often reimbursed by Medicare and Medicaid. Revenue depends heavily on payor mix, so lenders underwrite census and the mix of private-pay, Medicare and Medicaid residents alongside income.",
    related: ["hud-232", "assisted-living"],
    learnMore: "skilled-nursing",
  },
  {
    slug: "sofr",
    term: "Secured Overnight Financing Rate",
    alias: "SOFR",
    category: "Underwriting",
    definition: "The Secured Overnight Financing Rate is a benchmark interest rate based on overnight Treasury repurchase transactions, published by the Federal Reserve Bank of New York. Floating-rate bridge and construction loans are usually priced as SOFR plus a spread.",
    related: ["bridge-loan", "interest-only"],
  },
  {
    slug: "stabilization",
    term: "Stabilization",
    category: "Underwriting",
    definition: "Stabilization is the point at which a property reaches the occupancy and income a permanent lender will underwrite, for example 85% occupancy held for several months at a senior living community. Bridge and construction loans are sized to be repaid by a refinance once the property stabilizes.",
    related: ["bridge-loan", "interest-reserve", "noi"],
  },
  {
    slug: "term-sheet",
    term: "Term sheet",
    category: "Loan terms",
    definition: "A term sheet is a lender's summary of the proposed loan: amount, rate, term, amortization, fees, reserves, recourse and conditions. It is usually not binding on the lender until a commitment is issued, and comparing term sheets means comparing all-in cost, not just the interest rate.",
    related: ["broker", "loan-constant"],
  },
  {
    slug: "yield-maintenance",
    term: "Yield maintenance",
    category: "Loan terms",
    definition: "Yield maintenance is a prepayment premium that compensates a lender for the interest it loses when a fixed-rate loan is repaid early. It is calculated from the difference between the loan's rate and a Treasury yield, and it shrinks as the loan ages.",
    related: ["defeasance", "prepayment-penalty"],
  },
];

export function getTerm(slug: string): GlossaryTerm | undefined {
  return GLOSSARY.find((t) => t.slug === slug);
}

/** Terms sorted A to Z by display name, ignoring case. */
export function sortedGlossary(): GlossaryTerm[] {
  return [...GLOSSARY].sort((a, b) => a.term.localeCompare(b.term, "en", { sensitivity: "base" }));
}

/** First letter of each term, for the A-Z jump bar. */
export function glossaryLetters(terms: readonly GlossaryTerm[] = sortedGlossary()): string[] {
  return [...new Set(terms.map((t) => t.term[0]!.toUpperCase()))];
}

/**
 * Link target for a term's "learn more": a calculator path is used as-is and a
 * bare slug is a /financing page.
 */
export function learnMoreHref(learnMore: string): string {
  return learnMore.startsWith("/") ? learnMore : `/financing/${learnMore}`;
}

export const GLOSSARY_META = {
  title: "Commercial real estate finance glossary",
  description: "Plain-English definitions of DSCR, debt yield, LTV, MIP, HUD 232, SBA 504, CMBS, bridge loan terms and California rules that shape commercial loans.",
} as const;

export const glossaryRoutes: SitemapRoute[] = [
  {
    path: GLOSSARY_PATH,
    title: GLOSSARY_META.title,
    description: GLOSSARY_META.description,
    changeFrequency: "monthly",
    priority: 0.6,
    section: "Resources",
  },
];
