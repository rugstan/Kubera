// Hard money underwriting file (hm_underwriting): after-repair value, scope of
// work, sponsor track record and exit plan, checked against the hard money
// grid in lib/sizing/programs/assumptions.ts. Kubera presents the file to the
// private lender, which funds as lender of record, holds any rehab holdback
// and administers it; nothing here schedules or releases rehab funds.

import { z } from "zod";
import { HARD_MONEY } from "@/lib/sizing/programs/assumptions";
import { hardMoneyTier } from "@/lib/sizing/programs/hardMoney";

const money = z.number().finite().min(0).max(1e10);

export const scopeLineSchema = z.object({
  category: z.enum(["demolition", "structural", "roof", "exterior", "mechanical", "electrical", "plumbing", "interior", "kitchen_bath", "site_work", "permits_fees", "other"]),
  description: z.string().trim().min(2).max(500),
  cost: money,
  /** Weeks this line takes in the rehab schedule. */
  weeks: z.number().int().min(0).max(156).optional(),
  /** Requires a licensed contractor (CSLB) rather than owner labor. */
  licensedTrade: z.boolean().default(false),
});
export type ScopeLine = z.infer<typeof scopeLineSchema>;

export const trackRecordSchema = z.object({
  address: z.string().trim().min(3).max(300),
  strategy: z.enum(["fix_and_flip", "bridge", "ground_up", "buy_and_hold"]),
  purchaseDate: z.iso.date(),
  purchasePrice: money,
  rehabCost: money,
  exitDate: z.iso.date().optional(),
  exitType: z.enum(["sold", "refinanced", "held", "in_progress"]),
  exitValue: money.optional(),
  role: z.enum(["sponsor", "co_sponsor", "contractor", "lp"]),
  verified: z.boolean().default(false),
});
export type TrackRecordEntry = z.infer<typeof trackRecordSchema>;

export const exitPlanSchema = z.object({
  type: z.enum(["sale", "refinance"]),
  targetMonths: z.number().int().min(1).max(60),
  /** Sale exit: expected price (usually the ARV). */
  expectedSalePrice: money.optional(),
  /** Refinance exit: take-out program and expected loan. */
  refinanceProgram: z.string().trim().max(120).optional(),
  refinanceLoanAmount: money.optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type ExitPlan = z.infer<typeof exitPlanSchema>;

export const hmUnderwritingSchema = z.object({
  dealId: z.uuid(),
  strategy: z.enum(["FIX_AND_FLIP", "BRIDGE"]),
  purpose: z.enum(["PURCHASE", "REFINANCE"]),
  purchasePrice: money,
  asIsValue: money,
  arv: money,
  arvSource: z.enum(["appraisal", "bpo", "comparable_sales", "sponsor_estimate"]),
  requestedLoanAmount: money,
  contingencyPct: z.number().min(0).max(50),
  scopeOfWork: z.array(scopeLineSchema).max(200),
  trackRecord: z.array(trackRecordSchema).max(200),
  exitPlan: exitPlanSchema,
  notes: z.string().trim().max(4000).optional(),
});
export type HmUnderwritingInput = z.input<typeof hmUnderwritingSchema>;
export type HmUnderwritingData = z.output<typeof hmUnderwritingSchema>;

export type HmUnderwriting = HmUnderwritingData & {
  id: string;
  metrics: HmMetrics;
  preparedBy: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type HmMetrics = {
  rehabBudget: number;
  contingency: number;
  totalCost: number;
  /** Completed comparable projects in the last 36 months. */
  completedProjects: number;
  verifiedProjects: number;
  tier: ReturnType<typeof hardMoneyTier>;
  asIsLtv: number;
  ltc: number;
  ltarv: number;
  limits: { maxLtc: number; maxLtarv: number };
  /** Largest loan the grid supports on cost and ARV. */
  maxLoan: number;
  rehabWeeks: number;
  needsLicensedContractor: boolean;
  flags: string[];
};

const MONTHS_36 = 36 * 30.44 * 86_400_000;
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

export function hmMetrics(d: HmUnderwritingData, now: Date): HmMetrics {
  const rehabBudget = d.scopeOfWork.reduce((s, l) => s + l.cost, 0);
  const contingency = rehabBudget * (d.contingencyPct / 100);
  const basis = d.purpose === "PURCHASE" ? d.purchasePrice : d.asIsValue;
  const totalCost = basis + rehabBudget + contingency;
  const recent = d.trackRecord.filter((t) => t.exitType !== "in_progress" && t.exitDate && now.getTime() - Date.parse(`${t.exitDate}T00:00:00Z`) <= MONTHS_36 && (t.role === "sponsor" || t.role === "co_sponsor"));
  const completedProjects = recent.length;
  const verifiedProjects = recent.filter((t) => t.verified).length;
  // The tier is set by verified experience; unverified projects are shown but do not count.
  const tier = hardMoneyTier(verifiedProjects);
  const grid = HARD_MONEY.grid[d.strategy][tier];
  const loan = d.requestedLoanAmount;
  const asIsLtv = d.asIsValue > 0 ? r4(loan / d.asIsValue) : 0;
  const ltc = totalCost > 0 ? r4(loan / totalCost) : 0;
  const ltarv = d.arv > 0 ? r4(loan / d.arv) : 0;
  const maxLoan = Math.floor(Math.min(totalCost * grid.maxLtc, d.arv * grid.maxLtarv, HARD_MONEY.maxLoan) / 1000) * 1000;
  const rehabWeeks = d.scopeOfWork.reduce((s, l) => s + (l.weeks ?? 0), 0);
  const needsLicensedContractor = d.scopeOfWork.some((l) => l.licensedTrade);

  const flags: string[] = [];
  if (ltc > grid.maxLtc) flags.push(`Loan-to-cost ${(ltc * 100).toFixed(1)}% is above the ${(grid.maxLtc * 100).toFixed(0)}% limit for this sponsor tier.`);
  if (ltarv > grid.maxLtarv) flags.push(`Loan-to-ARV ${(ltarv * 100).toFixed(1)}% is above the ${(grid.maxLtarv * 100).toFixed(0)}% limit for this sponsor tier.`);
  if (loan < HARD_MONEY.minLoan) flags.push(`Loan is below the ${HARD_MONEY.minLoan.toLocaleString("en-US")} program minimum.`);
  if (d.arv < basis + rehabBudget) flags.push("After-repair value is below purchase price plus rehab: the project loses money before costs.");
  if (d.arvSource === "sponsor_estimate") flags.push("ARV is the sponsor's estimate; the lender of record will order its own valuation.");
  if (d.scopeOfWork.length === 0 && d.strategy === "FIX_AND_FLIP") flags.push("Fix-and-flip file has no scope of work.");
  if (d.contingencyPct < 10 && rehabBudget > 0) flags.push("Contingency under 10% of the rehab budget.");
  if (completedProjects > verifiedProjects) flags.push(`${completedProjects - verifiedProjects} track-record project(s) not yet verified (closing statements or deeds).`);
  if (d.exitPlan.targetMonths > HARD_MONEY.maxTermMonths) flags.push(`Exit in ${d.exitPlan.targetMonths} months is beyond the ${HARD_MONEY.maxTermMonths}-month maximum term.`);
  if (rehabWeeks / 4.345 > d.exitPlan.targetMonths) flags.push("Rehab schedule runs past the planned exit.");
  if (d.exitPlan.type === "sale") {
    const price = d.exitPlan.expectedSalePrice ?? d.arv;
    const net = price * (1 - HARD_MONEY.sellingCostPct);
    const margin = price > 0 ? (net - totalCost) / price : 0;
    if (margin < HARD_MONEY.minFlipMarginPct) flags.push(`Projected sale margin ${(margin * 100).toFixed(1)}% is under the ${(HARD_MONEY.minFlipMarginPct * 100).toFixed(0)}% lenders look for.`);
  } else {
    if (!d.exitPlan.refinanceProgram) flags.push("Refinance exit has no take-out program.");
    if ((d.exitPlan.refinanceLoanAmount ?? 0) < loan) flags.push("Expected refinance loan does not repay this loan.");
  }

  return { rehabBudget, contingency, totalCost, completedProjects, verifiedProjects, tier, asIsLtv, ltc, ltarv, limits: { maxLtc: grid.maxLtc, maxLtarv: grid.maxLtarv }, maxLoan, rehabWeeks, needsLicensedContractor, flags };
}
