// California metro pages (/california/<slug>). Only markets where there is
// unique, useful copy ship: Los Angeles, Orange County and the Bay Area. Each
// page explains how the local rules and property mix change the way a loan is
// sized, and its figures come from lib/rules/california and
// lib/sizing/assumptions.ts rather than being retyped. Nothing here claims
// closed deals, market statistics or lender appetite we have not recorded.

import {
  AB1482,
  AB1482_CAP_TABLE,
  LOCAL_ORDINANCES,
  UNMODELED_LOCAL_RENT_CONTROL_CITIES,
  ab1482Region,
  estimateReassessment,
  type Ab1482Region,
} from "@/lib/rules/california";
import type { SitemapRoute } from "@/lib/seo/sitemap-routes";
import { ASSUMPTIONS_REVIEWED, CMBS, HUD, SBA } from "@/lib/sizing/assumptions";

export const CALIFORNIA_BASE = "/california";

export interface MarketFact {
  label: string;
  value: string;
  source: string;
  asOf: string;
  verify: boolean;
}

export interface MarketSection {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
}

export interface MarketFaq {
  question: string;
  answer: string;
}

export interface MarketPage {
  slug: "los-angeles" | "orange-county" | "bay-area";
  /** Short name for cards and breadcrumbs. */
  name: string;
  /** Page title without the brand (the rendered title must stay within 60 characters). */
  title: string;
  description: string;
  summary: string;
  /** Definition-first lead. */
  definition: string;
  /** Places named in Service markup. */
  areaServed: string[];
  /** Counties whose AB 1482 cap the page reports. */
  counties: string[];
  facts: MarketFact[];
  sections: MarketSection[];
  faq: MarketFaq[];
  /** Financing page slugs. */
  relatedPrograms: string[];
  /** Other market slugs. */
  relatedMarkets: string[];
}

const AS_OF = ASSUMPTIONS_REVIEWED;
const pct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`;
const x = (n: number) => `${n.toFixed(2)}x`;
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

const REGION_NAME: Record<Ab1482Region, string> = {
  los_angeles: "Los Angeles area",
  san_francisco: "San Francisco Bay area",
  san_diego: "San Diego area",
  inland_empire: "Inland Empire",
  california: "California statewide",
};

/** The most recent loaded AB 1482 period for a county's CPI region. */
function latestAb1482(county: string) {
  const region = ab1482Region(county);
  const row = AB1482_CAP_TABLE.filter((r) => r.region === region).sort((a, b) => b.effectiveTo.localeCompare(a.effectiveTo))[0];
  if (!row) throw new Error(`no AB 1482 row for ${county}`);
  const cap = Math.min(AB1482.basePct + row.cpiPct, AB1482.maxPct);
  return { region, row, cap };
}

function ab1482Fact(county: string): MarketFact {
  const { region, row, cap } = latestAb1482(county);
  return {
    label: `AB 1482 cap, ${county} County (${REGION_NAME[region]} CPI)`,
    value: `${cap.toFixed(1)}% for ${row.effectiveFrom} to ${row.effectiveTo}`,
    source: `Civil Code section 1947.12: ${AB1482.basePct}% plus regional CPI (${row.cpiPct}%), capped at ${AB1482.maxPct}%; Corin rent-control table`,
    asOf: AS_OF,
    verify: !row.verified,
  };
}

function reassessmentFact(price: number, currentAssessed: number): MarketFact {
  const r = estimateReassessment({ purchasePrice: price, currentAssessedValue: currentAssessed, eventDate: AS_OF });
  return {
    label: `Illustrative Prop 13 reset: ${usd(price)} sale, prior assessed value ${usd(currentAssessed)}`,
    value: `Annual property tax rises from about ${usd(r.annualTaxBefore)} to about ${usd(r.annualTaxAfter)} at a ${r.totalLevyRatePct.toFixed(2)}% levy`,
    source: "Corin Prop 13 estimator (1% base plus a default voter-approved levy); use the tax rate area's actual rate",
    asOf: AS_OF,
    verify: true,
  };
}

const localCities = (...names: string[]) => UNMODELED_LOCAL_RENT_CONTROL_CITIES.filter((c) => names.includes(c)).map((c) => c.replace(/\b\w/g, (m) => m.toUpperCase()));
const joinList = (items: string[]) => (items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`);

const laRso = LOCAL_ORDINANCES.find((o) => o.id === "la_rso");
const laCounty = LOCAL_ORDINANCES.find((o) => o.id === "la_county_rstpo");
if (!laRso || !laCounty) throw new Error("rent-control data is missing the Los Angeles ordinances");
const laRsoRow = laRso.capRows[0]!;

const FINANCING_DISCLAIMER = "Programs and figures are indicative, not a commitment to lend. Corin Commercial arranges loans as a licensed California real estate broker and is not the lender.";

export const MARKETS: readonly MarketPage[] = [
  {
    slug: "los-angeles",
    name: "Los Angeles",
    title: "Los Angeles commercial real estate loans",
    description: "How Los Angeles rent rules, licensing, seismic retrofit and transfer taxes shape senior living, hotel, multifamily, construction and hard money loans.",
    summary: "Rent stabilization, care-facility licensing and seismic diligence in the City and County of Los Angeles.",
    definition:
      "Los Angeles commercial real estate financing is the arrangement of loans on apartments, care facilities and hotels in the City and County of Los Angeles, where local rent ordinances, state licensing of care facilities and seismic retrofit rules shape how much a lender will lend. Corin Commercial arranges these loans as a licensed California real estate broker; lenders make the credit decisions.",
    areaServed: ["City of Los Angeles", "Los Angeles County"],
    counties: ["Los Angeles"],
    facts: [
      {
        label: "City of Los Angeles RSO allowable increase",
        value: `${laRsoRow.capPct}% for ${laRsoRow.effectiveFrom} to ${laRsoRow.effectiveTo}`,
        source: `${laRso.label}, ${laRso.citation}; covers buildings with a certificate of occupancy on or before ${laRso.coveredIfCertificateOfOccupancyOnOrBefore}`,
        asOf: AS_OF,
        verify: !laRsoRow.verified,
      },
      {
        label: "Unincorporated Los Angeles County rent ordinance",
        value: `Greater of ${laCounty.capRows[0]!.capPct}% or a share of CPI`,
        source: `${laCounty.label}, ${laCounty.citation}; covers certificates of occupancy on or before ${laCounty.coveredIfCertificateOfOccupancyOnOrBefore}`,
        asOf: AS_OF,
        verify: true,
      },
      ab1482Fact("Los Angeles"),
      reassessmentFact(12_000_000, 5_000_000),
      {
        label: "HUD 223(f) market-rate multifamily",
        value: `${pct(HUD.multifamily.s223f.maxLtv)} LTV, ${x(HUD.multifamily.s223f.minDscr)} DSCR`,
        source: "HUD Mortgagee Letter 2025-03 (Jan 2025)",
        asOf: AS_OF,
        verify: true,
      },
    ],
    sections: [
      {
        heading: "Multifamily: underwrite the rent rules, not the market rent",
        paragraphs: [
          `Most older apartment buildings in the City of Los Angeles are covered by the Rent Stabilization Ordinance, which applies to buildings with a certificate of occupancy on or before ${laRso.coveredIfCertificateOfOccupancyOnOrBefore}. The allowable annual increase in Corin's rent-control table is ${laRsoRow.capPct}% for ${laRsoRow.effectiveFrom} to ${laRsoRow.effectiveTo}. Unincorporated areas of the county have their own ordinance, and several incorporated cities, including ${joinList(localCities("beverly hills", "culver city", "inglewood", "long beach", "pasadena", "santa monica", "west hollywood"))}, have rules of their own.`,
          `Newer or exempt buildings fall under the statewide cap in AB 1482, which is ${AB1482.basePct}% plus the regional change in the Consumer Price Index, capped at ${AB1482.maxPct}%. A lender will model growth under whichever rule applies to the specific building, so the address, the year of the certificate of occupancy and the unit mix all matter.`,
          `For HUD 223(f) and agency loans, in-place rents under stabilization often leave coverage, not loan-to-value, as the limit. The HUD market-rate box is ${pct(HUD.multifamily.s223f.maxLtv)} loan-to-value and ${x(HUD.multifamily.s223f.minDscr)} coverage; the loan is whichever test gives less.`,
        ],
      },
      {
        heading: "Senior living: licensing comes first",
        paragraphs: [
          "Assisted living and memory care communities in California are generally licensed as residential care facilities for the elderly by the Department of Social Services, and skilled nursing facilities are licensed by the Department of Public Health. A lender, and HUD for a Section 232 loan, will confirm that the license is in good standing and that the operator has the experience to run the building before they look at proceeds.",
          `A stabilized facility can often refinance into HUD 232 (${pct(HUD.section232.refi.maxLtv)} loan-to-value and ${x(HUD.section232.refi.minDscr)} coverage in Corin's assumptions). A facility that is newly built, newly acquired or still filling usually starts with a bridge loan and refinances once it reaches the occupancy and income HUD wants.`,
        ],
      },
      {
        heading: "Hotels: flag and ownership decide the structure",
        paragraphs: [
          `Los Angeles hotels range from brand-flagged airport and downtown properties to independent and boutique hotels on the Westside and in the Valley. Conduit lenders set different debt yield floors by hotel type (${pct(CMBS.minDebtYield.PREMIUM_FLAG, 1)} for a premium flag, ${pct(CMBS.minDebtYield.ECONOMY_FLAG, 1)} for economy and ${pct(CMBS.minDebtYield.BOUTIQUE_INDEPENDENT, 1)} for boutique or independent in Corin's assumptions), so the same income can support different loans.`,
          "Owner-operators buying or refinancing their own hotel often compare SBA 504 against conduit debt, and a hotel facing a franchisor renovation requirement can use a PIP bridge. The hotel debt yield calculator shows where a loan stands against the floors.",
        ],
      },
      {
        heading: "Costs and diligence buyers should model",
        paragraphs: [
          "A sale in California resets the assessed value to the purchase price under Proposition 13, so a buyer's tax bill can be many times the seller's. The estimate above shows the size of the effect; the tax rate area's actual levy sets the real number.",
          "The City of Los Angeles also taxes high-value property sales with a tiered measure that took effect in 2023, on top of county and documentary transfer taxes. Rates and thresholds change over time, so confirm current figures with title and escrow before pricing a deal.",
          "Seismic diligence is routine. The City of Los Angeles has mandatory retrofit ordinances for certain soft-story wood-frame and non-ductile concrete buildings, and lenders ask for the compliance status of covered buildings along with engineering reports where required.",
        ],
      },
    ],
    faq: [
      { question: "Does Los Angeles rent control limit how much I can borrow?", answer: "Indirectly. Lenders underwrite rent growth under the rule that covers the building, so stabilized rents usually mean lower income and a smaller loan than market rents would suggest. Coverage tends to be the limit on those buildings." },
      { question: "What is the rent increase limit under AB 1482 in Los Angeles County?", answer: `The statute is ${AB1482.basePct}% plus regional CPI, capped at ${AB1482.maxPct}%. Corin's table shows ${latestAb1482("Los Angeles").cap.toFixed(1)}% for the period ending ${latestAb1482("Los Angeles").row.effectiveTo}; the figure is a planning default that is refreshed each August and should be verified against the published CPI.` },
      { question: "Can a Los Angeles assisted living facility get a HUD 232 loan?", answer: "Often, if it is licensed and in good standing, operated by an experienced operator, and stabilized. Newly built or recently acquired facilities usually need a bridge first. An advisor can review the facility against HUD's tests." },
      { question: "Does Corin lend money in Los Angeles?", answer: "No. Corin Commercial is a licensed California real estate broker. Lenders make the credit decision and fund the loan. Corin never holds or disburses loan funds." },
    ],
    relatedPrograms: ["hud-223f-multifamily", "hud-232", "bridge-to-hud", "hotel-cmbs", "sba-504-hotel", "fannie-mae-multifamily", "construction-loans", "hard-money"],
    relatedMarkets: ["orange-county", "bay-area"],
  },
  {
    slug: "orange-county",
    name: "Orange County",
    title: "Orange County commercial property loans",
    description: "Orange County hotels, senior living and apartments: how resort demand, few local rent ordinances and Mello-Roos assessments shape the loan programs we arrange.",
    summary: "Resort and coastal hotels, owner-operated senior living and mostly statewide rent rules in Orange County.",
    definition:
      "Orange County commercial real estate financing is the arrangement of loans on hotels, senior living communities and apartment buildings in Orange County, California, where resort-driven hospitality, owner-operators and the statewide rent cap shape which loan program fits. Corin Commercial arranges these loans as a licensed California real estate broker; lenders make the credit decisions.",
    areaServed: ["Orange County, California"],
    counties: ["Orange"],
    facts: [
      ab1482Fact("Orange"),
      {
        label: "Orange County cities with their own rent ordinance on Corin's review list",
        value: joinList(localCities("santa ana")) || "None listed",
        source: "Corin review of local rent-control ordinances; the list is not exhaustive and is reviewed by hand for each property",
        asOf: AS_OF,
        verify: true,
      },
      reassessmentFact(8_000_000, 3_000_000),
      {
        label: "Hotel CMBS debt yield floors (premium / economy / boutique)",
        value: `${pct(CMBS.minDebtYield.PREMIUM_FLAG, 1)} / ${pct(CMBS.minDebtYield.ECONOMY_FLAG, 1)} / ${pct(CMBS.minDebtYield.BOUTIQUE_INDEPENDENT, 1)}`,
        source: "Corin hotel CMBS assumptions",
        asOf: AS_OF,
        verify: true,
      },
    ],
    sections: [
      {
        heading: "Hotels: resort demand and owner-operators",
        paragraphs: [
          "Orange County's hotel market is anchored by the resort district around Anaheim, the coastal communities, and the business travel around the airport. That produces a mix of brand-flagged hotels, independent and boutique hotels, and owner-operated select-service properties.",
          `For owner-operators, SBA 504 is a frequent comparison with conduit debt because the debenture is fixed-rate over a long term and requires ${pct(SBA.equity.base + SBA.equity.specialPurpose)} equity for an existing hotel in Corin's assumptions. A hotel that must renovate to keep or change its flag can use a PIP bridge and refinance once the work is done. Conduit lenders apply different debt yield floors by hotel type, so a boutique hotel needs more income per dollar of loan than a premium-flag one.`,
        ],
      },
      {
        heading: "Senior living: coverage usually sets the loan",
        paragraphs: [
          `Where purchase prices are high relative to income, loan-to-value is rarely the tightest test. In Corin's HUD 232 assumptions, coverage of ${x(HUD.section232.refi.minDscr)} on a ${HUD.section232.refi.termYears}-year amortization is usually what limits proceeds on a stabilized community, so income quality (census, payor mix and expense ratios) matters more than the appraisal.`,
          "Assisted living and memory care communities are licensed in California as residential care facilities for the elderly, and the license has to be in good standing before any lender proceeds. Facilities that are filling up or changing operators generally start with a bridge loan.",
        ],
      },
      {
        heading: "Multifamily: mostly the statewide rule",
        paragraphs: [
          `Few Orange County cities have their own rent ordinance; ${joinList(localCities("santa ana"))} is the one on Corin's review list, and each property is checked by hand. Elsewhere the statewide cap in AB 1482 applies to buildings older than ${AB1482.newConstructionYears} years: ${AB1482.basePct}% plus regional CPI, capped at ${AB1482.maxPct}%. Orange County uses the Los Angeles area CPI in Corin's table.`,
          `That makes rent growth easier to underwrite than in jurisdictions with local caps, and agency and HUD loans on stabilized buildings are sized on income and coverage in the usual way: ${pct(HUD.multifamily.s223f.maxLtv)} loan-to-value and ${x(HUD.multifamily.s223f.minDscr)} coverage in the HUD market-rate box, with the smaller result setting the loan.`,
        ],
      },
      {
        heading: "How the programs line up",
        paragraphs: [
          "Which program fits depends on the property's stage more than its address. A stabilized apartment building with documented rents suits HUD 223(f) or an agency loan; a building being repositioned suits a multifamily bridge until its income supports permanent debt. A stabilized care community suits HUD 232; one still filling suits a bridge. An owner-operated hotel suits SBA 504; a branded hotel with strong trailing income and no owner-occupancy suits conduit debt.",
          "The sizer runs these side by side from the same inputs, and an advisor reviews the result with you. Lenders make their own credit decisions, so treat the sizer's output as a starting point for a conversation, not an offer.",
        ],
      },
      {
        heading: "Costs and diligence",
        paragraphs: [
          "A sale resets the assessed value under Proposition 13, so budget for a much higher tax bill than the seller's. Newer master-planned communities often carry Mello-Roos special taxes on top of the base levy; those are fixed charges that are not reassessed, and lenders count them as expenses.",
          "Orange County sits in a seismically active region. Lenders order engineering and seismic reports where their guidelines require them, and earthquake insurance can follow from the results.",
        ],
      },
    ],
    faq: [
      { question: "Is there rent control in Orange County?", answer: `Few cities have their own ordinance. The statewide cap in AB 1482 (${AB1482.basePct}% plus regional CPI, capped at ${AB1482.maxPct}%) applies to covered buildings, and Corin reviews any property in a city with local rules by hand.` },
      { question: "Which loan fits an owner-operated hotel in Orange County?", answer: "Often SBA 504 for an owner-occupied purchase or refinance, a conduit loan if income clears the debt yield floor and the owner prefers non-recourse, or a PIP bridge for a renovation. An advisor can compare them side by side." },
      { question: "How does Prop 13 affect a purchase in Orange County?", answer: "A sale resets the assessed value to the purchase price, so annual property tax is roughly 1% of the price plus local charges, which can be much higher than the seller's bill. Lenders underwrite the post-sale tax." },
      { question: "Does Corin lend money in Orange County?", answer: "No. Corin Commercial is a licensed California real estate broker, and lenders make the credit decisions and fund the loans." },
    ],
    relatedPrograms: ["sba-504-hotel", "hotel-cmbs", "pip-bridge", "hud-232", "hud-223f-multifamily", "fannie-mae-multifamily"],
    relatedMarkets: ["los-angeles", "bay-area"],
  },
  {
    slug: "bay-area",
    name: "Bay Area",
    title: "Bay Area commercial real estate loans",
    description: "San Francisco Bay Area multifamily, hotel and senior living loans: city-by-city rent rules, soft-story retrofit, seismic diligence and construction costs.",
    summary: "City-by-city rent rules, seismic diligence and high construction costs across the San Francisco Bay Area.",
    definition:
      "Bay Area commercial real estate financing is the arrangement of loans on apartments, hotels and care facilities across the San Francisco Bay Area, where many cities have their own rent ordinances, seismic risk drives diligence, and high construction costs shape new-build financing. Corin Commercial arranges these loans as a licensed California real estate broker; lenders make the credit decisions.",
    areaServed: ["San Francisco Bay Area", "San Francisco", "Alameda County", "Santa Clara County", "San Mateo County", "Contra Costa County", "Marin County"],
    counties: ["San Francisco", "Alameda", "Santa Clara"],
    facts: [
      ab1482Fact("San Francisco"),
      ab1482Fact("Santa Clara"),
      {
        label: "Bay Area cities with their own rent ordinance on Corin's review list",
        value: joinList(localCities("alameda", "berkeley", "east palo alto", "hayward", "los gatos", "mountain view", "oakland", "richmond", "san francisco", "san jose")),
        source: "Corin review of local rent-control ordinances; the list is not exhaustive and is reviewed by hand for each property",
        asOf: AS_OF,
        verify: true,
      },
      reassessmentFact(15_000_000, 6_000_000),
      {
        label: "HUD 221(d)(4) market-rate new construction",
        value: `${pct(HUD.multifamily.s221d4.maxLtc)} LTC, ${x(HUD.multifamily.s221d4.minDscr)} DSCR, ${HUD.multifamily.s221d4.termYears}-year term`,
        source: "HUD Mortgagee Letter 2025-03 (Jan 2025)",
        asOf: AS_OF,
        verify: true,
      },
    ],
    sections: [
      {
        heading: "Multifamily: the city decides the rent rule",
        paragraphs: [
          `The Bay Area has more local rent ordinances than any other part of the state Corin covers. Cities on Corin's review list include ${joinList(localCities("alameda", "berkeley", "east palo alto", "hayward", "los gatos", "mountain view", "oakland", "richmond", "san francisco", "san jose"))}, and the list is not exhaustive. Each property is checked by hand, because the local cap, the exemptions and the covered building age differ from city to city, and from the statewide AB 1482 rule.`,
          `Under AB 1482 (${AB1482.basePct}% plus regional CPI, capped at ${AB1482.maxPct}%), the Bay Area is not one CPI region in Corin's table: San Francisco, Alameda, Contra Costa, Marin and San Mateo counties use the San Francisco area figure, while Santa Clara County falls back to the statewide figure. The facts above show both.`,
        ],
      },
      {
        heading: "Seismic risk and retrofit status",
        paragraphs: [
          "Major faults run through the region, so seismic diligence is part of almost every apartment and care-facility loan. Lenders order a probable maximum loss (PML) report when their guidelines call for one, and a high result can require earthquake insurance or a lower loan.",
          "San Francisco, Oakland and Berkeley each run soft-story retrofit programs for older wood-frame buildings. Lenders ask whether a building is covered and whether the required work is complete, since an open retrofit obligation affects both cost and risk.",
        ],
      },
      {
        heading: "New construction: costs and prevailing wage",
        paragraphs: [
          `Land and construction costs are high, which puts pressure on loan-to-cost and on the equity a developer needs. HUD 221(d)(4) is a long-term, non-recourse construction-to-permanent option at ${pct(HUD.multifamily.s221d4.maxLtc)} loan-to-cost and ${x(HUD.multifamily.s221d4.minDscr)} coverage in the market-rate box, over a ${HUD.multifamily.s221d4.termYears}-year term.`,
          "HUD-insured new construction carries Davis-Bacon prevailing wage requirements, and projects with public subsidy can trigger California prevailing wage rules too. Both change the construction budget, so they belong in the first sizing, not in a late revision.",
        ],
      },
      {
        heading: "Matching the program to the building",
        paragraphs: [
          "Bay Area apartment buildings fall into two very different groups. Older buildings under a local ordinance carry capped rents, which usually makes coverage the limit and favors long-term fixed-rate debt such as HUD 223(f) or an agency loan on a stabilized property. Newer or exempt buildings can be underwritten on market rents, with the statewide cap as the ceiling on growth.",
          "A value-add owner who plans renovations and a repositioning usually starts with a multifamily bridge and refinances once the income is in place. A developer with entitlements in hand compares construction lending with HUD 221(d)(4). In every case the first step is the same: confirm which rent rule covers the building, because it changes the income a lender will underwrite.",
        ],
      },
      {
        heading: "Hotels and senior living",
        paragraphs: [
          `Hotel demand across San Francisco, the Peninsula and Silicon Valley leans on business and convention travel. Lenders weigh the trailing-12 trend heavily, and a hotel whose income has not yet recovered to a level that clears the debt yield floor (${pct(CMBS.minDebtYield.PREMIUM_FLAG, 1)} to ${pct(CMBS.minDebtYield.BOUTIQUE_INDEPENDENT, 1)} by hotel type in Corin's assumptions) may be a bridge candidate rather than a conduit one.`,
          "Care facilities need a license in good standing from the state before any lender proceeds, and high labor costs flow straight into net operating income. Lenders underwrite expenses as they find them, so a stabilized facility with documented cost control is the most natural candidate for HUD 232.",
        ],
      },
    ],
    faq: [
      { question: "Which Bay Area cities have rent control?", answer: "Several, including San Francisco, Oakland, Berkeley, San Jose, Hayward and others on Corin's review list. The list is not exhaustive, so each property is checked by hand against its city's ordinance." },
      { question: "How does seismic risk affect a Bay Area loan?", answer: "Lenders may order a probable maximum loss report and ask about soft-story retrofit status. A high PML can require earthquake insurance or reduce the loan. Diligence runs in parallel with underwriting." },
      { question: "Is HUD 221(d)(4) practical for Bay Area construction?", answer: "It can be, for projects that can carry prevailing wage requirements and the HUD process. Its long fixed-rate term and non-recourse structure are attractive; whether the costs and timeline work depends on the project. An advisor can size it against alternatives." },
      { question: "Does Corin lend money in the Bay Area?", answer: "No. Corin Commercial is a licensed California real estate broker, and lenders make the credit decisions and fund the loans." },
    ],
    relatedPrograms: ["hud-221d4", "hud-223f-multifamily", "multifamily-bridge", "hotel-cmbs", "hud-232", "construction-loans"],
    relatedMarkets: ["los-angeles", "orange-county"],
  },
];

export function getMarket(slug: string): MarketPage | undefined {
  return MARKETS.find((m) => m.slug === slug);
}

export function marketPath(slug: string): string {
  return `${CALIFORNIA_BASE}/${slug}`;
}

export const CALIFORNIA_INDEX = {
  title: "California commercial loans by metro",
  description: "Financing guides for Los Angeles, Orange County and the Bay Area: local rent rules, licensing, seismic diligence and the loan programs we arrange.",
} as const;

export const marketDisclaimer = FINANCING_DISCLAIMER;

export const marketRoutes: SitemapRoute[] = [
  {
    path: CALIFORNIA_BASE,
    title: CALIFORNIA_INDEX.title,
    description: CALIFORNIA_INDEX.description,
    changeFrequency: "monthly",
    priority: 0.6,
    section: "Resources",
  },
  ...MARKETS.map(
    (m): SitemapRoute => ({
      path: marketPath(m.slug),
      title: m.title,
      description: m.summary,
      changeFrequency: "monthly",
      priority: 0.6,
      section: "Resources",
    }),
  ),
];
