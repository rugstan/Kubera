// Compliance gates A (MLDS, B&P §10240) and H (Civ. Code §1916.1 broker
// arrangement; SB 1146 modifications). Pure functions: facts in, decisions out.
// No I/O, no clock reads — callers pass `now`.
//
// This encodes counsel research that is pending attorney sign-off. It never
// concludes that a loan IS usury-exempt; it only reports whether the elements
// Kubera must record are present and whether a deal must stop.

import { computeMldsTimer, type MldsTimer } from "@/lib/disclosures/timer";
import type { DisclosureStatus } from "@/lib/disclosures/state";
import {
  EXEMPT_LENDER_CATEGORIES,
  brokerOfRecordElementsSchema,
  collateralSchema,
  lenderChargesSchema,
  mldsFactsSchema,
  modificationFactsSchema,
  usuryFactsSchema,
  type BrokerOfRecordElements,
  type Collateral,
  type CollateralInput,
  type LenderChargesInput,
  type MldsFacts,
  type ModificationFacts,
  type UsuryFacts,
} from "./schemas";

export type FlagCode =
  | "held_for_counsel"
  | "cfl_license_review"
  | "usury_exemption_unavailable"
  | "no_exemption_representation"
  | "lender_written_notice_required"
  | "broker_of_record_incomplete"
  | "officer_approval_required"
  | "lender_category_unverified"
  | "mlds_warning"
  | "mlds_overdue"
  | "mlds_late";

export type Flag = { code: FlagCode; reason: string; authority?: string };

export type GateDecision = { allowed: boolean; reasons: string[] };

const allow = (): GateDecision => ({ allowed: true, reasons: [] });

// ---------------------------------------------------------------------------
// Gate A — MLDS (RE 882)

export type MldsRequirement = {
  required: boolean;
  form: "RE882" | null;
  heldForCounsel: boolean;
  flags: Flag[];
  reasons: string[];
};

export function mldsRequirement(input: MldsFacts): MldsRequirement {
  const facts = mldsFactsSchema.parse(input);
  const flags: Flag[] = [];
  const reasons: string[] = [];

  if (facts.namesKuberaAsBeneficiary) {
    flags.push({ code: "held_for_counsel", reason: "Deal documents name Kubera as trust-deed beneficiary; Kubera is a broker only.", authority: "B&P §10234" });
  }
  if (facts.namesKuberaAsOriginator) {
    flags.push({ code: "held_for_counsel", reason: "Deal documents name Kubera as originator or lender of record; Kubera is a broker only.", authority: "B&P §10234" });
  }
  if (facts.tableFundedInKuberaName) {
    flags.push({ code: "held_for_counsel", reason: "Table-funded loan in Kubera's name.", authority: "B&P §10234; Civ. Code §1916.1" });
  }
  if (facts.nonTraditionalResidential1to4) {
    flags.push({ code: "held_for_counsel", reason: "Non-traditional loan on 1–4 residential units needs RE 885, which is not supported.", authority: "DRE RE 885" });
  }

  const realProperty = facts.collateral.realPropertyLien && !facts.collateral.equityPledgeOrUccOnly;
  const brokered = facts.kuberaRole === "broker" || facts.kuberaRole === "paid_referral";
  const required = realProperty && brokered;

  if (required) {
    reasons.push(
      facts.kuberaRole === "paid_referral"
        ? "Paid referral on a real-property-secured loan: treated as MLDS-required (counsel gate A, open question 2)."
        : "Kubera brokers a loan secured directly or collaterally by a lien on real property.",
    );
  } else if (!realProperty && brokered) {
    reasons.push("No lien on real property secures the loan, so no MLDS is required.");
    flags.push({
      code: "cfl_license_review",
      reason:
        facts.program === "SBA_7A"
          ? "SBA 7(a) on business assets only: confirm whether a CFL broker license is needed."
          : "Business-asset-only loan: confirm whether a CFL broker license is needed.",
      authority: "B&P §10131(d); Fin. Code §22057",
    });
  } else {
    reasons.push("Unpaid referral where Kubera does not negotiate: no MLDS required.");
  }

  const heldForCounsel = flags.some((f) => f.code === "held_for_counsel");
  return { required, form: required ? "RE882" : null, heldForCounsel, flags, reasons };
}

/** State of the deal's MLDS used by the blocking gates. */
export type MldsCaseState = {
  requirement: MldsRequirement;
  /** Status of the current (non-superseded) MLDS disclosure, if one exists. */
  status: DisclosureStatus | null;
};

function mldsSigned(state: MldsCaseState): boolean {
  return !state.requirement.required || state.status === "signed";
}

/**
 * No commitment or loan document goes to the borrower for signature before the
 * MLDS is signed. Deals held for counsel send nothing.
 */
export function borrowerDocumentGate(kind: "commitment" | "loan_document", state: MldsCaseState): GateDecision {
  const reasons: string[] = [];
  if (state.requirement.heldForCounsel || state.status === "held_for_counsel") reasons.push("Deal is held for counsel review.");
  if (!mldsSigned(state)) reasons.push(`A signed MLDS (RE 882) must be on file before any ${kind === "commitment" ? "commitment" : "loan document"} goes to the borrower.`);
  return reasons.length ? { allowed: false, reasons } : allow();
}

export const CLOSING_STAGES: ReadonlySet<string> = new Set(["closing", "closed", "funded", "closed_won"]);

// ---------------------------------------------------------------------------
// Gate H — usury / broker of record

/** Cal. Const. art. XV §1(2): greater of 10% or 5% + FRBSF discount rate. */
export function usuryCapPct(fedDiscountRatePct: number): number {
  return Math.max(10, 5 + fedDiscountRatePct);
}

/**
 * Effective annualized rate for the art. XV cap test: the note rate plus the
 * compensation the lender retains (points, exit fee, minimum interest beyond
 * the stated term), spread evenly over the stated term. The higher of this
 * figure and any effective rate recorded from the closing statement is used.
 *
 * VERIFY (counsel gate H): the spreading method (stated term vs. earliest
 * permitted payoff) and which charges count as interest. Until counsel signs
 * off this is a conservative screen that decides whether the gate-H block and
 * officer approval apply; it is never a determination that a loan is or is not
 * usurious.
 */
export function effectiveRatePct(noteRatePct: number, charges?: LenderChargesInput): number {
  if (!charges) return noteRatePct;
  const c = lenderChargesSchema.parse(charges);
  let rate = noteRatePct;
  if (c.termMonths) {
    // Minimum interest only adds to the yield where it exceeds the stated term's own interest.
    const extraInterestPct = (noteRatePct * Math.max(0, c.minimumInterestMonths - c.termMonths)) / 12;
    rate += ((c.lenderPointsPct + c.exitFeePct + extraInterestPct) * 12) / c.termMonths;
  }
  if (c.effectiveRatePct !== undefined) rate = Math.max(rate, c.effectiveRatePct);
  return Math.round(rate * 10_000) / 10_000;
}

/** "Note rate 9.5% (effective 11.5% …)" for gate reasons: both figures whenever charges raise the rate. */
export function rateLabel(noteRatePct: number, effective: number): string {
  return effective > noteRatePct ? `Note rate ${noteRatePct}% (effective ${effective}% with the lender's points, exit fee and minimum interest; VERIFY)` : `Note rate ${noteRatePct}%`;
}

export type BrokerElement =
  | "arranging_licensee"
  | "licensee_active"
  | "acts_for"
  | "engagement_agreement"
  | "compensation"
  | "negotiation_log"
  | "collateral_identification"
  | "business_purpose_certification"
  | "officer_approval";

export const BROKER_ELEMENT_LABELS: Record<BrokerElement, string> = {
  arranging_licensee: "Arranging DRE licensee (name and 8-digit license number)",
  licensee_active: "Licensee's license active on the transaction date",
  acts_for: "Party Kubera acts for (borrower and/or lender)",
  engagement_agreement: "Signed engagement / fee agreement",
  compensation: "Compensation amount and payer",
  negotiation_log: "Negotiation log showing Kubera actively arranged the loan (term-sheet versions or lender submissions)",
  collateral_identification: "Collateral APN and lien position",
  business_purpose_certification: "Business-purpose certification",
  officer_approval: "Designated-officer approval",
};

/**
 * Elements Kubera must record for a broker-arranged loan or modification that
 * are missing. `collateral` is the loan's collateral: a real-property lien must
 * be identified by APN and lien position (Reference, gate H).
 */
export function missingBrokerElements(input: BrokerOfRecordElements, opts: { requireOfficerApproval: boolean; collateral: CollateralInput }): BrokerElement[] {
  const e = brokerOfRecordElementsSchema.parse(input);
  const collateral = collateralSchema.parse(opts.collateral);
  const missing: BrokerElement[] = [];
  if (!e.arrangingLicensee) missing.push("arranging_licensee");
  else if (!e.arrangingLicensee.activeAtTransaction) missing.push("licensee_active");
  if (!e.actsFor) missing.push("acts_for");
  if (!e.engagementAgreementRef) missing.push("engagement_agreement");
  if (!e.compensation || e.compensation.amountUsd <= 0) missing.push("compensation");
  if (!e.negotiationLog.some((n) => n.kind === "term_sheet" || n.kind === "lender_submission" || n.kind === "counteroffer")) missing.push("negotiation_log");
  if (collateral.realPropertyLien && (!collateral.apn || collateral.lienPosition === undefined)) missing.push("collateral_identification");
  if (!e.businessPurposeCertified) missing.push("business_purpose_certification");
  if (opts.requireOfficerApproval && !e.officerApproval) missing.push("officer_approval");
  return missing;
}

function hasRealPropertyLien(c: Collateral): boolean {
  return c.realPropertyLien && !c.equityPledgeOrUccOnly;
}

export type UsuryStatus = "lender_exempt" | "within_cap" | "cleared" | "blocked" | "held_for_counsel";

export type UsuryEvaluation = {
  status: UsuryStatus;
  capPct: number;
  noteRatePct: number;
  /** Note rate plus lender-retained charges, annualized (the figure tested against the cap). */
  effectiveRatePct: number;
  aboveCap: boolean;
  lenderExempt: boolean;
  /** Elements missing from the broker-of-record file (recorded on every loan). */
  missing: BrokerElement[];
  /** True when the deal may not proceed to closing/funding. */
  blocking: boolean;
  flags: Flag[];
  reasons: string[];
};

function lenderIsExempt(lender: UsuryFacts["lender"], flags: Flag[]): boolean {
  if (!EXEMPT_LENDER_CATEGORIES.has(lender.category)) return false;
  if (!lender.evidenceRef) {
    flags.push({ code: "lender_category_unverified", reason: `${lender.name} is recorded as ${lender.category} without charter or license evidence; treated as non-exempt.` });
    return false;
  }
  return true;
}

export function evaluateUsury(input: UsuryFacts): UsuryEvaluation {
  const facts = usuryFactsSchema.parse(input);
  const flags: Flag[] = [];
  const reasons: string[] = [];
  const capPct = usuryCapPct(facts.fedDiscountRatePct);
  const effective = effectiveRatePct(facts.noteRatePct, facts.lenderCharges);
  const aboveCap = effective > capPct;
  const rate = rateLabel(facts.noteRatePct, effective);
  const lenderExempt = lenderIsExempt(facts.lender, flags);
  const realProperty = hasRealPropertyLien(facts.collateral);
  const gateApplies = !lenderExempt && aboveCap;
  const missing = missingBrokerElements(facts.elements, { requireOfficerApproval: gateApplies, collateral: facts.collateral });

  if (!realProperty) {
    flags.push({
      code: "usury_exemption_unavailable",
      reason: "No real-property lien (equity pledge / UCC only): the §1916.1 broker exemption is unavailable.",
      authority: "Civ. Code §1916.1",
    });
  }
  if (missing.length) {
    flags.push({ code: "broker_of_record_incomplete", reason: `Broker-of-record file is missing: ${missing.map((m) => BROKER_ELEMENT_LABELS[m]).join("; ")}.` });
  }

  let status: UsuryStatus;
  if (facts.tableFundedInKuberaName) {
    status = "held_for_counsel";
    flags.push({ code: "held_for_counsel", reason: "Table-funded loan naming Kubera as lender.", authority: "B&P §10234; Civ. Code §1916.1" });
  } else if (lenderExempt) {
    status = "lender_exempt";
    reasons.push(`${facts.lender.name} is recorded as an exempt lender category (${facts.lender.category}).`);
  } else if (!aboveCap) {
    status = "within_cap";
    reasons.push(`${rate} does not exceed the art. XV cap of ${capPct}%.`);
  } else if (!realProperty) {
    status = "held_for_counsel";
    flags.push({ code: "held_for_counsel", reason: `Non-exempt lender: ${rate} exceeds the ${capPct}% cap with no real-property lien.`, authority: "Cal. Const. art. XV" });
  } else if (missing.length) {
    status = "blocked";
    if (missing.includes("officer_approval")) flags.push({ code: "officer_approval_required", reason: "Designated-officer approval is required before funding." });
    reasons.push(`Non-exempt lender: ${rate} exceeds the ${capPct}% cap; every broker-of-record element and officer approval must be recorded first.`);
  } else {
    status = "cleared";
    reasons.push("All broker-of-record elements and officer approval are recorded. This is not a determination that any exemption applies.");
  }

  return { status, capPct, noteRatePct: facts.noteRatePct, effectiveRatePct: effective, aboveCap, lenderExempt, missing, blocking: status === "blocked" || status === "held_for_counsel", flags, reasons };
}

/** SB 1146 (Stats. 2024, ch. 601) applies to modifications effective on/after this date. */
export const SB1146_EFFECTIVE_DATE = "2025-01-01";

export type ModificationStatus = "held_for_counsel" | "no_exemption_representation" | "documented" | "incomplete";

export type ModificationEvaluation = {
  status: ModificationStatus;
  /** Rate after the change, and with the lender's charges for it annualized (the figure tested against the cap). */
  noteRatePct?: number;
  effectiveRatePct?: number;
  aboveCap?: boolean;
  /** A licensed broker's arrangement is documented (still not an exemption determination). */
  brokerArrangementDocumented: boolean;
  lenderNoticeRequired: boolean;
  missing: (BrokerElement | "other_broker_identity" | "agreement_recital")[];
  blocking: boolean;
  flags: Flag[];
};

export type LoanContext = { lender: UsuryFacts["lender"]; fedDiscountRatePct: number; collateral: CollateralInput };

/** Each forbearance, extension or modification must itself be arranged by a licensed broker (SB 1146). */
export function evaluateModification(input: ModificationFacts, loan: LoanContext): ModificationEvaluation {
  const mod = modificationFactsSchema.parse(input);
  const collateral = collateralSchema.parse(loan.collateral);
  const flags: Flag[] = [];
  const capPct = usuryCapPct(loan.fedDiscountRatePct);
  const lenderExempt = lenderIsExempt(loan.lender, []);
  const effective = effectiveRatePct(mod.noteRatePct, mod.lenderCharges);
  const aboveCap = effective > capPct;
  const gateApplies = !lenderExempt && aboveCap;
  const rates = { noteRatePct: mod.noteRatePct, effectiveRatePct: effective, aboveCap };

  if (mod.effectiveDate < SB1146_EFFECTIVE_DATE) {
    flags.push({ code: "held_for_counsel", reason: `${mod.kind} effective ${mod.effectiveDate} predates SB 1146; counsel must review.`, authority: "Civ. Code §1916.1 (SB 1146)" });
    return { status: "held_for_counsel", ...rates, brokerArrangementDocumented: false, lenderNoticeRequired: false, missing: [], blocking: true, flags };
  }

  if (!hasRealPropertyLien(collateral)) {
    flags.push({ code: "usury_exemption_unavailable", reason: "No real-property lien: the §1916.1 broker exemption is unavailable for this modification.", authority: "Civ. Code §1916.1" });
    // Mirrors evaluateUsury: a non-exempt lender above the art. XV cap with no
    // real-property lien is held for counsel whoever arranged the change. No
    // broker-of-record file can cure it, because the §1916.1 exemption needs a
    // real-property lien.
    if (gateApplies) {
      flags.push({
        code: "held_for_counsel",
        reason: `Non-exempt lender: ${rateLabel(mod.noteRatePct, effective)} exceeds the ${capPct}% cap with no real-property lien.`,
        authority: "Cal. Const. art. XV",
      });
      const lenderNoticeRequired = mod.arrangedBy === "lender_or_servicer_only" && !mod.lenderNoticeSentAt;
      if (mod.arrangedBy === "lender_or_servicer_only") {
        flags.push({ code: "no_exemption_representation", reason: `${mod.kind} negotiated only by the lender or servicer; Kubera makes no exemption representation.`, authority: "Civ. Code §1916.1 (SB 1146)" });
        if (lenderNoticeRequired) flags.push({ code: "lender_written_notice_required", reason: "Send the lender written notice that Kubera did not arrange this change and makes no exemption representation." });
      }
      return { status: "held_for_counsel", ...rates, brokerArrangementDocumented: false, lenderNoticeRequired, missing: [], blocking: true, flags };
    }
  }

  if (mod.arrangedBy === "lender_or_servicer_only") {
    flags.push({ code: "no_exemption_representation", reason: `${mod.kind} negotiated only by the lender or servicer; Kubera makes no exemption representation.`, authority: "Civ. Code §1916.1 (SB 1146)" });
    const lenderNoticeRequired = !mod.lenderNoticeSentAt;
    if (lenderNoticeRequired) flags.push({ code: "lender_written_notice_required", reason: "Send the lender written notice that Kubera did not arrange this change and makes no exemption representation." });
    return { status: "no_exemption_representation", ...rates, brokerArrangementDocumented: false, lenderNoticeRequired, missing: [], blocking: false, flags };
  }

  const missing: ModificationEvaluation["missing"] = [];
  if (mod.arrangedBy === "other_licensed_broker") {
    if (!mod.otherBroker) missing.push("other_broker_identity");
  } else {
    missing.push(...missingBrokerElements(mod.elements, { requireOfficerApproval: gateApplies, collateral }));
  }
  if (!mod.agreementRecitesBrokerArrangement) missing.push("agreement_recital");

  if (missing.length) {
    flags.push({ code: "broker_of_record_incomplete", reason: `${mod.kind} file is missing: ${missing.join(", ")}.` });
    if (missing.includes("officer_approval")) {
      flags.push({ code: "officer_approval_required", reason: `Designated-officer approval is required for this ${mod.kind}: ${rateLabel(mod.noteRatePct, effective)} exceeds the ${capPct}% cap.` });
    }
  }
  const blocking = missing.length > 0 && gateApplies;
  return {
    status: missing.length ? "incomplete" : "documented",
    ...rates,
    brokerArrangementDocumented: missing.length === 0,
    lenderNoticeRequired: false,
    missing,
    blocking,
    flags,
  };
}

// ---------------------------------------------------------------------------
// Whole-deal evaluation

export type DealComplianceInput = {
  mlds: { facts: MldsFacts; status: DisclosureStatus | null };
  timer?: { applicationCompletedAt: Date; borrowerObligatedAt?: Date | null; deliveredAt?: Date | null };
  usury?: UsuryFacts;
  modifications?: ModificationFacts[];
  now: Date;
};

export type DealCompliance = {
  mlds: MldsRequirement;
  timer: MldsTimer | null;
  usury: UsuryEvaluation | null;
  modifications: ModificationEvaluation[];
  heldForCounsel: boolean;
  flags: Flag[];
  gates: {
    borrowerCommitment: GateDecision;
    borrowerLoanDocuments: GateDecision;
    closing: GateDecision;
  };
};

function dedupe(flags: Flag[]): Flag[] {
  const seen = new Set<string>();
  return flags.filter((f) => {
    const key = `${f.code}|${f.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Closing-gate reason when the loan has no broker-of-record (gate H) file. */
export const BROKER_OF_RECORD_FILE_MISSING =
  "Record the loan's broker-of-record file (lender, category, note rate, collateral and broker-of-record elements) before closing.";

export function evaluateDealCompliance(input: DealComplianceInput): DealCompliance {
  let mlds = mldsRequirement(input.mlds.facts);
  // Once an MLDS case is open it stays required until it is signed (or
  // superseded), whatever the collateral facts say now: editing the collateral
  // must not drop an open RE 882 from the closing gate.
  if (!mlds.required && input.mlds.status !== null && input.mlds.status !== "superseded") {
    mlds = {
      ...mlds,
      required: true,
      form: "RE882",
      reasons: [...mlds.reasons, "An MLDS case is already open on this deal, so a signed MLDS is still required."],
    };
  }
  const caseState: MldsCaseState = { requirement: mlds, status: input.mlds.status };
  const flags: Flag[] = [...mlds.flags];

  let timer: MldsTimer | null = null;
  if (mlds.required && input.timer) {
    timer = computeMldsTimer({ ...input.timer, now: input.now });
    if (timer.status === "warning") flags.push({ code: "mlds_warning", reason: `MLDS due ${timer.dueAt.toISOString()} (${timer.dueReason === "before_obligation" ? "before the borrower is obligated" : "3 business days"}).` });
    if (timer.status === "overdue") flags.push({ code: "mlds_overdue", reason: `MLDS was due ${timer.dueAt.toISOString()} and has not been delivered.`, authority: "B&P §10240" });
    if (timer.status === "late") flags.push({ code: "mlds_late", reason: `MLDS was delivered after its ${timer.dueAt.toISOString()} due time.`, authority: "B&P §10240" });
  }

  const usury = input.usury ? evaluateUsury(input.usury) : null;
  if (usury) flags.push(...usury.flags);

  const parsedUsury = input.usury ? usuryFactsSchema.parse(input.usury) : null;
  const pendingModifications = input.modifications ?? [];
  // Without the loan's usury facts (lender, collateral, discount rate) a
  // modification cannot be evaluated; it is reported below and blocks closing.
  const modifications = parsedUsury
    ? pendingModifications.map((m) => evaluateModification(m, { lender: parsedUsury.lender, fedDiscountRatePct: parsedUsury.fedDiscountRatePct, collateral: parsedUsury.collateral }))
    : [];
  for (const m of modifications) flags.push(...m.flags);
  if (!usury) {
    flags.push({ code: "broker_of_record_incomplete", reason: "No broker-of-record file (gate H) is recorded for this loan." });
  }

  const all = dedupe(flags);
  const heldForCounsel = all.some((f) => f.code === "held_for_counsel") || input.mlds.status === "held_for_counsel";

  const closingReasons: string[] = [];
  if (heldForCounsel) closingReasons.push("Deal is held for counsel review.");
  if (mlds.required && input.mlds.status !== "signed") closingReasons.push("No deal moves to closing without a signed MLDS (RE 882) on file.");
  // Gate H elements are recorded on every loan: fail closed when the file is absent.
  if (!usury) closingReasons.push(BROKER_OF_RECORD_FILE_MISSING);
  if (!parsedUsury && pendingModifications.length) {
    closingReasons.push(`${pendingModifications.length} recorded modification(s) cannot be evaluated until the loan's broker-of-record file is recorded.`);
  }
  if (usury?.blocking) closingReasons.push(...usury.reasons, ...usury.missing.map((m) => `Missing: ${BROKER_ELEMENT_LABELS[m]}`));
  for (const m of modifications) {
    if (!m.blocking) continue;
    const held = m.flags.find((f) => f.code === "held_for_counsel");
    closingReasons.push(held ? `A modification is held for counsel: ${held.reason}` : "A broker-arranged modification is not cleared.");
  }

  return {
    mlds,
    timer,
    usury,
    modifications,
    heldForCounsel,
    flags: all,
    gates: {
      borrowerCommitment: heldForCounsel ? { allowed: false, reasons: ["Deal is held for counsel review."] } : borrowerDocumentGate("commitment", caseState),
      borrowerLoanDocuments: heldForCounsel ? { allowed: false, reasons: ["Deal is held for counsel review."] } : borrowerDocumentGate("loan_document", caseState),
      closing: closingReasons.length ? { allowed: false, reasons: [...new Set(closingReasons)] } : allow(),
    },
  };
}

/** Stage-advance gate for the pipeline (WS-T stage templates call this). */
export function stageAdvanceGate(targetStage: string, compliance: DealCompliance): GateDecision {
  return CLOSING_STAGES.has(targetStage.toLowerCase()) ? compliance.gates.closing : allow();
}

// ---------------------------------------------------------------------------
// Copy guard: never state that a specific loan is usury-exempt.

/** Neutral wording approved for the advisor and documents (counsel gate H, replacement line 2). */
export const USURY_NEUTRAL_STATEMENT =
  "California limits interest on some loans, but exemptions exist, including for certain lenders and for real-property-secured loans made or arranged by a licensed real estate broker (Civ. Code §1916.1). Whether one applies depends on the lender, collateral, and how the loan and any later changes are arranged. Kubera does not give legal advice; ask your attorney.";

const EXEMPTION_CLAIM = [
  /\b(this|your|the|our)\s+(loan|note|deal|financing)\s+(is|will be|would be)\s+(fully\s+)?(usury[- ]?)?exempt\b/gi,
  /\b(is|are|will be)\s+exempt\s+from\s+(california\s+)?usury\b/gi,
  /\busury[- ]exempt\s+(loans?|notes?|financing)\b/gi,
  /\bno\s+usury\s+(risk|limits?|cap)\s+(applies|apply)\b/gi,
];

/** A negation shortly before the match ("not a determination that the loan is exempt") is not a claim. */
const NEGATION_BEFORE = /\b(not|never|whether|cannot)\b[^.!?]{0,40}$/i;

/** True when `text` asserts that a specific loan is exempt from usury limits. */
export function containsExemptionClaim(text: string): boolean {
  return EXEMPTION_CLAIM.some((re) =>
    [...text.matchAll(re)].some((m) => !NEGATION_BEFORE.test(text.slice(Math.max(0, (m.index ?? 0) - 60), m.index ?? 0))),
  );
}
