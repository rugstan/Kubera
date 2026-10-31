import { BRIDGE, HUD } from "@/lib/sizing/assumptions";
import { CONSTRUCTION_MARKET } from "./market-facts";
import { fact, pct, SRC, x, years } from "./format";
import type { ProgramEntry } from "./types";

const mf = HUD.multifamily;
const s232 = HUD.section232;

const NO_DRAW_ROLE =
  "The construction lender, not Kubera, funds and administers draws. Kubera has no role in draw requests, inspections or lien waivers, and never holds or disburses loan funds.";

export const constructionPrograms: ProgramEntry[] = [
  {
    slug: "construction-loans",
    family: "construction",
    name: "Construction loans",
    title: "Commercial construction loans",
    description:
      "Commercial construction loans fund ground-up and heavy renovation projects. Compare bank, debt fund and private lender leverage, pricing and interest reserves.",
    summary: "Ground-up and heavy-renovation financing from banks, debt funds and private lenders.",
    definition:
      "A commercial construction loan is a short-term loan that a lender funds in stages as a project is built, secured by the land and improvements, with an interest reserve inside the loan and a plan to repay it from a permanent loan or a sale. Leverage is set by cost and by as-completed value.",
    loanType: "Commercial construction loan (brokered)",
    facts: [
      fact("Bank: loan-to-cost", CONSTRUCTION_MARKET.bank.ltc, SRC.market),
      fact("Bank: pricing", CONSTRUCTION_MARKET.bank.pricing, SRC.market),
      fact("Debt fund: loan-to-cost", CONSTRUCTION_MARKET.debtFund.ltc, SRC.market),
      fact("Debt fund: pricing", CONSTRUCTION_MARKET.debtFund.pricing, SRC.market),
      fact("Private lender: loan-to-cost", `${CONSTRUCTION_MARKET.privateLender.ltc}, ${CONSTRUCTION_MARKET.privateLender.cap}`, SRC.market),
      fact("Kubera sizing assumption: max loan-to-cost", pct(BRIDGE.construction.maxLtc), SRC.kubera),
      fact("Kubera sizing assumption: min debt yield on cost", pct(BRIDGE.construction.minDebtYieldOnCost, 1), SRC.kubera),
      fact("Kubera sizing assumption: term", `${BRIDGE.construction.termMonths} months`, SRC.kubera),
    ],
    sections: [
      {
        heading: "How construction loans are sized",
        paragraphs: [
          "Lenders size to the lesser of several tests: loan-to-cost, loan-to-as-completed value, debt yield on cost, and (for income property) debt service coverage at stabilization. The interest reserve sits inside the loan, so it counts toward leverage.",
          NO_DRAW_ROLE,
        ],
        bullets: [
          "Contingency and developer fee are part of the budget lenders review",
          "Experience tiers: sponsors with a track record of completed projects borrow at higher leverage",
          "The capital stack can include senior debt, mezzanine, preferred equity, C-PACE and common equity",
        ],
      },
      {
        heading: "Lender types",
        paragraphs: [
          "Banks offer the lowest cost and leverage and often require recourse and deposit relationships. Debt funds lend more against cost at higher pricing. Private lenders go highest on leverage, with a cap against as-completed value, and price accordingly.",
        ],
      },
      {
        heading: "The takeout",
        paragraphs: [
          "Every construction loan needs a repayment plan. For income property that is a permanent loan sized on stabilized income; for for-sale projects it is sale proceeds. Lenders test the take-out up front, and so do we.",
        ],
      },
    ],
    faq: [
      {
        question: "What equity does a construction loan require?",
        answer: "It depends on the lender type. Banks generally require the most equity, and private lenders the least, subject to a cap against as-completed value. The facts table shows typical ranges.",
      },
      {
        question: "Who handles construction draws?",
        answer: NO_DRAW_ROLE,
      },
      {
        question: "Can HUD finance construction?",
        answer: `Yes. HUD 221(d)(4) for multifamily and Section 232 new construction for senior housing finance construction and the permanent term in one insured loan.`,
      },
    ],
    related: ["construction-to-permanent", "c-pace", "hud-221d4", "hud-232", "construction"],
  },
  {
    slug: "construction-to-permanent",
    family: "construction",
    name: "Construction-to-permanent loans",
    title: "Construction-to-permanent loans",
    description:
      "Construction-to-permanent financing covers the build and the long-term loan in one structure. Compare HUD 221(d)(4), HUD 232 new construction and bank options.",
    summary: "One loan that funds construction and converts to long-term debt.",
    definition:
      "A construction-to-permanent loan is a financing structure in which a single loan funds construction and then converts, after completion and stabilization, into a long-term amortizing mortgage, so the borrower closes once and avoids refinancing risk at the end of construction.",
    loanType: "Construction-to-permanent loan (brokered)",
    loanTermYears: mf.s221d4.termYears,
    facts: [
      fact("HUD 221(d)(4): term", `Construction period plus ${years(mf.s221d4.termYears)}`, SRC.hudMfML),
      fact("HUD 221(d)(4): market-rate max loan-to-cost / DSCR", `${pct(mf.s221d4.maxLtc)} / ${x(mf.s221d4.minDscr)}`, SRC.hudMfML),
      fact("HUD 232 new construction: term", `Construction period plus ${years(s232.newConstruction.termYears)}`, SRC.hud232),
      fact("HUD 232 new construction: max loan-to-cost / DSCR (for-profit)", `${pct(s232.newConstruction.maxLtc)} / ${x(s232.newConstruction.minDscr)}`, SRC.hud232),
      fact("Annual MIP: HUD multifamily", pct(mf.mip.annual, 2), SRC.hudMfMip),
      fact("Annual MIP: HUD 232 new construction", pct(s232.newConstruction.annualMip, 2), SRC.hud232),
    ],
    sections: [
      {
        heading: "One closing, two phases",
        paragraphs: [
          "HUD's construction-to-permanent products are the clearest examples: the borrower closes one insured loan, construction funds are released by the HUD lender under HUD oversight, and the loan converts to a long fixed amortizing term at completion. Kubera has no role in the draw process.",
          "Banks also offer construction-to-perm structures, usually with a shorter permanent term and often a rate reset at conversion.",
        ],
      },
      {
        heading: "Trade-offs against two-step financing",
        paragraphs: [
          "One-step financing removes refinancing risk and locks pricing early. Two-step financing, with a bank construction loan followed by a separate permanent loan, usually closes faster and offers more flexibility, but exposes the borrower to rate and credit conditions at takeout.",
        ],
        bullets: [
          "HUD: higher leverage and fixed long-term debt, longer processing, more compliance",
          "Bank construction-to-perm: faster, shorter term, often recourse",
          "Two-step: flexible, but takeout risk stays with the borrower",
        ],
      },
    ],
    faq: [
      {
        question: "Which asset types use HUD construction-to-permanent loans?",
        answer: "Multifamily rental housing through 221(d)(4) and licensed healthcare facilities through Section 232 new construction.",
      },
      {
        question: "What is the main risk of two-step financing?",
        answer: "The permanent loan has to be available and large enough at completion. If rates, values or lease-up disappoint, the borrower may face a shortfall.",
      },
      {
        question: "Who manages draws on a construction-to-permanent loan?",
        answer: NO_DRAW_ROLE,
      },
    ],
    related: ["construction-loans", "hud-221d4", "hud-232", "c-pace", "construction"],
  },
  {
    slug: "c-pace",
    family: "construction",
    name: "C-PACE",
    title: "C-PACE commercial financing",
    description:
      "C-PACE finances energy, water and resilience improvements through a property tax assessment. Learn how it fits a construction or renovation capital stack.",
    summary: "Long-term assessment-based financing for qualifying building improvements.",
    definition:
      "Commercial Property Assessed Clean Energy (C-PACE) is a financing structure in which a property owner funds eligible energy, water and resilience improvements with capital that is repaid through a special assessment on the property's tax bill, with the obligation running with the property rather than the borrower.",
    loanType: "Commercial property assessed clean energy financing (brokered)",
    facts: [
      fact("Repayment", "Special assessment collected with property taxes", "State and local C-PACE enabling law", { verify: false }),
      fact("Eligible uses", "Energy efficiency, water conservation, renewable energy and resilience improvements", "State and local C-PACE enabling law"),
      fact("Availability", "Set by state and local program; confirm for the property's jurisdiction", "State and local C-PACE enabling law"),
      fact("Existing mortgage holder", "Consent is generally required", "Program guidelines"),
      fact("Stack position", "Can sit beside senior, mezzanine or preferred equity capital", SRC.kubera, { verify: false }),
    ],
    sections: [
      {
        heading: "Where C-PACE fits",
        paragraphs: [
          "C-PACE can replace a portion of equity or mezzanine debt in a construction or renovation budget because it is long-term and non-recourse to the owner, and it is typically ranked ahead of the mortgage as a tax lien. That priority is why senior lenders review it and often must consent.",
          "C-PACE is arranged with programs and capital providers that fund at closing. Kubera brokers the introduction and coordinates the capital stack and does not fund or hold any money.",
        ],
        bullets: [
          "New construction that exceeds code in energy or water performance",
          "Renovation with qualifying systems such as HVAC, envelope, lighting, solar or resilience upgrades",
          "Refinancing recently completed improvements, where the program allows",
        ],
      },
      {
        heading: "What to check first",
        paragraphs: [
          "Confirm that the property's jurisdiction has an active program, that the improvements qualify, and that the senior lender will consent. The assessment stays with the property if it is sold, which buyers and lenders will factor in.",
        ],
      },
    ],
    faq: [
      {
        question: "Is C-PACE a loan?",
        answer: "Economically it works like a loan, but it is structured as a voluntary assessment on the property. Documents and rights differ from a mortgage.",
      },
      {
        question: "Does a senior lender need to approve C-PACE?",
        answer: "Generally the existing mortgage holder must consent, since the assessment ranks ahead of the mortgage. Many construction lenders have standard consent processes.",
      },
      {
        question: "Can C-PACE be used for senior housing or hotels?",
        answer: "Often yes, where the state program covers the property type and the improvements qualify. Check program rules for the specific property.",
      },
    ],
    related: ["construction-loans", "construction-to-permanent", "hotel-to-senior-living-conversion", "multifamily-bridge", "construction"],
  },
];
