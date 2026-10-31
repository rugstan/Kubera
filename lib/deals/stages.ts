// Per-program stage templates: the stages a deal moves through, the events
// that advance it, the requirements each event checks, and the fields locked
// once the borrower accepts a term sheet. Templates are code (versioned); a
// published copy lives in `stage_templates` so every deal records the exact
// version it runs on.
//
// Closing stages call the compliance gate (lib/compliance/gates.ts): no deal
// reaches `closing` without a signed MLDS where one is required, while held for
// counsel, or with an uncleared usury / modification file. Gate A also blocks
// every step that puts a commitment or loan documents in front of the borrower
// (term-sheet acceptance, the commitment / firm commitment / SBA authorization
// stages, and scheduling closing) until the MLDS is signed: those events carry
// `compliance_commitment` / `compliance_loan_documents`.

import { createHash } from "node:crypto";
import { stageAdvanceGate, type DealCompliance } from "@/lib/compliance/gates";
import { POST_TERM_SHEET, STAGE_LABELS, TERMINAL_STAGE_STATUS, isTerminalStage } from "./stage-catalog";
import { DEAL_PROGRAM_LABELS, isSbaProgram, type Deal, type DealProgram } from "./types";

export type StageDef = { key: string; label: string; terminal?: boolean };

export type Requirement =
  | "engagement_agreement"
  | "locked_package_sent"
  | "term_sheet_ref"
  | "terms_snapshot"
  | "compliance_commitment"
  | "compliance_loan_documents"
  | "compliance_closing"
  | "form159_signed";

export type EventDef = {
  key: string;
  label: string;
  from: string[];
  to: string;
  requires: Requirement[];
  /** Accepting the term sheet freezes the template's locked fields. */
  locksTerms?: boolean;
};

export type StageTemplate = {
  program: DealProgram;
  version: number;
  name: string;
  stages: StageDef[];
  events: EventDef[];
  lockedFields: string[];
};

/** Deal fields frozen at term-sheet acceptance (plus every key of `lockedTerms`). */
export const LOCKED_DEAL_FIELDS = ["program", "loanAmountCents", "lockedTerms"] as const;

/** Economic terms captured in the `lockedTerms` snapshot. */
export const TERM_SNAPSHOT_KEYS = [
  "lenderName",
  "noteRatePct",
  "termMonths",
  "amortizationMonths",
  "interestOnlyMonths",
  "prepayment",
  "recourse",
  "brokerCompensationCents",
] as const;

const EVENT_INTO: Record<string, { key: string; label: string }> = {
  application: { key: "application_submitted", label: "Lender application submitted" },
  third_party_reports: { key: "reports_ordered", label: "Third-party reports ordered" },
  plan_and_cost_review: { key: "plan_and_cost_review_ordered", label: "Plan and cost review ordered" },
  hud_review: { key: "hud_submitted", label: "Submitted to HUD" },
  firm_commitment: { key: "firm_commitment_issued", label: "HUD firm commitment issued" },
  lender_underwriting: { key: "lender_underwriting_started", label: "Lender underwriting started" },
  sba_authorization: { key: "sba_authorization_issued", label: "SBA authorization issued" },
  underwriting: { key: "underwriting_started", label: "Underwriting started" },
  commitment: { key: "commitment_issued", label: "Lender commitment issued" },
};

export const STAGE_TEMPLATE_VERSION = 1;

/**
 * Stages whose entry means a lender commitment (or the SBA authorization the
 * lender commits on) goes to the borrower. Events into them run gate A's
 * borrower-commitment check: no commitment before a signed MLDS.
 */
export const COMMITMENT_STAGES: ReadonlySet<string> = new Set(["commitment", "firm_commitment", "sba_authorization"]);

function buildTemplate(program: DealProgram): StageTemplate {
  const middle = POST_TERM_SHEET[program];
  const order = ["intake", "engaged", "packaging", "lender_outreach", "term_sheet", ...middle, "closing", "closed"];
  const stages: StageDef[] = [...order, "withdrawn", "lost"].map((key) => ({
    key,
    label: STAGE_LABELS[key] ?? key,
    ...(key === "closed" || key === "withdrawn" || key === "lost" ? { terminal: true } : {}),
  }));

  const closingRequires: Requirement[] = isSbaProgram(program) ? ["compliance_closing", "form159_signed"] : ["compliance_closing"];
  // Scheduling closing sends the loan documents to the borrower for signature.
  const closingScheduledRequires: Requirement[] = ["compliance_loan_documents", ...closingRequires];
  const events: EventDef[] = [
    { key: "engagement_signed", label: "Engagement / fee agreement signed", from: ["intake"], to: "engaged", requires: ["engagement_agreement"] },
    { key: "packaging_started", label: "Packaging started", from: ["engaged"], to: "packaging", requires: [] },
    { key: "package_sent", label: "Locked package sent to a lender", from: ["packaging"], to: "lender_outreach", requires: ["locked_package_sent"] },
    { key: "term_sheet_received", label: "Term sheet received", from: ["lender_outreach"], to: "term_sheet", requires: ["term_sheet_ref"] },
    { key: "term_sheet_declined", label: "Term sheet declined; back to outreach", from: ["term_sheet"], to: "lender_outreach", requires: [] },
    {
      key: "term_sheet_accepted",
      label: "Term sheet accepted (terms lock)",
      from: ["term_sheet"],
      to: middle[0] ?? "closing",
      // Accepting the term sheet commits the borrower to the lender's terms: no
      // commitment goes to the borrower before a signed MLDS (gate A).
      requires: middle.length ? ["term_sheet_ref", "terms_snapshot", "compliance_commitment"] : ["term_sheet_ref", "terms_snapshot", "compliance_commitment", ...closingScheduledRequires],
      locksTerms: true,
    },
  ];
  for (let i = 1; i < middle.length; i++) {
    const into = EVENT_INTO[middle[i]!]!;
    events.push({ key: into.key, label: into.label, from: [middle[i - 1]!], to: middle[i]!, requires: COMMITMENT_STAGES.has(middle[i]!) ? ["compliance_commitment"] : [] });
  }
  events.push(
    { key: "closing_scheduled", label: "Closing scheduled", from: [middle.at(-1) ?? "term_sheet"], to: "closing", requires: closingScheduledRequires },
    { key: "loan_closed", label: "Loan closed (lender of record funded)", from: ["closing"], to: "closed", requires: closingRequires },
    { key: "withdraw", label: "Borrower withdrew", from: order.filter((s) => s !== "closed"), to: "withdrawn", requires: [] },
    { key: "mark_lost", label: "Deal lost", from: order.filter((s) => s !== "closed"), to: "lost", requires: [] },
  );
  return {
    program,
    version: STAGE_TEMPLATE_VERSION,
    name: `${DEAL_PROGRAM_LABELS[program]} · v${STAGE_TEMPLATE_VERSION}`,
    stages,
    events,
    lockedFields: [...LOCKED_DEAL_FIELDS, ...TERM_SNAPSHOT_KEYS.map((k) => `lockedTerms.${k}`)],
  };
}

const TEMPLATES = new Map<DealProgram, StageTemplate>();

export function stageTemplate(program: DealProgram): StageTemplate {
  let t = TEMPLATES.get(program);
  if (!t) {
    t = buildTemplate(program);
    TEMPLATES.set(program, t);
  }
  return t;
}

/** Stable digest of a template (published with the `stage_templates` row). */
export function templateDigest(t: StageTemplate): string {
  return createHash("sha256").update(JSON.stringify({ program: t.program, version: t.version, stages: t.stages, events: t.events, lockedFields: t.lockedFields })).digest("hex");
}

export function stageLabel(program: DealProgram, key: string): string {
  return stageTemplate(program).stages.find((s) => s.key === key)?.label ?? key;
}

export function availableEvents(template: StageTemplate, stage: string): EventDef[] {
  return template.events.filter((e) => e.from.includes(stage));
}

// ---------------------------------------------------------------------------
// Advancing

/** Facts the requirements are checked against (loaded by the caller). */
export type StageContext = {
  engagementAgreementRef?: string | null;
  /** At least one locked package version has been sent to a lender. */
  lockedPackageSent?: boolean;
  termSheetRef?: string | null;
  /**
   * Compliance evaluation for the deal (gate A/H); required for term-sheet
   * acceptance, the commitment stages and closing. null/absent fails closed.
   */
  compliance?: DealCompliance | null;
  /** SBA deals: Form 159 is signed by agent, applicant and lender, or no Kubera compensation exists. */
  form159Satisfied?: boolean;
  /**
   * Open holds on the deal (possible or confirmed sanctions match), as reasons.
   * While any is open only the exit events (withdraw, mark lost) apply.
   */
  holds?: string[];
  /**
   * WS-U closing gate (checklists, pre-closing conditions, sanctions screening
   * clear within the rescreen window). When provided, events into closing or
   * closed require `ready`; null means it could not be evaluated (refused).
   */
  closingGate?: { ready: boolean; reasons: string[] } | null;
};

/** Events that only take a deal out of the pipeline; they stay available while the deal is on hold. */
export const EXIT_STAGES: ReadonlySet<string> = new Set(["withdrawn", "lost"]);
/** Target stages the closing gate guards. */
export const CLOSING_TARGET_STAGES: ReadonlySet<string> = new Set(["closing", "closed"]);

export type StageEventInput = {
  deal: Deal;
  event: string;
  context: StageContext;
  /** Economic terms accepted with the term sheet (term_sheet_accepted only). */
  terms?: Record<string, unknown>;
  now: Date;
};

export type StageAdvance =
  | { ok: true; from: string; to: string; event: EventDef; patch: Partial<Deal> }
  | { ok: false; from: string; event: string; reasons: string[] };

/** One reason for every compliance requirement of an event when the evaluation is missing (deduplicated). */
function complianceNotEvaluated(to: string): string {
  return `Run the compliance evaluation (MLDS and broker-of-record gates) before moving the deal to ${STAGE_LABELS[to] ?? to}.`;
}

/** Gate A borrower-document check; fails closed when compliance is not evaluated or the gate is absent. */
function borrowerGateReasons(compliance: DealCompliance | null | undefined, gate: "borrowerCommitment" | "borrowerLoanDocuments", to: string): string[] {
  const decision = compliance?.gates?.[gate];
  if (!decision) return [complianceNotEvaluated(to)];
  if (decision.allowed) return [];
  const what = gate === "borrowerCommitment" ? "a commitment" : "loan documents";
  return decision.reasons.length ? decision.reasons : [`A signed MLDS (RE 882) must be on file before ${what} go to the borrower.`];
}

function requirementReasons(req: Requirement, input: StageEventInput, to: string): string[] {
  const c = input.context;
  switch (req) {
    case "engagement_agreement":
      return c.engagementAgreementRef ? [] : ["Record the signed engagement / fee agreement first."];
    case "locked_package_sent":
      return c.lockedPackageSent ? [] : ["Send a locked package version to at least one lender (through the approval gate) first."];
    case "term_sheet_ref":
      return c.termSheetRef ? [] : ["Attach the lender's term sheet (vault reference) first."];
    case "terms_snapshot": {
      const t = input.terms ?? {};
      const missing = ["lenderName", "noteRatePct", "termMonths"].filter((k) => t[k] === undefined || t[k] === null || t[k] === "");
      return missing.length ? [`Accepted terms are missing: ${missing.join(", ")}.`] : [];
    }
    case "compliance_commitment":
      return borrowerGateReasons(c.compliance, "borrowerCommitment", to);
    case "compliance_loan_documents":
      return borrowerGateReasons(c.compliance, "borrowerLoanDocuments", to);
    case "compliance_closing":
      if (!c.compliance) return [complianceNotEvaluated(to)];
      return stageAdvanceGate(to, c.compliance).reasons;
    case "form159_signed":
      return c.form159Satisfied ? [] : ["SBA Form 159 must be signed by Kubera, the applicant and the lender before closing."];
  }
}

export function applyStageEvent(input: StageEventInput): StageAdvance {
  const template = stageTemplate(input.deal.program);
  const from = input.deal.stage;
  if (input.deal.stageTemplateVersion !== template.version) {
    return { ok: false, from, event: input.event, reasons: [`Deal runs stage template v${input.deal.stageTemplateVersion}; this build only advances v${template.version}.`] };
  }
  const event = template.events.find((e) => e.key === input.event);
  if (!event) return { ok: false, from, event: input.event, reasons: [`Unknown event "${input.event}" for ${template.name}.`] };
  if (!event.from.includes(from)) return { ok: false, from, event: input.event, reasons: [`"${event.label}" does not apply in stage ${stageLabel(input.deal.program, from)}.`] };

  const holds = input.context.holds ?? [];
  if (holds.length && !EXIT_STAGES.has(event.to)) {
    return { ok: false, from, event: input.event, reasons: [...holds.map((h) => `On hold: ${h}`), "Only withdrawing or marking the deal lost is possible until the hold is released."] };
  }

  const reasons = [...new Set(event.requires.flatMap((r) => requirementReasons(r, input, event.to)))];
  if (CLOSING_TARGET_STAGES.has(event.to) && input.context.closingGate !== undefined) {
    const g = input.context.closingGate;
    if (!g) reasons.push("The checklist and sanctions-screening gate could not be evaluated, so the deal cannot go to closing.");
    else if (!g.ready) reasons.push(...(g.reasons.length ? g.reasons : ["The checklist and sanctions-screening gate is not clear."]));
  }
  if (reasons.length) return { ok: false, from, event: input.event, reasons: [...new Set(reasons)] };

  const at = input.now.toISOString();
  const patch: Partial<Deal> = { stage: event.to, stageEnteredAt: at };
  if (event.locksTerms) {
    const terms = Object.fromEntries(TERM_SNAPSHOT_KEYS.filter((k) => input.terms?.[k] !== undefined).map((k) => [k, input.terms![k]]));
    patch.termSheetAcceptedAt = at;
    patch.lockedTerms = terms;
    patch.lockedFields = template.lockedFields;
  }
  if (event.to === "closed") patch.closedOn = at.slice(0, 10);
  // Terminal stages settle the deal's pipeline status (closed → won, lost, withdrawn).
  if (isTerminalStage(event.to)) patch.status = TERMINAL_STAGE_STATUS[event.to];
  return { ok: true, from, to: event.to, event, patch };
}

// ---------------------------------------------------------------------------
// Field locks

export class LockedFieldError extends Error {
  constructor(readonly fields: string[]) {
    super(`Locked since term-sheet acceptance: ${fields.join(", ")}. Record a documented modification to change them.`);
    this.name = "LockedFieldError";
  }
}

/** Locked fields `patch` would change. */
export function lockedChanges(deal: Deal, patch: Partial<Deal>): string[] {
  if (!deal.termSheetAcceptedAt) return [];
  const changed: string[] = [];
  for (const f of LOCKED_DEAL_FIELDS) {
    if (!(f in patch)) continue;
    if (JSON.stringify(patch[f] ?? null) !== JSON.stringify(deal[f] ?? null)) changed.push(f);
  }
  if ("termSheetAcceptedAt" in patch && patch.termSheetAcceptedAt !== deal.termSheetAcceptedAt) changed.push("termSheetAcceptedAt");
  return changed;
}

/**
 * Throws LockedFieldError when `patch` changes locked terms without a new
 * documented modification reference (`lockOverrideRef`).
 */
export function assertEditable(deal: Deal, patch: Partial<Deal>): void {
  const changed = lockedChanges(deal, patch);
  if (!changed.length) return;
  const override = patch.lockOverrideRef;
  if (override && override !== deal.lockOverrideRef) return;
  throw new LockedFieldError(changed);
}
