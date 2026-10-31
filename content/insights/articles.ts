// Insight articles. Every figure comes from lib/sizing/assumptions.ts or the
// calculators, so an article cannot disagree with the sizer. Copy rules
// (Global rule 4): advisor-led positioning, no approval or outcome promises,
// no guaranteed timelines, Kubera is a broker and not a lender.

import { calcDscr } from "@/lib/calculators/dscr";
import { calcHotelDebtYield } from "@/lib/calculators/hotel-debt-yield";
import { calcHudMip } from "@/lib/calculators/hud-mip";
import { usd } from "@/lib/calculators/format";
import { disclosures } from "@/lib/site";
import { AGENCY, ASSUMPTIONS_REVIEWED, BRIDGE, CMBS, HUD, SBA } from "@/lib/sizing/assumptions";
import type { Insight } from "./types";

const pct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`;
const x = (n: number) => `${n.toFixed(2)}x`;
const millions = (n: number) => `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
const roundTo = (n: number, step: number) => Math.round(n / step) * step;

const PUBLISHED = ASSUMPTIONS_REVIEWED;

// Worked examples are computed, not typed, so they track the assumptions.
const mipExample = (() => {
  const r = calcHudMip({ loanAmount: 10_000_000, program: "223f", ratePct: 6 });
  if (!r.ok) throw new Error("HUD MIP example failed");
  return r.result;
})();

const dscrExample = (() => {
  const r = calcDscr({ noi: 1_000_000, loanAmount: 10_000_000, ratePct: 6, amortYears: 30, targetDscr: 1.25 });
  if (!r.ok) throw new Error("DSCR example failed");
  return r.result;
})();

const hotelExample = (() => {
  const r = calcHotelDebtYield({ keys: 120, adr: 150, occupancyPct: 70, noi: 1_800_000, loanAmount: 15_000_000, tier: "BOUTIQUE_INDEPENDENT", ratePct: 7 });
  if (!r.ok) throw new Error("Hotel example failed");
  return r.result;
})();

export const INSIGHTS: readonly Insight[] = [
  {
    slug: "hud-multifamily-2025-changes",
    title: "What the 2025 HUD changes mean for 223(f) and 221(d)(4) loans",
    metaTitle: "HUD multifamily changes in 2025",
    description: "HUD raised leverage and cut coverage for multifamily loans in 2025 and moved to a flat insurance premium. Here is what changed for 223(f) and 221(d)(4).",
    category: "Multifamily",
    published: PUBLISHED,
    updated: PUBLISHED,
    summary: `Two 2025 actions reshaped HUD multifamily underwriting. Mortgagee Letter 2025-03 raised market-rate leverage to ${pct(HUD.multifamily.s223f.maxLtv)} and lowered the coverage minimum to ${x(HUD.multifamily.s223f.minDscr)}. A Federal Register notice then set a flat ${pct(HUD.multifamily.mip.annual, 2)} annual premium, so green certification no longer lowers the cost.`,
    keyTakeaways: [
      `Market-rate 223(f) and 221(d)(4) loans size at up to ${pct(HUD.multifamily.s223f.maxLtv)} of value or cost and ${x(HUD.multifamily.s223f.minDscr)} coverage; affordable and rental-assistance projects at ${pct(HUD.multifamily.s223f.maxLtvAffordable)} and ${x(HUD.multifamily.s223f.minDscrAffordable)}.`,
      `The annual premium is a flat ${pct(HUD.multifamily.mip.annual, 2)} for applications on or after ${HUD.multifamily.mip.effectiveForApplicationsOnOrAfter}, and green certification no longer reduces it.`,
      `Cash-out 223(f) refinances stay at ${pct(HUD.multifamily.s223f.cashOutMaxLtv)} loan-to-value.`,
      "Section 232 senior housing was not changed by the leverage letter.",
    ],
    sections: [
      {
        heading: "Higher leverage, lower coverage",
        paragraphs: [
          `HUD Mortgagee Letter 2025-03 (January 2025) changed the underwriting boxes for the two main multifamily programs. For market-rate 223(f) purchases and refinances, and for market-rate 221(d)(4) construction and substantial rehabilitation, the maximum is now ${pct(HUD.multifamily.s223f.maxLtv)} loan-to-value (loan-to-cost on 221(d)(4)) with a ${x(HUD.multifamily.s223f.minDscr)} minimum debt service coverage ratio.`,
          `Projects with affordability restrictions or project-based rental assistance get a more generous box: ${pct(HUD.multifamily.s223f.maxLtvAffordable)} and ${x(HUD.multifamily.s223f.minDscrAffordable)}. A cash-out 223(f) refinance is not part of the increase and stays at ${pct(HUD.multifamily.s223f.cashOutMaxLtv)} loan-to-value.`,
        ],
        bullets: [
          `Market rate: ${pct(HUD.multifamily.s223f.maxLtv)} LTV or LTC, ${x(HUD.multifamily.s223f.minDscr)} DSCR`,
          `Affordable or rental assistance: ${pct(HUD.multifamily.s223f.maxLtvAffordable)}, ${x(HUD.multifamily.s223f.minDscrAffordable)}`,
          `223(f) cash-out: ${pct(HUD.multifamily.s223f.cashOutMaxLtv)} LTV`,
        ],
      },
      {
        heading: "A flat mortgage insurance premium",
        paragraphs: [
          `A Federal Register notice published on September 23, 2025 set the annual mortgage insurance premium (MIP) for FHA multifamily programs at a flat ${pct(HUD.multifamily.mip.annual, 2)} for applications submitted or amended on or after ${HUD.multifamily.mip.effectiveForApplicationsOnOrAfter}. It removed the separate green, affordable and broadly affordable categories, so a green certification no longer lowers the premium.`,
          `On a $10,000,000 loan at 6.00% over ${HUD.multifamily.s223f.termYears} years, the first-year premium is about ${usd(roundTo(mipExample.yearOneMip, 100))}, which adds roughly ${mipExample.mipAsRatePoints.toFixed(2)} percentage points to the note rate in year one. The premium is charged on the average balance, so it falls as the loan amortizes. The HUD MIP calculator shows the full schedule.`,
          `The upfront premium is configurable in Kubera's assumptions (default ${pct(HUD.multifamily.mip.upfront, 2)}) because it rests on a secondary source; a HUD lender confirms the figure for a specific application.`,
        ],
      },
      {
        heading: "What this does to sizing",
        paragraphs: [
          "Higher leverage helps only when it is the binding constraint, and on many deals it is not. Coverage often binds first: at a typical HUD rate, a property that cannot reach the minimum coverage cannot take more debt just because the loan-to-value limit allows it. Run both tests before assuming the extra leverage is available.",
          "The lower coverage minimum matters most for properties with thin margins, such as older rent-stabilized buildings in California, where in-place rents are below market. There, income, not value, sets the loan.",
        ],
      },
      {
        heading: "What did not change",
        paragraphs: [
          `Section 232 senior housing and healthcare loans were not changed by Mortgagee Letter 2025-03. Kubera's assumptions keep ${pct(HUD.section232.refi.maxLtv)} loan-to-value and ${x(HUD.section232.refi.minDscr)} coverage for refinances, with annual premiums of ${pct(HUD.section232.refi.annualMip, 2)} on refinances and ${pct(HUD.section232.newConstruction.annualMip, 2)} on new construction. Whether the flat ${pct(HUD.multifamily.mip.annual, 2)} notice reaches Section 232 has not been confirmed, so treat the Section 232 premium as a figure to verify.`,
          "HUD processing remains a multi-step lender and HUD review. Timelines vary by lender and HUD office and are not guaranteed.",
        ],
      },
    ],
    faq: [
      { question: "Did HUD raise the maximum loan-to-value for 223(f)?", answer: `For market-rate multifamily, Mortgagee Letter 2025-03 moved the maximum to ${pct(HUD.multifamily.s223f.maxLtv)} with a ${x(HUD.multifamily.s223f.minDscr)} minimum coverage. Cash-out refinances stay at ${pct(HUD.multifamily.s223f.cashOutMaxLtv)}. Confirm current figures with a HUD lender.` },
      { question: "Does green certification still reduce the HUD premium?", answer: "No. The 2025 notice replaced the green, affordable and broadly affordable premium categories with a single flat rate for multifamily." },
      { question: "Do these changes apply to HUD 232 senior housing?", answer: "The leverage letter did not change Section 232. Whether the flat premium reaches Section 232 has not been confirmed, so verify it before relying on a figure." },
    ],
    related: [
      { href: "/calculators/hud-mip", label: "HUD MIP calculator" },
      { href: "/calculators/dscr", label: "DSCR calculator" },
      { href: "/financing/hud-223f-multifamily", label: "HUD 223(f) multifamily loans" },
      { href: "/financing/hud-221d4", label: "HUD 221(d)(4) new construction" },
      { href: "/glossary#mip", label: "Glossary: mortgage insurance premium" },
    ],
    sources: [
      "HUD Mortgagee Letter 2025-03 (January 2025)",
      "Federal Register 2025-18379 (September 23, 2025), flat annual MIP for FHA multifamily programs",
      "Kubera underwriting assumptions, reviewed " + PUBLISHED,
    ],
  },
  {
    slug: "hud-232-or-bridge-first",
    title: "HUD 232 or a bridge loan first? Choosing between permanent and interim debt",
    metaTitle: "HUD 232 or a bridge loan first?",
    description: "A care facility that is not ready for HUD 232 may need a bridge loan first. See how to decide, what the bridge must prove and what the exit test looks like.",
    category: "Senior living",
    published: PUBLISHED,
    updated: PUBLISHED,
    summary: `HUD 232 is the lowest-cost permanent debt for a care facility, but it needs a stabilized operating history. When a facility is newly built, recently acquired or still filling, a bridge loan covers the gap, sized to be repaid by a 232 refinance once the property qualifies.`,
    keyTakeaways: [
      `HUD 232 refinances in Kubera's assumptions size at up to ${pct(HUD.section232.refi.maxLtv)} loan-to-value and ${x(HUD.section232.refi.minDscr)} coverage over ${HUD.section232.refi.termYears} years.`,
      `HUD generally looks for at least ${HUD.section232.minYearsSinceCompletion} years since completion and ${pct(HUD.section232.stabilizedOccupancy)} stabilized occupancy on a refinance.`,
      `A senior-housing bridge in the sizer allows up to ${pct(BRIDGE.senior.maxLtv)} loan-to-value on a ${BRIDGE.senior.termMonths}-month term, with a ${pct(BRIDGE.senior.minDebtYield)} minimum debt yield.`,
      "The deciding question is whether the bridge exit, a 232 refinance, will clear HUD's tests when the bridge matures.",
    ],
    sections: [
      {
        heading: "Why HUD 232 is hard to reach on day one",
        paragraphs: [
          `HUD 232 is attractive because it is long-term, fully amortizing and non-recourse apart from standard carve-outs. The cost of that is a demanding file. On a refinance or purchase, Kubera's assumptions assume a facility at least ${HUD.section232.minYearsSinceCompletion} years past completion, operating near ${pct(HUD.section232.stabilizedOccupancy)} occupancy, with enough income to carry a ${x(HUD.section232.refi.minDscr)} coverage ratio. Facilities below roughly ${HUD.section232.practicalMinBeds} beds often find HUD's fixed costs outweigh its rate advantage.`,
          "A new operator, a licensing change, a lease-up or a deferred-maintenance backlog can each push a facility out of the 232 box for now, even when the long-term plan is a 232 refinance.",
        ],
      },
      {
        heading: "What a bridge loan has to prove",
        paragraphs: [
          `A bridge lender underwrites the exit as much as the property. In the sizer, a senior-housing bridge goes up to ${pct(BRIDGE.senior.maxLtv)} loan-to-value, requires a debt yield of at least ${pct(BRIDGE.senior.minDebtYield)}, and runs ${BRIDGE.senior.termMonths} months, priced over SOFR. The bridge is only sensible if the facility can plausibly reach the 232 tests inside that term.`,
          "The exit test models the refinance: at the stabilized income you expect, does a 232 loan large enough to repay the bridge clear HUD's loan-to-value and coverage limits? If it does not, the bridge becomes a long-term problem rather than a short one.",
        ],
        bullets: [
          "Stabilized income the facility can realistically reach, not the pro forma",
          "A 232 loan amount that repays the bridge, with room for costs and reserves",
          "Licensing and operator status in good standing",
          "A timeline with margin: HUD processing times vary and are not guaranteed",
        ],
      },
      {
        heading: "When to skip the bridge",
        paragraphs: [
          "If the facility already meets the 232 tests today, a bridge adds a second set of closing costs for no benefit. Compare the all-in cost of going straight to 232 against bridge plus 232: the bridge costs more per year, and the sponsor pays closing costs twice.",
          "If the facility is far from stabilizing, a bridge sized on the assumption of a 232 exit may be the wrong tool. Other structures, such as a bank or debt fund loan with a longer term, can be a better fit. An advisor can compare them.",
        ],
      },
      {
        heading: "How Kubera approaches the choice",
        paragraphs: [
          "Kubera is a licensed California real estate broker, not a lender. An advisor reviews the facility, runs both paths in the sizer and shows the numbers side by side, and lenders make their own credit decisions.",
          disclosures.timeline,
        ],
      },
    ],
    faq: [
      { question: "Can I get a HUD 232 loan on a newly built facility?", answer: `HUD has a separate Section 232 new construction program, and refinancing a completed facility generally looks for at least ${HUD.section232.minYearsSinceCompletion} years of operating history in Kubera's assumptions. A newly built facility often uses construction financing and then a bridge before it reaches the refinance box.` },
      { question: "How long does a bridge loan last?", answer: `Kubera's senior-housing bridge assumption is ${BRIDGE.senior.termMonths} months. Terms and extensions vary by lender.` },
      { question: "Is a bridge loan more expensive than HUD 232?", answer: "Usually, yes on an annual basis: bridge loans are floating-rate and interest-only, and HUD 232 is fixed-rate and fully amortizing. The comparison that matters is total cost over the period you will hold each loan, including closing costs on both." },
    ],
    related: [
      { href: "/financing/hud-232", label: "HUD 232 loans" },
      { href: "/financing/bridge-to-hud", label: "Bridge-to-HUD loans" },
      { href: "/calculators/dscr", label: "DSCR calculator" },
      { href: "/glossary#stabilization", label: "Glossary: stabilization" },
    ],
    sources: [
      "HUD Handbook 4232.1 and prior MIP schedule",
      "Kubera underwriting assumptions, reviewed " + PUBLISHED,
    ],
  },
  {
    slug: "sba-504-vs-7a-hotel-acquisition",
    title: "SBA 504 or 7(a) for a hotel acquisition?",
    metaTitle: "SBA 504 vs 7(a) for hotel purchases",
    description: "Compare SBA 504 and 7(a) for buying a hotel: structure, equity, rate type, caps and when a 7(a) plus 504 stack can raise the total SBA financing.",
    category: "Hotels",
    published: PUBLISHED,
    updated: PUBLISHED,
    summary: `For an owner-operator buying a hotel, SBA 504 usually gives lower fixed-rate cost on the real estate portion, and 7(a) is more flexible about what it can finance. A 7(a) plus 504 stack combines them when the project needs more than either program alone.`,
    keyTakeaways: [
      `SBA 504 splits the project into a bank first lien (${pct(SBA.bankFirstPct)}), an SBA-backed debenture and ${pct(SBA.equity.base + SBA.equity.specialPurpose)} equity for an existing hotel.`,
      `The standard debenture cap in Kubera's assumptions is ${millions(SBA.cdcCap)}; a 7(a) loan is capped at ${millions(SBA.sevenACap)}, and Kubera models combined exposure up to ${millions(SBA.combinedExposureCap)} for the stack.`,
      "504 is for fixed assets; 7(a) can also finance working capital, a business purchase and goodwill.",
      `Both programs need personal guaranties and a minimum ${x(SBA.minDscr)} coverage in Kubera's assumptions.`,
    ],
    sections: [
      {
        heading: "How SBA 504 is built",
        paragraphs: [
          `SBA 504 pairs a bank first lien of about ${pct(SBA.bankFirstPct)} of the project with a second lien from a Certified Development Company, funded by an SBA-backed debenture, for most of the remainder. The borrower contributes equity: ${pct(SBA.equity.base)} as a base, plus ${pct(SBA.equity.specialPurpose)} for special-purpose property such as a hotel, plus ${pct(SBA.equity.newBusiness)} more for a start-up or new construction.`,
          `The debenture is fixed-rate for the life of the loan with a ${SBA.cdcAmortYears}-year amortization, which is the main source of the program's appeal: a large share of the debt is fixed at a long-term rate. Ongoing SBA and servicing fees (${pct(SBA.annualDebentureFees, 2)} a year in Kubera's assumptions) add to the cost, and Kubera's sizer includes them.`,
        ],
      },
      {
        heading: "Where 7(a) is different",
        paragraphs: [
          `A 7(a) loan is a bank loan partly backed by an SBA guaranty, usually floating-rate and priced over Prime. In Kubera's assumptions the guaranty covers ${pct(SBA.sevenAGuaranteedShare)} of the loan, and the program has an upfront guaranty fee and an annual servicing fee. It can finance real estate, but also working capital, equipment, a business purchase and goodwill, which 504 cannot.`,
          "For a hotel purchase that includes a going-concern value or needs working capital for a ramp-up, 7(a) may be the only program that funds all of it. For a straightforward purchase of the real estate, 504 is often the lower-cost structure because of the fixed debenture.",
        ],
      },
      {
        heading: "The 7(a) plus 504 stack",
        paragraphs: [
          `When one program alone leaves a gap, a 7(a) loan can sit alongside a 504 structure. Kubera's modeling of the combined structure allows up to ${millions(SBA.combinedExposureCap)} of total SBA exposure, split between the ${millions(SBA.cdcCap)} debenture and a 7(a) loan up to ${millions(SBA.sevenACap)}. That figure rests on the 2026 SOP and is marked for verification; confirm it against the revision in effect when you apply.`,
          "A stack has more moving parts: two SBA lenders or a bank that is also the 7(a) lender, intercreditor terms and a longer approval path. It is worth it when the project cost genuinely exceeds what 504 alone supports.",
        ],
      },
      {
        heading: "Questions an advisor will ask",
        paragraphs: ["Choosing between the programs, and deciding whether a stack is needed, usually turns on five questions."],
        bullets: [
          "How much of the price is real estate, and how much is business value and working capital?",
          `Will the operating company occupy at least 51% of the property? Both programs require owner occupancy.`,
          `Does the hotel's trailing income reach ${x(SBA.minDscr)} coverage after SBA fees?`,
          "How much equity is available, and does a seller note count toward it?",
          "What is the plan for any renovation required by the franchisor (a property improvement plan)?",
        ],
      },
    ],
    faq: [
      { question: "Which is cheaper, SBA 504 or 7(a)?", answer: "It depends on the structure, rate environment and fees. A 504 debenture is fixed-rate over a long term, while a 7(a) loan is usually floating-rate, so the comparison changes as rates move. The SBA 504 calculator shows the 504 side; an advisor can model both." },
      { question: "Can I use SBA 504 to buy a franchised hotel?", answer: "Yes, if the borrower's operating company occupies the property and the project meets the program's rules. A franchisor's property improvement plan can usually be included in the project cost." },
      { question: "Do SBA loans require a personal guaranty?", answer: "Yes. The SBA requires personal guaranties from owners of 20% or more, so these are not non-recourse programs." },
    ],
    related: [
      { href: "/calculators/sba-504", label: "SBA 504 calculator" },
      { href: "/financing/sba-504-hotel", label: "SBA 504 hotel loans" },
      { href: "/financing/sba-7a-504-hotel-stack", label: "SBA 7(a) plus 504 stack" },
      { href: "/glossary#sba-504", label: "Glossary: SBA 504" },
    ],
    sources: [
      "SBA SOP 50 10 (confirm the revision in effect at application)",
      "Kubera modeling of the 2026 combined 7(a) plus 504 structure",
      "Kubera underwriting assumptions, reviewed " + PUBLISHED,
    ],
  },
  {
    slug: "dscr-vs-debt-yield",
    title: "DSCR or debt yield: which constraint limits your loan?",
    metaTitle: "DSCR vs debt yield: what limits you",
    description: "Loan size is the smallest of several limits. See how DSCR, debt yield and loan-to-value each cap a loan, with a worked example and when each one binds.",
    category: "Underwriting",
    published: PUBLISHED,
    updated: PUBLISHED,
    summary: "A lender sizes a loan against several tests at once and lends the smallest result. Coverage binds when rates are high, debt yield binds when a lender wants a floor on income per dollar, and loan-to-value binds when value is the concern.",
    keyTakeaways: [
      "The binding constraint is whichever test produces the smallest loan; relaxing any other test does not raise proceeds.",
      "DSCR depends on the rate and amortization, so it tightens when rates rise. Debt yield ignores both.",
      `Hotel CMBS lenders in Kubera's assumptions require ${pct(CMBS.minDebtYield.PREMIUM_FLAG, 1)} to ${pct(CMBS.minDebtYield.BOUTIQUE_INDEPENDENT, 1)} debt yield by hotel type, which often binds before coverage.`,
      "Run all three tests before deciding how to improve a deal.",
    ],
    sections: [
      {
        heading: "Three tests, one loan",
        paragraphs: [
          "Every sizing starts from three numbers: net operating income, the property's value or cost, and the loan's rate and amortization. From those a lender derives several maximum loans and lends the smallest.",
          "Debt service coverage ratio (DSCR) divides income by the annual payment. Debt yield divides income by the loan balance. Loan-to-value (LTV) divides the loan by value. Each one answers a different worry: can the property pay, how much income stands behind each dollar, and how much cushion is there if values fall.",
        ],
      },
      {
        heading: "A worked example",
        paragraphs: [
          `Take a property with $1,000,000 of net operating income. At 6.00% over 30 years, a loan of $10,000,000 has a coverage ratio of ${x(dscrExample.dscr)}. With a required coverage of 1.25x, the largest loan the income supports is about ${usd(roundTo(dscrExample.maxLoanAtTarget, 10_000))}. A lender with a 10% debt yield floor would cap the loan at $10,000,000 instead, because $1,000,000 divided by 10% is $10,000,000.`,
          "In this example the debt yield test is the tighter one, so negotiating a lower rate would not raise the loan. Only more income, a lender with a lower floor, or a different program would. At a higher rate the coverage test would tighten and could become the binding one.",
        ],
      },
      {
        heading: "When each one binds",
        paragraphs: ["As a rule of thumb, from how Kubera's sizer behaves across programs:"],
        bullets: [
          `Coverage binds on long-term fixed-rate programs with a high minimum, such as HUD 232 at ${x(HUD.section232.refi.minDscr)}, especially when rates are high.`,
          `Debt yield binds on conduit and bridge loans, where lenders want a floor on income that does not move with rates. A boutique hotel at ${pct(CMBS.minDebtYield.BOUTIQUE_INDEPENDENT, 1)} is an example.`,
          `Loan-to-value binds when income is strong relative to value, for example a low cap rate market or a recently renovated property. Agency loans in Kubera's assumptions go to ${pct(AGENCY.maxLtv)}, but real deals often land lower because coverage binds first.`,
        ],
      },
      {
        heading: "Hotel example",
        paragraphs: [
          `A 120-key hotel earning $1,800,000 of net operating income looking for a $15,000,000 loan has a debt yield of ${pct(hotelExample.debtYield, 1)}. For a boutique or independent hotel the floor in Kubera's CMBS assumptions is ${pct(hotelExample.minDebtYield, 1)}, so the largest loan on debt yield alone is about ${usd(roundTo(hotelExample.maxLoanAtMinDebtYield, 10_000))}. A premium-flag hotel with the same income clears a lower floor.`,
        ],
      },
      {
        heading: "What to do about it",
        paragraphs: [
          "Find the binding constraint first. If coverage binds, a longer amortization, an interest-only period tested on the amortizing payment, or a lower-rate program raises the loan. If debt yield binds, only income or a lender with a lower floor helps. If loan-to-value binds, more value, through renovation or a better appraisal, or more equity, is the lever.",
        ],
      },
    ],
    faq: [
      { question: "Which is more important, DSCR or debt yield?", answer: "Neither always. The one that gives the smaller loan is the binding constraint. DSCR depends on the rate and amortization, so it moves with the market; debt yield does not." },
      { question: "Why do lenders use debt yield at all?", answer: "It compares income to the loan alone, so it is not affected by the interest rate, amortization or cap rate. That makes it a steadier measure of risk, especially for loans that will be refinanced." },
      { question: "Can I improve DSCR without more income?", answer: "Yes. A lower rate, a longer amortization or a smaller loan raises coverage. Lenders re-underwrite income, so they may adjust it first." },
    ],
    related: [
      { href: "/calculators/dscr", label: "DSCR calculator" },
      { href: "/calculators/hotel-debt-yield", label: "Hotel debt yield calculator" },
      { href: "/glossary#debt-yield", label: "Glossary: debt yield" },
      { href: "/glossary#dscr", label: "Glossary: DSCR" },
    ],
    sources: ["Kubera underwriting assumptions, reviewed " + PUBLISHED, "Kubera loan sizer (lib/sizing)"],
  },
  {
    slug: "california-mortgage-loan-disclosure-statement",
    title: "The California Mortgage Loan Disclosure Statement (RE 882): what borrowers should expect",
    metaTitle: "California loan disclosure (RE 882)",
    description: "California brokers give borrowers a Mortgage Loan Disclosure Statement on loans secured by real property. See what it contains, when it arrives and why.",
    category: "California",
    published: PUBLISHED,
    updated: PUBLISHED,
    legalDraft: true,
    summary: "When a California real estate broker arranges a loan secured by real property, the broker gives the borrower a Mortgage Loan Disclosure Statement on DRE form RE 882. It lays out estimated costs, all broker compensation and the loan terms before the borrower becomes obligated.",
    keyTakeaways: [
      "The statement is a state-required disclosure, not a loan approval or a commitment to lend.",
      "It sets out estimated borrower-paid costs, all broker compensation including any paid by the lender, and the loan terms.",
      "Kubera's process is to hold loan documents until the borrower has signed the statement.",
      "This article is general information, not legal advice.",
    ],
    sections: [
      {
        heading: "What the statement is",
        paragraphs: [
          `The Mortgage Loan Disclosure Statement, on form RE 882 of the California Department of Real Estate, is the written disclosure a licensed broker gives a borrower on a loan the broker arranges. ${disclosures.mlds}`,
          "The point of the form is to put the cost and the terms of the loan, and the broker's compensation, in front of the borrower in a standard format before the borrower commits.",
        ],
      },
      {
        heading: "What it contains",
        paragraphs: ["The statement covers the main facts of the transaction:"],
        bullets: [
          "Estimated maximum costs the borrower will pay, such as appraisal, escrow, title, notary and recording",
          "All compensation the broker will receive, including any paid by the lender",
          "The loan amount, interest rate, term, payments and any balloon payment",
          "A statement that credit insurance is not required and that the broker will not use broker-controlled funds, where that is the case",
          "The broker's name, license number and licensed address",
          "A notice that the figures are estimates",
        ],
      },
      {
        heading: "Who signs and what you receive",
        paragraphs: [
          "Each borrower signs the statement, and so does the broker or a licensee acting for the broker. The borrower receives an exact copy. Electronic signature is acceptable with the borrower's consent to sign electronically, and the broker keeps a copy for three years.",
          "Kubera never accepts, holds or disburses loan funds. The statement describes the costs and compensation of the transaction; it does not mean Kubera is the lender.",
        ],
      },
      {
        heading: "How Kubera handles it",
        paragraphs: [
          "Kubera's process treats the statement as a gate. We do not deliver a loan commitment or loan documents to a borrower before the statement is signed, and a deal does not move to closing without a signed statement on file. Because rules and forms change, an attorney reviews our disclosure process, and this article stays in draft until that review is complete.",
          "If you are comparing brokers or lenders, ask each one when you will receive the statement and what compensation it shows.",
        ],
      },
    ],
    faq: [
      { question: "Is the Mortgage Loan Disclosure Statement a loan approval?", answer: "No. It is a disclosure of costs, compensation and loan terms. It is not a commitment to lend." },
      { question: "When do I receive it?", answer: "After the broker receives a completed written loan application and before you become obligated on the loan. Kubera's disclosure sets the outer limit at three business days after a completed application." },
      { question: "Does the statement apply to every Kubera loan?", answer: "It applies to loans Kubera arranges that are secured directly or collaterally by real property. Your advisor will confirm whether it applies to your transaction." },
    ],
    related: [
      { href: "/licensing", label: "Licensing and disclosures" },
      { href: "/glossary#mlds", label: "Glossary: Mortgage Loan Disclosure Statement" },
      { href: "/about", label: "About Kubera Commercial" },
    ],
    sources: ["California Business and Professions Code sections 10240 and 10241", "California Department of Real Estate form RE 882"],
  },
];

export const INSIGHTS_BY_SLUG: ReadonlyMap<string, Insight> = new Map(INSIGHTS.map((i) => [i.slug, i]));
