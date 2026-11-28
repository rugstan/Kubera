// Submission playbooks (spec 3.2 and 4.2): which playbooks a deal program may
// use, the lender loan types each one tailors against, and which editor
// sections each one shows. Pure data and functions; client and server share it.
//
// The 11 deal programs are unchanged. DSCR rental, non-hotel CMBS, mezz / pref
// and C-PACE sit under BANK_LIFE_CO (and mezz / C-PACE also under the bridge
// and construction programs) because that is where the lender directory files
// those lenders, so sendPackageToLender's `lender.programs.includes(deal.program)`
// check keeps working.

import { PROGRAM_LOAN_TYPES } from "../loan-types";
import { dealPrograms, type DealProgram } from "../types";
import {
  submissionPlaybooks,
  submissionSections,
  type FixTarget,
  type PlaybookLoanTypes,
  type ProgramDetailKey,
  type ProgramPlaybooks,
  type SectionId,
  type SizeUnit,
  type SourceKind,
  type SubmissionPlaybook,
} from "./types";

export const PLAYBOOK_LABELS: Record<SubmissionPlaybook, string> = {
  construction: "Construction",
  bridge: "Bridge / value-add",
  hard_money: "Hard money",
  fix_flip: "Fix & flip",
  dscr_rental: "DSCR rental",
  sba_7a: "SBA 7(a)",
  sba_504: "SBA 504",
  hud_multifamily: "HUD multifamily",
  hud_232: "HUD 232 senior housing",
  agency: "Agency (Fannie Mae / Freddie Mac)",
  cmbs: "CMBS / conduit",
  hotel_cmbs: "Hotel CMBS",
  hotel_pip_bridge: "Hotel PIP bridge",
  bank: "Bank / credit union",
  life_company: "Life company",
  mezz_pref: "Mezzanine / preferred equity",
  c_pace: "C-PACE",
};

/** Mid-sentence form, e.g. the email subject "Loan request: $8,400,000 bridge | ...". */
export const PLAYBOOK_SHORT_LABELS: Record<SubmissionPlaybook, string> = {
  construction: "construction",
  bridge: "bridge",
  hard_money: "hard money",
  fix_flip: "fix & flip",
  dscr_rental: "DSCR rental",
  sba_7a: "SBA 7(a)",
  sba_504: "SBA 504",
  hud_multifamily: "HUD multifamily",
  hud_232: "HUD 232",
  agency: "agency",
  cmbs: "CMBS",
  hotel_cmbs: "hotel CMBS",
  hotel_pip_bridge: "hotel PIP bridge",
  bank: "bank",
  life_company: "life company",
  mezz_pref: "mezzanine / pref",
  c_pace: "C-PACE",
};

/** Spec 3.2. The default comes first in allowedPlaybooks(). */
export const PROGRAM_PLAYBOOKS: ProgramPlaybooks = {
  CONSTRUCTION: { default: "construction", also: ["c_pace", "mezz_pref"] },
  PRIVATE_BRIDGE: { default: "bridge", also: ["mezz_pref"] },
  HARD_MONEY: { default: "hard_money", also: ["fix_flip"] },
  PIP_BRIDGE: { default: "hotel_pip_bridge", also: [] },
  HOTEL_CMBS: { default: "hotel_cmbs", also: [] },
  SBA_7A: { default: "sba_7a", also: [] },
  SBA_504: { default: "sba_504", also: [] },
  HUD_232: { default: "hud_232", also: [] },
  HUD_MULTIFAMILY: { default: "hud_multifamily", also: [] },
  AGENCY: { default: "agency", also: [] },
  BANK_LIFE_CO: { default: "bank", also: ["life_company", "cmbs", "dscr_rental", "mezz_pref", "c_pace"] },
};

export function defaultPlaybook(program: DealProgram): SubmissionPlaybook {
  return PROGRAM_PLAYBOOKS[program].default;
}

export function allowedPlaybooks(program: DealProgram): SubmissionPlaybook[] {
  const p = PROGRAM_PLAYBOOKS[program];
  return [p.default, ...p.also];
}

export function isPlaybookAllowed(program: DealProgram, playbook: SubmissionPlaybook): boolean {
  return allowedPlaybooks(program).includes(playbook);
}

/** Deal programs under which a playbook may be chosen. */
export function programsForPlaybook(playbook: SubmissionPlaybook): DealProgram[] {
  return dealPrograms.filter((p) => isPlaybookAllowed(p, playbook));
}

/**
 * Lender loan types each playbook tailors against (LenderFit compares them to
 * lender.loanTypes), canonical lenderLoanTypes order. A default playbook
 * covers every loan type its program derives (loan-types.ts PROGRAM_LOAN_TYPES).
 */
export const playbookLoanTypes: PlaybookLoanTypes = {
  construction: ["construction"],
  bridge: ["bridge"],
  hard_money: ["private_money"],
  fix_flip: ["fix_flip"],
  dscr_rental: ["dscr"],
  sba_7a: ["sba"],
  sba_504: ["sba"],
  hud_multifamily: ["hud_fha"],
  hud_232: ["hud_fha"],
  agency: ["agency"],
  cmbs: ["cmbs"],
  hotel_cmbs: ["cmbs", "hotel"],
  hotel_pip_bridge: ["bridge", "hotel"],
  bank: ["bank"],
  life_company: ["life_company"],
  mezz_pref: ["mezz_pref"],
  c_pace: ["c_pace"],
};

// Program loan types must stay inside their default playbook's (proved again in playbooks.test.ts).
for (const p of dealPrograms) {
  const covered = playbookLoanTypes[defaultPlaybook(p)];
  if (PROGRAM_LOAN_TYPES[p].some((t) => !covered.includes(t))) throw new Error(`playbookLoanTypes: ${defaultPlaybook(p)} must cover ${p}'s loan types`);
}

// ---------------------------------------------------------------------------
// Playbook groups the requirement table names (spec 4.5)

/** "Short-term": exit fields are required, stabilized value is required. */
export const SHORT_TERM_PLAYBOOKS: readonly SubmissionPlaybook[] = ["construction", "bridge", "hard_money", "fix_flip", "hotel_pip_bridge", "mezz_pref"];

/** "Income": the operating-financials section shows and NOI, T-12 and rent roll apply. dscr_rental joins at 5+ units (isIncomeProperty). */
export const INCOME_PLAYBOOKS: readonly SubmissionPlaybook[] = [
  "bridge",
  "agency",
  "cmbs",
  "hotel_cmbs",
  "hotel_pip_bridge",
  "bank",
  "life_company",
  "hud_multifamily",
  "hud_232",
  "mezz_pref",
  "c_pace",
];

/** Units at or above which a DSCR rental is underwritten as income property (5–8 unit and small mixed-use programs). */
export const DSCR_INCOME_MIN_UNITS = 5;

/** Facts section visibility depends on (a missing profile counts as unknown size). */
export type SectionFacts = { sizeCount: number | null; sizeUnit: SizeUnit | null } | null;

export function isShortTermPlaybook(playbook: SubmissionPlaybook): boolean {
  return SHORT_TERM_PLAYBOOKS.includes(playbook);
}

/** Income property for this playbook: the INCOME_PLAYBOOKS, plus a DSCR rental of 5+ units. */
export function isIncomeProperty(playbook: SubmissionPlaybook, facts: SectionFacts): boolean {
  if (INCOME_PLAYBOOKS.includes(playbook)) return true;
  return playbook === "dscr_rental" && facts?.sizeUnit === "units" && (facts.sizeCount ?? 0) >= DSCR_INCOME_MIN_UNITS;
}

/**
 * The sources line that must equal deals.loanAmountCents (capital.sources_uses):
 * the deal's loan is the mezz tranche on mezz_pref and the assessment on c_pace.
 */
export const playbookTrancheSource: Readonly<Record<SubmissionPlaybook, SourceKind>> = Object.fromEntries(
  submissionPlaybooks.map((p) => [p, p === "mezz_pref" ? "subordinate_debt" : p === "c_pace" ? "c_pace" : "senior_loan"]),
) as Record<SubmissionPlaybook, SourceKind>;

// ---------------------------------------------------------------------------
// Sections (spec 4.2)

export const SECTION_LABELS: Record<SectionId, string> = {
  loan_request: "Loan request",
  property: "Property",
  value: "Value",
  financials: "Operating financials",
  sponsor: "Sponsor and guarantors",
  plan_exit: "Business plan and exit",
  sources_uses: "Sources and uses",
  construction: "Construction",
  rehab: "Rehab / capex and reserves",
  rental: "Rental (rent and PITIA)",
  sba: "Operating business (SBA)",
  hotel: "Hotel",
  tenancy: "Tenancy and rollover",
  agency: "Agency",
  hud: "HUD",
  capital_stack: "Capital stack",
  documents: "Documents and third-party reports",
};

/** The program_details key each program section edits. */
export const SECTION_PROGRAM_DETAIL_KEY: Readonly<Partial<Record<SectionId, ProgramDetailKey>>> = {
  construction: "construction",
  rehab: "rehab",
  rental: "rental",
  sba: "sba",
  hotel: "hotel",
  tenancy: "tenancy",
  agency: "agency",
  hud: "hud",
  capital_stack: "capitalStack",
};

/** Playbooks that run on the hard money file: their rehab section links to it instead of a form. */
export const HARD_MONEY_FILE_PLAYBOOKS: readonly SubmissionPlaybook[] = ["hard_money", "fix_flip"];

/** Sections shown for a subset of playbooks; every other section shows for all. financials is resolved by isIncomeProperty. */
const SECTION_PLAYBOOKS: Readonly<Partial<Record<SectionId, readonly SubmissionPlaybook[]>>> = {
  construction: ["construction", "c_pace"],
  rehab: ["bridge", "hotel_pip_bridge", ...HARD_MONEY_FILE_PLAYBOOKS],
  rental: ["dscr_rental"],
  sba: ["sba_7a", "sba_504"],
  hotel: ["hotel_cmbs", "hotel_pip_bridge"],
  tenancy: ["cmbs", "life_company", "bank"],
  agency: ["agency"],
  hud: ["hud_232", "hud_multifamily"],
  capital_stack: ["mezz_pref", "c_pace"],
};

/**
 * form             an editable form on /deals/[id]/submission
 * hard_money_file  a link to the existing hard money file (not rebuilt)
 * read_only        the documents and reports view
 */
export type SectionView = "form" | "hard_money_file" | "read_only";

/** How a section shows for a playbook; null when it is hidden. Hiding never deletes data. */
export function sectionView(section: SectionId, playbook: SubmissionPlaybook, facts: SectionFacts): SectionView | null {
  if (section === "documents") return "read_only";
  if (section === "financials") return isIncomeProperty(playbook, facts) ? "form" : null;
  const only = SECTION_PLAYBOOKS[section];
  if (only && !only.includes(playbook)) return null;
  if (section === "rehab" && HARD_MONEY_FILE_PLAYBOOKS.includes(playbook)) return "hard_money_file";
  return "form";
}

/** Visible sections in display order. */
export function visibleSections(playbook: SubmissionPlaybook, facts: SectionFacts): { id: SectionId; label: string; view: SectionView }[] {
  return submissionSections.flatMap((id) => {
    const view = sectionView(id, playbook, facts);
    return view ? [{ id, label: SECTION_LABELS[id], view }] : [];
  });
}

/** Program-detail keys whose section shows for the playbook (others are kept but hidden). */
export function programDetailKeysFor(playbook: SubmissionPlaybook, facts: SectionFacts): ProgramDetailKey[] {
  return visibleSections(playbook, facts).flatMap((s) => {
    const key = s.view === "form" ? SECTION_PROGRAM_DETAIL_KEY[s.id] : undefined;
    return key ? [key] : [];
  });
}

// ---------------------------------------------------------------------------
// Fix links. The editor renders `id="section-<SectionId>"` on each section and
// `id="field-<FieldSourceKey>"` on each input; the deal page renders `id="details"`.

export function submissionFixHref(dealId: string, target: FixTarget): string {
  const id = encodeURIComponent(dealId);
  switch (target.kind) {
    case "editor":
      return `/deals/${id}/submission?section=${target.section}#${target.field ? `field-${target.field}` : `section-${target.section}`}`;
    case "deal_details":
      return `/deals/${id}#details`;
    case "checklist":
      return `/checklists/deal?id=${id}${target.itemId ? `#item-${encodeURIComponent(target.itemId)}` : ""}`;
    case "hard_money_file":
      return `/checklists/deal?id=${id}#hard-money`;
    case "principals":
      return `/checklists/deal?id=${id}#principals`;
    case "construction_project":
      return target.projectId ? `/construction/project?id=${encodeURIComponent(target.projectId)}` : "/construction";
  }
}
