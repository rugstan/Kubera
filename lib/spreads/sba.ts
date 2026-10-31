// SBA global cash flow: the business's cash flow available for debt service
// plus each guarantor's personal surplus, over business and personal debt
// service combined.

import { SBA_GLOBAL } from "./assumptions";

export type BusinessCashFlowInput = {
  netIncome: number;
  depreciation?: number;
  amortization?: number;
  /** Interest on debt being refinanced or serviced (added back; the debt service is counted below). */
  interestExpense?: number;
  /** One-time expenses the lender agrees to add back. */
  nonRecurringAddBacks?: number;
  /** Owner distributions the business cannot retain. */
  distributions?: number;
};

export type GuarantorCashFlow = {
  label: string;
  salary?: number;
  otherIncome?: number;
  /** Annual personal debt service (mortgage, auto, cards). */
  personalDebtService?: number;
  /** Annual living expenses; the default allowance applies when omitted. */
  livingExpenses?: number;
  /** Personal income taxes. */
  taxes?: number;
};

export type GlobalCashFlowInput = {
  business: BusinessCashFlowInput;
  /** Business debt service: existing debt that stays plus the proposed SBA loan(s). */
  businessDebtService: { existing: number; proposed: number };
  guarantors: GuarantorCashFlow[];
  minDscr?: number;
};

export type GlobalCashFlowResult = {
  businessCashFlow: number;
  businessDebtService: number;
  businessDscr: number;
  guarantors: { label: string; income: number; expenses: number; debtService: number; surplus: number; livingExpenseDefaulted: boolean }[];
  personalSurplus: number;
  globalCashFlow: number;
  globalDebtService: number;
  globalDscr: number;
  meetsMinimum: boolean;
  meetsSopMinimum: boolean;
  flags: string[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

export function globalCashFlow(input: GlobalCashFlowInput): GlobalCashFlowResult {
  const b = input.business;
  const flags: string[] = [];
  const businessCashFlow =
    b.netIncome + (b.depreciation ?? 0) + (b.amortization ?? 0) + (b.interestExpense ?? 0) + (b.nonRecurringAddBacks ?? 0) - (b.distributions ?? 0);
  const businessDebtService = input.businessDebtService.existing + input.businessDebtService.proposed;
  const guarantors = input.guarantors.map((g) => {
    const defaulted = g.livingExpenses === undefined;
    if (defaulted) flags.push(`living_expenses_defaulted:${g.label}`);
    const income = (g.salary ?? 0) + (g.otherIncome ?? 0);
    const expenses = (g.livingExpenses ?? SBA_GLOBAL.defaultLivingExpenses) + (g.taxes ?? 0);
    const debtService = g.personalDebtService ?? 0;
    return { label: g.label, income: r2(income), expenses: r2(expenses), debtService: r2(debtService), surplus: r2(income - expenses), livingExpenseDefaulted: defaulted };
  });
  const personalSurplus = guarantors.reduce((s, g) => s + g.surplus, 0);
  const personalDebt = guarantors.reduce((s, g) => s + g.debtService, 0);
  const globalCF = businessCashFlow + personalSurplus;
  const globalDS = businessDebtService + personalDebt;
  const businessDscr = businessDebtService > 0 ? businessCashFlow / businessDebtService : 0;
  const globalDscr = globalDS > 0 ? globalCF / globalDS : 0;
  const min = input.minDscr ?? SBA_GLOBAL.minDscr;
  if (businessDscr < SBA_GLOBAL.sopMinDscr) flags.push("business_dscr_below_sop_minimum");
  if (personalSurplus < 0) flags.push("guarantor_personal_deficit");
  return {
    businessCashFlow: r2(businessCashFlow),
    businessDebtService: r2(businessDebtService),
    businessDscr: r4(businessDscr),
    guarantors,
    personalSurplus: r2(personalSurplus),
    globalCashFlow: r2(globalCF),
    globalDebtService: r2(globalDS),
    globalDscr: r4(globalDscr),
    meetsMinimum: globalDscr + 1e-9 >= min,
    meetsSopMinimum: globalDscr + 1e-9 >= SBA_GLOBAL.sopMinDscr,
    flags,
  };
}
