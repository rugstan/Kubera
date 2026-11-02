import type { Benchmarks } from "@/lib/rates";
import {
  AGENCY,
  BRIDGE,
  BROKER_FEE_PCT,
  CAP_RATES,
  CMBS,
  HUD,
  SBA,
  SPREADS,
  mid,
  type HudMultifamilyTier,
} from "./assumptions";
import { bindingLimit, debtConstant, round, type Constraint } from "./finance";
import type {
  FeeLine,
  HospitalityInputs,
  MultifamilyInputs,
  ProgramId,
  ProgramQuote,
  Recourse,
  SeniorInputs,
  SizingOptions,
  SizingResult,
  Tranche,
} from "./types";

type QuoteSpec = {
  id: ProgramId;
  name: string;
  short: string;
  requested: number;
  limits: Partial<Record<Constraint, number>>;
  /** Builds tranches for a given total loan amount. */
  tranches: (loan: number) => Tranche[];
  annualFee: (loan: number, tranches: Tranche[]) => FeeLine;
  annualAudit: number;
  closing: (loan: number, tranches: Tranche[]) => FeeLine[];
  noi: number;
  value: number;
  leverageBasis?: "LTV" | "LTC";
  termLabel: string;
  amortLabel: string;
  recourse: Recourse;
  closeTimeline: string;
  advisoryFeePct: number;
  eligible: boolean;
  notes?: string[];
  warnings?: string[];
  equityRequired?: (loan: number) => number;
  accent?: ProgramQuote["accent"];
};

const singleTranche =
  (label: string, ratePct: number, amortYears: number) =>
  (loan: number): Tranche[] => [
    { label, amount: loan, ratePct, amortYears, annualDebtService: loan * debtConstant(ratePct, amortYears) },
  ];

function buildQuote(spec: QuoteSpec): ProgramQuote {
  const { amount, binding } = bindingLimit({ REQUESTED: spec.requested, ...spec.limits });
  const loanAmount = spec.eligible ? round(amount) : 0;
  const tranches = loanAmount > 0 ? spec.tranches(loanAmount) : [];
  const annualPrincipalInterest = tranches.reduce((s, t) => s + t.annualDebtService, 0);
  const annualFee = spec.annualFee(loanAmount, tranches);
  const closingBreakdown = loanAmount > 0 ? spec.closing(loanAmount, tranches).filter((l) => l.amount > 0) : [];
  const closingCosts = closingBreakdown.reduce((s, l) => s + l.amount, 0);
  const annualAudit = loanAmount > 0 ? spec.annualAudit : 0;
  const annualAllIn = annualPrincipalInterest + annualFee.amount + annualAudit;
  const ratePct = loanAmount > 0 ? tranches.reduce((s, t) => s + t.ratePct * t.amount, 0) / loanAmount : 0;
  const warnings = [...(spec.warnings ?? [])];
  if (spec.eligible && loanAmount < spec.requested * 0.98 && loanAmount > 0) {
    warnings.unshift(`Sized below request — ${CONSTRAINT_COPY[binding]} limits proceeds.`);
  }

  return {
    id: spec.id,
    name: spec.name,
    short: spec.short,
    eligible: spec.eligible && loanAmount > 0,
    notes: spec.notes ?? [],
    warnings,
    requested: spec.requested,
    loanAmount,
    binding,
    ratePct,
    termLabel: spec.termLabel,
    amortLabel: spec.amortLabel,
    recourse: spec.recourse,
    tranches,
    monthlyPrincipalInterest: annualPrincipalInterest / 12,
    annualPrincipalInterest,
    annualFee,
    annualAudit,
    closingCosts,
    closingBreakdown,
    annualAllIn,
    allInRatePct: loanAmount > 0 ? (annualAllIn / loanAmount) * 100 : 0,
    dscr: annualPrincipalInterest + annualFee.amount > 0 ? spec.noi / (annualPrincipalInterest + annualFee.amount) : 0,
    ltv: spec.value > 0 ? loanAmount / spec.value : 0,
    leverageBasis: spec.leverageBasis ?? "LTV",
    debtYield: loanAmount > 0 ? spec.noi / loanAmount : 0,
    equityRequired: spec.equityRequired?.(loanAmount),
    closeTimeline: spec.closeTimeline,
    estimatedAdvisoryFee: loanAmount * spec.advisoryFeePct,
    accent: spec.accent,
  };
}

export const CONSTRAINT_COPY: Record<Constraint, string> = {
  REQUESTED: "requested amount",
  LTV: "loan-to-value",
  LTC: "loan-to-cost",
  DSCR: "debt service coverage",
  DEBT_YIELD: "debt yield",
  PROGRAM_CAP: "program maximum",
};

// Interim structures: chosen only when no permanent program covers the request.
const INTERIM: ReadonlySet<ProgramId> = new Set(["BRIDGE_TO_HUD_232", "HOSPITALITY_PIP_BRIDGE", "WHITE_LABEL_CRE_BRIDGE"]);

/**
 * Cost of borrowing per dollar: note rate plus MIP/guarantee fees and audit,
 * with closing costs spread over ten years. Principal is excluded so an
 * interest-only bridge isn't mistaken for cheaper money than amortizing debt.
 */
export function costOfFunds(q: ProgramQuote): number {
  if (q.loanAmount <= 0) return Infinity;
  return q.ratePct / 100 + (q.annualFee.amount + q.annualAudit + q.closingCosts / 10) / q.loanAmount;
}

/** Cheapest permanent program covering ≥95% of the request, else cheapest interim, else the largest proceeds. */
export function pickBestFit(quotes: ProgramQuote[]): ProgramId | null {
  const eligible = quotes.filter((q) => q.eligible);
  if (!eligible.length) return null;
  const full = eligible.filter((q) => q.loanAmount >= q.requested * 0.95);
  const cheapest = (qs: ProgramQuote[]) => qs.reduce((a, b) => (costOfFunds(b) < costOfFunds(a) ? b : a)).id;
  const permanent = full.filter((q) => !INTERIM.has(q.id));
  if (permanent.length) return cheapest(permanent);
  if (full.length) return cheapest(full);
  return eligible.reduce((a, b) => (b.loanAmount > a.loanAmount ? b : a)).id;
}

/** Largest loan ≤ hi whose structure still clears `ok`. Monotone, so bisection is exact to $1k. */
function maxLoanWhere(hi: number, ok: (loan: number) => boolean): number {
  if (hi <= 0) return 0;
  if (ok(hi)) return hi;
  let lo = 0;
  while (hi - lo > 1_000) {
    const m = (lo + hi) / 2;
    if (ok(m)) lo = m;
    else hi = m;
  }
  return lo;
}

// ---------------------------------------------------------------------------
// SBA 504 (+ optional 7(a) stack), shared by senior living and hospitality.

type SbaArgs = {
  project: number;
  requested: number;
  noi: number;
  value: number;
  leverageBasis: "LTV" | "LTC";
  rates: Benchmarks;
  green: boolean;
  newBusiness: boolean;
  nonRecourseOnly: boolean;
  allowStack: boolean;
  warnings?: string[];
  notes?: string[];
};

function sizeSba(a: SbaArgs): ProgramQuote {
  const equityPct = SBA.equity.base + SBA.equity.specialPurpose + (a.newBusiness ? SBA.equity.newBusiness : 0);
  const cdcPct = 1 - equityPct - SBA.bankFirstPct;
  const cdcMax = Math.min(a.project * cdcPct, a.green ? SBA.cdcCapGreen : SBA.cdcCap);
  const bankMax = a.project * SBA.bankFirstPct;
  const maxDebt = a.project * (1 - equityPct);
  const sevenAMax = a.allowStack
    ? Math.max(0, Math.min(maxDebt - bankMax - cdcMax, SBA.sevenACap, SBA.combinedExposureCap - cdcMax))
    : 0;

  const bankRate = a.rates.fiveYear + mid(SPREADS.sbaBankFirst);
  const cdcRate = a.rates.tenYear + mid(SPREADS.sba504Debenture);
  const sevenARate = a.rates.prime + mid(SPREADS.sba7a);

  const tranches = (loan: number): Tranche[] => {
    // Scale proportionally when the request is smaller than a full 50/35 stack.
    const scale = Math.min(1, loan / (bankMax + cdcMax));
    const bank = bankMax * scale;
    const cdc = cdcMax * scale;
    const sevenA = loan > bankMax + cdcMax ? loan - bankMax - cdcMax : 0;
    const t: Tranche[] = [
      { label: "Bank 1st lien", amount: bank, ratePct: bankRate, amortYears: SBA.bankAmortYears, annualDebtService: bank * debtConstant(bankRate, SBA.bankAmortYears) },
      { label: "SBA 504 CDC 2nd (25-yr fixed)", amount: cdc, ratePct: cdcRate, amortYears: SBA.cdcAmortYears, annualDebtService: cdc * debtConstant(cdcRate, SBA.cdcAmortYears) },
    ];
    if (sevenA > 0) {
      t.push({ label: "SBA 7(a) stack (variable)", amount: sevenA, ratePct: sevenARate, amortYears: SBA.sevenAAmortYears, annualDebtService: sevenA * debtConstant(sevenARate, SBA.sevenAAmortYears) });
    }
    return t;
  };
  const fees = (loan: number, t: Tranche[]): FeeLine => {
    const cdc = t[1]?.amount ?? 0;
    const sevenA = t[2]?.amount ?? 0;
    return {
      label: "SBA guarantee & CDC servicing fees",
      amount: cdc * SBA.annualDebentureFees + sevenA * SBA.sevenAGuaranteedShare * SBA.sevenAAnnualServiceFee,
    };
  };
  const dscrOk = (loan: number) => {
    const t = tranches(loan);
    const ds = t.reduce((s, x) => s + x.annualDebtService, 0) + fees(loan, t).amount;
    return a.noi / ds >= SBA.minDscr;
  };
  const cap = bankMax + cdcMax + sevenAMax;
  const dscrLimit = maxLoanWhere(Math.min(cap, a.requested), dscrOk);
  const quote = buildQuote({
    id: "SBA_504_STANDARD",
    name: "SBA 504",
    short: "Owner-operator, 25-yr fixed CDC",
    requested: a.requested,
    limits: { PROGRAM_CAP: cap, DSCR: dscrLimit },
    tranches,
    annualFee: fees,
    annualAudit: 0,
    closing: (loan, t) => [
      { label: "504 debenture fees (financed)", amount: (t[1]?.amount ?? 0) * SBA.upfrontDebentureFees },
      { label: "7(a) upfront guarantee fee", amount: (t[2]?.amount ?? 0) * SBA.sevenAGuaranteedShare * SBA.sevenAUpfrontGuaranteeFee },
      { label: "Bank origination & SBA participation", amount: (t[0]?.amount ?? 0) * (0.005 + SBA.bankParticipationFee) },
      { label: "Appraisal, Phase I, legal", amount: SBA.thirdPartyReports },
      { label: "Corin advisory fee (est.)", amount: loan * BROKER_FEE_PCT.SBA },
    ],
    noi: a.noi,
    value: a.value,
    leverageBasis: a.leverageBasis,
    termLabel: "25-yr fixed CDC · bank 1st 10–25 yr",
    amortLabel: "25 years",
    recourse: "Full recourse (personal guaranty)",
    closeTimeline: SBA.typicalCloseDays,
    advisoryFeePct: BROKER_FEE_PCT.SBA,
    eligible: !a.nonRecourseOnly,
    notes: [
      `${Math.round(equityPct * 100)}% equity injection (special-purpose property${a.newBusiness ? ", new business" : ""}).`,
      "Operating company must occupy ≥51% of the property.",
      ...(a.notes ?? []),
    ],
    warnings: [
      ...(a.nonRecourseOnly ? ["SBA requires personal guaranties from 20%+ owners — outside your non-recourse preference."] : []),
      ...(a.warnings ?? []),
    ],
    equityRequired: (loan) => Math.max(a.project * equityPct, a.project - loan),
    accent: "emerald",
  });
  if (quote.tranches.length > 2) {
    quote.id = "SBA_504_PLUS_7A_10M_STACK";
    quote.name = "SBA 504 + 7(a) Stack";
    quote.short = `Up to $${SBA.combinedExposureCap / 1_000_000}M SBA + bank 1st`;
    quote.accent = "gold";
  }
  return quote;
}

/** Shown whenever a borrower flags green certification on a HUD quote. */
export const GREEN_MIP_NOTE = "Green certification no longer lowers HUD mortgage insurance premiums.";

const hudCommonClosing = (loan: number, upfrontMip: number): FeeLine[] => [
  { label: "Upfront MIP", amount: loan * upfrontMip },
  { label: "Lender financing fee", amount: loan * HUD.lenderFinancingFeePct },
  { label: "HUD application & exam fees", amount: loan * HUD.applicationFeePct },
  { label: "Third-party reports (appraisal, PCNA, ESA)", amount: HUD.thirdPartyReports },
  { label: "Legal, title & organizational", amount: HUD.legalAndTitle },
  { label: "Corin advisory fee (est.)", amount: loan * BROKER_FEE_PCT.HUD },
];

const bridgeClosing = (loan: number, feePct: number): FeeLine[] => [
  { label: "Lender origination", amount: loan * BRIDGE.lenderFeePct },
  { label: "Exit fee (at payoff)", amount: loan * BRIDGE.exitFeePct },
  { label: "Appraisal, legal & title", amount: BRIDGE.fixedCosts },
  { label: "Corin advisory fee (est.)", amount: loan * feePct },
];

const noFee = (label: string) => (): FeeLine => ({ label, amount: 0 });

// ---------------------------------------------------------------------------
// Senior living & care

export function sizeSenior(i: SeniorInputs, rates: Benchmarks): SizingResult {
  const valueEstimated = !i.value;
  const value = i.value || i.noi / CAP_RATES.senior;
  const occ = i.occupancyPct / 100;
  const isNC = i.transaction === "NEW_CONSTRUCTION";
  const quotes: ProgramQuote[] = [];

  // HUD 232 ------------------------------------------------------------------
  {
    const p = isNC ? HUD.section232.newConstruction : HUD.section232.refi;
    const rate = rates.tenYear + mid(SPREADS.hud232) + (isNC ? 0.15 : 0);
    const mip = p.annualMip;
    const constant = debtConstant(rate, p.termYears) + mip;
    const warnings: string[] = [];
    if (i.loanAmount < HUD.smallLoanThreshold)
      warnings.push("Under $3.5M, HUD's fixed costs and $20k/yr audit usually make SBA 504 cheaper.");
    if (i.beds < HUD.section232.practicalMinBeds)
      warnings.push(`Facilities under ~${HUD.section232.practicalMinBeds} licensed beds rarely pencil for HUD 232.`);
    if (!isNC && occ < HUD.section232.stabilizedOccupancy)
      warnings.push("Census below stabilized levels — HUD 223(f) typically needs a bridge to stabilize first.");
    if (!isNC) warnings.push(`Requires ≥${HUD.section232.minYearsSinceCompletion} years since construction completion.`);
    const notes: string[] = [];
    if (i.green && !HUD.greenLowersMip) notes.push(GREEN_MIP_NOTE);

    quotes.push(
      buildQuote({
        id: isNC ? "HUD_232_NEW_CONST" : "HUD_232_223F",
        name: isNC ? "HUD 232 New Construction" : "HUD 232/223(f)",
        short: `${p.termYears}-yr fixed, non-recourse`,
        requested: i.loanAmount,
        limits: {
          [isNC ? "LTC" : "LTV"]: value * ("maxLtc" in p ? p.maxLtc : p.maxLtv),
          DSCR: i.noi / p.minDscr / constant,
        },
        tranches: singleTranche(isNC ? "HUD 232 insured loan" : "HUD 232/223(f) insured loan", rate, p.termYears),
        annualFee: (loan) => ({ label: `Annual MIP (${(mip * 100).toFixed(2)}%)`, amount: loan * mip }),
        annualAudit: HUD.annualAuditCost,
        closing: (loan) => hudCommonClosing(loan, p.upfrontMip),
        noi: i.noi,
        value,
        leverageBasis: isNC ? "LTC" : "LTV",
        termLabel: isNC ? "Construction + 40 yrs fixed" : "35 yrs fixed",
        amortLabel: `${p.termYears} years, fully amortizing`,
        recourse: "Non-recourse",
        closeTimeline: isNC ? "9–12 months after a complete file; not guaranteed" : "120–180 days (LEAN) after a complete file; not guaranteed",
        advisoryFeePct: BROKER_FEE_PCT.HUD,
        eligible: isNC || occ >= 0.8,
        notes,
        warnings,
        accent: "gold",
      }),
    );
  }

  // SBA 504 --------------------------------------------------------------------
  quotes.push(
    sizeSba({
      project: value,
      requested: i.loanAmount,
      noi: i.noi,
      value,
      leverageBasis: isNC ? "LTC" : "LTV",
      rates,
      green: i.green,
      newBusiness: isNC,
      nonRecourseOnly: i.nonRecourseOnly,
      allowStack: true,
      notes: i.facilityType === "SNF" ? ["SNF operators: Medicare/Medicaid cost reports reviewed in underwriting."] : [],
    }),
  );

  // Bridge-to-HUD ------------------------------------------------------------
  {
    const b = BRIDGE.senior;
    const rate = rates.sofr30 + b.spread;
    quotes.push(
      buildQuote({
        id: "BRIDGE_TO_HUD_232",
        name: "Bridge-to-HUD",
        short: `${b.termMonths}-mo interest-only, HUD takeout`,
        requested: i.loanAmount,
        limits: { [isNC ? "LTC" : "LTV"]: value * b.maxLtv, DEBT_YIELD: i.noi / b.minDebtYield },
        tranches: singleTranche("Floating bridge (SOFR + spread)", rate, 0),
        annualFee: noFee("No MIP or guarantee fee"),
        annualAudit: 0,
        closing: (loan) => bridgeClosing(loan, BROKER_FEE_PCT.BRIDGE),
        noi: i.noi,
        value,
        termLabel: `${b.termMonths} months + extensions`,
        amortLabel: "Interest-only",
        recourse: "Non-recourse (standard carve-outs)",
        closeTimeline: "21–45 days after a complete file; not guaranteed",
        advisoryFeePct: BROKER_FEE_PCT.BRIDGE,
        eligible: !isNC,
        notes: ["Refinance into HUD 232/223(f) once census and T-12 stabilize."],
        warnings: isNC ? ["Ground-up care facilities need construction debt, not bridge."] : [],
      }),
    );
  }

  const metrics = [
    { label: "NOI / bed", value: usd(i.beds ? i.noi / i.beds : 0) },
    { label: "Value / bed", value: usd(i.beds ? value / i.beds : 0) },
    { label: "Occupied beds", value: `${Math.round(i.beds * occ)} of ${i.beds}` },
  ];
  return { quotes, bestFit: pickBestFit(quotes), value, valueEstimated, metrics };
}

// ---------------------------------------------------------------------------
// Hospitality & hotels

export function sizeHospitality(i: HospitalityInputs, rates: Benchmarks): SizingResult {
  const valueEstimated = !i.value;
  const value = i.value || i.noi / CAP_RATES.hotel[i.tier];
  const isConstruction = i.transaction === "CONSTRUCTION";
  const project = value + i.pipBudget;
  const occ = i.occupancyPct / 100;
  const revpar = i.adr * occ;
  const roomsRevenue = revpar * i.keys * 365;
  const quotes: ProgramQuote[] = [];

  quotes.push(
    sizeSba({
      project,
      requested: i.loanAmount,
      noi: i.noi,
      value: project,
      leverageBasis: isConstruction || i.pipBudget > 0 ? "LTC" : "LTV",
      rates,
      green: i.green,
      newBusiness: isConstruction,
      nonRecourseOnly: i.nonRecourseOnly,
      allowStack: true,
      notes: i.pipBudget > 0 ? ["PIP budget is financed in the project cost."] : [],
      warnings: i.tier !== "BOUTIQUE_INDEPENDENT" ? ["Franchisor comfort letter required at closing."] : [],
    }),
  );

  {
    const rate = rates.tenYear + mid(SPREADS.hotelCmbs) + (i.tier === "PREMIUM_FLAG" ? -0.25 : 0.25);
    const constant = debtConstant(rate, CMBS.amortYears);
    const minDy = CMBS.minDebtYield[i.tier];
    const warnings: string[] = [];
    if (i.loanAmount < CMBS.minLoan) warnings.push("Conduit lenders typically start at $5M.");
    if (i.pipBudget > 0) warnings.push("Outstanding PIP must be completed or fully reserved at closing.");
    if (isConstruction) warnings.push("CMBS requires a stabilized, operating hotel.");
    quotes.push(
      buildQuote({
        id: "HOSPITALITY_CMBS_NON_RECOURSE",
        name: "Hotel CMBS",
        short: "10-yr fixed, non-recourse",
        requested: i.loanAmount,
        limits: { LTV: value * CMBS.maxLtv, DEBT_YIELD: i.noi / minDy, DSCR: i.noi / CMBS.minDscr / constant },
        tranches: singleTranche("Conduit fixed-rate loan", rate, CMBS.amortYears),
        annualFee: noFee("No guarantee fee"),
        annualAudit: 0,
        closing: (loan) => [
          { label: "Lender origination", amount: loan * CMBS.originationPct },
          { label: "Reports, legal, rating-agency costs", amount: CMBS.fixedCosts },
          { label: "Corin advisory fee (est.)", amount: loan * BROKER_FEE_PCT.CMBS },
        ],
        noi: i.noi,
        value,
        termLabel: "10 yrs fixed · defeasance",
        amortLabel: "30 years",
        recourse: "Non-recourse (standard carve-outs)",
        closeTimeline: "60–90 days after a complete file; not guaranteed",
        advisoryFeePct: BROKER_FEE_PCT.CMBS,
        eligible: !isConstruction && i.loanAmount >= CMBS.minLoan,
        warnings,
        accent: i.loanAmount >= 20_000_000 ? "gold" : undefined,
      }),
    );
  }

  {
    const b = BRIDGE.hotelPip;
    const rate = rates.sofr30 + b.spread + (i.tier === "BOUTIQUE_INDEPENDENT" ? 0.5 : 0);
    quotes.push(
      buildQuote({
        id: "HOSPITALITY_PIP_BRIDGE",
        name: "PIP Bridge",
        short: `${b.termMonths}-mo IO with PIP holdback`,
        requested: i.loanAmount,
        limits: { LTC: project * b.maxLtc, DEBT_YIELD: i.noi / b.minDebtYield },
        tranches: singleTranche("Floating bridge incl. PIP holdback", rate, 0),
        annualFee: noFee("No guarantee fee"),
        annualAudit: 0,
        closing: (loan) => bridgeClosing(loan, BROKER_FEE_PCT.BRIDGE),
        noi: i.noi,
        value: project,
        leverageBasis: "LTC",
        termLabel: `${b.termMonths} months + extensions`,
        amortLabel: "Interest-only",
        recourse: "Non-recourse (standard carve-outs)",
        closeTimeline: BRIDGE.closeDays,
        advisoryFeePct: BROKER_FEE_PCT.BRIDGE,
        eligible: !isConstruction,
        notes: ["Exit to CMBS or SBA once the PIP is complete and RevPAR stabilizes."],
        warnings: isConstruction ? ["Ground-up hotels: see SBA 504 construction or a construction lender."] : [],
      }),
    );
  }

  const metrics = [
    { label: "RevPAR", value: usd(revpar, 2) },
    { label: "Rooms revenue", value: usd(roomsRevenue) },
    { label: "NOI / key", value: usd(i.keys ? i.noi / i.keys : 0) },
    { label: "Value / key", value: usd(i.keys ? value / i.keys : 0) },
  ];
  return { quotes, bestFit: pickBestFit(quotes), value, valueEstimated, metrics };
}

// ---------------------------------------------------------------------------
// HUD multifamily boxes (223(f) and 221(d)(4))

export type HudMultifamilyBox = {
  program: "223F" | "221D4";
  tier: HudMultifamilyTier;
  leverageBasis: "LTV" | "LTC";
  maxLeverage: number;
  minDscr: number;
  termYears: number;
  annualMip: number;
  upfrontMip: number;
};

export const HUD_TIER_LABEL: Record<HudMultifamilyTier, string> = {
  MARKET_RATE: "Market-rate",
  AFFORDABLE: "Affordable",
  RENTAL_ASSISTANCE: "Rental-assistance",
  MIDDLE_INCOME: "Middle-income",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "2025-10-01" → "Oct 1, 2025". Pure string formatting, so it is safe in prerendered and client code. */
export function isoDateLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}, ${y}`;
}

const HUD_MIP_EFFECTIVE_LABEL = isoDateLabel(HUD.multifamily.mip.effectiveForApplicationsOnOrAfter);

function pctLabel(n: number, digits = 0): string {
  return `${(n * 100).toFixed(digits)}%`;
}

/**
 * Which HUD multifamily box a deal falls in. Rental assistance and affordable
 * share the affordable box; the 221(d)(4) middle-income tier applies only to
 * new construction and only when the tier is switched on.
 */
export function hudMultifamilyTier(
  i: Pick<MultifamilyInputs, "affordable" | "rentalAssistance" | "middleIncome" | "transaction">,
  options: SizingOptions = {},
): { tier: HudMultifamilyTier; warnings: string[] } {
  if (i.rentalAssistance) return { tier: "RENTAL_ASSISTANCE", warnings: [] };
  if (i.affordable) return { tier: "AFFORDABLE", warnings: [] };
  if (i.middleIncome) {
    const enabled = options.middleIncomeTier ?? HUD.multifamily.middleIncome221d4.enabled;
    if (i.transaction !== "CONSTRUCTION")
      return { tier: "MARKET_RATE", warnings: ["The middle-income tier applies to 221(d)(4) new construction only; sized on the market-rate box."] };
    if (!enabled)
      return { tier: "MARKET_RATE", warnings: ["The 221(d)(4) middle-income tier is not yet confirmed with a HUD lender; sized on the market-rate box."] };
    return { tier: "MIDDLE_INCOME", warnings: [] };
  }
  return { tier: "MARKET_RATE", warnings: [] };
}

/**
 * Max leverage, min DSCR and MIP for a HUD multifamily program and tier. MIP is
 * flat across tiers; green has no effect. A 223(f) cash-out refinance stays
 * capped at the cash-out LTV (80%) whatever the tier allows.
 */
export function hudMultifamilyBox(construction: boolean, tier: HudMultifamilyTier, cashOutRefinance = false): HudMultifamilyBox {
  const { mip } = HUD.multifamily;
  const fees = { annualMip: mip.annual, upfrontMip: mip.upfront };
  if (construction) {
    const p = HUD.multifamily.s221d4;
    const mi = HUD.multifamily.middleIncome221d4;
    const [maxLeverage, minDscr] =
      tier === "AFFORDABLE" || tier === "RENTAL_ASSISTANCE"
        ? [p.maxLtcAffordable, p.minDscrAffordable]
        : tier === "MIDDLE_INCOME"
          ? [mi.maxLtc, mi.minDscr]
          : [p.maxLtc, p.minDscr];
    return { program: "221D4", tier, leverageBasis: "LTC", maxLeverage, minDscr, termYears: p.termYears, ...fees };
  }
  const p = HUD.multifamily.s223f;
  // The middle-income tier is a 221(d)(4) rule; 223(f) falls back to market-rate.
  const effective: HudMultifamilyTier = tier === "MIDDLE_INCOME" ? "MARKET_RATE" : tier;
  const affordable = effective === "AFFORDABLE" || effective === "RENTAL_ASSISTANCE";
  return {
    program: "223F",
    tier: effective,
    leverageBasis: "LTV",
    maxLeverage: cashOutRefinance ? Math.min(affordable ? p.maxLtvAffordable : p.maxLtv, p.cashOutMaxLtv) : affordable ? p.maxLtvAffordable : p.maxLtv,
    minDscr: affordable ? p.minDscrAffordable : p.minDscr,
    termYears: p.termYears,
    ...fees,
  };
}

// ---------------------------------------------------------------------------
// Multifamily, mixed-use & commercial

export function sizeMultifamily(i: MultifamilyInputs, rates: Benchmarks, options: SizingOptions = {}): SizingResult {
  const isConstruction = i.transaction === "CONSTRUCTION";
  const cap = i.assetType === "MULTIFAMILY" ? CAP_RATES.multifamily : i.assetType === "MIXED_USE" ? CAP_RATES.mixedUse : CAP_RATES.commercial;
  const valueEstimated = !i.value;
  const value = i.value || i.noi / cap;
  const cost = i.totalCost || value * 0.82;
  const residential = i.assetType !== "COMMERCIAL";
  const quotes: ProgramQuote[] = [];

  {
    const { tier, warnings: tierWarnings } = hudMultifamilyTier(i, options);
    const cashOutRefinance = !isConstruction && i.transaction === "REFINANCE" && Boolean(i.cashOut);
    const box = hudMultifamilyBox(isConstruction, tier, cashOutRefinance);
    const rate = rates.tenYear + mid(SPREADS.hudMultifamily) + (isConstruction ? 0.15 : 0);
    const warnings: string[] = [...tierWarnings];
    if (!residential) warnings.push("HUD multifamily programs require a residential asset.");
    if (i.assetType === "MIXED_USE") warnings.push("Commercial space is capped by HUD (typically ≤25% of NRA).");
    if (i.loanAmount < HUD.smallLoanThreshold) warnings.push("Under $3.5M, HUD's fixed costs weigh heavily on all-in cost.");
    if (!isConstruction) warnings.push("223(f) requires ≥3 years since completion and stabilized occupancy.");
    const notes = [
      `${HUD_TIER_LABEL[tier]} box: ${pctLabel(box.maxLeverage)} ${box.leverageBasis}, ${box.minDscr.toFixed(2)}x DSCR.`,
      `Flat ${pctLabel(box.annualMip, 2)} annual MIP for applications submitted on or after ${HUD_MIP_EFFECTIVE_LABEL}.`,
      ...(cashOutRefinance ? [`Cash-out refinances stay capped at ${pctLabel(HUD.multifamily.s223f.cashOutMaxLtv)} LTV.`] : []),
      ...(i.green && !HUD.greenLowersMip ? [GREEN_MIP_NOTE] : []),
    ];
    quotes.push(
      buildQuote({
        id: "HUD_221D4_223F_MULTIFAMILY",
        name: isConstruction ? "HUD 221(d)(4)" : "HUD 223(f)",
        short: `${box.termYears}-yr fixed, non-recourse`,
        requested: i.loanAmount,
        limits: {
          [box.leverageBasis]: (isConstruction ? cost : value) * box.maxLeverage,
          DSCR: i.noi / box.minDscr / (debtConstant(rate, box.termYears) + box.annualMip),
        },
        tranches: singleTranche(isConstruction ? "HUD 221(d)(4) insured loan" : "HUD 223(f) insured loan", rate, box.termYears),
        annualFee: (loan) => ({ label: `Annual MIP (${(box.annualMip * 100).toFixed(2)}%)`, amount: loan * box.annualMip }),
        annualAudit: HUD.annualAuditCost,
        closing: (loan) => hudCommonClosing(loan, box.upfrontMip),
        noi: i.noi,
        value: isConstruction ? cost : value,
        leverageBasis: box.leverageBasis,
        termLabel: isConstruction ? "Construction + 40 yrs fixed" : "35 yrs fixed",
        amortLabel: `${box.termYears} years, fully amortizing`,
        recourse: "Non-recourse",
        closeTimeline: isConstruction ? "8–12 months after a complete file; not guaranteed" : "120–180 days after a complete file; not guaranteed",
        advisoryFeePct: BROKER_FEE_PCT.HUD,
        eligible: residential,
        notes,
        warnings,
        accent: "gold",
      }),
    );
  }

  {
    const rate = rates.tenYear + mid(SPREADS.agency) - (i.green ? AGENCY.greenRateDiscountPct : 0);
    const warnings: string[] = [];
    if (!residential) warnings.push("Agency debt is for multifamily housing only.");
    if (isConstruction) warnings.push("Agency lenders need a stabilized asset — pair with construction debt first.");
    quotes.push(
      buildQuote({
        id: "AGENCY_FANNIE_FREDDIE",
        name: "Agency (Fannie / Freddie)",
        short: "10-yr fixed, non-recourse",
        requested: i.loanAmount,
        limits: { LTV: value * AGENCY.maxLtv, DSCR: i.noi / AGENCY.minDscr / debtConstant(rate, AGENCY.amortYears) },
        tranches: singleTranche("Agency fixed-rate loan", rate, AGENCY.amortYears),
        annualFee: noFee("Guarantee fee embedded in rate"),
        annualAudit: 0,
        closing: (loan) => [
          { label: "Lender origination", amount: loan * AGENCY.originationPct },
          { label: "Reports, legal & title", amount: AGENCY.fixedCosts },
          { label: "Corin advisory fee (est.)", amount: loan * BROKER_FEE_PCT.AGENCY },
        ],
        noi: i.noi,
        value,
        termLabel: "5–30 yrs fixed (10 shown)",
        amortLabel: "30 years",
        recourse: "Non-recourse (standard carve-outs)",
        closeTimeline: "45–60 days after a complete file; not guaranteed",
        advisoryFeePct: BROKER_FEE_PCT.AGENCY,
        eligible: residential && !isConstruction,
        warnings,
      }),
    );
  }

  {
    const b = isConstruction ? BRIDGE.construction : BRIDGE.cre;
    const rate = rates.sofr30 + b.spread;
    quotes.push(
      buildQuote({
        id: "WHITE_LABEL_CRE_BRIDGE",
        name: isConstruction ? "Private Construction" : "Private Bridge",
        short: `${b.termMonths}-mo interest-only, private lender`,
        requested: i.loanAmount,
        limits: isConstruction
          ? { LTC: cost * BRIDGE.construction.maxLtc, DEBT_YIELD: i.noi / BRIDGE.construction.minDebtYieldOnCost }
          : { LTV: value * BRIDGE.cre.maxLtv, DEBT_YIELD: i.noi / BRIDGE.cre.minDebtYield },
        tranches: singleTranche(isConstruction ? "Construction loan (SOFR + spread)" : "Bridge loan (SOFR + spread)", rate, 0),
        annualFee: noFee("No guarantee fee"),
        annualAudit: 0,
        closing: (loan) => bridgeClosing(loan, BROKER_FEE_PCT.BRIDGE),
        noi: i.noi,
        value: isConstruction ? cost : value,
        leverageBasis: isConstruction ? "LTC" : "LTV",
        termLabel: `${b.termMonths} months + extensions`,
        amortLabel: "Interest-only",
        recourse: "Non-recourse (standard carve-outs)",
        closeTimeline: BRIDGE.closeDays,
        advisoryFeePct: BROKER_FEE_PCT.BRIDGE,
        eligible: true,
        notes: ["Arranged by Corin as broker; the private lender funds at closing and is the lender of record."],
        warnings: i.loanAmount > 25_000_000 ? ["Above the typical $25M private-bridge range — usually syndicated with a debt fund."] : [],
      }),
    );
  }

  const metrics = [
    { label: i.assetType === "COMMERCIAL" ? "NOI / sq ft" : "NOI / unit", value: usd(i.assetType === "COMMERCIAL" ? (i.sqft ? i.noi / i.sqft : 0) : i.units ? i.noi / i.units : 0, i.assetType === "COMMERCIAL" ? 2 : 0) },
    { label: i.assetType === "COMMERCIAL" ? "Value / sq ft" : "Value / unit", value: usd(i.assetType === "COMMERCIAL" ? (i.sqft ? value / i.sqft : 0) : i.units ? value / i.units : 0) },
    { label: "Implied cap rate", value: `${((i.noi / value) * 100).toFixed(2)}%` },
  ];
  return { quotes, bestFit: pickBestFit(quotes), value, valueEstimated, metrics };
}

export function usd(n: number, digits = 0): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits, minimumFractionDigits: digits });
}
