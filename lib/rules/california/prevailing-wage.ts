// Prevailing-wage flag rule for Jev (WS-Z). Construction and substantial
// rehabilitation financed with federal or public money often carries wage
// requirements that raise hard costs and need compliance staff. This rule
// turns deal facts into flags Jev can attach to a quote or a decision.
//
// Two regimes:
//   Davis-Bacon (federal): FHA-insured multifamily construction and
//     substantial rehab under National Housing Act §212, and federal funds
//     such as HOME or CDBG.
//   California prevailing wage (Labor Code §1720 et seq.): "public works"
//     paid for in whole or in part out of public funds, and projects that
//     use certain streamlined approvals (SB 35, AB 2011).
//
// Underwriting guidance only. VERIFY unit-count thresholds, exemptions and
// funding-source triggers with counsel before telling a borrower either way.

export type WageProgram = "HUD_221D4" | "HUD_220" | "HUD_232_NEW_CONSTRUCTION" | "HUD_232_223F" | "HUD_223F" | "HUD_223A7" | "SBA" | "AGENCY" | "BRIDGE" | "CONSTRUCTION_PRIVATE" | "OTHER";

export type WorkType = "new_construction" | "substantial_rehabilitation" | "repairs" | "none";

export type PublicFunding =
  | "federal_home"
  | "federal_cdbg"
  | "federal_other"
  | "state_grant"
  | "state_or_local_subsidy_loan"
  | "land_below_market"
  | "fee_waiver_or_reduction"
  | "tax_increment_or_abatement"
  | "lihtc_only"
  | "c_pace";

export type StreamlinedApproval = "sb35" | "ab2011" | "none";

export type PrevailingWageInput = {
  /** Two-letter state; the California rule applies only in CA. */
  state?: string;
  program?: WageProgram;
  workType: WorkType;
  /** Total units after the work. */
  units?: number;
  publicFunding?: PublicFunding[];
  streamlinedApproval?: StreamlinedApproval;
  /** Deed-restricted affordable project with a public-agency regulatory agreement. */
  publicAgencyRegulatoryAgreement?: boolean;
};

export type WageStatus = "required" | "likely" | "possible" | "not_indicated";

export type PrevailingWageFlag = {
  code: "davis_bacon" | "ca_prevailing_wage" | "wage_review";
  status: WageStatus;
  reason: string;
  authority: string;
};

export type PrevailingWageResult = {
  davisBacon: WageStatus;
  californiaPrevailingWage: WageStatus;
  flags: PrevailingWageFlag[];
  /** Jev-friendly strings for the decision note and CRM. */
  jevFlags: string[];
  /** True when counsel or compliance should look before the quote goes out. */
  requiresComplianceReview: boolean;
  underwritingNotes: string[];
};

/** FHA programs that carry Davis-Bacon through NHA §212 when there is construction or substantial rehab. */
const FHA_CONSTRUCTION_PROGRAMS: ReadonlySet<WageProgram> = new Set(["HUD_221D4", "HUD_220", "HUD_232_NEW_CONSTRUCTION"]);

const FEDERAL_FUNDS: ReadonlySet<PublicFunding> = new Set(["federal_home", "federal_cdbg", "federal_other"]);

const CA_PUBLIC_FUNDS: ReadonlySet<PublicFunding> = new Set([
  "state_grant",
  "state_or_local_subsidy_loan",
  "land_below_market",
  "fee_waiver_or_reduction",
  "tax_increment_or_abatement",
]);

/** HOME applies Davis-Bacon only to projects with at least this many HOME-assisted units. VERIFY. */
const HOME_DAVIS_BACON_UNIT_THRESHOLD = 12;

const rank: Record<WageStatus, number> = { not_indicated: 0, possible: 1, likely: 2, required: 3 };
const max = (a: WageStatus, b: WageStatus): WageStatus => (rank[a] >= rank[b] ? a : b);

export function evaluatePrevailingWage(input: PrevailingWageInput): PrevailingWageResult {
  const state = (input.state ?? "CA").toUpperCase();
  const funding = new Set(input.publicFunding ?? []);
  const flags: PrevailingWageFlag[] = [];
  const notes: string[] = [];
  let davis: WageStatus = "not_indicated";
  let ca: WageStatus = "not_indicated";
  const constructionWork = input.workType === "new_construction" || input.workType === "substantial_rehabilitation";

  // --- Davis-Bacon ---------------------------------------------------------------------
  if (input.program && FHA_CONSTRUCTION_PROGRAMS.has(input.program) && constructionWork) {
    davis = "required";
    flags.push({
      code: "davis_bacon",
      status: "required",
      reason: `${input.program.replace(/_/g, " ")} ${input.workType.replace(/_/g, " ")} is subject to Davis-Bacon wage rates and HUD labor standards.`,
      authority: "National Housing Act §212; 40 U.S.C. §3142",
    });
  } else if (input.program === "HUD_232_223F" && (input.workType === "substantial_rehabilitation" || input.workType === "repairs")) {
    // 223(f) refinance with repairs: wage rules attach when the repairs reach rehabilitation scale.
    const status: WageStatus = input.workType === "substantial_rehabilitation" ? "likely" : "possible";
    davis = max(davis, status);
    flags.push({
      code: "davis_bacon",
      status,
      reason: "Section 232/223(f) refinance with a repair or rehabilitation scope: confirm with the HUD lender whether the work triggers Davis-Bacon (scale of the repairs controls).",
      authority: "National Housing Act §212; HUD Handbook 4480.1 / 4430.1 (VERIFY)",
    });
  }

  const federalFunds = [...funding].filter((f) => FEDERAL_FUNDS.has(f));
  if (federalFunds.length > 0 && constructionWork) {
    const units = input.units;
    const home = federalFunds.length === 1 && federalFunds[0] === "federal_home";
    const status: WageStatus = home && units !== undefined && units < HOME_DAVIS_BACON_UNIT_THRESHOLD ? "possible" : "likely";
    davis = max(davis, status);
    flags.push({
      code: "davis_bacon",
      status,
      reason: `Federal funds in the project (${federalFunds.join(", ").replace(/_/g, " ")}) usually bring Davis-Bacon wages for construction work${home ? `; HOME applies it from ${HOME_DAVIS_BACON_UNIT_THRESHOLD} HOME-assisted units (VERIFY)` : ""}.`,
      authority: "Davis-Bacon Act; program statutes (HOME: 24 CFR §92.354; CDBG: 42 U.S.C. §5310)",
    });
  }

  // --- California prevailing wage --------------------------------------------------------
  if (state === "CA" && constructionWork) {
    const publicFunds = [...funding].filter((f) => CA_PUBLIC_FUNDS.has(f));
    if (publicFunds.length > 0) {
      ca = "likely";
      flags.push({
        code: "ca_prevailing_wage",
        status: "likely",
        reason: `Public funds in the project (${publicFunds.join(", ").replace(/_/g, " ")}) can make construction a "public work" paid for in whole or in part out of public funds. Several private-residential and affordable-housing exceptions exist, so counsel should confirm.`,
        authority: "Labor Code §1720(a)(1), §1720(c)",
      });
    }
    if (input.streamlinedApproval === "sb35" || input.streamlinedApproval === "ab2011") {
      ca = max(ca, "required");
      flags.push({
        code: "ca_prevailing_wage",
        status: "required",
        reason: `Streamlined ministerial approval (${input.streamlinedApproval === "sb35" ? "SB 35" : "AB 2011"}) conditions the approval on prevailing-wage payment for the construction workforce, with thresholds that depend on project size.`,
        authority: input.streamlinedApproval === "sb35" ? "Gov. Code §65913.4(a)(8)" : "Gov. Code §65912.111 et seq.",
      });
    }
    if (input.publicAgencyRegulatoryAgreement && ca === "not_indicated") {
      ca = "possible";
      flags.push({
        code: "ca_prevailing_wage",
        status: "possible",
        reason: "A public-agency regulatory agreement alone usually does not trigger prevailing wage, but check the agreement and any fee waiver or land contribution that accompanies it.",
        authority: "Labor Code §1720(c)(5)",
      });
    }
    if (funding.has("lihtc_only") && ca === "not_indicated") {
      notes.push("Federal low-income housing tax credits alone are not a public-funds trigger under Labor Code §1720(c)(5) (VERIFY); combined public subsidy changes that.");
    }
  }

  if (funding.has("c_pace")) {
    notes.push("C-PACE is a private-capital assessment financing and is not treated as public funds here; confirm the program's own labor terms (VERIFY).");
  }

  if (davis !== "not_indicated" || ca !== "not_indicated") {
    notes.push("Prevailing wages raise labor cost and require certified payroll; confirm the GC prices them and the budget contingency reflects it.");
  }
  if (davis !== "not_indicated" && ca !== "not_indicated") {
    notes.push("When both apply, the higher of the federal and state wage determination controls each classification.");
  }
  if (davis === "not_indicated" && ca === "not_indicated" && constructionWork) {
    notes.push("No prevailing-wage trigger found from the facts given; re-run if public funding or a streamlined approval is added.");
  }

  const jevFlags: string[] = [];
  if (davis === "required" || davis === "likely") jevFlags.push("DAVIS_BACON_WAGES_APPLY");
  else if (davis === "possible") jevFlags.push("DAVIS_BACON_REVIEW");
  if (ca === "required" || ca === "likely") jevFlags.push("CA_PREVAILING_WAGE_APPLIES");
  else if (ca === "possible") jevFlags.push("CA_PREVAILING_WAGE_REVIEW");

  const requiresComplianceReview = [davis, ca].some((s) => s === "likely" || s === "possible");
  return { davisBacon: davis, californiaPrevailingWage: ca, flags, jevFlags, requiresComplianceReview, underwritingNotes: notes };
}
