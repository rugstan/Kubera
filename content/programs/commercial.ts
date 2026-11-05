import { BRIDGE, CMBS } from "@/lib/sizing/assumptions";
import { BANK_PERM, CONSTRUCTION } from "@/lib/sizing/programs/assumptions";
import { disclosures } from "@/lib/site";
import { BRIDGE_EXIT_TEST } from "./market-facts";
import { fact, pct, pts, SRC, x, years } from "./format";
import type { ProgramEntry } from "./types";

// Commercial property: the property-type pages (office, industrial, retail,
// self-storage, medical office, mixed-use, manufactured housing communities)
// and the capital-type pages (acquisition, mezzanine and preferred equity,
// life company, bank and credit union, CMBS conduit, debt fund bridge). Figures
// come only from the sizer's assumptions; everything else is described in words.

/** The bank permanent loan box the sizer uses for commercial take-outs. */
const bankLoanFacts = () => [
  fact("Bank loan: max LTV / minimum DSCR (Corin sizing assumption)", `${pct(BANK_PERM.maxLtv)} / ${x(BANK_PERM.minDscr)}`, SRC.corin),
  fact("Bank loan: amortization (Corin sizing assumption)", `${years(BANK_PERM.amortYears)} schedule`, SRC.corin),
];

/** The general commercial bridge box (the same one the private bridge page shows). */
const bridgeFact = () =>
  fact("Bridge loan: max LTV / minimum debt yield (Corin sizing assumption)", `${pct(BRIDGE.cre.maxLtv)} / ${pct(BRIDGE.cre.minDebtYield)}`, SRC.corin);

const typicalLenders = (value: string) => fact("Typical lenders", value, SRC.market, { verify: false });
const reviewFirst = (value: string) => fact("What lenders review first", value, SRC.market, { verify: false });

const LENDER_OF_RECORD =
  "Lenders fund at closing as lender of record and make their own credit decisions. Corin arranges the loan as a licensed broker; it never holds or disburses loan funds and does not service loans.";

const PROP_13 =
  "On a California purchase, lenders underwrite property taxes reassessed at the new price under Proposition 13, not the seller's tax bill.";

export const commercialPrograms: ProgramEntry[] = [
  // ---------------------------------------------------------------------------
  // Property types
  {
    slug: "office-loans",
    family: "commercial",
    name: "Office building loans",
    title: "Office building loans",
    description:
      "Office building loans for California owners and buyers. Compare bank, life company, CMBS and bridge options, and see how lenders weigh leases and rollover.",
    summary: "Bank, life company, CMBS and bridge debt for office buildings.",
    definition:
      "An office building loan is a commercial mortgage secured by an office property and sized on the income its leases produce, so lenders look closely at tenant credit, lease terms, upcoming rollover and the cost of re-leasing space before they set leverage.",
    loanType: "Office building mortgage (brokered)",
    facts: [
      typicalLenders("Banks and credit unions, life companies, CMBS conduits, debt funds and private lenders"),
      ...bankLoanFacts(),
      bridgeFact(),
      reviewFirst("Rent roll, major leases, the rollover schedule, and tenant improvement and leasing commission costs"),
    ],
    sections: [
      {
        heading: "How office loans are sized",
        paragraphs: [
          "Lenders size an office loan to the lower of loan-to-value and debt service coverage, and many also test debt yield. The income they count is rent from signed leases, adjusted for vacancy, market rent and the reserves needed to re-lease space as leases expire.",
          "Rollover drives most office terms. A building with long leases to strong tenants can borrow from life companies and CMBS conduits at fixed rates. A building with near-term expirations or real vacancy usually starts with a bank or a bridge lender.",
        ],
        bullets: [
          "Weighted average lease term, and the share of rent that expires before the loan matures",
          "Tenant improvement and leasing commission reserves, funded at closing or collected monthly",
          "Single-tenant buildings: the tenant's credit and remaining lease term carry the loan",
        ],
      },
      {
        heading: "Matching the building to a lender",
        paragraphs: [
          "We start with the rent roll and the leases, then take the loan to lenders whose appetite fits the building's tenancy, size and location.",
        ],
        bullets: [
          "Stabilized with long leases: life company, CMBS or bank",
          "Owner-user occupying most of the building: SBA 504 or a bank loan, subject to SBA rules",
          "Vacancy or near-term rollover: bank or debt fund bridge",
          "Purchase with a leasing plan: bridge with future funding for leasing costs",
        ],
      },
      {
        heading: "California office markets",
        paragraphs: [
          `Lender appetite for office varies widely across California submarkets and building classes. We present each building with its leasing history and submarket data so lenders underwrite the property in front of them. ${PROP_13}`,
        ],
      },
    ],
    faq: [
      {
        question: "What do lenders need for an office loan?",
        answer: "A current rent roll, the major leases, trailing operating statements, the rollover schedule and recent capital spending. Lenders also review the credit of the largest tenants.",
      },
      {
        question: "Can I finance an office building with high vacancy?",
        answer: "Often yes, through a bank or a bridge lender that sizes to the leasing plan and holds back funds for leasing costs. Permanent lenders usually want the building leased first.",
      },
      {
        question: "Do office loans require personal recourse?",
        answer: "It depends on the lender. CMBS and many life company loans are non-recourse with standard carve-outs; bank loans often carry a guaranty.",
      },
    ],
    related: ["medical-office-loans", "life-company-loans", "cmbs-loans", "debt-fund-bridge-loans", "commercial"],
  },
  {
    slug: "industrial-loans",
    family: "commercial",
    name: "Industrial and warehouse loans",
    title: "Industrial and warehouse loans",
    description:
      "Financing for California warehouse, distribution, flex and light industrial property. Compare bank, life company, CMBS, SBA and bridge loans.",
    summary: "Debt for warehouse, distribution, flex and light industrial buildings.",
    definition:
      "An industrial loan is a commercial mortgage secured by warehouse, distribution, manufacturing, flex or light industrial property. Lenders underwrite the leases and the building's function, such as clear height, loading and power, together with the tenant's credit and the depth of the local market.",
    loanType: "Industrial property mortgage (brokered)",
    facts: [
      typicalLenders("Banks and credit unions, SBA lenders for owner-users, life companies, CMBS conduits and debt funds"),
      ...bankLoanFacts(),
      bridgeFact(),
      reviewFirst("Rent roll, lease terms, building specifications, tenant credit and the environmental report"),
    ],
    sections: [
      {
        heading: "How industrial loans are underwritten",
        paragraphs: [
          "Industrial space is usually leased on net terms, where the tenant pays most operating costs, so lenders focus on the rent, the remaining lease term and the tenant's ability to pay. Single-tenant buildings are underwritten close to the tenant's credit. Multi-tenant and flex buildings are underwritten more like small office or retail, with rollover and re-leasing costs.",
          "Environmental review matters more here than for most property types. Expect a Phase I environmental site assessment on every loan, and further testing where past uses involved fuel, chemicals or manufacturing.",
        ],
        bullets: [
          "Clear height, loading, truck court and power, which decide how easily the space re-leases",
          "Remaining lease term and renewal options",
          "Phase I environmental site assessment and any recommended follow-up",
        ],
      },
      {
        heading: "Owner-users and investors",
        paragraphs: [
          "Owner-users that run their business from the building may fit SBA 504, which pairs a bank first lien with a CDC debenture, or a bank loan tied to the operating company. Investors usually compare bank and credit union loans, life company and CMBS fixed-rate loans, and bridge debt for vacant or repositioned buildings.",
        ],
        bullets: [
          "Owner-user: SBA 504, SBA 7(a) or a bank loan",
          "Stabilized and well leased: life company, CMBS or bank",
          "Vacant, dated or repositioning: debt fund or private bridge",
        ],
      },
      {
        heading: "California industrial markets",
        paragraphs: [
          "Lenders weigh submarket vacancy and rent trends in markets such as the Inland Empire, Los Angeles and Orange County, the Bay Area and the Central Valley, so we pair each request with current leasing data for the building's own submarket.",
        ],
      },
    ],
    faq: [
      {
        question: "Can a flex building get industrial financing?",
        answer: "Usually, though lenders look at how much of the building is office finish and how easily the space could be re-leased to a typical industrial tenant.",
      },
      {
        question: "Why does an industrial loan need an environmental report?",
        answer: "Past industrial uses can leave contamination that affects value and the lender's collateral. A Phase I report identifies recognized environmental conditions, and lenders may ask for more testing before they commit.",
      },
      {
        question: "Can an owner-user buy a warehouse with an SBA loan?",
        answer: "Often, through SBA 504 or 7(a), when the business occupies enough of the building to meet SBA occupancy rules and is otherwise eligible. Banks also lend to owner-users directly.",
      },
    ],
    related: ["office-loans", "bank-credit-union-loans", "life-company-loans", "acquisition-loans", "commercial"],
  },
  {
    slug: "retail-loans",
    family: "commercial",
    name: "Retail property loans",
    title: "Retail property loans",
    description:
      "Loans for California shopping centers, strip retail and single-tenant net lease buildings. Compare bank, life company, CMBS and bridge options.",
    summary: "Debt for strip centers, anchored centers and single-tenant net lease retail.",
    definition:
      "A retail property loan is a commercial mortgage secured by a shopping center, strip center, single-tenant net lease building or street retail, sized on the rent its tenants pay. Lenders weigh anchor and tenant credit, co-tenancy clauses, lease rollover and the trade area around the property.",
    loanType: "Retail property mortgage (brokered)",
    facts: [
      typicalLenders("Banks and credit unions, life companies, CMBS conduits, debt funds and private lenders"),
      ...bankLoanFacts(),
      bridgeFact(),
      reviewFirst("Rent roll, anchor and co-tenancy terms, tenant sales where reported, and lease expirations"),
    ],
    sections: [
      {
        heading: "How retail loans are underwritten",
        paragraphs: [
          "Grocery-anchored and service-oriented centers with daily-needs tenants attract the widest lender interest. Lenders look at who drives traffic, how long the anchors are committed, and whether co-tenancy clauses would let other tenants pay less or leave if an anchor goes dark.",
          "Single-tenant net lease buildings are underwritten largely on the tenant's credit and the lease term remaining, which can support long fixed-rate loans from life companies and CMBS conduits.",
        ],
        bullets: [
          "Anchor lease term and any go-dark or co-tenancy rights",
          "Tenant mix: the share of local, regional and national tenants",
          "Tenant improvement and leasing costs for vacant space",
        ],
      },
      {
        heading: "Matching the center to a lender",
        paragraphs: ["Retail lenders differ more by tenant mix than by property size, so we start with the rent roll and the leases and send the loan to lenders whose appetite fits."],
        bullets: [
          "Stabilized with credit anchors: life company or CMBS",
          "Local and regional tenants, relationship borrower: bank or credit union",
          "Vacancy, an anchor departure or a redevelopment plan: bridge debt",
          "Single-tenant net lease: life company, CMBS or bank, depending on the tenant",
        ],
      },
      {
        heading: "Purchases and 1031 exchanges",
        paragraphs: [
          "Many retail purchases are part of a 1031 exchange with fixed deadlines. Lenders need the leases, tenant estoppels and third-party reports before closing, so we line those up as soon as the property is under contract.",
          disclosures.timeline,
        ],
      },
    ],
    faq: [
      {
        question: "What is co-tenancy and why do lenders care?",
        answer: "A co-tenancy clause lets a tenant pay reduced rent or end its lease if an anchor, or a set share of the center, goes dark. Lenders discount the income at risk when they size the loan.",
      },
      {
        question: "Can I get a non-recourse loan on a strip center?",
        answer: "Often, from CMBS conduits and some life companies, with standard carve-outs for fraud, misapplication of funds and bankruptcy. Banks and credit unions usually ask for a guaranty.",
      },
      {
        question: "How is a single-tenant net lease building financed?",
        answer: "Lenders underwrite it largely on the tenant's credit and the lease term remaining. A long lease to a strong tenant can support long fixed-rate debt; a short remaining term usually limits leverage or term.",
      },
    ],
    related: ["mixed-use-loans", "cmbs-loans", "life-company-loans", "acquisition-loans", "commercial"],
  },
  {
    slug: "self-storage-loans",
    family: "commercial",
    name: "Self-storage loans",
    title: "Self-storage loans",
    description:
      "Self-storage financing for California facilities: bank, SBA, life company, CMBS and bridge options for stabilized, lease-up and expansion projects.",
    summary: "Debt for stabilized, lease-up and expanding self-storage facilities.",
    definition:
      "A self-storage loan is a commercial mortgage secured by a storage facility and underwritten on income from month-to-month rentals, so lenders focus on occupancy trends, rental rates, operating expenses and the strength of the operator and its management platform.",
    loanType: "Self-storage mortgage (brokered)",
    facts: [
      typicalLenders("Banks and credit unions, SBA lenders for owner-operators, life companies, CMBS conduits and debt funds"),
      ...bankLoanFacts(),
      bridgeFact(),
      reviewFirst("Trailing operating statements, occupancy and rate history, unit mix and the management agreement"),
    ],
    sections: [
      {
        heading: "How self-storage loans are underwritten",
        paragraphs: [
          "Storage customers rent month to month, so lenders rely on the facility's operating history rather than lease terms. They look at trailing income, physical and economic occupancy, rate increases to existing customers, and how much new supply is planned nearby.",
          "Operator quality matters. Facilities run on an established management platform, with online rentals and revenue management, tend to attract more lender interest than self-managed sites.",
        ],
        bullets: [
          "Trailing operating statements and a current rent roll by unit type",
          "Occupancy trend, and street rates against in-place rates",
          "New supply planned within the trade area",
        ],
      },
      {
        heading: "Lease-up, expansion and conversion",
        paragraphs: [
          "Newer facilities still in lease-up, expansions, and conversions of other buildings to storage usually start with a bank or a bridge loan sized to the business plan, then move to permanent debt once occupancy stabilizes. Owner-operators may fit SBA 504 or 7(a) for purchases and expansions, subject to SBA eligibility.",
        ],
        bullets: [
          "Stabilized: bank, life company or CMBS",
          "Lease-up or expansion: bank or debt fund bridge",
          "Owner-operator purchase: SBA 504 or 7(a), subject to eligibility",
        ],
      },
    ],
    faq: [
      {
        question: "Can SBA finance a self-storage facility?",
        answer: "Often, when the borrower owns and actively operates the facility. Eligibility depends on the ownership structure and the SBA rules in effect at application, so we confirm it with SBA lenders first.",
      },
      {
        question: "How do lenders treat a facility in lease-up?",
        answer: "Permanent lenders usually want stabilized occupancy and a record of achieved rents. Before that, banks and bridge lenders can size to the lease-up plan, often with an interest reserve and a defined take-out.",
      },
      {
        question: "Does a third-party manager help?",
        answer: "Often. Lenders look favorably on experienced operators and established management platforms, which can widen the lender pool and affect leverage.",
      },
    ],
    related: ["acquisition-loans", "bank-credit-union-loans", "cmbs-loans", "debt-fund-bridge-loans", "commercial"],
  },
  {
    slug: "medical-office-loans",
    family: "commercial",
    name: "Medical office building loans",
    title: "Medical office building loans",
    description:
      "Financing for medical office buildings and outpatient clinics in California: bank, SBA, life company and CMBS options for investors and physician owners.",
    summary: "Debt for medical office buildings, clinics and outpatient space.",
    definition:
      "A medical office building loan is a commercial mortgage secured by space leased to physicians, dental groups, health systems or outpatient providers. Lenders underwrite it much like office, with added weight on tenant credit, health system affiliation, specialized build-outs and how long medical tenants tend to stay.",
    loanType: "Medical office building mortgage (brokered)",
    facts: [
      typicalLenders("Banks and credit unions, SBA lenders for physician owner-users, life companies and CMBS conduits"),
      ...bankLoanFacts(),
      bridgeFact(),
      reviewFirst("Rent roll, leases, tenant financials, any health system affiliation and any ground lease"),
    ],
    sections: [
      {
        heading: "Why lenders treat medical office differently",
        paragraphs: [
          "Medical tenants invest heavily in their space and often renew, and buildings on or near a hospital campus benefit from referral patterns. Lenders recognize that stability, but they also weigh the cost to re-lease specialized space if a tenant leaves.",
          "Ground leases are common on hospital campuses. The ground lease term, rent and the landowner's consent rights all affect what a lender can offer.",
        ],
        bullets: [
          "Tenant mix and credit, including any health system tenants",
          "Location on or near a hospital campus",
          "Ground lease terms where the building sits on hospital land",
        ],
      },
      {
        heading: "Physician owners and investors",
        paragraphs: [
          "Physician groups that occupy their own building can often use SBA 504 or a bank loan tied to the practice. Investors in multi-tenant medical office buildings usually compare bank, life company and CMBS fixed-rate options.",
        ],
        bullets: [
          "Owner-user practice: SBA 504, SBA 7(a) or a bank loan",
          "Stabilized multi-tenant: life company, CMBS or bank",
          "Lease-up or repositioning: bank or debt fund bridge",
        ],
      },
    ],
    faq: [
      {
        question: "Is medical office financed differently from regular office?",
        answer: "The structure is similar, but lenders often view stable medical tenancy favorably and spend more time on tenant credit, build-out costs and any ground lease.",
      },
      {
        question: "Can a medical practice buy its building with an SBA loan?",
        answer: "Often, through SBA 504 or 7(a), when the practice occupies enough of the building to meet SBA occupancy rules and is otherwise eligible.",
      },
      {
        question: "What if the building is on a hospital ground lease?",
        answer: "Lenders review the ground lease term, rent and consent rights closely. A ground lease that runs well past the loan maturity and allows financing is usually needed.",
      },
    ],
    related: ["office-loans", "bank-credit-union-loans", "life-company-loans", "cmbs-loans", "commercial"],
  },
  {
    slug: "mixed-use-loans",
    family: "commercial",
    name: "Mixed-use property loans",
    title: "Mixed-use property loans",
    description:
      "Loans for California mixed-use buildings with apartments over retail or office. See how lenders weigh residential and commercial income and which programs fit.",
    summary: "Debt for buildings that combine apartments with retail or office space.",
    definition:
      "A mixed-use property loan is a commercial mortgage secured by a building that combines residential units with retail, office or other commercial space. Lenders classify the property by how much of its income and floor area is residential, and that split decides which loan programs are open to it.",
    loanType: "Mixed-use property mortgage (brokered)",
    facts: [
      typicalLenders("Banks and credit unions, Fannie Mae, Freddie Mac and HUD lenders for mostly residential buildings, life companies, CMBS conduits and debt funds"),
      ...bankLoanFacts(),
      bridgeFact(),
      fact("What decides the program", "The residential share of income and floor area, measured against each program's own limits", SRC.market),
    ],
    sections: [
      {
        heading: "Residential or commercial: why the split matters",
        paragraphs: [
          "When most of the income comes from apartments, the building can often be financed like multifamily, including agency loans from Fannie Mae and Freddie Mac and HUD programs, each of which limits how much commercial space it accepts. When the commercial space carries more of the income, lenders underwrite the building as commercial real estate.",
          "Ground-floor retail in a mixed-use building is underwritten on its leases, and lenders usually discount vacant or short-term commercial space more heavily than vacant apartments.",
        ],
        bullets: [
          "Mostly residential: Fannie Mae, Freddie Mac or HUD, within each program's commercial-space limits",
          "Balanced or mostly commercial: bank, credit union, life company or CMBS",
          "Lease-up or repositioning: multifamily or debt fund bridge",
        ],
      },
      {
        heading: "California considerations",
        paragraphs: [
          "California rent rules, including AB 1482, and local ordinances limit rent growth on covered units, and lenders underwrite to those limits. Many mixed-use buildings are older urban properties, so expect lenders to ask for a seismic report on older construction.",
        ],
      },
    ],
    faq: [
      {
        question: "Can a mixed-use building get an agency loan?",
        answer: "Often, when it is mostly residential and the commercial space stays within the program's limits. Fannie Mae and Freddie Mac each set their own thresholds, so we check the building against both.",
      },
      {
        question: "How do lenders value the retail space?",
        answer: "On its leases, with vacancy and re-leasing costs deducted. Vacant ground-floor space is often given little or no income until it is leased.",
      },
      {
        question: "Does rent control affect a mixed-use loan?",
        answer: "Yes, on covered residential units. Lenders size to the rents the law allows, not to market rents the building cannot reach.",
      },
    ],
    related: ["fannie-mae-multifamily", "freddie-mac-multifamily", "multifamily-bridge", "retail-loans", "commercial"],
  },
  {
    slug: "mobile-home-park-loans",
    family: "commercial",
    name: "Manufactured housing communities",
    title: "Mobile home park and MHC loans",
    description:
      "Financing for California mobile home parks and manufactured housing communities: agency, bank, CMBS and bridge options, and how local rent rules affect sizing.",
    summary: "Debt for mobile home parks and manufactured housing communities.",
    definition:
      "A manufactured housing community loan, often called a mobile home park loan, is a commercial mortgage secured by land leased as homesites to owners of manufactured homes, sometimes with park-owned homes. Lenders underwrite site rent, occupancy, utility arrangements and local rent rules.",
    loanType: "Manufactured housing community mortgage (brokered)",
    facts: [
      typicalLenders("Fannie Mae and Freddie Mac manufactured housing lenders, banks and credit unions, CMBS conduits and debt funds"),
      ...bankLoanFacts(),
      bridgeFact(),
      reviewFirst("Site rent roll, occupancy, park-owned homes, utility billing and local rent rules"),
    ],
    sections: [
      {
        heading: "How park loans are underwritten",
        paragraphs: [
          "Most of a community's income is site rent paid by residents who own their homes, and that income tends to be steady because moving a manufactured home is costly. Lenders treat rent from park-owned and rental homes differently, often giving it less weight than site rent.",
          "Utilities matter. Lenders look at whether water and sewer are public or private, how utilities are billed back to residents, and the condition of the park's own systems.",
        ],
        bullets: [
          "Site rent roll and occupancy by homesite",
          "Number of park-owned or rental homes",
          "Private water or sewer systems, and how utilities are billed",
          "All-age or age-restricted community",
        ],
      },
      {
        heading: "California rent rules",
        paragraphs: [
          "Many California cities and counties have mobile home rent stabilization ordinances that limit site rent increases, and the state's Mobilehome Residency Law sets resident protections. Lenders size the loan to the rents those rules allow, so we gather the local ordinance and the park's rent history up front.",
        ],
      },
      {
        heading: "Choosing a lender",
        paragraphs: [
          "Fannie Mae and Freddie Mac manufactured housing programs offer long fixed terms for stabilized communities that meet their standards. Banks, credit unions and bridge lenders fill in for smaller parks and parks in transition.",
        ],
        bullets: [
          "Stabilized community: Fannie Mae or Freddie Mac manufactured housing lenders, a bank or CMBS",
          "Infill, expansion or many park-owned homes: bank or debt fund bridge",
          "Smaller community: bank or credit union",
        ],
      },
    ],
    faq: [
      {
        question: "Do Fannie Mae and Freddie Mac finance mobile home parks?",
        answer: "Yes. Both have manufactured housing community programs for stabilized communities that meet their property and sponsor standards. We check which program, if either, fits the park.",
      },
      {
        question: "Do park-owned homes affect the loan?",
        answer: "Yes. Lenders usually give rent from park-owned or rental homes less weight than site rent, and some limit how many such homes a community can have.",
      },
      {
        question: "How does local rent control affect financing?",
        answer: "Lenders size the loan to the site rents the local ordinance allows. We collect the ordinance and the park's rent history so lenders can underwrite it.",
      },
    ],
    related: ["fannie-mae-multifamily", "freddie-mac-multifamily", "bank-credit-union-loans", "debt-fund-bridge-loans", "commercial"],
  },

  // ---------------------------------------------------------------------------
  // Capital types
  {
    slug: "acquisition-loans",
    family: "commercial",
    name: "Acquisition loans",
    title: "Commercial property acquisition loans",
    description:
      "Acquisition financing for California commercial property. Compare bank, life company, CMBS and bridge loans, and see how lenders size a purchase.",
    summary: "Purchase financing for stabilized and value-add commercial property.",
    definition:
      "A commercial acquisition loan is a mortgage used to buy income-producing real estate, sized on the lower of the purchase price or appraised value and the property's net operating income. The right lender depends on whether the property is stabilized or needs work, and on the purchase timeline.",
    loanType: "Commercial acquisition loan (brokered)",
    facts: [
      fact("Leverage basis", "The lower of purchase price and appraised value", SRC.market, { verify: false }),
      ...bankLoanFacts(),
      bridgeFact(),
      fact("Bridge loan: typical close", `${BRIDGE.closeRange} after a complete file`, SRC.corin),
    ],
    sections: [
      {
        heading: "Stabilized or value-add",
        paragraphs: [
          "A stabilized property with steady occupancy can be bought with permanent debt from a bank, credit union, life company or CMBS conduit. A property that needs leasing, renovation or a new operator usually starts with a bridge loan that funds part of the business plan, then refinances into permanent debt.",
        ],
        bullets: [
          "Stabilized: bank, credit union, life company or CMBS",
          "Value-add: debt fund or private bridge, sometimes with future funding for improvements",
          "Owner-user: SBA 504 or a bank loan",
          "Gap between the senior loan and your equity: mezzanine or preferred equity",
        ],
      },
      {
        heading: "Timing the purchase",
        paragraphs: [
          "Purchase contracts set deadlines for deposits and loan contingencies. Bank and permanent lenders need an appraisal, third-party reports and the leases, so we start those as soon as the property is under contract.",
          `Bridge lenders often move faster: many close in ${BRIDGE.closeRange} after a complete file, subject to appraisal and title. Timing is not guaranteed.`,
        ],
      },
      {
        heading: "What the lender will ask for",
        paragraphs: [
          `The signed purchase agreement, the seller's rent roll and operating statements, the leases, your sources of equity, and your experience with similar property. ${PROP_13}`,
        ],
      },
    ],
    faq: [
      {
        question: "How much equity does a commercial purchase need?",
        answer: "It depends on the lender and the property. Permanent lenders size to the lower of loan-to-value and debt coverage, and bridge lenders size to value and the business plan. The facts table shows the sizing assumptions we start from.",
      },
      {
        question: "Can I buy with a bridge loan and refinance later?",
        answer: "Yes. That is common for value-add purchases. The bridge lender tests the refinance up front, so the plan needs realistic rents, costs and timing.",
      },
      {
        question: "Can a 1031 exchange buyer use these loans?",
        answer: "Yes. Exchange deadlines are fixed, so we start lender work early and match the loan to the timeline. Your exchange intermediary and counsel handle the exchange itself.",
      },
    ],
    related: ["private-bridge", "debt-fund-bridge-loans", "bank-credit-union-loans", "mezzanine-preferred-equity", "commercial"],
  },
  {
    slug: "mezzanine-preferred-equity",
    family: "commercial",
    name: "Mezzanine and preferred equity",
    title: "Mezzanine and preferred equity",
    description:
      "Mezzanine loans and preferred equity fill the gap between a senior loan and sponsor equity. See how each is structured, priced and secured in a capital stack.",
    summary: "Subordinate capital that fills the gap between senior debt and common equity.",
    definition:
      "Mezzanine financing is a subordinate loan secured by a pledge of the ownership interests in the borrowing entity rather than by the property, and preferred equity is an investment in that entity with a priority return. Both fill the gap between the senior loan and the sponsor's common equity.",
    loanType: "Mezzanine financing (brokered)",
    facts: [
      fact("Mezzanine: indicative rate (Corin construction sizing assumption)", pct(CONSTRUCTION.mezz.ratePct / 100), SRC.corin),
      fact("Mezzanine: max combined loan-to-cost (Corin construction sizing assumption)", pct(CONSTRUCTION.mezz.maxCombinedLtc), SRC.corin),
      fact("Preferred equity: indicative return (Corin construction sizing assumption)", pct(CONSTRUCTION.pref.returnPct / 100, 1), SRC.corin),
      fact("Preferred equity: max combined loan-to-cost (Corin construction sizing assumption)", pct(CONSTRUCTION.pref.maxCombinedLtc), SRC.corin),
      fact("Sponsor common equity kept in the stack (Corin sizing assumption)", `${pct(CONSTRUCTION.minCommonEquityPct)} of total cost`, SRC.corin),
      fact("Security", "Mezzanine: pledge of the ownership interests. Preferred equity: priority position inside the ownership entity", SRC.market, { verify: false }),
    ],
    sections: [
      {
        heading: "Where they sit in the capital stack",
        paragraphs: [
          "The senior lender takes a first lien on the property. Mezzanine and preferred equity sit behind it and ahead of the sponsor's common equity, so they cost more than senior debt and less than giving up common ownership. The senior lender's consent and an intercreditor or recognition agreement set each party's rights.",
        ],
        bullets: [
          "Senior loan: first lien on the property, lowest cost",
          "Mezzanine loan: secured by the ownership interests, with remedies through a UCC foreclosure",
          "Preferred equity: priority return and control rights inside the ownership entity",
          "Common equity: the sponsor's first-loss capital",
        ],
      },
      {
        heading: "When to use it",
        paragraphs: [
          "Sponsors use mezzanine or preferred equity to reduce the cash they put into an acquisition, a recapitalization or a construction project, or to replace a partner. The trade-off is cost and control: these investors have remedies if the business plan slips, so your counsel should review the documents carefully.",
        ],
        bullets: [
          "Acquisition where the senior loan is sized below the sponsor's target",
          "Construction budget gap between the senior loan and equity",
          "Recapitalization or partner buyout without refinancing the senior loan",
        ],
      },
      {
        heading: "How we approach it",
        paragraphs: [
          "We size the senior loan first, then introduce mezzanine lenders and preferred equity providers whose structures the senior lender will accept. Those capital providers make their own investment decisions and fund their own capital. Corin never holds or disburses funds.",
        ],
      },
    ],
    faq: [
      {
        question: "Is mezzanine debt secured by the property?",
        answer: "No. It is secured by a pledge of the ownership interests in the borrower. After a default, the mezzanine lender can foreclose on those interests and take control of the borrower, subject to the intercreditor agreement.",
      },
      {
        question: "Is preferred equity a loan?",
        answer: "No. It is an equity investment with a priority return and specific rights in the ownership entity. It has no lien, but it can carry control rights that matter as much as a lender's remedies.",
      },
      {
        question: "Does the senior lender have to agree?",
        answer: "Yes. Senior lenders limit or prohibit secondary financing unless they consent to it, usually through an intercreditor or recognition agreement.",
      },
    ],
    related: ["construction-loans", "acquisition-loans", "c-pace", "debt-fund-bridge-loans", "commercial"],
  },
  {
    slug: "life-company-loans",
    family: "commercial",
    name: "Life company loans",
    title: "Life insurance company loans",
    description:
      "Life company loans offer long fixed-rate, often non-recourse debt for stabilized, lower-leverage commercial property. See who they lend to and what they need.",
    summary: "Long fixed-rate debt from insurers for stabilized, lower-leverage property.",
    definition:
      "A life company loan is a permanent commercial mortgage from a life insurance company, which lends against high-quality, stabilized property at conservative leverage in exchange for long fixed-rate terms, competitive pricing and, often, a non-recourse structure.",
    loanType: "Life insurance company commercial mortgage (brokered)",
    facts: [
      fact("Typical property", "Stabilized, well-located property with strong tenancy and moderate leverage", SRC.market, { verify: false }),
      fact("Rate", "Fixed, priced over Treasuries; spreads vary by lender and property", SRC.market),
      fact("Recourse", "Often non-recourse, with standard carve-outs", SRC.market),
      fact("Prepayment", "Usually yield maintenance or a set prepayment schedule", SRC.market),
      fact("Rate lock", "Many lenders offer an early rate lock at application", SRC.market),
    ],
    sections: [
      {
        heading: "Who life companies lend to",
        paragraphs: [
          "Life insurers match long-term liabilities with long-term loans, so they favor stabilized property with low leverage, strong tenants and good locations, such as industrial, grocery-anchored retail, well-leased office and medical office, multifamily and some self-storage. In exchange they offer some of the lowest spreads and longest fixed terms in commercial real estate.",
        ],
        bullets: [
          "Conservative leverage and higher debt coverage than most banks or conduits",
          "Long fixed terms, with amortization set by the lender",
          "Experienced sponsors with strong financial statements",
        ],
      },
      {
        heading: "Life company, CMBS or bank",
        paragraphs: [
          "Life companies are selective but easier to work with after closing: the borrower deals with the lender that holds the loan, not a servicer acting for bondholders. CMBS conduits accept more leverage and a wider range of property but are less flexible. Banks offer relationships and shorter terms, often with recourse.",
        ],
      },
      {
        heading: "What to prepare",
        paragraphs: [
          "Lenders review the property's operating history, rent roll, leases, third-party reports, and the sponsor's financial statements and real estate schedule. A complete, well-organized file helps a life company decide quickly whether the loan fits its allocation.",
        ],
      },
    ],
    faq: [
      {
        question: "What leverage do life companies offer?",
        answer: "Typically lower than banks or CMBS. Life companies trade leverage for pricing and term, so they suit owners who do not need maximum proceeds.",
      },
      {
        question: "Are life company loans non-recourse?",
        answer: "Often, with standard carve-outs for fraud, misapplication of funds and bankruptcy. Terms vary by lender.",
      },
      {
        question: "Can I prepay a life company loan?",
        answer: "Usually, with yield maintenance or a set prepayment premium. Some lenders allow an open period near maturity.",
      },
    ],
    related: ["cmbs-loans", "bank-credit-union-loans", "industrial-loans", "office-loans", "commercial"],
  },
  {
    slug: "bank-credit-union-loans",
    family: "commercial",
    name: "Bank and credit union loans",
    title: "Bank and credit union CRE loans",
    description:
      "Bank and credit union commercial real estate loans offer relationship pricing and flexible structure. See how community and regional lenders size them.",
    summary: "Relationship-based commercial mortgages from banks and credit unions.",
    definition:
      "A bank or credit union commercial real estate loan is a mortgage the lender holds on its own balance sheet, so it sets its own credit box, often prices for the relationship and can be flexible on structure, usually in exchange for shorter terms, a personal guaranty and deposit expectations.",
    loanType: "Bank commercial real estate mortgage (brokered)",
    facts: [
      ...bankLoanFacts(),
      fact("Bank loan: indicative spread (Corin sizing assumption)", `Five-year Treasury + ${pts(BANK_PERM.spread)} points`, SRC.corin),
      fact("Recourse", "Usually a personal guaranty, sometimes limited for strong sponsors", SRC.market, { verify: false }),
      fact("Relationship", "A deposit or treasury management relationship is often expected", SRC.market, { verify: false }),
    ],
    sections: [
      {
        heading: "How banks and credit unions lend",
        paragraphs: [
          "Banks and credit unions keep commercial loans on their own books, so each sets its own appetite by property type, location and sponsor. Community and regional lenders often know their local markets well and can be flexible on structure, which helps on smaller loans and on property that does not fit conduit or agency rules.",
          "Most bank loans fix or set the rate for an initial period and mature well before the amortization schedule ends, and many require a personal guaranty and a deposit relationship.",
        ],
        bullets: [
          "Relationship pricing that can improve with deposits",
          "Shorter terms, with a balloon payment at maturity",
          "Full or partial recourse",
          "Prepayment terms that are often lighter than CMBS or life company loans",
        ],
      },
      {
        heading: "Credit unions",
        paragraphs: [
          "Credit unions also lend on commercial real estate, subject to membership requirements and federal limits on member business lending. They can fit owner-users and smaller investors well, and their appetite varies by institution.",
        ],
      },
      {
        heading: "Why use a broker for a bank loan",
        paragraphs: [
          "Each bank's credit box is different and changes with its balance sheet. We know which local and regional lenders are active for a property type and size, present the loan the way their credit committees review it, and compare offers side by side.",
        ],
      },
    ],
    faq: [
      {
        question: "Do bank loans require a personal guaranty?",
        answer: "Most do, at least in part. Strong sponsors at lower leverage can sometimes negotiate a limited or burn-off guaranty.",
      },
      {
        question: "How long are bank loan terms?",
        answer: "Banks commonly fix or set the rate for an initial period and mature the loan before the amortization ends, leaving a balloon payment. Exact terms vary by lender.",
      },
      {
        question: "Do I need to move my deposits?",
        answer: "Many banks expect a deposit relationship and price the loan with it in mind. Credit unions require membership. We clarify these expectations before you choose a lender.",
      },
    ],
    related: ["life-company-loans", "cmbs-loans", "acquisition-loans", "construction-loans", "commercial"],
  },
  {
    slug: "cmbs-loans",
    family: "commercial",
    name: "CMBS conduit loans",
    title: "CMBS conduit loans",
    description: `CMBS conduit loans offer ${years(CMBS.termYears)} fixed, non-recourse debt for stabilized commercial property. See how conduits size loans and the trade-offs after closing.`,
    summary: "Fixed-rate, non-recourse conduit debt for stabilized commercial property.",
    definition:
      "A CMBS conduit loan is a fixed-rate, non-recourse commercial mortgage that a conduit lender makes to pool with other loans and sell as commercial mortgage-backed securities. After closing, a servicer administers the loan for bondholders, so terms are set at closing and most changes need servicer consent.",
    loanType: "CMBS conduit loan (brokered)",
    loanTermYears: CMBS.termYears,
    facts: [
      fact("Term / amortization (Corin sizing assumption)", `${years(CMBS.termYears)} fixed / ${years(CMBS.amortYears)} schedule`, SRC.corin),
      fact("Sizing tests", "The lowest of loan-to-value, debt service coverage and debt yield", SRC.market, { verify: false }),
      fact("Recourse", "Non-recourse, with standard carve-outs", SRC.market, { verify: false }),
      fact("Prepayment", "Defeasance or yield maintenance", SRC.corin, { verify: false }),
      fact("Reserves", "Taxes, insurance, replacement and, where required, leasing reserves", SRC.market),
    ],
    sections: [
      {
        heading: "How conduits size a loan",
        paragraphs: [
          "Conduit underwriters size to the lowest of loan-to-value, debt service coverage and debt yield, using in-place income with vacancy and reserve deductions. Because the loan will be sold into a securitization, rating agency standards shape the terms.",
          "Conduits finance a wide range of stabilized property: office, retail, industrial, self-storage, mixed-use and manufactured housing communities, as well as hotels, which have their own page.",
        ],
        bullets: [
          "Fixed rate for the full term, priced over Treasuries",
          "Non-recourse, with carve-outs for fraud, misapplication of funds and bankruptcy",
          "Cash management and reserves set in the loan documents",
        ],
      },
      {
        heading: "Trade-offs after closing",
        paragraphs: [
          "CMBS loans are inflexible once closed. Prepayment generally requires defeasance or yield maintenance, and assumptions, major leases and other changes go through a servicer rather than a relationship lender. For owners who plan to hold the property and value non-recourse, fixed-rate debt, that trade-off often works. Owners who may sell or refinance early often fit a bank or life company loan better.",
        ],
      },
    ],
    faq: [
      {
        question: "Is a CMBS loan non-recourse?",
        answer: "Yes, with customary carve-outs for events like fraud, misapplication of funds and voluntary bankruptcy. Triggering a carve-out can create full liability.",
      },
      {
        question: "Can a CMBS loan be assumed when I sell?",
        answer: "Often, with servicer consent, an assumption fee and a buyer who meets the servicer's standards.",
      },
      {
        question: "Who handles the loan after closing?",
        answer: "A master servicer collects payments, and a special servicer handles defaults and major changes. Neither is Corin, which arranges the loan as a broker.",
      },
    ],
    related: ["hotel-cmbs", "life-company-loans", "bank-credit-union-loans", "retail-loans", "mobile-home-park-loans", "commercial"],
  },
  {
    slug: "debt-fund-bridge-loans",
    family: "commercial",
    name: "Debt fund bridge loans",
    title: "Debt fund bridge loans",
    description:
      "Debt fund bridge loans finance commercial property in transition: lease-up, renovation or a maturing loan. See leverage, term, pricing and the exit test.",
    summary: "Floating-rate transitional debt from institutional debt funds.",
    definition:
      "A debt fund bridge loan is a short-term, usually floating-rate loan from an institutional real estate debt fund that finances a commercial property through a transition, such as lease-up, renovation or repositioning, often with future funding for improvements, until a sale or permanent refinance repays it.",
    loanType: "Debt fund bridge loan (brokered)",
    facts: [
      fact("Max LTV (Corin sizing assumption)", pct(BRIDGE.cre.maxLtv), SRC.corin),
      fact("Minimum debt yield (Corin sizing assumption)", pct(BRIDGE.cre.minDebtYield), SRC.corin),
      fact("Typical term", `${BRIDGE.cre.termMonths} months`, SRC.corin),
      fact("Indicative spread", `SOFR + ${pts(BRIDGE.cre.spread)} points`, SRC.corin),
      fact("Lender fee / exit fee", `${pct(BRIDGE.lenderFeePct, 1)} / ${pct(BRIDGE.exitFeePct, 1)}`, SRC.corin),
      fact("Exit test (stabilized)", `Debt yield ${BRIDGE_EXIT_TEST.debtYield} and ${BRIDGE_EXIT_TEST.dscr} DSCR`, SRC.market),
    ],
    sections: [
      {
        heading: "When a debt fund bridge fits",
        paragraphs: [
          "Debt funds lend on property that banks and permanent lenders will not finance yet: an office or retail building with space to lease, an industrial building that needs work, or a property whose loan comes due in the middle of a business plan. They price for that flexibility and usually lend at a floating rate with an interest rate cap.",
        ],
        bullets: [
          "Purchase of a value-add property",
          "Refinance of a maturing loan while the property is repositioned",
          "Future funding for capital work, tenant improvements and leasing commissions",
          "Lease-up of a newly built or converted property",
        ],
      },
      {
        heading: "Debt fund or private lender",
        paragraphs: [
          "Debt funds usually offer larger loans at lower spreads than private lenders, with more documentation and a longer process. Private and hard money lenders are faster and more flexible on smaller loans, at a higher cost.",
          LENDER_OF_RECORD,
        ],
      },
      {
        heading: "The exit decides the loan",
        paragraphs: [
          `Every bridge lender tests how its loan will be repaid. At stabilization the property should reach a debt yield of ${BRIDGE_EXIT_TEST.debtYield} and ${BRIDGE_EXIT_TEST.dscr} coverage on the take-out loan, so we model that test before the loan goes to lenders.`,
        ],
      },
    ],
    faq: [
      {
        question: "What is future funding?",
        answer: "A commitment inside the bridge loan to fund planned capital work or leasing costs after closing, released by the lender as the work is completed under its own process.",
      },
      {
        question: "Do debt fund loans need an interest rate cap?",
        answer: "Most floating-rate bridge loans require the borrower to buy a rate cap for the initial term, and to extend it if the loan is extended.",
      },
      {
        question: "How long does a debt fund bridge loan take?",
        answer: `Many bridge lenders work within ${BRIDGE.closeRange} after a complete file, subject to appraisal, title and diligence; debt funds can take longer on larger or more complex loans. Timing is not guaranteed.`,
      },
    ],
    related: ["private-bridge", "multifamily-bridge", "acquisition-loans", "self-storage-loans", "commercial"],
  },
];
