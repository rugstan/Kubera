// The lender-ready meter (spec 4.6). Screen and Term sheet are scored against
// the requirement table (requirements.ts); Underwrite adds the deal
// checklist's required application and underwriting items to the Term sheet
// set, since a lender underwriting the loan needs everything a term sheet
// needed plus the full file. Readiness never says "approved" or "qualified":
// it measures what Corin has in hand, not what a lender will decide.
//
// Hard stops (open sanctions holds, a deal that is not open and active) are
// listed separately: they block a send on their own and no override reason
// lifts them. Pure (no server imports), so the meter can render anywhere.

import { isTerminalStage } from "../stage-catalog";
import { submissionFixHref } from "./playbooks";
import { RECEIVED_STATUSES, SUBMISSION_REQUIREMENTS, playbookOf, requirementLevel, type SubmissionRequirement } from "./requirements";
import { TARGET_STAGE_LABELS, type FieldSource, type Readiness, type ReadinessItem, type SubmissionContext, type SubmissionMetrics, type TargetStage } from "./types";

/** Prefix of Underwrite items that come from the deal checklist. */
export const CHECKLIST_REQUIREMENT_PREFIX = "checklist.";

function perBorrowerFor(req: SubmissionRequirement, ctx: SubmissionContext): boolean {
  if (req.perBorrower) return req.perBorrower(ctx);
  if (!req.fields?.length || !ctx.profile) return false;
  const sources = ctx.profile.fieldSources as Record<string, FieldSource | undefined>;
  const values = ctx.profile as unknown as Record<string, unknown>;
  const setFields = req.fields.filter((f) => {
    if (f.startsWith("programDetails.")) {
      const [, section, key] = f.split(".");
      const sec = (ctx.profile!.programDetails as Record<string, Record<string, unknown> | undefined>)[section!];
      return sec?.[key!] !== undefined;
    }
    const v = values[f];
    return v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0);
  });
  return setFields.length > 0 && setFields.every((f) => sources[f]?.source === "borrower");
}

function hardStops(ctx: SubmissionContext): string[] {
  const out: string[] = [];
  const status = ctx.deal.status ?? "active";
  if (status === "on_hold" || status === "held_for_counsel") out.push(`The deal is ${status.replace(/_/g, " ")}; nothing goes to lenders until the hold is released.`);
  else if (status !== "active" || isTerminalStage(ctx.deal.stage)) out.push(`The deal is ${status === "active" ? ctx.deal.stage.replace(/_/g, " ") : status}; it cannot go to lenders.`);
  for (const h of ctx.openHolds) out.push(`On hold: ${h}`);
  return out;
}

function evaluateTable(ctx: SubmissionContext, metrics: SubmissionMetrics, stage: "screen" | "term_sheet"): { required: ReadinessItem[]; recommended: ReadinessItem[] } {
  const playbook = playbookOf(ctx);
  const required: ReadinessItem[] = [];
  const recommended: ReadinessItem[] = [];
  for (const req of SUBMISSION_REQUIREMENTS) {
    const level = requirementLevel(req, playbook, stage, ctx);
    if (!level) continue;
    if (req.when && !req.when(ctx)) continue;
    const met = stage === "term_sheet" && req.termSheetMet ? req.termSheetMet(ctx, metrics) : req.met(ctx, metrics);
    const target = req.resolveFix?.(ctx) ?? req.fix.target;
    const item: ReadinessItem = { id: req.id, section: req.section, label: req.label, met, perBorrower: met && perBorrowerFor(req, ctx), fix: { href: submissionFixHref(ctx.deal.id, target), hint: req.fix.hint } };
    (level === "required" ? required : recommended).push(item);
  }
  return { required, recommended };
}

/** The deal checklist's application and underwriting items as Underwrite requirements (required items count; optional ones are listed as recommended). */
function checklistItems(ctx: SubmissionContext): { required: ReadinessItem[]; recommended: ReadinessItem[] } {
  const required: ReadinessItem[] = [];
  const recommended: ReadinessItem[] = [];
  for (const i of ctx.checklistItems) {
    if (i.stage !== "application" && i.stage !== "underwriting") continue;
    if (i.status === "not_applicable") continue;
    const item: ReadinessItem = {
      id: `${CHECKLIST_REQUIREMENT_PREFIX}${i.itemKey}`,
      section: "documents",
      label: i.title,
      met: RECEIVED_STATUSES.includes(i.status),
      perBorrower: false,
      fix: { href: submissionFixHref(ctx.deal.id, { kind: "checklist", itemId: i.id }), hint: i.status === "rejected" ? "The document needs attention on the checklist." : "Collect it on the deal checklist." },
    };
    (i.required ? required : recommended).push(item);
  }
  return { required, recommended };
}

/**
 * Readiness for one target stage. `score` counts required items only
 * (whole-number percent; 100 when nothing is required), `ready` is every
 * required item met, `missing` lists the unmet required ids.
 */
export function evaluateReadiness(ctx: SubmissionContext, metrics: SubmissionMetrics, stage: TargetStage): Readiness {
  const table = evaluateTable(ctx, metrics, stage === "screen" ? "screen" : "term_sheet");
  const docs = stage === "underwrite" ? checklistItems(ctx) : { required: [], recommended: [] };
  const required = [...table.required, ...docs.required];
  const recommended = [...table.recommended, ...docs.recommended];
  const metCount = required.filter((i) => i.met).length;
  const missing = required.filter((i) => !i.met).map((i) => i.id);
  return {
    playbook: playbookOf(ctx),
    stage,
    required,
    recommended,
    score: required.length ? Math.floor((metCount / required.length) * 100) : 100,
    ready: missing.length === 0,
    missing,
    hardStops: hardStops(ctx),
  };
}

/** All three stages, for the meter. */
export function evaluateAllStages(ctx: SubmissionContext, metrics: SubmissionMetrics): Record<TargetStage, Readiness> {
  return { screen: evaluateReadiness(ctx, metrics, "screen"), term_sheet: evaluateReadiness(ctx, metrics, "term_sheet"), underwrite: evaluateReadiness(ctx, metrics, "underwrite") };
}

/** The highest stage that is ready, else Screen (the preview's default target, spec 5.1). */
export function defaultTargetStage(byStage: Record<TargetStage, Readiness>): TargetStage {
  if (byStage.underwrite.ready) return "underwrite";
  if (byStage.term_sheet.ready) return "term_sheet";
  return "screen";
}

/** The meter's label: "Lender-ready for a soft quote" (never "approved" or "qualified"). */
export function readinessHeadline(r: Pick<Readiness, "stage" | "ready" | "required" | "missing">): string {
  const what = r.stage === "screen" ? "a soft quote" : r.stage === "term_sheet" ? "a term sheet" : "full underwriting";
  const met = r.required.length - r.missing.length;
  return r.ready ? `Lender-ready for ${what}` : `${TARGET_STAGE_LABELS[r.stage]}: ${met} of ${r.required.length} required items in hand`;
}

/**
 * Unmet required items as the lender email may print them. A per-principal
 * checklist item's title carries the principal's name ("Personal financial
 * statement — <name>"); here it is the item alone, counted ("Personal
 * financial statement (2 principals)"), so no name reaches the email.
 */
export function lenderSafeMissingLabels(readiness: Pick<Readiness, "required">, ctx: Pick<SubmissionContext, "checklistItems">): string[] {
  const out: string[] = [];
  const perPrincipal = new Map<string, number>();
  for (const item of readiness.required) {
    if (item.met) continue;
    const source = item.id.startsWith(CHECKLIST_REQUIREMENT_PREFIX) ? ctx.checklistItems.find((c) => `${CHECKLIST_REQUIREMENT_PREFIX}${c.itemKey}` === item.id) : undefined;
    if (!source?.principalId) {
      out.push(item.label);
      continue;
    }
    const base = source.title.split(" — ")[0]!.trim();
    if (!perPrincipal.has(base)) out.push(base);
    perPrincipal.set(base, (perPrincipal.get(base) ?? 0) + 1);
  }
  return out.map((label) => {
    const n = perPrincipal.get(label);
    return n && n > 1 ? `${label} (${n} principals)` : label;
  });
}

/** The refusal staff see when required items are missing and no reason was given (spec 5.2). */
export function notReadyMessage(stage: TargetStage, labels: readonly string[]): string {
  const what = stage === "screen" ? "a soft-quote request" : stage === "term_sheet" ? "a term-sheet request" : "an underwriting request";
  const n = labels.length;
  return `${n} required item${n === 1 ? " is" : "s are"} missing for ${what}: ${labels.join("; ")}. Add ${n === 1 ? "it" : "them"} or give a reason to send anyway.`;
}
