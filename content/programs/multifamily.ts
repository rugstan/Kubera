import { AGENCY, ASSUMPTIONS_REVIEWED, BRIDGE, HUD, SPREADS } from "@/lib/sizing/assumptions";
import { disclosures } from "@/lib/site";
import { AGENCY_MARKET, BRIDGE_EXIT_TEST, CA_RENT_RULES, HUD_TIMING } from "./market-facts";
import { fact, pct, pts, SRC, usd, x, years } from "./format";
import type { ProgramEntry } from "./types";

const mf = HUD.multifamily;

const mipFact = () =>
  fact(
    "Annual MIP (flat, all FHA multifamily)",
    `${pct(mf.mip.annual, 2)} for applications on or after ${mf.mip.effectiveForApplicationsOnOrAfter}`,
    SRC.hudMfMip,
  );

export const multifamilyPrograms: ProgramEntry[] = [
  {
    slug: "hud-221d4",
    family: "multifamily",
    name: "HUD 221(d)(4)",
    title: "HUD 221(d)(4) multifamily construction",
    description:
      "HUD 221(d)(4) insures new construction and substantial rehab of multifamily with a long fixed term. See market-rate and affordable leverage and DSCR.",
    summary: "Non-recourse construction-to-permanent debt for new or substantially rehabilitated apartments.",
    definition:
      "HUD 221(d)(4) is an FHA mortgage insurance program for the new construction or substantial rehabilitation of multifamily rental housing. A single HUD-insured loan funds construction and then converts to a long-term, fixed-rate, fully amortizing, non-recourse mortgage. It suits apartment developers who can accept HUD processing time in exchange for one loan from construction through permanent financing.",
    loanType: "FHA-insured multifamily construction mortgage (brokered)",
    loanTermYears: mf.s221d4.termYears,
    facts: [
      fact("Term", `Construction period plus ${years(mf.s221d4.termYears)} fixed`, SRC.hudMfML),
      fact("Market-rate: max loan-to-cost / min DSCR", `${pct(mf.s221d4.maxLtc)} / ${x(mf.s221d4.minDscr)}`, SRC.hudMfML),
      fact(
        "Affordable or rental assistance: max loan-to-cost / min DSCR",
        `${pct(mf.s221d4.maxLtcAffordable)} / ${x(mf.s221d4.minDscrAffordable)}`,
        SRC.hudMfML,
      ),
      mipFact(),
      fact("Upfront premium (modeled)", pct(mf.mip.upfront, 2), "Secondary source; confirm with a HUD lender"),
      fact("Annual CPA audit", `About ${usd(HUD.annualAuditCost)} per year`, SRC.corin),
    ],
    sections: [
      {
        heading: "How 221(d)(4) works",
        paragraphs: [
          "Instead of a construction loan followed by a separate permanent loan, HUD insures one loan that covers both phases. The borrower avoids refinancing risk at completion and locks a long fixed term from the start. Draw administration during construction is handled by the HUD lender and HUD; Corin has no role in construction draws.",
          "The trade-off is process. HUD underwriting, Davis-Bacon wage requirements, a longer pre-construction timeline and the borrower's sponsor, contractor and architect qualifications all shape feasibility.",
        ],
      },
      {
        heading: "Costs and mortgage insurance",
        paragraphs: [
          `HUD multifamily now carries a single flat annual mortgage insurance premium of ${pct(mf.mip.annual, 2)}. Green, affordable and market-rate MIP tiers no longer apply, so green certification no longer lowers MIP. Other costs include the HUD application fee (${pct(HUD.applicationFeePct, 1)}), the lender financing fee, third-party reports and legal.`,
        ],
      },
    ],
    faq: [
      {
        question: "What leverage does HUD 221(d)(4) allow?",
        answer: `Under HUD Mortgagee Letter 2025-03 (Jan 2025; figures as of ${ASSUMPTIONS_REVIEWED}), market-rate projects size to ${pct(mf.s221d4.maxLtc)} of cost at ${x(mf.s221d4.minDscr)} DSCR, and affordable or rental-assistance projects to ${pct(mf.s221d4.maxLtcAffordable)} at ${x(mf.s221d4.minDscrAffordable)}. Confirm with a HUD lender.`,
      },
      {
        question: "Is 221(d)(4) recourse?",
        answer: "It is non-recourse to the borrower except for customary carve-outs. During construction, HUD typically requires completion assurances from the sponsor and contractor.",
      },
      {
        question: "How does 221(d)(4) compare with a bank construction loan?",
        answer: "HUD offers higher leverage, a fixed rate and no refinancing at completion, but takes longer and requires more process. A bank loan closes faster and can be more flexible, with shorter terms and recourse.",
      },
    ],
    related: ["hud-223f-multifamily", "hud-223a7", "construction-to-permanent", "construction-loans", "multifamily"],
  },
  {
    slug: "hud-223f-multifamily",
    family: "multifamily",
    name: "HUD 223(f) multifamily",
    title: "HUD 223(f) multifamily refinance",
    description:
      "HUD 223(f) refinances or acquires existing apartments with a long fixed-rate, non-recourse loan. See current LTV, DSCR and MIP for market-rate and affordable.",
    summary: "Long-term, fixed-rate, non-recourse refinance for existing apartment communities.",
    definition:
      `HUD 223(f) is an FHA mortgage insurance program that finances the purchase or refinance of existing multifamily rental properties with a long-term, fixed-rate, fully amortizing, non-recourse loan, offered through HUD-licensed MAP lenders. The term runs up to ${years(mf.s223f.termYears)}, and market-rate loans size to about ${pct(mf.s223f.maxLtv)} loan-to-value at a ${x(mf.s223f.minDscr)} minimum DSCR.`,
    loanType: "FHA-insured multifamily refinance mortgage (brokered)",
    loanTermYears: mf.s223f.termYears,
    facts: [
      fact("Term", `Up to ${years(mf.s223f.termYears)} fixed, fully amortizing`, SRC.hudMfML),
      fact("Market-rate: max LTV / min DSCR", `${pct(mf.s223f.maxLtv)} / ${x(mf.s223f.minDscr)}`, SRC.hudMfML),
      fact("Affordable or rental assistance: max LTV / min DSCR", `${pct(mf.s223f.maxLtvAffordable)} / ${x(mf.s223f.minDscrAffordable)}`, SRC.hudMfML),
      fact("Cash-out refinance: max LTV", pct(mf.s223f.cashOutMaxLtv), SRC.hudMfML),
      mipFact(),
      fact("Indicative pricing", `Ten-year Treasury + ${pts(SPREADS.hudMultifamily.lo)}–${pts(SPREADS.hudMultifamily.hi)} points`, SRC.corin, { verify: false }),
      fact("Typical processing", HUD_TIMING.processing, "HUD LEAN processing; Corin market research notes"),
    ],
    sections: [
      {
        heading: "Leverage and coverage",
        paragraphs: [
          `Under HUD Mortgagee Letter 2025-03, market-rate 223(f) loans size to ${pct(mf.s223f.maxLtv)} LTV at ${x(mf.s223f.minDscr)} DSCR. Affordable and rental-assistance properties size to ${pct(mf.s223f.maxLtvAffordable)} at ${x(mf.s223f.minDscrAffordable)}. Cash-out refinances remain at ${pct(mf.s223f.cashOutMaxLtv)} LTV.`,
          "Debt service coverage is often the binding constraint in practice, not LTV. Our sizer solves both and shows which one controls.",
        ],
      },
      {
        heading: "When 223(f) beats agency debt",
        paragraphs: [
          "HUD offers the longest fixed amortization and high leverage with non-recourse terms, and the loans are assumable. Agency loans are faster and carry fewer process requirements. HUD's fixed costs and annual audit favor larger balances and long holds.",
        ],
        bullets: [
          "Long hold and a desire for the lowest fixed payment: HUD",
          "Shorter hold or speed to close: agency or bridge",
          "Heavy value-add before stabilization: bridge first, HUD takeout later",
        ],
      },
    ],
    faq: [
      {
        question: "What is the current HUD 223(f) mortgage insurance premium?",
        answer: `A flat ${pct(mf.mip.annual, 2)} annual MIP applies to FHA multifamily applications submitted or amended on or after ${mf.mip.effectiveForApplicationsOnOrAfter}. Upfront premium is modeled at ${pct(mf.mip.upfront, 2)} and should be confirmed with a HUD lender.`,
      },
      {
        question: "Does green certification lower HUD MIP?",
        answer: "No. The separate green, affordable and market-rate MIP categories were removed in favor of a single flat premium.",
      },
      {
        question: "How long does a 223(f) loan take?",
        answer: `HUD processing typically runs ${HUD_TIMING.processing}. ${disclosures.timeline}`,
      },
    ],
    related: ["hud-221d4", "hud-223a7", "fannie-mae-multifamily", "multifamily-bridge", "multifamily"],
  },
  {
    slug: "hud-223a7",
    family: "multifamily",
    name: "HUD 223(a)(7)",
    title: "HUD 223(a)(7) streamlined refinance",
    description:
      "HUD 223(a)(7) lets owners of FHA-insured apartments refinance an existing HUD loan with streamlined processing to lower rate or payment. Learn when it fits.",
    summary: "Streamlined refinance of an existing HUD-insured multifamily loan.",
    definition:
      "HUD 223(a)(7) is an FHA refinance option for multifamily properties that already carry a HUD-insured mortgage. It replaces the existing loan with a new one under streamlined processing, typically to reduce the interest rate or monthly payment, and it works within limits set by the existing mortgage.",
    loanType: "FHA-insured streamlined refinance (brokered)",
    loanTermYears: mf.s223f.termYears,
    facts: [
      fact("Eligible property", "Multifamily with an existing HUD-insured mortgage", "HUD 223(a)(7) program rules"),
      fact("Typical purpose", "Lower rate or payment; limited cash-out", "HUD 223(a)(7) program rules"),
      fact("Processing", "Streamlined compared with a full 223(f)", "HUD 223(a)(7) program rules"),
      mipFact(),
      fact("Sizer availability", "Behind a flag in the Corin sizer while terms are verified", SRC.corin, { verify: false }),
    ],
    sections: [
      {
        heading: "How it differs from a 223(f)",
        paragraphs: [
          "A 223(f) is a full new underwriting for an existing, uninsured property. A 223(a)(7) leans on the fact that HUD already insures the property, so it avoids much of the third-party work, but the new loan is generally limited to the existing balance plus eligible costs, and the term follows HUD's rules for the existing loan.",
          "Because eligibility, term and fee details turn on the existing mortgage and HUD's current guidance, an advisor confirms each case with a HUD lender before quoting.",
        ],
      },
      {
        heading: "When it fits",
        paragraphs: [],
        bullets: [
          "Rates are lower than the existing HUD loan's coupon",
          "The owner wants to keep the HUD structure without a full re-underwrite",
          "The property performs, and no major recapitalization is needed",
        ],
      },
    ],
    faq: [
      {
        question: "Can I take cash out with a 223(a)(7)?",
        answer: "The program is designed for rate and payment relief, not equity extraction. If cash out matters, a 223(f) may fit better. Confirm limits with a HUD lender.",
      },
      {
        question: "Does the mortgage insurance premium change?",
        answer: `The flat ${pct(mf.mip.annual, 2)} annual MIP applies to FHA multifamily applications on or after ${mf.mip.effectiveForApplicationsOnOrAfter}. Verify how it applies to your existing loan.`,
      },
      {
        question: "Is a 223(a)(7) available for senior housing?",
        answer: "A similar streamlined refinance exists for Section 232 loans. Ask an advisor to review your loan.",
      },
    ],
    related: ["hud-223f-multifamily", "hud-221d4", "fannie-mae-multifamily", "multifamily-bridge", "multifamily"],
  },
  {
    slug: "fannie-mae-multifamily",
    family: "multifamily",
    name: "Fannie Mae multifamily",
    title: "Fannie Mae apartment loans in California",
    description:
      "Fannie Mae multifamily loans offer fixed or floating non-recourse debt on stabilized apartments. See small-loan leverage, DSCR, terms and how they compare.",
    summary: "Fixed-rate, non-recourse agency loans for stabilized apartment communities.",
    definition: `A Fannie Mae multifamily loan is a non-recourse mortgage on a stabilized apartment property, made by a Fannie Mae DUS lender and sold to Fannie Mae. Terms are fixed or floating, typically five to twelve years with a ${years(AGENCY.amortYears)} amortization schedule, and sizing is driven by debt service coverage as often as by loan-to-value.`,
    loanType: "Fannie Mae multifamily mortgage (brokered)",
    loanTermYears: AGENCY.amortYears,
    facts: [
      fact("Max LTV", pct(AGENCY.maxLtv), SRC.corin),
      fact("Minimum DSCR", x(AGENCY.minDscr), SRC.corin),
      fact("Typical term / amortization", `${years(AGENCY.termYears)} fixed / ${years(AGENCY.amortYears)} schedule`, SRC.corin),
      fact("Fannie Mae Small Loans", AGENCY_MARKET.fannieSmall, SRC.market),
      fact("Indicative pricing", `Ten-year Treasury + ${pts(SPREADS.agency.lo)}–${pts(SPREADS.agency.hi)} points`, SRC.corin, { verify: false }),
      fact("Origination fee / fixed costs", `${pct(AGENCY.originationPct, 1)} / about ${usd(AGENCY.fixedCosts)}`, SRC.corin),
      fact("Real-world sizing", AGENCY_MARKET.realDeals, SRC.market),
    ],
    sections: [
      {
        heading: "Sizing: DSCR usually binds",
        paragraphs: [
          `The headline maximum is ${pct(AGENCY.maxLtv)} LTV, but the lesser of the LTV and ${x(AGENCY.minDscr)} DSCR tests controls. ${AGENCY_MARKET.realDeals}.`,
        ],
      },
      {
        heading: "Agency or HUD",
        paragraphs: [
          "Agency debt closes faster, has fewer process requirements and allows shorter terms, which suits owners planning to sell or refinance within a decade. HUD offers longer fixed terms and higher leverage but a longer timeline. Corin compares both in the sizer.",
        ],
        bullets: [
          "Choose the term to match your hold period and prepayment tolerance",
          "Green financing options can adjust pricing; confirm current terms",
          "Properties still in lease-up or heavy renovation usually need a bridge first",
        ],
      },
    ],
    faq: [
      {
        question: "What is the minimum Fannie Mae multifamily loan?",
        answer: "Fannie Mae's small loan product serves smaller balances; the current thresholds are listed in the facts table and change by lender and program updates.",
      },
      {
        question: "Is a Fannie Mae loan recourse?",
        answer: "It is non-recourse with customary carve-outs, which can create recourse liability if triggered.",
      },
      {
        question: "How is Fannie Mae different from Freddie Mac?",
        answer: "Both are agency lenders with similar leverage and coverage on stabilized properties. Programs, pricing, small-loan products and lender networks differ, so we compare both.",
      },
    ],
    related: ["freddie-mac-multifamily", "hud-223f-multifamily", "multifamily-bridge", "dscr-investor", "multifamily"],
  },
  {
    slug: "freddie-mac-multifamily",
    family: "multifamily",
    name: "Freddie Mac multifamily",
    title: "Freddie Mac apartment loans in California",
    description:
      "Freddie Mac multifamily loans give non-recourse fixed-rate debt on stabilized apartments. See small-balance leverage, DSCR and how Freddie compares with Fannie.",
    summary: "Fixed-rate, non-recourse agency loans from Freddie Mac's lender network.",
    definition:
      "A Freddie Mac multifamily loan is a non-recourse mortgage on a stabilized apartment property, originated by a Freddie Mac Optigo lender and sold to Freddie Mac. It offers fixed- and floating-rate structures, with sizing set by the lesser of loan-to-value and debt service coverage tests.",
    loanType: "Freddie Mac multifamily mortgage (brokered)",
    loanTermYears: AGENCY.amortYears,
    facts: [
      fact("Max LTV", pct(AGENCY.maxLtv), SRC.corin),
      fact("Minimum DSCR", x(AGENCY.minDscr), SRC.corin),
      fact("Typical term / amortization", `${years(AGENCY.termYears)} fixed / ${years(AGENCY.amortYears)} schedule`, SRC.corin),
      fact("Freddie Mac Conventional Small Balance", AGENCY_MARKET.freddieSmall, SRC.market),
      fact("Program status", AGENCY_MARKET.freddieSblRetired, SRC.market),
      fact("Indicative pricing", `Ten-year Treasury + ${pts(SPREADS.agency.lo)}–${pts(SPREADS.agency.hi)} points`, SRC.corin, { verify: false }),
    ],
    sections: [
      {
        heading: "What Freddie Mac loans suit",
        paragraphs: [
          "Freddie Mac is a strong option for stabilized apartments where certainty of execution and a non-recourse structure matter. Smaller properties use its small-balance product, and larger ones use the standard conventional program.",
          "Small-balance programs have been revised recently. Treat the details in the facts table as a starting point and have an advisor confirm the product in force.",
        ],
      },
      {
        heading: "Choosing between agencies",
        paragraphs: [
          "Leverage and coverage are close, so pricing, prepayment structure, available terms and the lender's execution become the differentiators. We solicit quotes from lenders on both platforms so the comparison reflects real terms.",
        ],
      },
    ],
    faq: [
      {
        question: "Is Freddie Mac's small balance program still available?",
        answer: `${AGENCY_MARKET.freddieSblRetired}. Freddie's conventional small product remains the reference point; confirm with a lender.`,
      },
      {
        question: "Can Freddie Mac lend on value-add properties?",
        answer: "Freddie has transitional and value-add structures, but most agency loans require stabilized income. A bridge loan commonly covers renovation first.",
      },
      {
        question: "Is Corin the lender on a Freddie Mac loan?",
        answer: "No. Corin is a broker and arranges the loan with a Freddie Mac lender, which makes the credit decision and funds the loan.",
      },
    ],
    related: ["fannie-mae-multifamily", "hud-223f-multifamily", "multifamily-bridge", "dscr-investor", "multifamily"],
  },
  {
    slug: "multifamily-bridge",
    family: "multifamily",
    name: "Multifamily bridge",
    title: "Multifamily bridge loans in California",
    description:
      "Multifamily bridge loans fund acquisitions and value-add business plans with floating, interest-only debt, then exit to agency or HUD financing.",
    summary: "Floating, interest-only debt for value-add apartment business plans.",
    definition:
      `A multifamily bridge loan is a short-term, floating-rate, interest-only loan from a debt fund, bank or private lender that finances the acquisition, renovation or lease-up of an apartment property until it can refinance into permanent agency or HUD debt. Typical terms run about ${BRIDGE.cre.termMonths} months at up to ${pct(BRIDGE.cre.maxLtv)} loan-to-value.`,
    loanType: "Multifamily bridge loan (brokered)",
    facts: [
      fact("Max LTV", pct(BRIDGE.cre.maxLtv), SRC.corin),
      fact("Minimum debt yield", pct(BRIDGE.cre.minDebtYield), SRC.corin),
      fact("Typical term", `${BRIDGE.cre.termMonths} months`, SRC.corin),
      fact("Indicative spread", `SOFR + ${pts(BRIDGE.cre.spread)} points`, SRC.corin),
      fact("Lender fee / exit fee", `${pct(BRIDGE.lenderFeePct, 1)} / ${pct(BRIDGE.exitFeePct, 1)}`, SRC.corin),
      fact("Exit test (stabilized)", `Debt yield ${BRIDGE_EXIT_TEST.debtYield} and ${BRIDGE_EXIT_TEST.dscr} DSCR`, SRC.market),
      fact("Typical close", `${BRIDGE.closeRange} after a complete file`, SRC.corin),
    ],
    sections: [
      {
        heading: "Underwrite the exit first",
        paragraphs: [
          `A bridge loan is sized on today's income and tested against the permanent loan that will repay it. At stabilization the property should reach a debt yield of ${BRIDGE_EXIT_TEST.debtYield} and ${BRIDGE_EXIT_TEST.dscr} coverage on the takeout loan. If the plan does not clear that test on paper, adjust the leverage or the business plan before closing.`,
        ],
      },
      {
        heading: "California rent rules matter",
        paragraphs: [
          `${CA_RENT_RULES.ab1482}. ${CA_RENT_RULES.la}. Lenders underwrite value-add rent growth within these limits, so renovation plans that assume large rent jumps on covered units do not hold up.`,
        ],
      },
    ],
    faq: [
      {
        question: "What is a typical bridge loan term?",
        answer: `About ${BRIDGE.cre.termMonths} months, often with extension options. Extensions typically cost a fee and may require a coverage test.`,
      },
      {
        question: "Is the rate fixed or floating?",
        answer: "Bridge loans are typically floating over SOFR, and many borrowers buy an interest-rate cap. Lenders often require one.",
      },
      {
        question: "How fast can a bridge loan close?",
        answer: `Many close in ${BRIDGE.closeRange} after a complete file, subject to lender approval, appraisal, title and diligence. This is not guaranteed.`,
      },
    ],
    related: ["fannie-mae-multifamily", "hud-223f-multifamily", "private-bridge", "dscr-investor", "multifamily"],
  },
  {
    slug: "dscr-investor",
    family: "multifamily",
    name: "DSCR investor loans",
    title: "DSCR rental property loans in California",
    description:
      "DSCR investor loans qualify rental properties on property cash flow, not personal income. See how DSCR is calculated and which boxes fit 2-4 unit and 5+ unit.",
    summary: "Rental property loans underwritten on the property's debt service coverage.",
    definition:
      "A DSCR investor loan is a mortgage on a rental property underwritten mainly on the property's debt service coverage ratio, meaning net operating income divided by annual debt service, rather than on the borrower's personal income, with separate lender programs for 2-4 unit and 5+ unit properties.",
    loanType: "Investor rental property mortgage (brokered)",
    facts: [
      fact("DSCR formula", "Net operating income divided by annual debt service", "Standard underwriting definition", { verify: false }),
      fact("Agency multifamily minimum DSCR (reference)", x(AGENCY.minDscr), SRC.corin),
      fact("Bridge exit test (stabilized)", `Debt yield ${BRIDGE_EXIT_TEST.debtYield} and ${BRIDGE_EXIT_TEST.dscr} DSCR`, SRC.market),
      fact("Product boxes", "2-4 unit and 5+ unit, lender specific", SRC.corin, { verify: false }),
    ],
    sections: [
      {
        heading: "How lenders use DSCR",
        paragraphs: [
          "Instead of reviewing tax returns and employment income, the lender looks at what the property earns against what the loan costs. A ratio above one means the property covers its debt service. Minimums, leverage and pricing vary widely by lender, property type, borrower experience and credit profile.",
        ],
      },
      {
        heading: "Which box fits",
        paragraphs: [],
        bullets: [
          "2-4 unit rental: investor DSCR products from specialty and non-bank lenders",
          "5+ unit apartment: agency, HUD, bank or bridge, depending on size and business plan",
          "Short-hold or value-add: bridge first, then a DSCR or agency refinance",
        ],
      },
      {
        heading: "What an advisor adds",
        paragraphs: [
          "DSCR lenders price on many variables. Corin collects the property financials, matches the loan to a lender whose box fits, and explains the costs before you commit. The lender makes the credit decision.",
        ],
      },
    ],
    faq: [
      {
        question: "What DSCR do lenders require?",
        answer: "It varies by lender and product. Agency multifamily generally needs at least the agency minimum shown here, while investor DSCR programs differ. Ask for the lender's box.",
      },
      {
        question: "Do DSCR loans require personal income documentation?",
        answer: "Programs designed around DSCR usually do not, but lenders still review credit, liquidity and experience.",
      },
      {
        question: "Can I use a DSCR loan on a short-term rental?",
        answer: "Some lenders allow it with adjusted income calculations. Others do not. Specify the use up front so the lender can size it properly.",
      },
    ],
    related: ["multifamily-bridge", "fannie-mae-multifamily", "freddie-mac-multifamily", "fix-and-flip", "multifamily"],
  },
];
