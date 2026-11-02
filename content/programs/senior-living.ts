import { BRIDGE, HUD, SBA, SPREADS } from "@/lib/sizing/assumptions";
import { disclosures } from "@/lib/site";
import { HUD_TIMING } from "./market-facts";
import { fact, pct, pts, SRC, usd, x, years } from "./format";
import type { ProgramEntry } from "./types";

const s232 = HUD.section232;

export const seniorLivingPrograms: ProgramEntry[] = [
  {
    slug: "hud-232",
    family: "senior-living",
    name: "HUD Section 232",
    title: "HUD 232 senior housing loans",
    description:
      "HUD Section 232 insures long-term, non-recourse loans on assisted living, board and care, memory care and skilled nursing. See leverage, costs and fit.",
    summary: "FHA-insured, long-term, non-recourse debt for licensed healthcare real estate.",
    definition:
      "HUD Section 232 is an FHA mortgage insurance program that lets a HUD MAP lender make long-term, fixed-rate, non-recourse loans secured by licensed assisted living, board and care, memory care and skilled nursing facilities. It covers refinances and acquisitions of existing buildings and new construction or substantial rehabilitation.",
    loanType: "FHA-insured senior housing mortgage (brokered)",
    loanTermYears: s232.refi.termYears,
    facts: [
      fact("Refinance or acquisition: term", `Up to ${years(s232.refi.termYears)} fixed, fully amortizing`, SRC.hud232),
      fact("Refinance or acquisition: max LTV (for-profit)", pct(s232.refi.maxLtv), SRC.hud232),
      fact("Minimum DSCR", x(s232.refi.minDscr), SRC.hud232),
      fact("New construction: term", `Construction period plus up to ${years(s232.newConstruction.termYears)}`, SRC.hud232),
      fact("New construction: max loan-to-cost (for-profit)", pct(s232.newConstruction.maxLtc), SRC.hud232),
      fact("Annual MIP (refinance / new construction)", `${pct(s232.refi.annualMip, 2)} / ${pct(s232.newConstruction.annualMip, 2)}`, SRC.hud232, {
        verify: true,
      }),
      fact("Upfront MIP", pct(s232.refi.upfrontMip, 2), SRC.hud232),
      fact("Annual CPA audit", `About ${usd(HUD.annualAuditCost)} per year`, SRC.corin),
    ],
    sections: [
      {
        heading: "How the program works",
        paragraphs: [
          "A HUD MAP lender originates and underwrites the loan, HUD insures it, and the loan is typically pooled into a Ginnie Mae security. Because HUD insures the lender against default, lenders accept higher leverage and longer terms than conventional lenders. The loan is non-recourse to the borrower except for customary carve-outs, and it is assumable with HUD consent.",
          "Corin does not lend or insure. We arrange the loan as a licensed broker: we help size it, choose the right HUD lender, and organize the file so underwriting starts complete.",
        ],
      },
      {
        heading: "Which Section 232 loan fits",
        paragraphs: [],
        bullets: [
          "232/223(f): refinance or acquire an existing, stabilized, licensed facility.",
          "232 new construction or substantial rehabilitation: build or gut-renovate a facility with HUD financing from the start.",
          "Bridge-to-HUD: a short-term floating loan that carries a transitional property until it can take out into 232/223(f).",
        ],
      },
      {
        heading: "What lenders look at",
        paragraphs: [
          `Existing facilities generally need ${s232.minYearsSinceCompletion} or more years since construction completion and stabilized operations (around ${pct(s232.stabilizedOccupancy)} occupancy). Underwriters review operator experience, licensing history, trailing census and payer mix, state survey results, and the structure between property owner and operator.`,
          `Fixed costs matter. Third-party reports, legal and title, HUD fees and the annual audit make HUD less efficient on small balances; below roughly ${usd(HUD.smallLoanThreshold)}, an SBA 504 loan is often cheaper all in. HUD processing typically runs ${HUD_TIMING.processing} from application, and timelines are not guaranteed.`,
        ],
      },
    ],
    faq: [
      {
        question: "What is the difference between HUD 232 and HUD 232/223(f)?",
        answer:
          "Section 232 is the insurance program for healthcare facilities. The 232/223(f) loan is its refinance and acquisition product for existing, stabilized buildings. New construction and substantial rehabilitation use the 232 new construction product.",
      },
      {
        question: "Does HUD 232 cover skilled nursing and assisted living?",
        answer:
          "Yes. Section 232 covers licensed skilled nursing facilities, assisted living facilities, board and care homes (including California RCFEs) and memory care, subject to state licensing, operator and size requirements.",
      },
      {
        question: "Is a HUD 232 loan recourse?",
        answer:
          "It is non-recourse to the borrower except for customary carve-outs such as fraud or misapplication of funds. HUD also requires operator and principal certifications.",
      },
      {
        question: "How long does a HUD 232 loan take?",
        answer: `${disclosures.timeline} HUD LEAN processing typically runs ${HUD_TIMING.processing} from application.`,
      },
    ],
    related: ["hud-223f-senior-housing", "bridge-to-hud", "sba-504-hotel", "skilled-nursing", "senior-living"],
  },
  {
    slug: "hud-223f-senior-housing",
    family: "senior-living",
    name: "HUD 232/223(f) refinance",
    title: "HUD 232/223(f) senior housing refinance",
    description:
      "HUD 232/223(f) refinances or acquires existing, stabilized assisted living, memory care and nursing facilities with long-term fixed debt. See eligibility.",
    summary: "Refinance or acquire an existing, stabilized senior housing facility with HUD-insured fixed-rate debt.",
    definition:
      "HUD 232/223(f) is the refinance and acquisition loan within Section 232. It replaces existing debt on, or finances the purchase of, a completed and stabilized licensed senior housing facility with a long-term, fixed-rate, fully amortizing, non-recourse mortgage insured by FHA.",
    loanType: "FHA-insured refinance mortgage (brokered)",
    loanTermYears: s232.refi.termYears,
    facts: [
      fact("Term", `Up to ${years(s232.refi.termYears)} fixed, fully amortizing`, SRC.hud232),
      fact("Max LTV (for-profit)", pct(s232.refi.maxLtv), SRC.hud232),
      fact("Minimum DSCR", x(s232.refi.minDscr), SRC.hud232),
      fact("Seasoning", `${s232.minYearsSinceCompletion}+ years since construction completion`, SRC.hud232),
      fact("Stabilized occupancy", `Around ${pct(s232.stabilizedOccupancy)}`, SRC.hud232),
      fact("Practical minimum size", `About ${s232.practicalMinBeds} beds`, SRC.corin),
      fact("Indicative pricing", `Ten-year Treasury + ${pts(SPREADS.hud232.lo)}–${pts(SPREADS.hud232.hi)} points`, SRC.corin, { verify: false }),
    ],
    sections: [
      {
        heading: "When 223(f) is the right tool",
        paragraphs: [
          "Use 232/223(f) when the building is complete, licensed and operating steadily, and you want the longest fixed amortization available without personal recourse. Common uses are retiring a maturing bank or bridge loan, recapitalizing partners, and acquiring a stabilized facility with seller cooperation.",
        ],
        bullets: [
          "Existing facility with steady trailing census and cash flow",
          "A maturing bridge, bank or CMBS loan that needs a long-term replacement",
          "Acquisition of a stabilized licensed facility",
        ],
      },
      {
        heading: "What can slow a 223(f) file",
        paragraphs: [
          "Most delays trace back to the file, not the program. Licensing gaps, a property and operator structure HUD has not seen before, thin trailing financials, deferred maintenance flagged in the capital needs assessment, and environmental findings are the usual causes.",
          `Costs include the HUD application fee (${pct(HUD.applicationFeePct, 1)}), the lender financing fee, third-party reports and legal. Corin models these side by side with SBA and bridge options in the sizer so the all-in comparison is visible before you commit.`,
        ],
      },
    ],
    faq: [
      {
        question: "What occupancy does a HUD 223(f) senior housing loan need?",
        answer: `HUD generally looks for stabilized operations, around ${pct(s232.stabilizedOccupancy)} occupancy on a trailing basis. A transitional property can use a bridge loan first.`,
      },
      {
        question: "Can I cash out on a 232/223(f) loan?",
        answer: "Proceeds are sized to the lesser of the LTV and DSCR tests and HUD's allowable uses. Whether and how much equity can be taken out depends on the sizing result and HUD's current rules; an advisor confirms this with a HUD lender.",
      },
      {
        question: "Is the rate fixed?",
        answer: "Yes. The rate is fixed for the full term once it is locked, which is a main reason owners choose HUD over floating-rate debt.",
      },
    ],
    related: ["hud-232", "bridge-to-hud", "assisted-living", "memory-care", "senior-living"],
  },
  {
    slug: "bridge-to-hud",
    family: "senior-living",
    name: "Bridge-to-HUD",
    title: "Bridge-to-HUD senior living loans",
    description:
      "A floating-rate, interest-only bridge that carries a senior living property through lease-up or repositioning, sized for a HUD 232/223(f) takeout.",
    summary: "Short-term floating debt to stabilize a facility before a HUD 232/223(f) takeout.",
    definition:
      "A bridge-to-HUD loan is a short-term, floating-rate, interest-only loan from a private lender or debt fund that finances the acquisition or stabilization of a senior living property that does not yet meet HUD's seasoning or occupancy tests, sized so the property can take out into a HUD 232/223(f) loan.",
    loanType: "Short-term bridge loan (brokered)",
    facts: [
      fact("Max LTV", pct(BRIDGE.senior.maxLtv), SRC.corin),
      fact("Minimum debt yield", pct(BRIDGE.senior.minDebtYield), SRC.corin),
      fact("Typical term", `${BRIDGE.senior.termMonths} months`, SRC.corin),
      fact("Indicative spread", `SOFR + ${pts(BRIDGE.senior.spread)} points`, SRC.corin),
      fact("Lender fee / exit fee", `${pct(BRIDGE.lenderFeePct, 1)} / ${pct(BRIDGE.exitFeePct, 1)}`, SRC.corin),
      fact("Takeout test", `${pct(s232.stabilizedOccupancy)} occupancy, ${s232.minYearsSinceCompletion}+ years since completion, ${x(s232.refi.minDscr)} DSCR`, SRC.hud232),
    ],
    sections: [
      {
        heading: "The bridge-to-HUD plan",
        paragraphs: [
          "The structure only works if the exit is credible on day one. We size the bridge against the takeout: the stabilized net operating income has to support a HUD loan large enough to repay the bridge, with margin for HUD costs and the mortgage insurance premium.",
        ],
        bullets: [
          "Acquire a facility below stabilized occupancy and lease it up",
          "Complete a renovation or change of operator before applying to HUD",
          "Bridge a gap while an operator or licensing transition seasons",
        ],
      },
      {
        heading: "Risks to price in",
        paragraphs: [
          "Floating-rate interest, extension fees if lease-up runs long, and the possibility that HUD's tests or timing move before takeout are the main risks. A bridge lender funds as lender of record and underwrites its own credit decision; Corin does not fund bridge loans or hold any borrower money.",
        ],
      },
    ],
    faq: [
      {
        question: "Why bridge instead of going straight to HUD?",
        answer: `HUD 232/223(f) expects a completed, stabilized property. If census is still ramping or ownership just changed, a bridge covers the gap until the file meets HUD's tests.`,
      },
      {
        question: "How fast can a bridge loan close?",
        answer: `Private bridge loans often close faster than agency or HUD loans: many close in ${BRIDGE.closeRange} after a complete file, subject to lender approval, appraisal, title and diligence. This is not guaranteed.`,
      },
      {
        question: "What happens if I cannot take out into HUD?",
        answer: "The usual fallbacks are an extension, a bank or SBA 504 refinance, or a sale. Plan the fallback before closing the bridge.",
      },
    ],
    related: ["hud-223f-senior-housing", "hud-232", "private-bridge", "hotel-to-senior-living-conversion", "senior-living"],
  },
  {
    slug: "assisted-living",
    family: "senior-living",
    name: "Assisted living",
    title: "Assisted living facility loans",
    description:
      "Financing paths for assisted living communities: HUD 232, SBA 504 for owner-operators, bank debt and bridge loans. Compare by size, seasoning and operator.",
    summary: "Compare HUD, SBA, bank and bridge options for assisted living communities.",
    definition:
      "Assisted living facility financing is commercial real estate debt secured by a state-licensed residential community that provides help with daily living, such as meals, medication management and personal care. Lenders underwrite it as both real estate and an operating business.",
    loanType: "Assisted living facility mortgage (brokered)",
    facts: [
      fact("HUD 232/223(f): max LTV / DSCR", `${pct(s232.refi.maxLtv)} / ${x(s232.refi.minDscr)}`, SRC.hud232),
      fact("HUD fit", `Generally ${usd(HUD.smallLoanThreshold)}+ and ${s232.practicalMinBeds}+ beds`, SRC.corin),
      fact("SBA 504: bank first lien", pct(SBA.bankFirstPct), SRC.sba),
      fact("SBA 504: equity for special-purpose property", pct(SBA.equity.base + SBA.equity.specialPurpose), SRC.sba),
      fact("SBA 504: CDC debenture cap", usd(SBA.cdcCap), SRC.sba),
      fact("Bridge: max LTV", pct(BRIDGE.senior.maxLtv), SRC.corin),
    ],
    sections: [
      {
        heading: "Choosing among the options",
        paragraphs: [
          "The right loan depends mostly on size, ownership and how stable the community is. HUD wins on term, leverage and non-recourse when the balance is large enough to absorb its fixed costs. SBA 504 wins for owner-operators on smaller balances. Bridge debt wins on speed and transitional properties.",
        ],
        bullets: [
          "Larger, stabilized community, owner and operator separate or related: HUD 232/223(f)",
          "Owner-operated community on a smaller balance: SBA 504 or 7(a)",
          "Lease-up, acquisition on a short clock or a repositioning: bridge, then permanent debt",
        ],
      },
      {
        heading: "What a lender will ask for",
        paragraphs: [
          "Expect to provide state license and survey history, trailing twelve months of operating statements with census and rate roll, the property and operating structure, a rent roll by care level, and operator resumes. A complete file at the start shortens every program's timeline.",
        ],
      },
    ],
    faq: [
      {
        question: "What is the minimum size for an assisted living loan?",
        answer: `There is no universal minimum, but HUD's fixed costs make it uneconomic on small balances (below roughly ${usd(HUD.smallLoanThreshold)}). SBA 504 and bank loans serve smaller communities.`,
      },
      {
        question: "Do lenders finance the real estate and the business together?",
        answer: "Often yes. SBA 504 and 7(a) can finance real estate for an owner-operator, and HUD underwrites the operating cash flow alongside the building.",
      },
      {
        question: "Can I use the sizer before talking to an advisor?",
        answer: "Yes. The sizer shows indicative structures side by side. They are not offers, and an advisor confirms the numbers with lenders.",
      },
    ],
    related: ["hud-223f-senior-housing", "sba-504-hotel", "rcfe", "memory-care", "senior-living"],
  },
  {
    slug: "rcfe",
    family: "senior-living",
    name: "California RCFE",
    title: "California RCFE loans",
    description:
      "Loans for California residential care facilities for the elderly: Title 22 licensing, SBA 504 for owner-operators, HUD 232 for larger homes and bridge options.",
    summary: "Financing a California residential care facility for the elderly under Title 22.",
    definition:
      "A residential care facility for the elderly (RCFE) is a California community care facility licensed by the Department of Social Services, Community Care Licensing, under Title 22 of the California Code of Regulations. RCFE loans are commercial mortgages whose underwriting depends on the facility's license, capacity and operating record.",
    loanType: "RCFE mortgage (brokered)",
    facts: [
      fact("Licensing regulator", "California Department of Social Services, Community Care Licensing (Title 22)", "California Code of Regulations, Title 22", { verify: false }),
      fact("SBA 504: bank first lien", pct(SBA.bankFirstPct), SRC.sba),
      fact("SBA 504: equity for special-purpose property", pct(SBA.equity.base + SBA.equity.specialPurpose), SRC.sba),
      fact("SBA 504: CDC debenture cap", usd(SBA.cdcCap), SRC.sba),
      fact("HUD 232 practical minimum size", `About ${s232.practicalMinBeds} beds`, SRC.corin),
      fact("SBA typical close", `${SBA.closeRange} after a complete file`, SRC.sba),
    ],
    sections: [
      {
        heading: "Why RCFE loans are different",
        paragraphs: [
          "Most RCFEs are small, often six to a few dozen beds, and many are converted single-family homes. That makes them a poor fit for HUD, whose fixed costs favor larger communities, and a strong fit for SBA 504 and 7(a) when the owner also runs the facility.",
          "Lenders also care about the license. A change of ownership usually requires a new or transferred license from Community Care Licensing, so closing timelines and lender conditions are built around that process.",
        ],
      },
      {
        heading: "Common California structures",
        paragraphs: [],
        bullets: [
          "Owner-operator purchase or refinance: SBA 504, bank first lien plus CDC debenture",
          "Larger or multi-facility portfolio: HUD 232/223(f) when size supports it",
          "Hotel or commercial building conversion to RCFE: bridge for acquisition and conversion, then permanent debt",
          "Ground-up RCFE: construction financing with a licensing plan",
        ],
      },
    ],
    faq: [
      {
        question: "Can an RCFE get an SBA 504 loan?",
        answer: `Yes, when the borrower occupies and operates the facility. Care facilities are treated as special-purpose property, so equity is higher (${pct(SBA.equity.base + SBA.equity.specialPurpose)} in the base case).`,
      },
      {
        question: "Does the RCFE license transfer with the sale?",
        answer: "Not automatically. A buyer generally applies to Community Care Licensing for its own license, and lenders typically condition funding on that process.",
      },
      {
        question: "Is RCFE financing available for memory care?",
        answer: "Yes. Dementia care in an RCFE carries additional licensing and staffing requirements, which lenders review as part of operations.",
      },
    ],
    related: ["assisted-living", "memory-care", "hud-232", "hotel-to-senior-living-conversion", "senior-living"],
  },
  {
    slug: "memory-care",
    family: "senior-living",
    name: "Memory care",
    title: "Memory care facility financing",
    description:
      "How lenders finance memory care communities: licensing, staffing, HUD 232, SBA 504 and bridge loans for dementia care assisted living properties.",
    summary: "Loans for memory care and dementia care communities.",
    definition:
      "Memory care financing is commercial real estate debt on a licensed community that specializes in care for residents with Alzheimer's disease and other dementia. Lenders treat it as assisted living with a specialized program, and underwrite its higher staffing costs and rates.",
    loanType: "Memory care facility mortgage (brokered)",
    facts: [
      fact("HUD 232/223(f): max LTV / DSCR", `${pct(s232.refi.maxLtv)} / ${x(s232.refi.minDscr)}`, SRC.hud232),
      fact("Bridge: max LTV", pct(BRIDGE.senior.maxLtv), SRC.corin),
      fact("Bridge: typical term", `${BRIDGE.senior.termMonths} months`, SRC.corin),
      fact("SBA 504: equity for special-purpose property", pct(SBA.equity.base + SBA.equity.specialPurpose), SRC.sba),
      fact("Stabilization benchmark", `Around ${pct(s232.stabilizedOccupancy)} occupancy`, SRC.hud232),
    ],
    sections: [
      {
        heading: "What changes in underwriting",
        paragraphs: [
          "Memory care carries higher revenue per resident and higher labor cost per resident than standard assisted living. Underwriters therefore focus on staffing ratios, care-level mix, turnover, and whether the community's license and physical plant support dementia care, such as secured perimeters and common areas.",
        ],
      },
      {
        heading: "Financing paths",
        paragraphs: [
          "Stabilized communities on HUD-sized balances typically go to 232/223(f). Newer or ramping communities start with a bridge sized for a HUD takeout. Owner-operators on smaller balances often use SBA 504.",
        ],
        bullets: [
          "Stabilized, larger balance: HUD 232/223(f)",
          "Ramping census or new ownership: bridge-to-HUD",
          "Owner-operated, smaller balance: SBA 504",
        ],
      },
    ],
    faq: [
      {
        question: "Can a memory care community use SBA 504?",
        answer: "Yes, when the borrower owns and operates the community. Care facilities are special-purpose property, so equity is higher than for general commercial real estate.",
      },
      {
        question: "Is memory care treated differently by HUD?",
        answer: "HUD 232 covers licensed assisted living with a memory care component. Lenders look closely at the license category, staffing and the care-level rent roll.",
      },
      {
        question: "Does a new memory care wing count toward stabilization?",
        answer: "Newly added units usually need time to lease up before a lender counts their income. A bridge or phased structure can fit that gap.",
      },
    ],
    related: ["assisted-living", "rcfe", "hud-223f-senior-housing", "bridge-to-hud", "senior-living"],
  },
  {
    slug: "skilled-nursing",
    family: "senior-living",
    name: "Skilled nursing",
    title: "Skilled nursing facility loans",
    description:
      "Financing for skilled nursing facilities: HUD 232 long-term non-recourse debt, bridge loans and what lenders review for Medicaid and Medicare operators.",
    summary: "HUD 232, bridge and bank options for skilled nursing facilities.",
    definition:
      "Skilled nursing facility (SNF) financing is commercial real estate debt secured by a licensed nursing home that provides 24-hour nursing and rehabilitation care. Because most revenue comes from Medicaid and Medicare, lenders underwrite payer mix, reimbursement and regulatory standing as closely as the building.",
    loanType: "Skilled nursing facility mortgage (brokered)",
    loanTermYears: s232.refi.termYears,
    facts: [
      fact("HUD 232/223(f): term", `Up to ${years(s232.refi.termYears)} fixed`, SRC.hud232),
      fact("HUD 232/223(f): max LTV / DSCR", `${pct(s232.refi.maxLtv)} / ${x(s232.refi.minDscr)}`, SRC.hud232),
      fact("Annual MIP (refinance)", pct(s232.refi.annualMip, 2), SRC.hud232),
      fact("Annual CPA audit", `About ${usd(HUD.annualAuditCost)} per year`, SRC.corin),
      fact("Bridge: max LTV", pct(BRIDGE.senior.maxLtv), SRC.corin),
    ],
    sections: [
      {
        heading: "What lenders review",
        paragraphs: [
          "Skilled nursing underwriting centers on the operator. Lenders review state survey and inspection history, star ratings, staffing, payer mix and reimbursement rates, and the lease or ownership structure between the real estate owner and the operating entity.",
        ],
        bullets: [
          "Payer mix: Medicaid, Medicare, managed care and private pay",
          "Regulatory standing and any corrective-action history",
          "Operating-lease coverage when owner and operator are separate",
          "Capital needs and physical plant condition",
        ],
      },
      {
        heading: "Why HUD is common for SNFs",
        paragraphs: [
          "HUD 232 gives SNF owners long fixed amortization and non-recourse terms that conventional lenders rarely match, which is why it is a leading takeout for bridge-financed acquisitions. A CPA-audited financial package is required each year.",
        ],
      },
    ],
    faq: [
      {
        question: "Can a skilled nursing facility with low occupancy get HUD financing?",
        answer: "HUD looks for stabilized operations. A facility below that mark usually starts with a bridge loan or a lender willing to underwrite the turnaround.",
      },
      {
        question: "What documents does a skilled nursing lender ask for?",
        answer: "Expect state licenses and survey reports, trailing operating statements and cost reports, payer-mix and census detail, the ownership and operating structure, and operator resumes.",
      },
      {
        question: "Does reimbursement risk affect pricing?",
        answer: "Yes. Heavy Medicaid dependence and rate changes are reflected in lender underwriting, coverage requirements and pricing.",
      },
    ],
    related: ["hud-232", "hud-223f-senior-housing", "bridge-to-hud", "assisted-living", "senior-living"],
  },
];
