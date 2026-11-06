import { BRIDGE, CMBS, HUD, SBA, SPREADS } from "@/lib/sizing/assumptions";
import { disclosures } from "@/lib/site";
import { fact, pct, pts, SRC, usd, x, years } from "./format";
import type { ProgramEntry } from "./types";

const s232 = HUD.section232;
const sbaEquity = SBA.equity.base + SBA.equity.specialPurpose;

export const hotelPrograms: ProgramEntry[] = [
  {
    slug: "sba-504-hotel",
    family: "hotels",
    name: "SBA 504 hotel loans",
    title: "SBA 504 hotel loans in California",
    description:
      "SBA 504 pairs a bank first lien with a long-term fixed CDC debenture for owner-operated hotels. See equity, caps, fees and how a hotel qualifies.",
    summary: `Bank first lien plus a ${years(SBA.cdcAmortYears)} fixed CDC debenture for owner-operated hotels.`,
    definition:
      "An SBA 504 hotel loan is a two-lender structure for owner-operated hotels: a bank funds the first lien, a Certified Development Company (CDC) funds a long-term, fixed-rate second lien backed by an SBA-backed debenture, and the borrower contributes equity. The fixed-rate second lien is what makes 504 cheaper than most conventional hotel debt.",
    loanType: "SBA 504 commercial real estate loan (brokered)",
    loanTermYears: SBA.cdcAmortYears,
    facts: [
      fact("Bank first lien", `About ${pct(SBA.bankFirstPct)} of project cost`, SRC.sba),
      fact("CDC debenture", `About ${pct(1 - SBA.bankFirstPct - sbaEquity)} of project cost; ${years(SBA.cdcAmortYears)} fixed`, SRC.sba),
      fact("Borrower equity (hotel is special-purpose)", `${pct(sbaEquity)} base; +${pct(SBA.equity.newBusiness)} for start-ups or new construction`, SRC.sba),
      fact("CDC debenture cap", `${usd(SBA.cdcCap)} standard; ${usd(SBA.cdcCapGreen)} for qualifying energy-efficiency projects`, SRC.sba),
      fact("Minimum DSCR", x(SBA.minDscr), SRC.sba),
      fact("Upfront debenture fees (financed)", pct(SBA.upfrontDebentureFees, 2), SRC.corin),
      fact("Ongoing debenture fees (bundled in rate)", pct(SBA.annualDebentureFees, 2), SRC.corin),
      fact("Typical close", `${SBA.closeRange} after a complete file`, SRC.sba),
    ],
    sections: [
      {
        heading: "How the 504 stack is built",
        paragraphs: [
          "The project cost, including acquisition, renovation, closing costs and eligible soft costs, is funded by three layers: the bank's first lien, the CDC debenture and the borrower's equity. The debenture rate is set when the debenture is sold, and the fixed rate then runs for the full term.",
          "Corin arranges the stack as a licensed broker. We introduce the bank and CDC, size each layer and coordinate the file; the lenders make every credit decision and fund at closing.",
        ],
      },
      {
        heading: "What a hotel needs to qualify",
        paragraphs: [
          "Hotels are special-purpose property, so equity is higher and lenders weight franchise standing, property condition and the operator's record. The borrower must operate the hotel (through an eligible operating company) and sign personal guaranties from principal owners.",
        ],
        bullets: [
          "Owner-operated hotel; a passive investor structure usually does not fit",
          "Franchise in good standing, and a property improvement plan (PIP) scoped and budgeted if one is open",
          `Cash flow supporting at least ${x(SBA.minDscr)} on the combined debt`,
          "Personal guaranties from the principal owners",
        ],
      },
    ],
    faq: [
      {
        question: "How much equity does an SBA 504 hotel loan need?",
        answer: `The base is ${pct(SBA.equity.base)}, plus ${pct(SBA.equity.specialPurpose)} because a hotel is special-purpose property, so ${pct(sbaEquity)} in the base case. Start-ups and new construction add another ${pct(SBA.equity.newBusiness)}. Confirm the current rules against SBA SOP 50 10.`,
      },
      {
        question: "What is the maximum SBA 504 loan for a hotel?",
        answer: `The CDC debenture is capped at ${usd(SBA.cdcCap)} (${usd(SBA.cdcCapGreen)} for qualifying energy-efficiency projects). The bank first lien comes on top of that, so total project size can be much larger. A 7(a) + 504 stack can raise SBA exposure further.`,
      },
      {
        question: "Can I use 504 to finance a PIP?",
        answer: "Yes. Eligible renovation costs, including a franchise PIP, can be included in project cost when scoped and budgeted at application.",
      },
      {
        question: "How long does an SBA 504 loan take?",
        answer: `Typical range is ${SBA.closeRange}. ${disclosures.timeline}`,
      },
    ],
    related: ["sba-7a-504-hotel-stack", "hotel-cmbs", "pip-bridge", "hotel-to-senior-living-conversion", "hotels"],
  },
  {
    slug: "sba-7a-504-hotel-stack",
    family: "hotels",
    name: "SBA 7(a) + 504 hotel stack",
    title: "SBA 7(a) + 504 hotel loan stack",
    description:
      "Combine an SBA 7(a) loan with a 504 debenture on larger hotel and care-facility projects. See the modeled exposure cap, fees and when the stack fits.",
    summary: "A combined 7(a) and 504 structure for larger hotel projects.",
    definition:
      "A 7(a) + 504 stack is a structure that combines two SBA programs in one project: a 504 bank first lien and CDC debenture for the real estate, and an SBA 7(a) loan for working capital, equipment or other eligible costs, so the total SBA-backed exposure on a larger hotel or care-facility project can exceed what either program supports alone.",
    loanType: "SBA 7(a) and 504 combined financing (brokered)",
    loanTermYears: SBA.sevenAAmortYears,
    facts: [
      fact("Modeled combined SBA exposure", `Up to ${usd(SBA.combinedExposureCap)}`, SRC.sbaStack),
      fact("7(a) loan cap", usd(SBA.sevenACap), SRC.sba),
      fact("CDC debenture cap", `${usd(SBA.cdcCap)} standard; ${usd(SBA.cdcCapGreen)} for qualifying energy-efficiency projects`, SRC.sba),
      fact("7(a) SBA guaranty share", pct(SBA.sevenAGuaranteedShare), SRC.sba),
      fact("7(a) upfront guaranty fee / annual service fee", `${pct(SBA.sevenAUpfrontGuaranteeFee, 2)} / ${pct(SBA.sevenAAnnualServiceFee, 2)}`, SRC.corin),
      fact("7(a) indicative pricing", `Prime + ${pts(SPREADS.sba7a.lo)}–${pts(SPREADS.sba7a.hi)} points`, SRC.corin, { verify: false }),
      fact("Borrower equity (special-purpose)", pct(sbaEquity), SRC.sba),
    ],
    sections: [
      {
        heading: "Why stack the programs",
        paragraphs: [
          "A single 504 project is limited by the debenture cap, and a 7(a) loan alone is limited by its own cap and variable-rate structure. Stacking lets a larger hotel or care-facility project use the 504's long-term fixed real estate financing and the 7(a)'s flexibility for working capital and other eligible uses.",
          "SBA stacking rules and the combined exposure SBA will accept are revised from time to time. The figure on this page is Corin's modeling assumption and must be confirmed against the SOP in effect when you apply.",
        ],
      },
      {
        heading: "Where the stack fits",
        paragraphs: [],
        bullets: [
          "Acquisition of a flagged hotel plus a funded PIP and working capital",
          "Hotel repositioning where renovation and opening costs exceed a single program's cap",
          "Care-facility acquisitions combining real estate and operating business costs",
        ],
      },
      {
        heading: "Trade-offs",
        paragraphs: [
          "Two programs mean two sets of documents, fees and approvals. 7(a) loans are typically floating-rate, and the combined structure needs more lenders to line up. The extra complexity is worth it only when project cost really exceeds what a single program supports.",
        ],
      },
    ],
    faq: [
      {
        question: "Is the combined 7(a) + 504 limit fixed by SBA?",
        answer: `Not as a single published number. Corin models up to ${usd(SBA.combinedExposureCap)} for planning. Confirm with the lenders and the SOP in effect at application.`,
      },
      {
        question: "Can the same lender do both loans?",
        answer: "Sometimes. A bank that is a participating 7(a) lender can often provide the 504 first lien as well, with a separate CDC for the debenture.",
      },
      {
        question: "Does the stack change equity requirements?",
        answer: `Equity is driven by project type. A hotel is special-purpose property, so the base case is ${pct(sbaEquity)}, with more for start-ups or new construction.`,
      },
    ],
    related: ["sba-504-hotel", "hotel-cmbs", "pip-bridge", "hotel-to-senior-living-conversion", "hotels"],
  },
  {
    slug: "hotel-cmbs",
    family: "hotels",
    name: "Hotel CMBS",
    title: "Hotel CMBS conduit loans in California",
    description: `Hotel CMBS loans are ${years(CMBS.termYears)} fixed, non-recourse conduit debt for stabilized hotels. See leverage, debt yield, DSCR, loan size and prepayment.`,
    summary: "Fixed-rate, non-recourse conduit debt for stabilized hotels.",
    definition:
      "A hotel CMBS loan is a fixed-rate, non-recourse mortgage from a conduit lender that pools the loan with others and sells it as commercial mortgage-backed securities. It suits stabilized, flagged or well-run independent hotels where the borrower wants term certainty and no personal recourse beyond customary carve-outs.",
    loanType: "Hotel CMBS conduit loan (brokered)",
    loanTermYears: CMBS.termYears,
    facts: [
      fact("Term / amortization", `${years(CMBS.termYears)} fixed / ${years(CMBS.amortYears)} schedule`, SRC.corin),
      fact("Max LTV", pct(CMBS.maxLtv), SRC.corin),
      fact("Minimum DSCR", x(CMBS.minDscr), SRC.corin),
      fact(
        "Minimum debt yield (premium flag / economy flag / boutique or independent)",
        `${pct(CMBS.minDebtYield.PREMIUM_FLAG, 1)} / ${pct(CMBS.minDebtYield.ECONOMY_FLAG, 1)} / ${pct(CMBS.minDebtYield.BOUTIQUE_INDEPENDENT, 1)}`,
        SRC.corin,
      ),
      fact("Typical minimum loan", usd(CMBS.minLoan), SRC.corin),
      fact("Indicative pricing", `Ten-year Treasury + ${pts(SPREADS.hotelCmbs.lo)}–${pts(SPREADS.hotelCmbs.hi)} points`, SRC.corin, { verify: false }),
      fact("Prepayment", "Defeasance or yield maintenance", SRC.corin, { verify: false }),
    ],
    sections: [
      {
        heading: "How hotel CMBS is underwritten",
        paragraphs: [
          "Conduit underwriters size to the lowest of leverage, DSCR and debt-yield tests, then apply property-level reserves for furniture, fixtures and equipment. Hotel income is volatile, so underwriters use trailing and STR-benchmarked performance and haircut it.",
          "The key metrics are ADR, occupancy and RevPAR (ADR multiplied by occupancy), STR penetration against the competitive set, NOI per key, and the franchise term remaining.",
        ],
        bullets: [
          "Any open PIP must be complete or reserved",
          "Franchise term should run well past the loan maturity",
          "Non-recourse carve-outs include fraud, bankruptcy and misapplication of funds",
        ],
      },
      {
        heading: "CMBS or SBA 504",
        paragraphs: [
          "CMBS is non-recourse and handles larger balances, but is inflexible after closing, since prepayment requires defeasance or yield maintenance and lender consent is needed for changes. SBA 504 usually prices lower on owner-operated hotels but carries personal guaranties and a lower balance cap on the SBA piece.",
        ],
      },
    ],
    faq: [
      {
        question: "What is the minimum loan size for hotel CMBS?",
        answer: `Conduits typically start around ${usd(CMBS.minLoan)}. Smaller hotels usually fit SBA 504, a bank loan or a bridge.`,
      },
      {
        question: "Is hotel CMBS non-recourse?",
        answer: "Yes, with customary carve-outs for events like fraud, misapplication of funds and voluntary bankruptcy. Those carve-outs can create full liability if triggered.",
      },
      {
        question: "Can I pay off a CMBS loan early?",
        answer: "Early payoff generally requires defeasance (replacing the collateral with Treasuries) or yield maintenance. The cost depends on the rate environment and the remaining term.",
      },
    ],
    related: ["sba-504-hotel", "pip-bridge", "sba-7a-504-hotel-stack", "hotel-to-senior-living-conversion", "hotels"],
  },
  {
    slug: "pip-bridge",
    family: "hotels",
    name: "PIP bridge",
    title: "Hotel PIP bridge loans in California",
    description:
      "A PIP bridge funds a franchise property improvement plan with a floating, interest-only loan and renovation holdbacks, then exits to CMBS or SBA 504.",
    summary: "Floating, interest-only debt to complete a franchise renovation before a permanent takeout.",
    definition:
      "A hotel PIP bridge is a short-term, floating-rate, interest-only loan that funds the purchase of a hotel and the franchise-required property improvement plan (PIP), releasing renovation money against completed work, and is repaid by a permanent loan such as CMBS or SBA 504 once the hotel stabilizes.",
    loanType: "Hotel bridge loan (brokered)",
    facts: [
      fact("Max loan-to-cost", pct(BRIDGE.hotelPip.maxLtc), SRC.corin),
      fact("Minimum debt yield", pct(BRIDGE.hotelPip.minDebtYield), SRC.corin),
      fact("Typical term", `${BRIDGE.hotelPip.termMonths} months`, SRC.corin),
      fact("Indicative spread", `SOFR + ${pts(BRIDGE.hotelPip.spread)} points`, SRC.corin),
      fact("Lender fee / exit fee", `${pct(BRIDGE.lenderFeePct, 1)} / ${pct(BRIDGE.exitFeePct, 1)}`, SRC.corin),
      fact("Typical close", `${BRIDGE.closeRange} after a complete file`, SRC.corin),
    ],
    sections: [
      {
        heading: "Sizing a PIP bridge",
        paragraphs: [
          "Lenders size to cost, not just value, because a hotel under renovation has depressed income. The loan funds the acquisition and a renovation holdback sized to the franchisor's PIP, with the bridge lender releasing holdback funds against completed work under its own process.",
          "Corin arranges the loan and has no role in the lender's holdback process: it does not disburse, inspect or hold any funds.",
        ],
      },
      {
        heading: "Planning the exit",
        paragraphs: [
          "The bridge exists to reach a permanent loan. We test the takeout up front: stabilized NOI must support CMBS or SBA 504 proceeds large enough to repay the bridge. A bridge priced and sized without that test is a bet on the market.",
        ],
        bullets: [
          "CMBS takeout once RevPAR and NOI season after the PIP",
          "SBA 504 takeout for owner-operators",
          "Refinancing into a bank loan",
        ],
      },
    ],
    faq: [
      {
        question: "What is a PIP?",
        answer: "A property improvement plan is the list of renovations a hotel franchisor requires to keep or obtain the brand. Missing it can put the franchise at risk, which is why lenders examine it closely.",
      },
      {
        question: "How fast can a PIP bridge close?",
        answer: `Many close in ${BRIDGE.closeRange} after a complete file, subject to lender approval, appraisal, title and diligence. Timing is not guaranteed.`,
      },
      {
        question: "Is a PIP bridge recourse?",
        answer: "Private bridge lenders often require some recourse or completion guaranties. Terms vary by lender and are negotiated case by case.",
      },
    ],
    related: ["hotel-cmbs", "sba-504-hotel", "private-bridge", "hotel-to-senior-living-conversion", "hotels"],
  },
  {
    slug: "hotel-to-senior-living-conversion",
    family: "hotels",
    name: "Hotel to senior living conversion",
    title: "Hotel to senior living conversion loans",
    description:
      "Financing for converting a hotel to assisted living or an RCFE: acquisition plus conversion bridge, Title 22 licensing milestones and a HUD 232 path.",
    summary: "Acquisition and conversion bridge for turning a hotel into licensed senior living.",
    definition:
      "A hotel-to-senior-living conversion loan is a financing that pays for the purchase of a hotel and the renovation needed to operate it as licensed assisted living, memory care or a residential care facility for the elderly, usually through a bridge loan sized to acquisition plus conversion budget and repaid by permanent senior housing debt after licensing and lease-up.",
    loanType: "Conversion bridge loan (brokered)",
    facts: [
      fact("Bridge: max LTV on stabilized value", pct(BRIDGE.senior.maxLtv), SRC.corin),
      fact("Bridge: typical term", `${BRIDGE.senior.termMonths} months`, SRC.corin),
      fact("Indicative bridge spread", `SOFR + ${pts(BRIDGE.senior.spread)} points`, SRC.corin),
      fact("Takeout: HUD 232/223(f)", `${pct(s232.refi.maxLtv)} LTV, ${x(s232.refi.minDscr)} DSCR, ${s232.minYearsSinceCompletion}+ years since completion`, SRC.hud232),
      fact("Takeout: occupancy benchmark", `Around ${pct(s232.stabilizedOccupancy)}`, SRC.hud232),
      fact("California licensing", "RCFE license from Community Care Licensing (Title 22)", "California Code of Regulations, Title 22", { verify: false }),
    ],
    sections: [
      {
        heading: "The conversion path",
        paragraphs: [
          "Conversions succeed or fail on sequencing. A lender funds acquisition and a conversion budget, the borrower completes construction and applies for the facility license, and the community leases up until a permanent lender will count its income.",
        ],
        bullets: [
          "Confirm zoning and any conditional use permit before committing to a purchase",
          "Budget for life-safety, accessibility and licensing-driven construction",
          "Plan licensing milestones with the bridge term and extension options",
          "Pre-qualify the takeout: HUD 232/223(f) or SBA 504 for owner-operators",
        ],
      },
      {
        heading: "Why the takeout matters most",
        paragraphs: [
          `A converted building is new to HUD's seasoning clock. ${s232.minYearsSinceCompletion} or more years since completion is the usual test for 232/223(f), so conversions often use HUD 232 new construction or substantial rehabilitation instead, or an SBA 504 or bank takeout.`,
        ],
      },
    ],
    faq: [
      {
        question: "Can a hotel become an RCFE in California?",
        answer: "Yes, if zoning, building and fire requirements and Community Care Licensing standards can be met. Each is a gating item before a lender will fund the conversion budget.",
      },
      {
        question: "Which permanent loan follows a conversion?",
        answer: "It depends on size and ownership. HUD 232 fits larger communities; SBA 504 or a bank loan fits smaller, owner-operated ones. We test the takeout before the bridge closes.",
      },
      {
        question: "How long does a conversion take?",
        answer: `Conversion schedules turn on permitting, construction and licensing and cannot be promised. Bridge terms of ${BRIDGE.senior.termMonths} months are common to cover them. ${disclosures.timeline}`,
      },
    ],
    related: ["bridge-to-hud", "rcfe", "assisted-living", "pip-bridge", "hotels"],
  },
];
