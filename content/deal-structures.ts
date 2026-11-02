// The illustrative debt structures shown on /structures, four of them on the
// home page (HOME_STRUCTURE_SLUGS). They are examples of how a program is
// typically arranged, never closed transactions, and every page that renders
// them carries `disclosures.illustrative`. Program parameters are imported from
// `lib/sizing/assumptions.ts` and `lib/sizing/programs/assumptions.ts` (the
// single sources for underwriting numbers) so these pages cannot drift from the
// sizer. Dollar amounts below are the illustrative loan sizes only.

import { HEADER_CTA, expressHrefFor, sizerLinkFor } from "@/components/site/nav";
import type { ProgramFamily } from "@/content/programs/types";
import { ASSUMPTIONS_REVIEWED, BRIDGE, HUD, SBA } from "@/lib/sizing/assumptions";
import { CONSTRUCTION, HARD_MONEY, PROGRAM_ASSUMPTIONS_REVIEWED } from "@/lib/sizing/programs/assumptions";

export interface StackLine {
  label: string;
  amountUsd: number;
  /** Share of total project or loan cost, 0 to 1. */
  share: number;
  note?: string;
}

export interface StructureFact {
  label: string;
  value: string;
  note?: string;
}

export interface StructureStep {
  title: string;
  body: string;
}

export interface StructureLink {
  href: string;
  label: string;
}

export interface DealStructure {
  slug: string;
  /** Page title without the brand suffix; at most 40 characters so the rendered title fits 60. */
  metaTitle: string;
  /** Illustrative loan or project size in USD. */
  amountUsd: number;
  /** Short display form used on cards, e.g. "$2.5M". */
  amount: string;
  asset: string;
  program: string;
  /** One-sentence summary used on the home card and in metadata. */
  summary: string;
  tags: readonly string[];
  gold?: boolean;
  /** The situation that makes this structure worth considering. */
  situation: string;
  /** Why this arrangement tends to fit that situation. */
  reasons: readonly string[];
  /** Illustrative capital stack when the program has a defined shape. */
  stack?: { title: string; lines: StackLine[]; footnote: string };
  /** Program parameters, each taken from the sizing assumptions. */
  facts: readonly StructureFact[];
  steps: readonly StructureStep[];
  /** What a lender and the advisor would diligence before relying on this structure. */
  watch: readonly string[];
  /** The page's actions. The first is the primary call to action (`actions()`), the rest are secondary. */
  related: readonly StructureLink[];
}

/** Get loan options and Size my loan, both opened on the structure's family, as on every program page. */
function actions(family: ProgramFamily): StructureLink[] {
  return [{ href: expressHrefFor(family), label: HEADER_CTA.label }, sizerLinkFor(family)];
}

/** Percent with up to two decimals, no trailing zeros: 0.0065 -> "0.65%", 0.5 -> "50%". */
const pct = (n: number) => `${Number((n * 100).toFixed(2))}%`;
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function formatUsd(n: number): string {
  return usd(n);
}

export interface Sba504StackInput {
  totalUsd: number;
  /** CDC debenture cap for this project (standard or energy-efficiency). */
  debentureCapUsd: number;
  /** Special-purpose property (hotels, care facilities) needs 5 points more equity. */
  specialPurpose: boolean;
}

/**
 * Typical SBA 504 shape: a bank first lien, a CDC debenture and borrower equity.
 * The debenture takes whatever the first lien and equity leave, up to its cap;
 * any amount above the cap falls to the borrower. Amounts always sum to the total.
 */
export function sba504Stack({ totalUsd, debentureCapUsd, specialPurpose }: Sba504StackInput): StackLine[] {
  const equityShare = SBA.equity.base + (specialPurpose ? SBA.equity.specialPurpose : 0);
  const bank = totalUsd * SBA.bankFirstPct;
  const equity = totalUsd * equityShare;
  const debenture = Math.min(totalUsd - bank - equity, debentureCapUsd);
  const equityTotal = totalUsd - bank - debenture;
  return [
    { label: "Bank first lien", amountUsd: bank, share: bank / totalUsd, note: "Lender of record on the first mortgage" },
    {
      label: "CDC debenture (SBA 504)",
      amountUsd: debenture,
      share: debenture / totalUsd,
      note: `${SBA.cdcAmortYears}-year fixed rate, second lien`,
    },
    { label: "Borrower equity", amountUsd: equityTotal, share: equityTotal / totalUsd, note: specialPurpose ? "Includes the special-purpose property add-on" : undefined },
  ];
}

/** Spread or rate already in percentage points, up to three decimals: 3.125 -> "3.125%". */
const pts = (n: number) => `${Number(n.toFixed(3))}%`;

const SBA_ASSUMPTION_NOTE = `Modeled assumption, reviewed ${ASSUMPTIONS_REVIEWED}; confirm against the SBA SOP in effect at application.`;
const HUD_ASSUMPTION_NOTE = `Modeled on the current HUD handbook, reviewed ${ASSUMPTIONS_REVIEWED}; confirm with a HUD lender.`;
const PROGRAM_NOTE = `Modeled assumption, reviewed ${PROGRAM_ASSUMPTIONS_REVIEWED}; confirm with the lender.`;

const BANK = CONSTRUCTION.boxes.BANK;
const CPACE = CONSTRUCTION.cpace;
const REHAB = HARD_MONEY.grid.FIX_AND_FLIP.EXPERIENCED;
const HM_TERM = `${HARD_MONEY.minTermMonths} to ${HARD_MONEY.maxTermMonths} months`;

const STRUCTURE_LIST: DealStructure[] = [
  {
    slug: "assisted-living-sba-504-refinance",
    metaTitle: "SBA 504 refinance: assisted living",
    amountUsd: 2_500_000,
    amount: "$2.5M",
    asset: "58-bed assisted living",
    program: "SBA 504 refinance",
    summary: "Below HUD's efficient size: 504 avoids six figures of HUD closing costs and the $20k/yr audit.",
    tags: ["25-yr fixed CDC", "Bank 1st", "No HUD audit"],
    situation:
      "An owner-operator of a 58-bed assisted living community wants longer fixed-rate debt on a loan around $2.5 million. That is below the size where HUD's fixed costs usually make sense.",
    reasons: [
      `HUD financing carries third-party reports, legal and title work, and an annual CPA audit (modeled at ${usd(HUD.annualAuditCost)} a year). Below roughly ${usd(HUD.smallLoanThreshold)}, those costs usually outweigh the rate and term advantage.`,
      `An SBA 504 loan pairs a bank first lien with a CDC debenture that carries a fixed rate for ${SBA.cdcAmortYears} years, so the largest slice of the debt is fixed without a HUD audit.`,
      "Care facilities are special-purpose property under 504 rules, so the borrower contributes more equity than on a general-purpose building.",
    ],
    stack: {
      title: "Typical 504 shape at this size",
      lines: sba504Stack({ totalUsd: 2_500_000, debentureCapUsd: SBA.cdcCap, specialPurpose: true }),
      footnote:
        "On a refinance, the borrower's equity is existing equity in the property. SBA's rules for refinancing existing debt, including eligible debt and a required minimum benefit to the borrower, decide whether a given loan fits; the advisor and the CDC confirm eligibility.",
    },
    facts: [
      { label: "First lien share of project", value: pct(SBA.bankFirstPct), note: SBA_ASSUMPTION_NOTE },
      { label: "Debenture amortization", value: `${SBA.cdcAmortYears} years, fixed`, note: SBA_ASSUMPTION_NOTE },
      { label: "Equity, special-purpose property", value: pct(SBA.equity.base + SBA.equity.specialPurpose), note: SBA_ASSUMPTION_NOTE },
      { label: "Debenture ongoing fees", value: pct(SBA.annualDebentureFees), note: "Bundled into the effective debenture rate." },
      { label: "Debenture upfront fees", value: pct(SBA.upfrontDebentureFees), note: "Financed into the debenture." },
      { label: "Modeled HUD annual audit avoided", value: usd(HUD.annualAuditCost), note: HUD_ASSUMPTION_NOTE },
      { label: "Typical SBA timeline", value: SBA.closeRange, note: "After a complete file. Not guaranteed." },
    ],
    steps: [
      { title: "Check whether HUD or 504 fits the size", body: "The advisor compares both on all-in cost, not rate alone, using the loan sizer assumptions." },
      { title: "Line up a bank and a CDC", body: "A bank agrees to the first lien. A Certified Development Company packages the debenture and submits it to SBA." },
      { title: "Underwriting and SBA review", body: "The bank, the CDC and SBA each review the file. Each can ask for more information or change terms." },
      { title: "Closing and funding", body: "The lender funds as lender of record. Kubera does not hold or move loan funds." },
    ],
    watch: [
      "State licensing and the operating history of the community, including any change of operator.",
      "Census and payor mix, because lenders underwrite the cash flow of the operation as well as the real estate.",
      "Whether the existing debt is eligible to be refinanced under SBA's rules.",
      "The prepayment schedule on the debenture, which declines over time.",
    ],
    related: actions("senior-living"),
  },
  {
    slug: "flagged-hotel-sba-504-green-pip",
    metaTitle: "SBA 504 Green hotel acquisition + PIP",
    amountUsd: 14_500_000,
    amount: "$14.5M",
    asset: "110-key flagged hotel + PIP",
    program: "SBA 504 Green $5.5M + Bank 1st",
    summary: "Acquisition with the franchise PIP financed in project cost under the energy-efficiency 504 cap.",
    tags: ["Premium flag", "15% equity", "PIP financed"],
    gold: true,
    situation:
      "A buyer is acquiring a 110-key hotel under a premium franchise flag. The franchisor requires a property improvement plan (PIP), and the buyer wants the PIP funded inside the same financing.",
    reasons: [
      "SBA 504 project cost can include acquisition and eligible improvements, so a PIP that is part of the plan can be financed in the same transaction.",
      `If the project meets SBA's energy-efficiency criteria, the debenture cap rises from ${usd(SBA.cdcCap)} to ${usd(SBA.cdcCapGreen)}, which matters on a project this size.`,
      "Hotels are special-purpose property, so equity is higher than the 504 base. Lenders also look hard at flag, franchise agreement terms and cash flow after the PIP.",
    ],
    stack: {
      title: "Typical 504 shape at this size",
      lines: sba504Stack({ totalUsd: 14_500_000, debentureCapUsd: SBA.cdcCapGreen, specialPurpose: true }),
      footnote: `Debenture shown at the lesser of its share of project cost and the ${usd(SBA.cdcCapGreen)} energy-efficiency cap. A project that does not meet the criteria uses the ${usd(SBA.cdcCap)} cap, and the bank or borrower carries the difference.`,
    },
    facts: [
      { label: "Energy-efficiency debenture cap", value: usd(SBA.cdcCapGreen), note: SBA_ASSUMPTION_NOTE },
      { label: "Standard debenture cap", value: usd(SBA.cdcCap), note: SBA_ASSUMPTION_NOTE },
      { label: "First lien share of project", value: pct(SBA.bankFirstPct), note: SBA_ASSUMPTION_NOTE },
      { label: "Equity, special-purpose property", value: pct(SBA.equity.base + SBA.equity.specialPurpose), note: SBA_ASSUMPTION_NOTE },
      { label: "Minimum DSCR modeled", value: `${SBA.minDscr.toFixed(2)}x`, note: SBA_ASSUMPTION_NOTE },
      { label: "Typical SBA timeline", value: SBA.closeRange, note: "After a complete file. Not guaranteed." },
    ],
    steps: [
      { title: "Scope the PIP and the budget", body: "Collect the franchisor's PIP, contractor bids and an energy-efficiency estimate if the Green cap is the goal." },
      { title: "Build the project cost", body: "Acquisition, PIP, soft costs and fees roll into one project cost that the stack is sized against." },
      { title: "Package for the bank and the CDC", body: "The bank takes the first lien and the CDC submits the debenture to SBA with the franchise agreement and operating history." },
      { title: "Close and complete the PIP", body: "The lender funds as lender of record. The franchisor's PIP deadlines and the lender's conditions both apply." },
    ],
    watch: [
      "Franchise agreement terms, transfer approval and PIP deadlines.",
      "Whether the project documents the energy-efficiency improvement SBA requires for the higher cap.",
      "Trailing revenue per available room and market supply, which lenders read against the flag.",
      "SBA's equity and eligibility rules for acquisitions, which change by SOP revision.",
    ],
    related: actions("hotels"),
  },
  {
    slug: "memory-care-bridge-to-hud",
    metaTitle: "Memory care bridge-to-HUD structure",
    amountUsd: 16_800_000,
    amount: "$16.8M",
    asset: "96-bed memory care",
    program: "Bridge-to-HUD 232/223(f)",
    summary: "Floating bridge through census lease-up, sized for a potential 35-year non-recourse HUD takeout.",
    tags: ["Interest-only", "Non-recourse", "HUD exit"],
    gold: true,
    situation:
      "A 96-bed memory care community has not yet reached the occupancy or operating history HUD requires. The owner needs capital now and wants a path to long-term HUD debt later.",
    reasons: [
      "A floating-rate, interest-only bridge buys time to fill beds and build trailing income that a HUD underwriter can rely on.",
      `The bridge is sized with the takeout in mind: a lender checks that stabilized income could support HUD Section 232 debt (modeled at ${pct(HUD.section232.refi.maxLtv)} LTV and ${HUD.section232.refi.minDscr.toFixed(2)}x DSCR).`,
      `If the exit works, Section 232 loans run up to ${HUD.section232.refi.termYears} years fully amortizing and are non-recourse to the owner, subject to HUD's carve-outs.`,
    ],
    facts: [
      { label: "Bridge max LTV", value: pct(BRIDGE.senior.maxLtv), note: `Modeled assumption, reviewed ${ASSUMPTIONS_REVIEWED}.` },
      { label: "Bridge term", value: `${BRIDGE.senior.termMonths} months`, note: "Interest-only." },
      { label: "Bridge spread", value: `SOFR + ${BRIDGE.senior.spread.toFixed(2)}%`, note: "Indicative; set by the lender." },
      { label: "Bridge min debt yield", value: pct(BRIDGE.senior.minDebtYield) },
      { label: "HUD 232 refinance max LTV", value: pct(HUD.section232.refi.maxLtv), note: HUD_ASSUMPTION_NOTE },
      { label: "HUD 232 refinance min DSCR", value: `${HUD.section232.refi.minDscr.toFixed(2)}x`, note: HUD_ASSUMPTION_NOTE },
      { label: "HUD 232 term", value: `${HUD.section232.refi.termYears} years`, note: HUD_ASSUMPTION_NOTE },
      { label: "HUD 232 annual / upfront MIP", value: `${pct(HUD.section232.refi.annualMip)} / ${pct(HUD.section232.refi.upfrontMip)}`, note: "Modeled at the Section 232 rates; a HUD lender confirms whether the flat 0.25% MIP notice applies." },
      { label: "HUD stabilized occupancy test", value: pct(HUD.section232.stabilizedOccupancy), note: HUD_ASSUMPTION_NOTE },
      { label: "Years since completion for 223(f)", value: `${HUD.section232.minYearsSinceCompletion}`, note: HUD_ASSUMPTION_NOTE },
    ],
    steps: [
      { title: "Underwrite the exit first", body: "The advisor sizes the HUD takeout on stabilized census and expense assumptions, then works backward to the bridge." },
      { title: "Place the bridge", body: "A bridge lender funds as lender of record on a floating, interest-only loan with extension options." },
      { title: "Lease-up and reporting", body: "The operator builds census and trailing financials. The lender tracks them against the plan." },
      { title: "Apply for the HUD loan", body: "A HUD-approved lender submits the application when the property meets HUD's occupancy and history tests. HUD decides." },
    ],
    watch: [
      "Floating-rate exposure and any rate cap the bridge lender requires.",
      "Whether census reaches HUD's stabilized occupancy test before the bridge matures, and what the extension cost is if it does not.",
      "HUD's operator, licensing and environmental requirements, which are separate from the bridge's.",
      "Section 232 premium and loan limits, which change by notice.",
    ],
    related: [...actions("senior-living"), { href: "/financing/bridge-to-hud", label: "How bridge-to-HUD works" }],
  },
  {
    slug: "hotel-to-assisted-living-conversion-bridge",
    metaTitle: "Hotel-to-assisted-living conversion",
    amountUsd: 9_200_000,
    amount: "$9.2M",
    asset: "Boutique hotel → assisted living",
    program: "Conversion bridge · California",
    summary: "Acquisition plus RCFE conversion budget, with licensing and stabilization milestones built in.",
    tags: ["Title 22 RCFE", "Value-add", "HUD 232 path"],
    situation:
      "A California operator wants to buy a boutique hotel and convert it to a residential care facility for the elderly (RCFE). The loan has to cover the purchase and the conversion work, and then carry the property through licensing and lease-up.",
    reasons: [
      "A conversion has no trailing income to underwrite, so a bridge lender sizes on cost and on the plan: purchase price, conversion budget and the operator's experience.",
      `Construction-style bridge loans are modeled at up to ${pct(BRIDGE.construction.maxLtc)} of cost over about ${BRIDGE.construction.termMonths} months, with interest paid from a reserve inside the loan.`,
      "California RCFEs are licensed by the Department of Social Services under Title 22, so licensing milestones belong in the loan timeline from the start.",
    ],
    facts: [
      { label: "Bridge max LTC", value: pct(BRIDGE.construction.maxLtc), note: `Modeled assumption, reviewed ${ASSUMPTIONS_REVIEWED}.` },
      { label: "Bridge term", value: `${BRIDGE.construction.termMonths} months` },
      { label: "Bridge spread", value: `SOFR + ${BRIDGE.construction.spread.toFixed(2)}%`, note: "Indicative; set by the lender." },
      { label: "Min debt yield on cost", value: pct(BRIDGE.construction.minDebtYieldOnCost) },
      { label: "Lender fee / exit fee", value: `${pct(BRIDGE.lenderFeePct)} / ${pct(BRIDGE.exitFeePct)}`, note: "Indicative." },
      { label: "HUD 232 stabilized occupancy test", value: pct(HUD.section232.stabilizedOccupancy), note: HUD_ASSUMPTION_NOTE },
      { label: "HUD 232 refinance max LTV / min DSCR", value: `${pct(HUD.section232.refi.maxLtv)} / ${HUD.section232.refi.minDscr.toFixed(2)}x`, note: HUD_ASSUMPTION_NOTE },
    ],
    steps: [
      { title: "Confirm entitlement and licensing path", body: "Zoning or use-permit approval from the city and the RCFE license path are checked before the purchase closes." },
      { title: "Budget the conversion", body: "Hard and soft costs, contingency and the interest reserve are sized together so the loan covers the whole plan." },
      { title: "Close the bridge", body: "The lender funds as lender of record. Kubera does not hold or move loan funds." },
      { title: "License, lease up and refinance", body: "After licensing and stabilization, the property is re-underwritten for a takeout such as HUD Section 232 or a bank loan." },
    ],
    watch: [
      "Local approvals and fire and life-safety requirements for a change of use.",
      "The RCFE license timeline and the operator's licensing history.",
      "Conversion cost overruns and schedule slippage against the bridge term.",
      "Whether the stabilized property meets the takeout lender's occupancy and income tests.",
    ],
    related: actions("hotels"),
  },
  {
    slug: "multifamily-construction-bank-cpace",
    metaTitle: "Ground-up multifamily: bank + C-PACE",
    amountUsd: 24_000_000,
    amount: "$24M",
    asset: "120-unit ground-up apartments",
    program: "Bank construction loan + C-PACE",
    summary: "A bank construction loan sized on cost, with C-PACE covering qualifying building systems and a permanent loan as the exit.",
    tags: ["Bank 1st", "C-PACE", "Perm takeout"],
    situation:
      "A developer with land and entitlements for a 120-unit apartment project needs construction financing with a clear permanent exit.",
    reasons: [
      `A bank construction loan is usually the lowest-cost senior debt for an experienced developer. It is modeled at up to ${pct(BANK.maxLtc)} of total cost and no more than ${pct(BANK.maxAsCompletedLtv)} of the as-completed value.`,
      `California C-PACE can pay for qualifying energy, water and seismic improvements, modeled at up to ${pct(CPACE.maxPctOfCost)} of project cost at a fixed rate over about ${CPACE.termYears} years. That reduces the equity the developer has to bring, if the bank consents.`,
      `The bank sizes the loan against the permanent exit: stabilized income has to support a ${pct(BANK.minDebtYield)} debt yield and ${BANK.minDscrAtStabilization.toFixed(2)}x DSCR, so the takeout is tested before the construction loan closes.`,
    ],
    facts: [
      { label: "Bank max loan-to-cost", value: pct(BANK.maxLtc), note: PROGRAM_NOTE },
      { label: "Bank max loan-to-value, as completed", value: pct(BANK.maxAsCompletedLtv), note: PROGRAM_NOTE },
      { label: "Bank spread", value: `SOFR + ${pts(BANK.spread)}`, note: "Indicative; set by the lender." },
      { label: "Min debt yield at stabilization", value: pct(BANK.minDebtYield), note: PROGRAM_NOTE },
      { label: "Min DSCR at stabilization", value: `${BANK.minDscrAtStabilization.toFixed(2)}x`, note: PROGRAM_NOTE },
      { label: "C-PACE share of project cost", value: `Up to ${pct(CPACE.maxPctOfCost)}`, note: `Senior lender consent required. ${PROGRAM_NOTE}` },
      { label: "C-PACE term", value: `${CPACE.termYears} years, fixed`, note: PROGRAM_NOTE },
    ],
    steps: [
      { title: "Test the exit first", body: "The advisor sizes the permanent loan on projected stabilized rents and expenses, then works backward to a construction loan the takeout can repay." },
      { title: "Size the budget and reserve", body: "Hard and soft costs, contingency, the developer fee and the interest reserve are budgeted together so the loan, C-PACE and equity cover the whole plan." },
      { title: "Place the construction loan and C-PACE", body: "The bank funds the loan as lender of record and controls every funding during construction. Kubera never holds or moves loan funds." },
      { title: "Lease up and refinance", body: "After completion and lease-up, the property is underwritten for a permanent loan, such as an agency, HUD or bank loan, that repays the construction loan." },
    ],
    watch: [
      "Senior-lender consent to C-PACE, because the assessment is collected with property taxes and ranks ahead of the mortgage.",
      "Cost overruns against the contingency, and who covers them if the contingency runs out.",
      "Floating-rate exposure during construction and the rate cap the bank requires.",
      "Whether lease-up reaches the rents and occupancy the takeout lender needs to pass its DSCR and debt-yield tests.",
    ],
    related: [...actions("construction"), { href: "/financing/construction", label: "Construction loan programs" }],
  },
  {
    slug: "investor-rehab-hard-money",
    metaTitle: "Investor rehab: private hard money loan",
    amountUsd: 2_100_000,
    amount: "$2.1M",
    asset: "8-unit apartment purchase and rehab",
    program: "Private lender · purchase + rehab",
    summary: "Short-term private loan for an investor buying and renovating an 8-unit building, sized on cost and after-repair value.",
    tags: ["Interest-only", "Rehab holdback", "Refi or sale exit"],
    situation:
      "An experienced investor is buying an 8-unit building that needs renovation before it can qualify for a bank or agency loan.",
    reasons: [
      "The building needs work before its income can support a bank or agency loan, so a private lender sizes the loan on the purchase price, the rehab budget and the after-repair value instead.",
      `For an experienced investor, the loan is modeled at up to ${pct(REHAB.maxLtc)} of purchase price plus rehab, capped at ${pct(REHAB.maxLtarv)} of after-repair value.`,
      `Interest-only terms of ${HM_TERM} give time to renovate and lease the units before refinancing into longer-term debt or selling.`,
    ],
    facts: [
      { label: "Max loan-to-cost, purchase + rehab", value: pct(REHAB.maxLtc), note: PROGRAM_NOTE },
      { label: "Max loan-to-after-repair value", value: pct(REHAB.maxLtarv), note: PROGRAM_NOTE },
      { label: "Note rate, experienced investor", value: pts(REHAB.ratePct), note: "Indicative; set by the lender." },
      { label: "Lender points", value: `${REHAB.points} ${REHAB.points === 1 ? "point" : "points"}`, note: PROGRAM_NOTE },
      { label: "Minimum interest", value: `${REHAB.minInterestMonths} months`, note: PROGRAM_NOTE },
      { label: "Exit fee", value: pct(REHAB.exitFeePct), note: PROGRAM_NOTE },
      { label: "Term", value: `${HM_TERM}, interest-only`, note: PROGRAM_NOTE },
    ],
    steps: [
      { title: "Confirm the exit", body: "The advisor checks that renovated rents could support a permanent loan at today's rates, or that a sale would repay the loan and its costs." },
      { title: "Build the rehab budget", body: "Contractor bids, scope and schedule become the rehab budget the lender reviews and inspects against." },
      {
        title: "Close with the private lender",
        body: "The private lender funds the loan as lender of record and holds back the rehab budget, releasing it as work is completed. Kubera never holds or moves loan funds.",
      },
      { title: "Refinance or sell", body: "Once the work is done and the units are leased, a bank, agency or DSCR loan repays the private loan, or the property is sold." },
    ],
    watch: [
      "Minimum-interest, extension and exit fees, which raise the cost if the loan is repaid early or runs long.",
      "The rehab budget against the lender's inspections, which decide when each part of the holdback is released.",
      "Support for the after-repair value from comparable sales and rents.",
      "Whether the permanent loan's DSCR works at today's rates once the units are renovated and leased.",
    ],
    related: [...actions("hard-money"), { href: "/financing/hard-money", label: "Hard money loan programs" }],
  },
];

export const DEAL_STRUCTURES: readonly DealStructure[] = STRUCTURE_LIST;

/** The four structures on the home page, one per kind of borrower: senior living, hotels, construction and hard money. */
export const HOME_STRUCTURE_SLUGS = [
  "memory-care-bridge-to-hud",
  "flagged-hotel-sba-504-green-pip",
  "multifamily-construction-bank-cpace",
  "investor-rehab-hard-money",
] as const;

export function getDealStructure(slug: string): DealStructure | undefined {
  return DEAL_STRUCTURES.find((s) => s.slug === slug);
}

export function structurePath(slug: string): string {
  return `/structures/${slug}`;
}
