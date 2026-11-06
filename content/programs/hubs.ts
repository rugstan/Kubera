import { AGENCY, CMBS, HUD, SBA } from "@/lib/sizing/assumptions";
import { disclosures } from "@/lib/site";
import { pct, usd, x } from "./format";
import type { HubEntry } from "./types";

const s232 = HUD.section232;
const mf = HUD.multifamily;

// The hard-money hub is the `hard-money` program page itself (see hard-money.ts),
// because the program and its hub share one URL.
export const hubs: HubEntry[] = [
  {
    slug: "senior-living",
    family: "senior-living",
    name: "Senior living financing",
    title: "Senior living financing in California",
    description:
      "Compare HUD 232, bridge-to-HUD, SBA 504 and bank loans for assisted living, RCFE, memory care and skilled nursing. Advisor-led, licensed California broker.",
    summary: "HUD, SBA, bridge and bank options for senior living owners.",
    definition:
      "Senior living financing is commercial real estate debt for licensed assisted living, residential care (RCFE), memory care and skilled nursing facilities. Lenders underwrite the building and the operating business, so license standing, census and the operator's record weigh as heavily as the real estate.",
    sections: [
      {
        heading: "How to choose a path",
        paragraphs: [
          `Size, seasoning and ownership decide the program. HUD 232 gives the longest fixed term and non-recourse structure at ${pct(s232.refi.maxLtv)} LTV and ${x(s232.refi.minDscr)} DSCR, but its fixed costs favor balances above roughly ${usd(HUD.smallLoanThreshold)}. SBA 504 serves owner-operators on smaller balances. Bridge loans carry properties that are not yet stabilized.`,
        ],
        bullets: [
          "Stabilized and larger: HUD 232/223(f)",
          "Owner-operated and smaller: SBA 504 or 7(a)",
          "Transitional or on a short clock: bridge-to-HUD",
          "Ground-up or conversion: construction or conversion bridge, then permanent debt",
        ],
      },
      {
        heading: "What every lender wants to see",
        paragraphs: [
          "Licenses and survey history, trailing operating statements with census and rate roll, payer mix, the property and operating structure, and operator experience. A complete file shortens every timeline, though timelines are not guaranteed.",
        ],
      },
    ],
    faq: [
      {
        question: "What is the best loan for assisted living?",
        answer: "It depends on size, stabilization and ownership. HUD 232/223(f) fits larger stabilized communities, SBA 504 fits owner-operators, and bridge loans fit transitional properties.",
      },
      {
        question: "Is Corin the lender on senior living loans?",
        answer: disclosures.brokerNotLender,
      },
    ],
    related: ["hotel-to-senior-living-conversion", "hotels", "multifamily", "construction"],
  },
  {
    slug: "hotels",
    family: "hotels",
    name: "Hotel financing",
    title: "Hotel loans in California: SBA, CMBS, PIP",
    description:
      "Compare SBA 504, 7(a) + 504 stacks, hotel CMBS and PIP bridge loans for flagged and independent hotels. Advisor-led, licensed California broker.",
    summary: "SBA, CMBS and bridge options for hotel owners and buyers.",
    definition:
      "Hotel financing is commercial real estate debt secured by a lodging property, underwritten on the hotel's operating performance (ADR, occupancy, RevPAR), franchise standing and property condition. Programs differ in recourse, leverage and flexibility. Corin arranges SBA 504 and 7(a), hotel CMBS, PIP bridge and bank loans for flagged and independent hotels as a licensed broker, not a lender.",
    sections: [
      {
        heading: "How to choose a path",
        paragraphs: [
          `Owner-operators usually start with SBA 504, where equity is ${pct(SBA.equity.base + SBA.equity.specialPurpose)} for special-purpose property and the CDC debenture is fixed for ${SBA.cdcAmortYears} years. Larger stabilized hotels may fit CMBS at ${pct(CMBS.maxLtv)} or lower leverage, and renovations with an open PIP often start with a bridge.`,
        ],
        bullets: [
          "Owner-operated: SBA 504 or a 7(a) + 504 stack",
          "Larger and stabilized, non-recourse preferred: hotel CMBS",
          "Open PIP or transitional: PIP bridge",
          "Hotel conversion: acquisition and conversion bridge",
        ],
      },
      {
        heading: "Key hotel metrics lenders review",
        paragraphs: [
          "ADR, occupancy, RevPAR, STR comp-set penetration, NOI per key, franchise term remaining and PIP scope. We organize these up front so lenders can underwrite from a complete file.",
        ],
      },
    ],
    faq: [
      {
        question: "What is the best loan for a hotel purchase?",
        answer: "Owner-operators often use SBA 504 for the lower fixed cost of the debenture. CMBS fits larger stabilized hotels and a bridge fits properties needing a PIP or repositioning.",
      },
      {
        question: "Are these offers?",
        answer: disclosures.indicative,
      },
    ],
    related: ["c-pace", "senior-living", "multifamily", "construction"],
  },
  {
    slug: "multifamily",
    family: "multifamily",
    name: "Multifamily financing",
    title: "Multifamily loans in California",
    description:
      "Compare HUD 223(f) and 221(d)(4), Fannie Mae, Freddie Mac, bridge and DSCR investor loans for apartments. Advisor-led, licensed California broker.",
    summary: "HUD, agency, bridge and DSCR options for apartment owners.",
    definition:
      "Multifamily financing is commercial real estate debt on apartment properties of five or more units, with investor DSCR loans for smaller rentals. Lenders size to the lesser of loan-to-value and debt service coverage, and the binding test is usually coverage.",
    sections: [
      {
        heading: "How to choose a path",
        paragraphs: [
          `HUD 223(f) offers market-rate leverage of ${pct(mf.s223f.maxLtv)} at ${x(mf.s223f.minDscr)} DSCR with a ${mf.s223f.termYears}-year fixed term. Agency loans offer about ${pct(AGENCY.maxLtv)} leverage with shorter terms and faster execution. Bridge loans fund business plans that are not yet stabilized.`,
        ],
        bullets: [
          "Long hold, stabilized: HUD 223(f)",
          "New construction or heavy rehab: HUD 221(d)(4)",
          "Shorter hold, speed: Fannie Mae or Freddie Mac",
          "Value-add: multifamily bridge, then a permanent loan",
          "Small investor rentals: DSCR investor loans",
        ],
      },
      {
        heading: "California considerations",
        paragraphs: [
          "California rent rules, including AB 1482, and local ordinances limit how fast rents can grow on covered units. Lenders underwrite to those limits, so we include them in the business-plan test.",
        ],
      },
    ],
    faq: [
      {
        question: "Which is better for apartments, HUD or Fannie Mae?",
        answer: "HUD offers longer fixed terms and higher leverage with a slower process. Agency loans are faster with shorter terms. The right choice depends on hold period and timing.",
      },
      {
        question: "Does green certification lower HUD MIP?",
        answer: "No. HUD multifamily now uses a single flat annual premium for applications on or after its effective date.",
      },
    ],
    related: ["hard-money", "senior-living", "hotels", "construction"],
  },
  {
    slug: "commercial",
    family: "commercial",
    name: "Commercial property financing",
    title: "Commercial property loans in California",
    description:
      "Compare bank, life company, CMBS, debt fund bridge and mezzanine options for office, industrial, retail, self-storage and more. Licensed broker, not a lender.",
    summary: "Bank, life company, CMBS, bridge and mezzanine options for income property.",
    definition:
      "Commercial property financing is commercial real estate debt secured by income-producing buildings such as office, industrial, retail, self-storage, medical office, mixed-use and manufactured housing communities. Lenders size the loan to the property's net operating income, its value and the strength of its leases, then weigh the sponsor's experience and the exit.",
    sections: [
      {
        heading: "How to choose a path",
        paragraphs: [
          "The property's stability, the size of the loan and how long you plan to hold decide the lender. Stabilized property with strong leases can borrow long-term fixed-rate debt; property with vacancy, renovation or a near-term deadline usually starts with a bridge loan and refinances later.",
        ],
        bullets: [
          "Stabilized, lower leverage, long hold: life company loan",
          "Stabilized, non-recourse, fixed rate: CMBS conduit loan",
          "Relationship pricing and flexibility: bank or credit union loan",
          "Lease-up, renovation or a maturing loan: debt fund bridge loan",
          "Gap between the senior loan and your equity: mezzanine or preferred equity",
          "Owner-user businesses: SBA 504 or a bank loan, subject to SBA rules",
        ],
      },
      {
        heading: "What every lender wants to see",
        paragraphs: [
          "A current rent roll, the leases, trailing operating statements, recent capital spending, third-party reports, and the sponsor's financial statements and real estate experience. A complete file shortens every timeline, though timelines are not guaranteed.",
        ],
      },
      {
        heading: "California considerations",
        paragraphs: [
          "Property taxes are reassessed on a change of ownership under Proposition 13, so lenders underwrite a purchase on the new tax bill, not the seller's. Lenders often ask for a seismic report on older California buildings, and rent rules apply to the residential units in mixed-use property and to many mobile home parks.",
        ],
      },
    ],
    faq: [
      {
        question: "What is the best loan for a commercial property?",
        answer:
          "It depends on how stable the property is, how much leverage you need and how long you plan to hold. Life companies and CMBS conduits fit stabilized property, banks fit relationship borrowers, and bridge lenders fit property in transition.",
      },
      {
        question: "Is Corin the lender on commercial property loans?",
        answer: disclosures.brokerNotLender,
      },
    ],
    related: ["multifamily", "construction-to-permanent", "private-bridge", "hotel-cmbs", "construction"],
  },
  {
    slug: "construction",
    family: "construction",
    name: "Construction financing",
    title: "Construction financing in California",
    description:
      "Compare bank, debt fund, private, HUD construction-to-permanent and C-PACE options for ground-up and heavy renovation projects. Licensed broker, not a lender.",
    summary: "Bank, debt fund, HUD and C-PACE options for construction projects.",
    definition:
      "Construction financing is commercial real estate debt that funds a project in stages as it is built, secured by the land and improvements, with an interest reserve inside the loan and a defined takeout from a permanent loan or sale. Lenders size on cost, value and income together.",
    sections: [
      {
        heading: "How to choose a path",
        paragraphs: [
          "Banks are cheapest but conservative on leverage. Debt funds and private lenders go higher on cost at higher pricing. HUD offers construction-to-permanent loans for multifamily and senior housing with higher leverage and long fixed terms, in exchange for more process.",
        ],
        bullets: [
          "Bank construction loan, then a permanent loan",
          "Debt fund or private lender for higher leverage and speed",
          "HUD 221(d)(4) or 232 new construction for single-close financing",
          "C-PACE as a piece of the capital stack",
        ],
      },
      {
        heading: "Our role in construction projects",
        paragraphs: [
          "Corin arranges construction financing as a broker. The construction lender funds and administers draws. Corin has no role in draw requests, inspections or lien waivers, and never holds or disburses loan funds.",
        ],
      },
    ],
    faq: [
      {
        question: "What is an interest reserve?",
        answer: "A portion of the loan set aside to pay interest during construction and lease-up. It is part of the loan, so it counts toward leverage.",
      },
      {
        question: "Does Corin manage construction draws?",
        answer: "No. The construction lender funds and administers draws. Corin has no role in them.",
      },
    ],
    related: ["hud-221d4", "bridge-to-hud", "multifamily", "hard-money"],
  },
];
