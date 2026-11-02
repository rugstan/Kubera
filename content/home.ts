// Copy and data for the homepage sections (components/home/*). Every number is
// built from the sizing assumptions or the market facts, never typed here, so
// the homepage cannot drift from the sizer and the program pages
// (content/home.test.ts rejects a literal percentage or dollar figure).

import type { FaqItem } from "@/components/seo/schemas";
import { pct } from "@/content/programs/format";
import { CONSTRUCTION_MARKET, HARD_MONEY as HARD_MONEY_MARKET } from "@/content/programs/market-facts";
import type { ProgramFamily } from "@/content/programs/types";
import { HUD, SBA } from "@/lib/sizing/assumptions";
import { disclosures } from "@/lib/site";

export interface HomeFamily {
  family: ProgramFamily;
  /** Who the card is for, in one sentence. */
  audience: string;
  /** One program fact, built from the assumptions. */
  fact: string;
  /** Program pages shown as chips, 3 to 5. Each must resolve with getFinancingPage. */
  programSlugs: readonly string[];
  /** Small print under the chips. */
  note?: string;
}

export const HOME_FAMILIES: readonly HomeFamily[] = [
  {
    family: "senior-living",
    audience: "Assisted living, memory care, RCFE and skilled nursing owners and operators.",
    fact: `HUD 232: up to ${HUD.section232.refi.termYears}-year fixed, non-recourse terms`,
    programSlugs: ["hud-232", "hud-223f-senior-housing", "bridge-to-hud", "rcfe"],
  },
  {
    family: "hotels",
    audience: "Flagged and independent hotels, renovations and hotel conversions.",
    fact: `SBA 504: equity from ${pct(SBA.equity.base + SBA.equity.specialPurpose)} on hotels, subject to SBA eligibility`,
    programSlugs: ["sba-504-hotel", "sba-7a-504-hotel-stack", "hotel-cmbs", "pip-bridge"],
  },
  {
    family: "multifamily",
    audience: "Apartment communities of five or more units, plus small investor rentals.",
    fact: `HUD 223(f): up to ${pct(HUD.multifamily.s223f.maxLtv)} LTV, ${HUD.multifamily.s223f.termYears}-year fixed`,
    programSlugs: ["hud-223f-multifamily", "fannie-mae-multifamily", "freddie-mac-multifamily", "multifamily-bridge", "dscr-investor"],
  },
  {
    family: "construction",
    audience: "Ground-up development, heavy renovation and construction-to-permanent loans.",
    fact: `From ${CONSTRUCTION_MARKET.bank.ltc} at banks to ${CONSTRUCTION_MARKET.privateLender.ltc} with private lenders`,
    programSlugs: ["construction-loans", "construction-to-permanent", "hud-221d4", "c-pace"],
  },
  {
    family: "hard-money",
    audience: "Investors who need speed: purchases, fix-and-flip and short-term bridge loans.",
    fact: `${HARD_MONEY_MARKET.term}, sized on the property and your exit`,
    // Fix-and-flip leads: the card's own "Explore" link already opens the hard money hub.
    programSlugs: ["fix-and-flip", "private-bridge", "hard-money"],
    note: "A private lender funds the loan and is the lender of record.",
  },
];

export interface HomeStep {
  title: string;
  body: string;
}

export const HOME_STEPS: readonly HomeStep[] = [
  {
    title: "Share the basics",
    body: "Property type, loan amount, income and timing. The qualifier takes about a minute, or you can talk to an advisor first.",
  },
  {
    title: "We match programs and lenders",
    body: "A licensed advisor reviews your numbers against HUD, SBA, CMBS, agency, bank, debt fund and private lending programs.",
  },
  {
    title: "We package and shop the loan",
    body: "We prepare a lender-ready file and request terms from the lenders most likely to fit your deal.",
  },
  {
    title: "You choose, the lender closes",
    body: "We compare the terms lenders put forward and help you decide. The lender makes the credit decision and funds the loan.",
  },
];

export interface HomeReason {
  title: string;
  body: string;
  /** Adds the DRE lookup link when the corporate license is configured. */
  verifyLicense?: boolean;
}

export const HOME_REASONS: readonly HomeReason[] = [
  {
    title: "More than one lender's credit box",
    body: "HUD, SBA, Fannie Mae, Freddie Mac, CMBS, banks, debt funds and private lenders. We explain which structure fits and why.",
  },
  {
    title: "Specialists in harder assets",
    body: "Senior living, hotels and construction are underwritten on operations and plans, not just the building. We know what those lenders ask for and package it up front.",
  },
  {
    title: "Every cost on the table",
    body: "Our estimates show rate, lender fees, mortgage insurance, third-party costs and our advisory fee as separate lines, so you can compare the all-in cost.",
  },
  {
    title: "Licensed and accountable",
    body: "Kubera Commercial, Inc. is licensed by the California Department of Real Estate. You receive a Mortgage Loan Disclosure Statement on every loan we arrange that is secured by real property.",
    verifyLicense: true,
  },
];

/** An FAQ entry; `link` renders after the answer on the page and is left out of the JSON-LD. */
export type HomeFaqItem = FaqItem & { link?: { href: string; label: string } };

// Owner and counsel to confirm the fee answer. It follows the licensing page's
// "How we are paid" section: borrower-paid, lender-paid or both, and the MLDS
// only on loans secured by real property (an SBA 7(a) on business assets gets none).
export const HOME_FAQ: readonly HomeFaqItem[] = [
  {
    question: "Are you a lender?",
    answer: `No. ${disclosures.brokerNotLender} Because we are not tied to one lender, we can compare programs and terms across many.`,
  },
  {
    question: "How do you get paid?",
    answer:
      "We may be paid an advisory fee by you, compensation from the lender, or both, only as agreed in writing. Our sizer shows our estimated advisory fee as its own line, and on loans secured by real property every amount we receive, including lender-paid compensation, appears on your Mortgage Loan Disclosure Statement.",
    link: { href: "/licensing#compensation", label: "How we are paid" },
  },
  {
    question: "Does starting affect my credit?",
    answer:
      "No. The qualifier asks about the property and the loan, not your Social Security number, and starting does not involve a credit check. If you decide to apply, the lender may check credit with your authorization.",
  },
  {
    question: "What do I need to get started?",
    answer:
      "The property type, the loan amount you have in mind, current or projected income and your timing. An advisor will tell you which documents the lenders that fit your deal will ask for.",
  },
  {
    question: "How long does financing take?",
    answer: `It depends on the program. Private and bridge loans can move in weeks, SBA and agency loans usually take a few months, and HUD loans take longer. ${disclosures.timeline}`,
  },
  {
    question: "Do you handle construction draws or hold loan funds?",
    answer:
      "No. The construction lender funds the loan and administers draws. Kubera has no role in draw requests, inspections or lien waivers, and never holds, transfers or disburses loan funds.",
  },
  {
    question: "Which loan is right for my property?",
    answer:
      "It depends on the asset, its income, your hold period and how fast you need to close. Start with the sizer to compare structures, or send the basics and an advisor will map the options.",
  },
];
