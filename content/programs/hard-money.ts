import { BRIDGE } from "@/lib/sizing/assumptions";
import { disclosures } from "@/lib/site";
import { HARD_MONEY } from "./market-facts";
import { fact, pct, pts, SRC } from "./format";
import type { ProgramEntry } from "./types";

const LENDER_OF_RECORD =
  "Private lenders fund at closing as lender of record and make their own credit decisions. Kubera arranges the loan as a licensed broker; it never funds loans, holds borrower money or services loans.";

export const hardMoneyPrograms: ProgramEntry[] = [
  {
    slug: "hard-money",
    family: "hard-money",
    name: "Hard money loans",
    title: "Hard money loans",
    description:
      "Hard money loans are short-term, asset-based loans from private lenders for fast closings. See typical rates, points, leverage, extensions and exit costs.",
    summary: "Short-term, asset-based private loans for speed and flexibility.",
    definition:
      "A hard money loan is a short-term, interest-only loan from a private lender, secured by real estate and underwritten mainly on the value of the asset and the borrower's exit plan rather than on the borrower's credit or income, which is why it can close faster than bank or agency debt.",
    loanType: "Private short-term real estate loan (brokered)",
    isHub: true,
    facts: [
      fact("Interest rate", HARD_MONEY.rate, SRC.market),
      fact("Origination points", HARD_MONEY.points, SRC.market),
      fact("Leverage: fix-and-flip", HARD_MONEY.fixFlipLeverage, SRC.market),
      fact("Leverage: stabilized bridge", HARD_MONEY.stabilizedBridgeLeverage, SRC.market),
      fact("Term", HARD_MONEY.term, SRC.market),
      fact("Extension fee", HARD_MONEY.extensionFee, SRC.market),
      fact("Minimum interest", HARD_MONEY.minimumInterest, SRC.market),
      fact("Exit fee", HARD_MONEY.exitFee, SRC.market),
      fact("Default rate", HARD_MONEY.defaultRate, SRC.market),
    ],
    sections: [
      {
        heading: "When hard money makes sense",
        paragraphs: [
          "Hard money is a tool for speed and for deals that conventional lenders will not touch yet: an auction or short-fuse purchase, a property with a heavy rehab, a borrower between tax years, or a bridge to a refinance. It is more expensive than bank or agency debt, so the plan has to justify the cost.",
          LENDER_OF_RECORD,
        ],
        bullets: [
          "Purchase on a short timeline",
          "Heavy rehabilitation with an after-repair value plan",
          "Bridge to a permanent loan once the property is stabilized",
          "Situations where income documentation is hard to produce",
        ],
      },
      {
        heading: "Read the whole cost",
        paragraphs: [
          "The rate is only part of the cost. Points at closing, minimum interest, extension fees and exit fees can add materially to the total, and a default rate applies if the loan matures unpaid. We show the all-in cost, including these items, before you decide.",
        ],
      },
      {
        heading: "Timing",
        paragraphs: [
          `Private bridge and hard money loans often close faster than bank or agency loans: many close in ${BRIDGE.closeRange}. ${disclosures.timeline}`,
        ],
      },
    ],
    faq: [
      {
        question: "How much does a hard money loan cost?",
        answer: `Typical ranges are an interest rate of ${HARD_MONEY.rate} and ${HARD_MONEY.points}, plus extension, minimum-interest and exit fees. Actual terms vary by lender, asset and borrower.`,
      },
      {
        question: "How is hard money different from a bridge loan?",
        answer: "They overlap. Hard money usually means a smaller, faster, more asset-focused private loan, while institutional bridge loans come from debt funds with lower pricing and more documentation.",
      },
      {
        question: "Are hard money loans exempt from California interest-rate limits?",
        answer: "Whether any particular loan falls within an exemption depends on the lender, the collateral and how the loan is arranged. Kubera does not advise on that; ask your own counsel.",
      },
      {
        question: "Who funds a hard money loan Kubera arranges?",
        answer: LENDER_OF_RECORD,
      },
    ],
    related: ["fix-and-flip", "private-bridge", "multifamily-bridge", "construction-loans", "construction"],
  },
  {
    slug: "fix-and-flip",
    family: "hard-money",
    name: "Fix-and-flip loans",
    title: "Fix-and-flip loans",
    description:
      "Fix-and-flip loans fund a purchase and a rehab budget, sized on as-is value and after-repair value. See leverage, holdbacks, points and exit costs.",
    summary: "Purchase-plus-rehab financing sized on as-is and after-repair value.",
    definition:
      "A fix-and-flip loan is a short-term private loan that funds the purchase of a property and part of its renovation budget, sized against the lesser of a share of the as-is value plus rehab cost and a share of the after-repair value (ARV), and repaid when the property is sold or refinanced.",
    loanType: "Short-term renovation loan (brokered)",
    facts: [
      fact("Leverage", HARD_MONEY.fixFlipLeverage, SRC.market),
      fact("Interest rate", HARD_MONEY.rate, SRC.market),
      fact("Origination points", HARD_MONEY.points, SRC.market),
      fact("Term", HARD_MONEY.term, SRC.market),
      fact("Extension fee", HARD_MONEY.extensionFee, SRC.market),
      fact("Minimum interest", HARD_MONEY.minimumInterest, SRC.market),
      fact("Exit fee", HARD_MONEY.exitFee, SRC.market),
    ],
    sections: [
      {
        heading: "How the loan is sized",
        paragraphs: [
          "Lenders start with the purchase price and the rehab budget, then cap the loan at a share of the property's after-repair value. The lower result controls. A rehab holdback is set aside inside the loan and released by the lender as work is completed under the lender's own process.",
          "That holdback is the lender's, not Kubera's. Private lenders fund at closing as lender of record. Kubera does not inspect work, release funds or hold any money.",
        ],
        bullets: [
          "As-is value plus rehab budget versus ARV: the lender uses the lower",
          "Experience with prior projects can improve leverage and pricing",
          "A clear exit by sale or refinance is required",
        ],
      },
      {
        heading: "What makes or breaks the deal",
        paragraphs: [
          "Accurate rehab budgets, realistic ARV comparables and the timeline matter more than the rate. Delays raise interest cost, trigger extension fees and can compress margin. We help test the numbers before you commit.",
        ],
      },
    ],
    faq: [
      {
        question: "What is ARV?",
        answer: "After-repair value is the property's estimated market value once the planned renovation is complete. Lenders use it to cap the loan.",
      },
      {
        question: "Can the loan cover the rehab?",
        answer: "Often partly. The lender sets the portion funded through a holdback within its overall leverage limit, so borrowers typically need cash for the remainder.",
      },
      {
        question: "What if I cannot sell in time?",
        answer: "Most lenders offer extensions for a fee. A refinance into a DSCR or bank loan is the usual alternative.",
      },
    ],
    related: ["hard-money", "private-bridge", "dscr-investor", "construction-loans", "construction"],
  },
  {
    slug: "private-bridge",
    family: "hard-money",
    name: "Private bridge loans",
    title: "Private bridge loans",
    description:
      "Private bridge loans from debt funds and private lenders finance acquisitions, transitions and repositionings. See leverage, term, pricing and exit planning.",
    summary: "Short-term floating debt from private lenders and debt funds.",
    definition:
      "A private bridge loan is a short-term loan from a debt fund, family office or other private lender that finances an acquisition, refinance or repositioning of commercial real estate until a planned event, such as stabilization, a sale or a permanent refinance, repays it.",
    loanType: "Private bridge loan (brokered)",
    facts: [
      fact("Max LTV (Kubera sizing assumption)", pct(BRIDGE.cre.maxLtv), SRC.kubera),
      fact("Minimum debt yield (Kubera sizing assumption)", pct(BRIDGE.cre.minDebtYield), SRC.kubera),
      fact("Typical term", `${BRIDGE.cre.termMonths} months`, SRC.kubera),
      fact("Indicative spread", `SOFR + ${pts(BRIDGE.cre.spread)} points`, SRC.kubera),
      fact("Lender fee / exit fee", `${pct(BRIDGE.lenderFeePct, 1)} / ${pct(BRIDGE.exitFeePct, 1)}`, SRC.kubera),
      fact("Typical close", `${BRIDGE.closeRange} after a complete file`, SRC.kubera),
      fact("Private-lender range (rate)", HARD_MONEY.rate, SRC.market),
    ],
    sections: [
      {
        heading: "Who uses private bridge debt",
        paragraphs: [
          "Owners use bridge loans when permanent financing is not available yet: a property that needs lease-up, a maturing loan, a time-sensitive purchase or a repositioning. The lender prices speed and flexibility, so the loan costs more than permanent debt.",
          LENDER_OF_RECORD,
        ],
        bullets: [
          "Acquisition ahead of a permanent loan",
          "Refinance of a maturing loan while the property is repositioned",
          "Transitional senior housing, hotel or multifamily assets",
        ],
      },
      {
        heading: "Choosing a structure",
        paragraphs: [
          "Debt funds typically offer larger loans at lower spreads, with more documentation and a longer process. Private lenders are faster and smaller, with higher pricing. Most deals need a defined exit: HUD, agency, CMBS, SBA or sale.",
        ],
      },
    ],
    faq: [
      {
        question: "How is a bridge loan repaid?",
        answer: "From a permanent refinance, a sale or other planned capital event. The lender will test that exit before it commits.",
      },
      {
        question: "Does the loan require recourse?",
        answer: "Often some, such as carve-out or completion guaranties, but terms vary by lender and deal.",
      },
      {
        question: "How fast can it close?",
        answer: `Many close in ${BRIDGE.closeRange} after a complete file, subject to lender approval, appraisal, title and diligence. Timing is not guaranteed.`,
      },
    ],
    related: ["hard-money", "multifamily-bridge", "bridge-to-hud", "pip-bridge", "hotels"],
  },
];
