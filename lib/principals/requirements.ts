// What each principal owes for a program: guaranty, financial statements,
// credit authorization, SBA Form 1919, HUD-2530. Thresholds are program
// defaults from research (VERIFY against the lender's term sheet; a lender can
// always ask for more). Everyone on the chart is sanctions-screened.

import type { ChecklistProgram, PrincipalRequirement } from "@/lib/checklists/types";
import { buildOrgChart, type OrgChart } from "./org-chart";
import { CONTROL_ROLES, type Principal } from "./types";

export type ProgramPrincipalRule = {
  /** Individuals at or above this effective share guarantee the loan; null = no guaranty (non-recourse program). */
  guarantyPct: number | null;
  /** Individuals at or above this share are key principals who provide PFS, REO and credit. */
  keyPrincipalPct: number;
  /** Controlling persons (managing member, GP, officers, directors) are key principals regardless of share. */
  controlIsKeyPrincipal: boolean;
  /** SBA Form 1919: owners at or above this share plus controlling persons. */
  form1919Pct: number | null;
  /** HUD-2530 previous participation: principals at or above this share plus controlling persons, operators and agents. */
  hud2530Pct: number | null;
  source: string;
};

const HUD: ProgramPrincipalRule = { guarantyPct: null, keyPrincipalPct: 25, controlIsKeyPrincipal: true, form1919Pct: null, hud2530Pct: 25, source: "HUD MAP Guide / Handbook 4232.1; previous participation (VERIFY 25% principal threshold)" };
const SBA: ProgramPrincipalRule = { guarantyPct: 20, keyPrincipalPct: 20, controlIsKeyPrincipal: true, form1919Pct: 20, hud2530Pct: null, source: "SBA SOP 50 10: 20%+ owners guarantee and complete Form 1919 (VERIFY)" };
const RECOURSE_20: ProgramPrincipalRule = { guarantyPct: 20, keyPrincipalPct: 20, controlIsKeyPrincipal: true, form1919Pct: null, hud2530Pct: null, source: "Private lender practice: personal guaranty from 20%+ owners (VERIFY per lender)" };
const CARVE_OUT_25: ProgramPrincipalRule = { guarantyPct: 25, keyPrincipalPct: 25, controlIsKeyPrincipal: true, form1919Pct: null, hud2530Pct: null, source: "Non-recourse carve-out guaranty from key principals, typically 25%+ or control (VERIFY per lender)" };

export const PROGRAM_PRINCIPAL_RULES: Readonly<Record<ChecklistProgram, ProgramPrincipalRule>> = {
  HUD_232_223F: HUD,
  HUD_232_NEW_CONSTRUCTION: HUD,
  HUD_MULTIFAMILY_223F: HUD,
  HUD_221D4: HUD,
  SBA_7A: SBA,
  SBA_504: SBA,
  HOTEL_CMBS: CARVE_OUT_25,
  PIP_BRIDGE: RECOURSE_20,
  AGENCY_MULTIFAMILY: CARVE_OUT_25,
  BRIDGE: CARVE_OUT_25,
  HARD_MONEY: RECOURSE_20,
  CONSTRUCTION: RECOURSE_20,
};

export type PrincipalObligations = {
  principalId: string;
  legalName: string;
  effectivePct: number;
  requirements: Set<PrincipalRequirement>;
  /** Why each requirement applies, for the staff view. */
  reasons: string[];
  /** Every principal on the chart is screened against sanctions lists. */
  screening: true;
};

const pct = (n: number) => `${Math.round(n * 100) / 100}%`;

/**
 * Obligations per principal across one or more programs (an SBA 7(a)+504
 * stack passes both). Principals not connected to the borrower still get
 * screened but owe nothing else until the chart is fixed.
 */
export function principalObligations(programs: readonly ChecklistProgram[], principals: readonly Principal[], chart: OrgChart = buildOrgChart(principals)): Map<string, PrincipalObligations> {
  const out = new Map<string, PrincipalObligations>();
  for (const p of principals) {
    const node = chart.nodes.get(p.id);
    const effective = node?.effectivePct ?? 0;
    const controlling = Boolean(node?.controlling) && p.roles.some((r) => CONTROL_ROLES.includes(r));
    const ob: PrincipalObligations = { principalId: p.id, legalName: p.legalName, effectivePct: effective, requirements: new Set(), reasons: [], screening: true };
    out.set(p.id, ob);
    if (!node || p.roles.includes("borrower_entity")) continue;
    const add = (r: PrincipalRequirement, why: string) => {
      if (!ob.requirements.has(r)) ob.reasons.push(why);
      ob.requirements.add(r);
    };

    for (const program of programs) {
      const rule = PROGRAM_PRINCIPAL_RULES[program];
      const individual = p.kind === "individual";
      const guarantor = p.isGuarantor || p.roles.includes("guarantor") || (individual && rule.guarantyPct !== null && effective >= rule.guarantyPct);
      const keyPrincipal = p.roles.includes("key_principal") || guarantor || effective >= rule.keyPrincipalPct || (rule.controlIsKeyPrincipal && controlling);

      if (guarantor && rule.guarantyPct !== null) add("guaranty", p.isGuarantor || p.roles.includes("guarantor") ? "Named guarantor." : `Owns ${pct(effective)} (guaranty at ${rule.guarantyPct}%+).`);
      if (individual && keyPrincipal) {
        const why = guarantor ? "Guarantor." : controlling ? "Controls the borrower." : `Owns ${pct(effective)} (key principal at ${rule.keyPrincipalPct}%+).`;
        add("pfs", `Personal financial statement: ${why}`);
        add("reo_schedule", `Real estate owned: ${why}`);
        add("credit_authorization", `Credit authorization: ${why}`);
        add("government_id", `Photo ID: ${why}`);
        add("resume", `Résumé: ${why}`);
      }
      if (rule.form1919Pct !== null && (effective >= rule.form1919Pct || controlling)) add("form_1919", controlling ? "SBA Form 1919: officer, director, managing member or general partner." : `SBA Form 1919: owns ${pct(effective)} (${rule.form1919Pct}%+).`);
      if (rule.hud2530Pct !== null && (effective >= rule.hud2530Pct || controlling || p.roles.includes("operator") || p.roles.includes("management_agent"))) {
        add("hud_2530", p.roles.includes("operator") || p.roles.includes("management_agent") ? "HUD-2530: operator or management agent." : controlling ? "HUD-2530: controlling participant." : `HUD-2530: owns ${pct(effective)} (${rule.hud2530Pct}%+).`);
      }
    }
  }
  return out;
}

/** Principals that owe a specific requirement. */
export function principalsOwing(requirement: PrincipalRequirement, obligations: Map<string, PrincipalObligations>): PrincipalObligations[] {
  return [...obligations.values()].filter((o) => o.requirements.has(requirement));
}
