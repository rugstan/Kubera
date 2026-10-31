// SBA Form 1919 (Borrower Information Form) prefill data. Kubera assembles
// what it already knows (the borrower entity, its owners from the ownership
// chart, each owner's answers from the portal) so the lender of record's form
// arrives mostly complete. Restricted values (SSN, date of birth) are never
// copied into the prefill: it records only that they are on file, and the
// lender collects them on the signed form.
//
// VERIFY: section and field names against the current SBA Form 1919.

import { form1919Flags } from "./financials";
import { buildOrgChart } from "./org-chart";
import { principalObligations } from "./requirements";
import { CONTROL_ROLES, FORM_1919_QUESTIONS, ROLE_LABEL, type Form1919Answers, type Form1919Question, type Principal } from "./types";

export type Form1919DealContext = {
  loanAmount: number | null;
  useOfProceeds?: string | null;
  businessAddress?: string | null;
  businessPhone?: string | null;
  dba?: string | null;
  employees?: number | null;
  entityType?: "llc" | "c_corp" | "s_corp" | "partnership" | "sole_proprietor" | "trust" | "other" | null;
};

export type Form1919Owner = {
  principalId: string;
  name: string;
  title: string | null;
  kind: Principal["kind"];
  /** Direct share of the applicant business (0–100), or the effective share through upper tiers. */
  ownershipPct: number;
  roles: string[];
  email: string | null;
  phone: string | null;
  homeAddress: string | null;
  citizenship: Principal["citizenship"];
  taxIdOnFile: boolean;
  dateOfBirthOnFile: boolean;
  answers: Partial<Record<Form1919Question, boolean>> | null;
  veteranStatus: Form1919Answers["veteranStatus"] | null;
  /** "Yes" answers that need an explanation and lender review. */
  yesAnswers: string[];
  missing: string[];
};

export type Form1919Prefill = {
  applicant: {
    legalName: string | null;
    dba: string | null;
    entityType: Form1919DealContext["entityType"];
    formationState: string | null;
    businessAddress: string | null;
    businessPhone: string | null;
    employees: number | null;
    loanAmount: number | null;
    useOfProceeds: string | null;
  };
  owners: Form1919Owner[];
  /** Fields still missing anywhere on the form. */
  missing: string[];
  complete: boolean;
  questions: typeof FORM_1919_QUESTIONS;
};

export function buildForm1919Prefill(input: {
  principals: readonly Principal[];
  deal: Form1919DealContext;
  /** Decrypted Form 1919 answers per principal id (from the portal). */
  answers: ReadonlyMap<string, Form1919Answers>;
}): Form1919Prefill {
  const chart = buildOrgChart(input.principals);
  const borrower = chart.root?.principal ?? null;
  const obligations = principalObligations(["SBA_7A"], input.principals, chart);
  const missing: string[] = [];

  if (!borrower) missing.push("Applicant business");
  if (!input.deal.loanAmount) missing.push("Loan amount");
  if (!input.deal.useOfProceeds) missing.push("Use of proceeds");
  if (!input.deal.businessAddress) missing.push("Business address");

  const owners: Form1919Owner[] = [];
  for (const p of input.principals) {
    if (!obligations.get(p.id)?.requirements.has("form_1919")) continue;
    const node = chart.nodes.get(p.id);
    const a = input.answers.get(p.id) ?? null;
    const ownerMissing: string[] = [];
    if (p.kind === "individual") {
      if (!p.hasSsn) ownerMissing.push("SSN or ITIN");
      if (!p.hasDob) ownerMissing.push("Date of birth");
      if (!p.homeAddress) ownerMissing.push("Home address");
      if (!p.citizenship) ownerMissing.push("Citizenship");
      if (!a) ownerMissing.push("Eligibility questions");
    }
    if (!p.email) ownerMissing.push("Email");
    const direct = p.parentId === borrower?.id ? p.ownershipPct ?? 0 : node?.effectivePct ?? 0;
    owners.push({
      principalId: p.id,
      name: p.legalName,
      title: p.title ?? (p.roles.find((r) => CONTROL_ROLES.includes(r)) ? ROLE_LABEL[p.roles.find((r) => CONTROL_ROLES.includes(r))!] : null),
      kind: p.kind,
      ownershipPct: direct,
      roles: p.roles.map((r) => ROLE_LABEL[r]),
      email: p.email,
      phone: p.phone,
      homeAddress: p.homeAddress,
      citizenship: p.citizenship,
      taxIdOnFile: p.hasSsn,
      dateOfBirthOnFile: p.hasDob,
      answers: a ? { ...a.answers } : null,
      veteranStatus: a?.veteranStatus ?? null,
      yesAnswers: a ? form1919Flags(a).map((f) => f.text) : [],
      missing: ownerMissing,
    });
    for (const m of ownerMissing) missing.push(`${p.legalName}: ${m}`);
  }
  if (owners.length === 0) missing.push("Owners of 20% or more and controlling persons");

  return {
    applicant: {
      legalName: borrower?.legalName ?? null,
      dba: input.deal.dba ?? null,
      entityType: input.deal.entityType ?? null,
      formationState: borrower?.formationState ?? null,
      businessAddress: input.deal.businessAddress ?? null,
      businessPhone: input.deal.businessPhone ?? null,
      employees: input.deal.employees ?? null,
      loanAmount: input.deal.loanAmount,
      useOfProceeds: input.deal.useOfProceeds ?? null,
    },
    owners: owners.sort((x, y) => y.ownershipPct - x.ownershipPct),
    missing,
    complete: missing.length === 0,
    questions: FORM_1919_QUESTIONS,
  };
}
