// The lender submission (spec 5.1): one path from the stored facts to each
// lender's approval request.
//
//   previewSubmission    in memory only: readiness, the summary and every
//                        lender's fit and email. Writes nothing, calls no gate.
//   prepareSubmission    the batch: readiness gate, then the summary is built,
//                        rendered, stored and recorded (deal_summaries), and
//                        the package version is locked with it; then each
//                        lender's fit and exact email.
//   submitDealToLenders  prepareSubmission, then sendPackageToLender per lender
//                        with the submission (lib/deals/packages.ts), which
//                        asks the broker approval gate and mints the link only
//                        after approval.
//
// Nothing here reads or changes LENDER_EMAIL_ENABLED: the lender mailer is
// injected, and null means nothing is emailed (staff get the link and the
// approved text). Sanctions holds and a closed deal stop everything, with or
// without an override reason.

import { dealSummaryPackageItem, sha256Hex, summaryStoragePath } from "@/lib/agents/lenders/package";
import type { CreditBox } from "@/lib/agents/lenders/types";
import type { ApprovalGate } from "@/lib/compliance/approval-gate";
import type { DocumentStorage } from "@/lib/disclosures/store";
import { PackageError, assertDealCanGoToLenders, lockPackageVersion, outreachMessage, sendPackageToLender, type DealHoldReader, type LenderMailer, type SendPackageResult } from "../packages";
import type { DealDeskStore } from "../store";
import type { DealPackage, LenderPanelEntry, PackageItem } from "../types";
import { buildLenderEmail, emailLenderFrom, emailNameCheck, type LenderEmail } from "./email";
import { evaluateReadiness, lenderSafeMissingLabels, notReadyMessage } from "./readiness";
import { EmailSafetyError, checkNeutralCopy, type NeutralCopyFlag } from "./redaction";
import { buildDealSummary, staffTypedText, summarySpecSha256 } from "./summary";
import { lenderFit, tailorDealFrom } from "./tailor";
import { OVERRIDE_REASON_LENGTH, type DealSummaryRecord, type DealSummarySpec, type EmailAdvisor, type LenderFit, type Readiness, type SubmissionContext, type SubmissionMetrics, type SubmissionSendInput, type SubmissionStore, type TargetStage } from "./types";

/**
 * What the integrator wires (lib/deals/runtime.ts and the lender desk runtime).
 * Every dependency is an interface or a function over the frozen types.
 */
export type SubmissionSendDeps = {
  /** The deal desk store (packages, lenders, outreach). */
  desk: DealDeskStore;
  /** deal_summaries: insertSummary returns the existing row on (deal_id, pdf_sha256); getSummary is the send gate's check. */
  summaries: Pick<SubmissionStore, "insertSummary" | "getSummary">;
  /** The vault bucket the summary PDF is written to (content-addressed path). */
  storage: Pick<DocumentStorage, "put">;
  /** lib/agents/lenders/package-pdf.tsx renderDealSummaryPdf. */
  renderPdf: (spec: DealSummarySpec) => Promise<Uint8Array>;
  /** lib/deals/submission/context.ts loadSubmissionContext, bound to the runtime; null when the deal is not found. */
  loadContext: (dealId: string) => Promise<SubmissionContext | null>;
  /** lib/deals/submission/metrics.ts computeSubmissionMetrics. */
  computeMetrics: (ctx: SubmissionContext) => SubmissionMetrics;
  /** Approved credit boxes for the fit (lib/agents/lenders CreditBoxStore); null = none recorded. */
  boxes: { listBoxes(opts?: { status?: CreditBox["status"] }): Promise<CreditBox[]> } | null;
  gate: ApprovalGate;
  now: () => Date;
  baseUrl: string;
  /** The lender mailer: null unless LENDER_EMAIL_ENABLED=true (decided by the runtime, never here). */
  mailer: LenderMailer | null;
  holds: DealHoldReader | null;
};

export const MAX_LENDERS_PER_SUBMISSION = 25;

export type PreparedLender = {
  lender: LenderPanelEntry;
  fit: LenderFit;
  email: LenderEmail;
  /** What sendPackageToLender takes for this lender. */
  submission: SubmissionSendInput;
};

/** The summary as stored and the package version it was locked into. */
export type LockedSubmission = {
  summary: DealSummaryRecord;
  summaryItem: PackageItem;
  /** The vault documents plus the deal summary: the locked manifest. */
  items: PackageItem[];
  pkg: DealPackage;
};

export type SkippedLender = { lenderId: string; lenderName: string; error: string; fit: LenderFit | null };

export type PreparedSubmission = {
  ctx: SubmissionContext;
  metrics: SubmissionMetrics;
  readiness: Readiness;
  /** Null when no lender was admitted: then nothing was stored or locked. */
  locked: LockedSubmission | null;
  lenders: PreparedLender[];
  /** Lenders not prepared: not on the panel, refused by `admit`, or their email failed a check. */
  skipped: SkippedLender[];
};

export type PrepareInput = {
  dealId: string;
  targetStage: TargetStage;
  lenderIds: readonly string[];
  /** Vault documents (verified clean and hashed, lib/deals/runtime.ts vaultItems). The deal summary is added. */
  items: readonly PackageItem[];
  advisor: EmailAdvisor;
  actor: string;
  /** Why to send with required items missing (20–1000 characters); shown to the approving broker. */
  overrideReason?: string | null;
  /** Decides, before anything is stored, whether a lender may be submitted to; returns the refusal, or null to admit. */
  admit?: (lender: LenderPanelEntry, fit: LenderFit) => string | null;
};

function uniqueLenderIds(ids: readonly string[]): string[] {
  const out = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (!out.length) throw new PackageError("invalid", "Choose at least one lender");
  if (out.length > MAX_LENDERS_PER_SUBMISSION) throw new PackageError("invalid", `Submit to at most ${MAX_LENDERS_PER_SUBMISSION} lenders at a time`);
  return out;
}

function missingLabels(readiness: Readiness): string[] {
  return readiness.required.filter((i) => !i.met).map((i) => i.label);
}

/** The readiness gate before anything is stored: hard stops, then missing items without a valid reason. */
function gateReadiness(readiness: Readiness, overrideReason: string | null | undefined): string | null {
  if (readiness.hardStops.length) throw new PackageError("deal_held", `${readiness.hardStops.join(" ")} A reason to send anyway does not lift a hold.`);
  if (!readiness.missing.length) return null;
  const reason = overrideReason?.trim() || null;
  if (!reason) throw new PackageError("not_ready", notReadyMessage(readiness.stage, missingLabels(readiness)));
  if (reason.length < OVERRIDE_REASON_LENGTH.min || reason.length > OVERRIDE_REASON_LENGTH.max) {
    throw new PackageError("not_ready", `The reason to send with items missing must be ${OVERRIDE_REASON_LENGTH.min} to ${OVERRIDE_REASON_LENGTH.max} characters.`);
  }
  return reason;
}

/** The deal summary placeholder a preview lists before the PDF exists (the email prints it by kind, so the text matches). */
const PREVIEW_SUMMARY_ITEM: Pick<PackageItem, "documentId" | "label" | "kind"> = { documentId: "deal-summary-preview", label: "Deal summary (Corin)", kind: "DEAL_SUMMARY" };

export type SubmissionPreview = {
  readiness: Readiness;
  summary: DealSummarySpec;
  /** Fair-lending prompts on staff-typed text (spec 6.5): staff edit it, or confirm and the approving broker sees the flags. */
  neutralCopy: NeutralCopyFlag[];
  lenders: ({ lender: LenderPanelEntry; fit: LenderFit } & ({ ok: true; email: LenderEmail } | { ok: false; error: string }))[];
};

/**
 * The preview page's data (spec 5.1 step 2): built in memory on each view;
 * writes nothing and calls no gate. The email text equals what
 * prepareSubmission builds for the same facts and documents.
 */
export function previewSubmission(input: {
  ctx: SubmissionContext;
  metrics: SubmissionMetrics;
  stage: TargetStage;
  lenders: readonly LenderPanelEntry[];
  boxes: readonly CreditBox[];
  /** The vault documents staff picked (the deal summary is added). */
  documents: readonly Pick<PackageItem, "documentId" | "label" | "kind">[];
  advisor: EmailAdvisor;
}): SubmissionPreview {
  const { ctx, metrics, stage } = input;
  const readiness = evaluateReadiness(ctx, metrics, stage);
  const openItems = missingLabels(readiness);
  const lenderOpenItems = lenderSafeMissingLabels(readiness, ctx);
  const summary = buildDealSummary(ctx, metrics, stage, { openItems, advisor: { name: input.advisor.name, email: input.advisor.email, dreLicense: input.advisor.dreLicense } });
  const deal = tailorDealFrom(ctx);
  const documents = [PREVIEW_SUMMARY_ITEM, ...input.documents.filter((d) => d.kind !== "DEAL_SUMMARY")];
  const lenders = input.lenders.map((lender) => {
    const fit = lenderFit(lender, input.boxes, deal, metrics.metrics);
    try {
      const email = buildLenderEmail({ ctx, metrics, stage, lender: emailLenderFrom(lender), fit, documents, notYetInHand: lenderOpenItems, advisor: input.advisor });
      return { lender, fit, ok: true as const, email };
    } catch (err) {
      if (err instanceof EmailSafetyError || (err instanceof Error && err.name === "PackageCopyError")) return { lender, fit, ok: false as const, error: err.message };
      throw err;
    }
  });
  return { readiness, summary, neutralCopy: checkNeutralCopy(staffTypedText(ctx)), lenders };
}

/**
 * Request-approval step 1 (spec 5.1 step 3): for the batch, checks readiness
 * (nothing is stored or locked when items are missing without a reason),
 * builds, renders, stores and records the summary, adds it to the manifest
 * and locks the package version; then, per lender, the fit and the exact
 * email. Throws PackageError (deal_held, deal_closed, not_ready, invalid,
 * deal_not_found), PackageCopyError or EmailSafetyError.
 */
export async function prepareSubmission(deps: SubmissionSendDeps, input: PrepareInput): Promise<PreparedSubmission> {
  const lenderIds = uniqueLenderIds(input.lenderIds);
  const deal = await deps.desk.getDeal(input.dealId);
  if (!deal) throw new PackageError("deal_not_found", `Deal ${input.dealId} not found`);
  // Holds and deal status first: they win over any override reason.
  await assertDealCanGoToLenders(deps, deal);
  const ctx = await deps.loadContext(deal.id);
  if (!ctx) throw new PackageError("deal_not_found", `Deal ${input.dealId} not found`);
  const metrics = deps.computeMetrics(ctx);
  const readiness = evaluateReadiness(ctx, metrics, input.targetStage);
  const overrideReason = gateReadiness(readiness, input.overrideReason);
  if (!ctx.profile) throw new PackageError("not_ready", "Start the deal's submission profile before sending it to lenders.");

  const openItems = missingLabels(readiness);
  const lenderOpenItems = lenderSafeMissingLabels(readiness, ctx);
  // Pure, so overclaiming or unsafe staff text stops the batch before anything is stored.
  const spec = buildDealSummary(ctx, metrics, input.targetStage, { openItems, advisor: { name: input.advisor.name, email: input.advisor.email, dreLicense: input.advisor.dreLicense } });

  // Each lender's fit, admission and email are decided before anything is stored.
  const [panel, boxes] = await Promise.all([deps.desk.listLenders(), deps.boxes ? deps.boxes.listBoxes({ status: "approved" }) : Promise.resolve([] as CreditBox[])]);
  const tailorDeal = tailorDealFrom(ctx);
  const provisionalDocs = [PREVIEW_SUMMARY_ITEM, ...input.items.filter((i) => i.kind !== "DEAL_SUMMARY")];
  const admitted: { lender: LenderPanelEntry; fit: LenderFit }[] = [];
  const skipped: SkippedLender[] = [];
  for (const lenderId of lenderIds) {
    const lender = panel.find((l) => l.id === lenderId);
    if (!lender) {
      skipped.push({ lenderId, lenderName: lenderId, error: "Lender not found on the panel", fit: null });
      continue;
    }
    const fit = lenderFit(lender, boxes, tailorDeal, metrics.metrics);
    const refusal = input.admit?.(lender, fit) ?? null;
    if (refusal) {
      skipped.push({ lenderId, lenderName: lender.name, error: refusal, fit });
      continue;
    }
    try {
      buildLenderEmail({ ctx, metrics, stage: input.targetStage, lender: emailLenderFrom(lender), fit, documents: provisionalDocs, notYetInHand: lenderOpenItems, advisor: input.advisor });
    } catch (err) {
      if (err instanceof EmailSafetyError) {
        skipped.push({ lenderId, lenderName: lender.name, error: err.message, fit });
        continue;
      }
      throw err;
    }
    admitted.push({ lender, fit });
  }
  if (!admitted.length) return { ctx, metrics, readiness, locked: null, lenders: [], skipped };

  const now = deps.now();
  const pdf = await deps.renderPdf(spec);
  const pdfSha256 = sha256Hex(pdf);
  const summaryItem = dealSummaryPackageItem(deal.id, pdfSha256);
  await deps.storage.put(summaryStoragePath(deal.id, pdfSha256), pdf, "application/pdf");
  const summary = await deps.summaries.insertSummary(
    {
      dealId: deal.id,
      asOf: spec.asOf,
      playbook: ctx.profile.playbook,
      targetStage: input.targetStage,
      templateVersion: spec.templateVersion,
      spec,
      specSha256: summarySpecSha256(spec),
      pdfSha256,
      pdfStoragePath: summaryItem.storagePath,
      profileVersion: ctx.profile.recordVersion,
      sponsorVersion: ctx.sponsor?.recordVersion ?? null,
      createdBy: input.actor,
    },
    now,
  );

  const items = [...input.items.filter((i) => i.kind !== "DEAL_SUMMARY" && i.documentId !== summaryItem.documentId), summaryItem];
  const { pkg } = await lockPackageVersion(deps.desk, deal.id, items, input.actor, now);

  // The emails list the locked manifest (the same text the pre-check built: documents print by kind and label).
  const lenders: PreparedLender[] = admitted.map(({ lender, fit }) => {
    const email: LenderEmail = buildLenderEmail({ ctx, metrics, stage: input.targetStage, lender: emailLenderFrom(lender), fit, documents: pkg.manifest, notYetInHand: lenderOpenItems, advisor: input.advisor });
    return {
      lender,
      fit,
      email,
      submission: {
        targetStage: input.targetStage,
        summaryId: summary.id,
        readiness: { missing: [...readiness.missing], hardStops: [...readiness.hardStops], score: readiness.score },
        ...(overrideReason ? { overrideReason } : {}),
        fit,
        email: { subject: email.subject, text: email.text, sha256: email.sha256 },
        nameCheck: emailNameCheck(ctx, emailLenderFrom(lender), input.advisor),
      },
    };
  });
  return { ctx, metrics, readiness, locked: { summary, summaryItem, items, pkg }, lenders, skipped };
}

export type SubmitDealInput = PrepareInput & {
  /** Required to submit to a lender whose fit has exceptions (spec 5.6); shown to the approving broker. */
  lenderOverrideReason?: string | null;
  allowStaleLender?: boolean;
  note?: string | null;
  ttlDays?: number;
};

export type SubmitDealOutcome =
  | { lenderId: string; lenderName: string; ok: true; result: SendPackageResult; message: string; fit: LenderFit }
  | { lenderId: string; lenderName: string; ok: false; error: string; fit: LenderFit | null };

export type SubmitDealResult = { prepared: PreparedSubmission; outcomes: SubmitDealOutcome[] };

/** Sends one prepared lender through the approval gate (lib/deals/packages.ts sendPackageToLender). */
export async function sendPreparedToLender(
  deps: Omit<SubmissionSendDeps, "storage" | "renderPdf" | "loadContext" | "computeMetrics" | "boxes">,
  locked: Pick<LockedSubmission, "items">,
  lender: PreparedLender,
  opts: { dealId: string; actor: string; allowStaleLender?: boolean; note?: string | null; ttlDays?: number },
): Promise<SendPackageResult> {
  return sendPackageToLender(
    { store: deps.desk, gate: deps.gate, now: deps.now, baseUrl: deps.baseUrl, mailer: deps.mailer, holds: deps.holds, summaries: deps.summaries },
    { dealId: opts.dealId, lenderId: lender.lender.id, items: locked.items, actor: opts.actor, ttlDays: opts.ttlDays, allowStaleLender: opts.allowStaleLender, note: opts.note ?? undefined, submission: lender.submission },
  );
}

/** The refusal for a lender the request falls outside of, when no reason was given (spec 5.6). */
export function fitRefusal(lender: Pick<LenderPanelEntry, "name">, fit: LenderFit, reason: string | null): string | null {
  return fit.exceptions.length && !reason ? `Outside ${lender.name}'s recorded box: ${fit.exceptions.join("; ")}. Add a reason to submit anyway.` : null;
}

/**
 * The send action (spec 5.1 steps 3–6): prepare once, then one approval
 * request per lender. A lender whose fit has exceptions needs
 * `lenderOverrideReason`; when no lender is admitted nothing is stored or
 * locked. With no mailer the result carries the share URL and the approved
 * email for staff to send by hand; nothing is emailed.
 */
export async function submitDealToLenders(deps: SubmissionSendDeps, input: SubmitDealInput): Promise<SubmitDealResult> {
  const lenderOverride = input.lenderOverrideReason?.trim() || null;
  const prepared = await prepareSubmission(deps, { ...input, admit: (lender, fit) => input.admit?.(lender, fit) ?? fitRefusal(lender, fit, lenderOverride) });
  const outcomes: SubmitDealOutcome[] = prepared.skipped.map((s) => ({ lenderId: s.lenderId, lenderName: s.lenderName, ok: false as const, error: s.error, fit: s.fit }));
  const locked = prepared.locked;
  if (!locked) return { prepared, outcomes };
  for (const p of prepared.lenders) {
    const note = [p.fit.exceptions.length && lenderOverride ? `lender fit override: ${lenderOverride}` : null, input.note?.trim() || null].filter(Boolean).join(" — ") || null;
    try {
      const result = await sendPreparedToLender(deps, locked, p, { dealId: prepared.ctx.deal.id, actor: input.actor, allowStaleLender: input.allowStaleLender, note, ttlDays: input.ttlDays });
      outcomes.push({ lenderId: p.lender.id, lenderName: p.lender.name, ok: true, result, message: outreachMessage(result), fit: p.fit });
    } catch (err) {
      if (err instanceof PackageError) outcomes.push({ lenderId: p.lender.id, lenderName: p.lender.name, ok: false, error: err.message, fit: p.fit });
      else throw err;
    }
  }
  return { prepared, outcomes };
}
