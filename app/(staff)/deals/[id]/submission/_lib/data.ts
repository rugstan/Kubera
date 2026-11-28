import "server-only";

// The staff UI's one door to the submission module. Every page, route and
// action under app/(staff)/deals/[id]/submission (and the deal page card, the
// matching desk and the approvals queue) calls only the exported functions
// below, which run on:
//
//   lib/deals/submission/context.ts    loadSubmissionContext (via the deal desk runtime)
//   lib/deals/submission/metrics.ts    computeSubmissionMetrics
//   lib/deals/submission/readiness.ts  evaluateAllStages (requirements.ts behind it)
//   lib/deals/submission/prefill.ts    buildPrefill
//   lib/deals/submission/store.ts      rt.submission.store (Supabase or the demo desks)
//   lib/deals/submission/send.ts       previewSubmission; prepareSubmission and
//                                      sendPreparedToLender through the lender
//                                      desk's submitToLenders (matcher gate and
//                                      decision log, lib/agents/lenders/outreach.ts)
//   lib/agents/lenders/package-pdf.tsx renderDealSummaryPdf
//
// Nothing here sends: a request asks the broker approval gate, and the lender
// mailer is the runtime's (null unless LENDER_EMAIL_ENABLED=true), so with
// email to lenders off staff get the approved text and the link instead.

import { OutreachError, submitToLenders } from "@/lib/agents/lenders/outreach";
import { PackageCopyError } from "@/lib/agents/lenders/package";
import { lenderRuntime } from "@/lib/agents/lenders/runtime";
import type { AssetClass } from "@/lib/agents/lenders/types";
import { lenderStaleness } from "@/lib/deals/lenders";
import { PackageError } from "@/lib/deals/packages";
import { dealDeskRuntime, renderDealSummary, type DealDeskRuntime } from "@/lib/deals/runtime";
import type { StaffSession } from "@/lib/deals/session";
import { GuardError } from "@/lib/deals/store";
import { loadSubmissionContext } from "@/lib/deals/submission/context";
import { computeSubmissionMetrics } from "@/lib/deals/submission/metrics";
import { PLAYBOOK_LABELS, SECTION_LABELS, allowedPlaybooks, defaultPlaybook, visibleSections, type SectionView } from "@/lib/deals/submission/playbooks";
import { PREFILL_ORIGIN_LABELS, buildPrefill, type PrefillSuggestion, type SubmissionPrefill } from "@/lib/deals/submission/prefill";
import { evaluateAllStages } from "@/lib/deals/submission/readiness";
import { EmailSafetyError, type NeutralCopyFlag } from "@/lib/deals/submission/redaction";
import { requirementLabel as tableRequirementLabel } from "@/lib/deals/submission/requirements";
import { previewSubmission } from "@/lib/deals/submission/send";
import { submissionDealProfile, tailorDealFrom } from "@/lib/deals/submission/tailor";
import {
  CONSTRUCTION_CONTRACT_LABELS,
  CREDIT_BAND_LABELS,
  EXIT_STRATEGY_LABELS,
  LIEN_POSITION_LABELS,
  LOAN_PURPOSE_LABELS,
  NOI_BASIS_LABELS,
  OVERRIDE_REASON_LENGTH,
  RATE_TYPE_LABELS,
  RECOURSE_LABELS,
  SIZE_UNIT_LABELS,
  SUBMISSION_ASSET_TYPE_LABELS,
  USE_KIND_LABELS,
  VALUE_SOURCE_LABELS,
  type DealSummarySpec,
  type EmailAdvisor,
  type FieldSource,
  type LenderFit,
  type Readiness,
  type SectionId,
  type SubmissionContext,
  type SubmissionMetrics,
  type SubmissionPlaybook,
  type TargetStage,
  type UseLine,
  type VaultDocumentRef,
} from "@/lib/deals/submission/types";
import type { LenderPanelEntry } from "@/lib/deals/types";
import type { SectionValues } from "./fields";
import { count, date, pct, usd } from "./format";

// ---------------------------------------------------------------------------
// Public types

export type StageReadiness = Record<TargetStage, Readiness>;

/**
 * One suggested value on the "Start from these" panel. `source` is what the
 * profile's field_sources will record; null for the playbook (from the deal
 * program) and the sponsor fields (sponsor facts carry no source and always
 * read "per borrower"), which `tag` names instead.
 */
export type PrefillRow = { name: string; label: string; value: string; source: FieldSource | null; tag: string | null };

/**
 * The suggestions shown while no profile exists (prefill.ts SubmissionPrefill,
 * with each value formatted for display). Nothing is stored until staff press
 * "Start from these", which rebuilds the prefill with their name on every source.
 */
export type PrefillSuggestions = Pick<SubmissionPrefill, "playbook" | "notes"> & { rows: PrefillRow[] };

export type SubmissionView = {
  ctx: SubmissionContext;
  /** The profile's playbook, or the program default before a profile exists. */
  playbook: SubmissionPlaybook;
  allowedPlaybooks: SubmissionPlaybook[];
  sections: { id: SectionId; label: string; view: SectionView }[];
  metrics: SubmissionMetrics;
  readiness: StageReadiness;
  /** Suggestions, only while no profile row exists. */
  prefill: PrefillSuggestions | null;
  /** True only with LENDER_EMAIL_ENABLED and an email provider (the runtime decides); false means staff send the approved text by hand. */
  lenderEmailEnabled: boolean;
};

export type PreviewLender = Pick<LenderPanelEntry, "id" | "name" | "portalUrl" | "submissionInstructions"> & { stale: boolean; staleReason: string | null };

export type SubmissionPreview = {
  view: SubmissionView;
  stage: TargetStage;
  /** Panel lenders whose recorded appetite covers the deal's program (active only). */
  lenders: PreviewLender[];
  lender: PreviewLender | null;
  fit: LenderFit | null;
  /** The exact text a broker approves, with EMAIL_PLACEHOLDERS for the link; null until a lender is chosen or when it fails a check. */
  email: { subject: string; text: string; sha256: string } | null;
  /** Why the chosen lender's email cannot be built (restricted data, overclaiming copy); null when it can. */
  emailError: string | null;
  /** The one-page summary, identical for every lender; null when staff text stops it (`blocked`). */
  summary: DealSummarySpec | null;
  /** Why nothing can be built (overclaiming copy or a restricted identifier in staff-typed text); null otherwise. */
  blocked: string | null;
  /** Fair-lending prompts on staff-typed text (spec 6.5): edit the text, or the approving broker sees them. */
  neutralCopy: NeutralCopyFlag[];
  /** Clean vault documents that can go into the package. */
  documents: VaultDocumentRef[];
};

export type SubmissionRequestInput = {
  dealId: string;
  lenderIds: string[];
  stage: TargetStage;
  documentIds: string[];
  /** Required when required items are missing at `stage`, or a lender is unranked or outside its recorded box; OVERRIDE_REASON_LENGTH after trimming. */
  overrideReason: string | null;
  note: string | null;
  allowStaleLender: boolean;
};

export type MissingItem = { id: string; label: string; href: string };

export type SubmissionOutcome = {
  lenderId: string;
  lenderName: string;
  ok: boolean;
  message: string;
  /** The lender_outreach row, once requested. */
  outreachId?: string;
  /** Approved already with email to lenders off: the link, shown once with the approved email. */
  shareUrl?: string;
};

export type SubmissionRequestResult =
  | { ok: false; reason: "not_ready"; missing: MissingItem[]; message: string }
  | { ok: false; reason: "refused"; message: string }
  | { ok: true; outcomes: SubmissionOutcome[] };

/** Matching-desk defaults read from the profile (lenders desk "Deal metrics" form). */
export type MatchingDefaults = {
  noiCents: number | null;
  valueCents: number | null;
  costCents: number | null;
  occupancyPct: number | null;
  lien: "first" | "second" | null;
  nonRecourse: boolean;
  closeDays: number | null;
  assetClass: AssetClass | null;
  /** DSCR at the assumed sizing terms (computed; never typed). */
  dscr: number | null;
};

/** A save the store refused, or a refusal staff can act on. */
export class SubmissionDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubmissionDataError";
  }
}

// ---------------------------------------------------------------------------
// The adapter

/** Who prefill names on the sources of a preview (replaced by the staff member when they start from it). */
const PREVIEW_ACTOR = "staff:prefill-preview";

/** The advisor who signs the lender email: the signed-in staff member. The preview and the request use the same one, so the hashes match. */
export function advisorFor(staff: Pick<StaffSession, "name" | "email" | "dreLicense">): EmailAdvisor {
  return { name: staff.name, title: null, dreLicense: staff.dreLicense, email: staff.email, phone: null };
}

async function viewFor(rt: DealDeskRuntime, dealId: string): Promise<SubmissionView | null> {
  const ctx = await loadSubmissionContext(rt, dealId);
  if (!ctx) return null;
  const playbook = ctx.profile?.playbook ?? defaultPlaybook(ctx.deal.program);
  const metrics = computeSubmissionMetrics(ctx);
  return {
    ctx,
    playbook,
    allowedPlaybooks: allowedPlaybooks(ctx.deal.program),
    sections: visibleSections(playbook, ctx.profile ? { sizeCount: ctx.profile.sizeCount, sizeUnit: ctx.profile.sizeUnit } : null),
    metrics,
    readiness: evaluateAllStages(ctx, metrics),
    prefill: ctx.profile ? null : suggestionsFrom(buildPrefill(ctx, { actor: PREVIEW_ACTOR })),
    lenderEmailEnabled: rt.lenderMailer !== null,
  };
}

/** Everything the editor, the deal-page card and the preview show for a deal; null when the deal does not exist. */
export async function loadSubmissionView(dealId: string): Promise<SubmissionView | null> {
  const rt = dealDeskRuntime();
  if (!rt) return null;
  return viewFor(rt, dealId);
}

/** A store refusal as staff read it (the field path, never a sponsor value). */
function storeError(err: unknown): never {
  if (err instanceof GuardError) throw new SubmissionDataError(`Nothing was saved: ${err.message.replace(/^(Submission|Sponsor) profile: /, "")}.`);
  throw err;
}

/**
 * Saves one section. `expectedVersion` is the record_version the form was
 * rendered with (null inserts the row); a stale version throws
 * ConcurrentUpdateError and nothing is saved.
 */
export async function saveSection(dealId: string, sectionId: SectionId, values: SectionValues, expectedVersion: number | null, actor: string): Promise<void> {
  const rt = dealDeskRuntime();
  if (!rt) throw new SubmissionDataError("Deal desk storage is not configured");
  if (sectionId === "sponsor" && values.target !== "sponsor") throw new SubmissionDataError("The sponsor section saves the sponsor summary");
  const store = rt.submission.store;
  try {
    if (values.target === "sponsor") await store.upsertSponsor(dealId, expectedVersion, values.patch, actor, rt.now());
    else await store.upsertProfile(dealId, expectedVersion, values.patch, actor, rt.now());
  } catch (err) {
    storeError(err);
  }
}

/** Writes the suggested values (sources "Per borrower", "From spread", "Public record", named for `actor`); refuses once a profile exists. */
export async function applyPrefill(dealId: string, actor: string): Promise<{ fields: number }> {
  const rt = dealDeskRuntime();
  if (!rt) throw new SubmissionDataError("Deal desk storage is not configured");
  const ctx = await loadSubmissionContext(rt, dealId);
  if (!ctx) throw new SubmissionDataError("Deal not found");
  if (ctx.profile) throw new SubmissionDataError("This deal already has a submission profile; edit the sections instead");
  const prefill = buildPrefill(ctx, { actor, now: rt.now() });
  const store = rt.submission.store;
  try {
    await store.upsertProfile(dealId, null, prefill.profile, actor, rt.now());
    if (Object.keys(prefill.sponsor).length && !ctx.sponsor) await store.upsertSponsor(dealId, null, prefill.sponsor, actor, rt.now());
  } catch (err) {
    storeError(err);
  }
  return { fields: prefill.suggestions.filter((s) => s.field !== "playbook").length };
}

/** The preview's documents: the vault documents as the package lists them (the deal summary is added by send.ts). */
const previewDocuments = (docs: readonly VaultDocumentRef[]) => docs.map((d) => ({ documentId: d.id, label: d.fileName, kind: d.kind }));

/** A refusal from the summary or email builders as staff read it; anything else is rethrown. */
function builderError(err: unknown): string {
  if (err instanceof PackageCopyError || err instanceof EmailSafetyError) return err.message;
  throw err;
}

/** The email, fit and summary a lender would get at `stage`, built in memory. Writes nothing and calls no gate. */
export async function getPreview(dealId: string, lenderId: string | null, stage: TargetStage, advisor: EmailAdvisor): Promise<SubmissionPreview | null> {
  const rt = dealDeskRuntime();
  if (!rt) return null;
  const view = await viewFor(rt, dealId);
  if (!view) return null;
  const now = rt.now();
  const panel = (await rt.store.listLenders({ activeOnly: true })).filter((l) => l.programs.includes(view.ctx.deal.program));
  const lenders: PreviewLender[] = panel.map((l) => {
    const s = lenderStaleness(l, now);
    return { id: l.id, name: l.name, portalUrl: l.portalUrl, submissionInstructions: l.submissionInstructions, stale: s.stale, staleReason: s.reason };
  });
  const chosen = panel.find((l) => l.id === lenderId) ?? null;
  const lender = chosen ? (lenders.find((l) => l.id === chosen.id) ?? null) : null;
  const base = { view, stage, lenders, lender, documents: view.ctx.vaultDocuments };
  const boxes = await approvedBoxes();
  try {
    const p = previewSubmission({ ctx: view.ctx, metrics: view.metrics, stage, lenders: chosen ? [chosen] : [], boxes, documents: previewDocuments(view.ctx.vaultDocuments), advisor });
    const one = p.lenders[0] ?? null;
    return {
      ...base,
      fit: one?.fit ?? null,
      email: one?.ok ? { subject: one.email.subject, text: one.email.text, sha256: one.email.sha256 } : null,
      emailError: one && !one.ok ? one.error : null,
      summary: p.summary,
      blocked: null,
      neutralCopy: p.neutralCopy,
    };
  } catch (err) {
    return { ...base, fit: null, email: null, emailError: null, summary: null, blocked: builderError(err), neutralCopy: [] };
  }
}

/** The lender desk's approved credit boxes (the fit); none when lender matching is not configured. */
async function approvedBoxes() {
  const lr = lenderRuntime();
  if (!lr) return [];
  try {
    return await lr.store.listBoxes({ status: "approved" });
  } catch (err) {
    console.warn("[submission] credit boxes unavailable", err instanceof Error ? err.message : err);
    return [];
  }
}

const STAGE_NOUN: Record<TargetStage, string> = { screen: "soft-quote", term_sheet: "term-sheet", underwrite: "underwriting" };

/**
 * Requests broker approval to submit to each lender. Refuses, locking nothing
 * and asking no gate, when required items are missing at `stage` and no reason
 * of OVERRIDE_REASON_LENGTH.min characters is given, or when a hard stop
 * (hold, closed deal) applies. Then the lender desk's submitToLenders checks
 * each lender against the matcher and its recorded box (the same reason lets
 * an unranked or out-of-box lender through, and the broker sees it), and
 * send.ts locks the summary and the package and asks the gate per lender.
 */
export async function requestSubmission(input: SubmissionRequestInput, staff: StaffSession): Promise<SubmissionRequestResult> {
  const rt = lenderRuntime();
  if (!rt) return { ok: false, reason: "refused", message: "Lender matching storage is not configured" };
  const view = await viewFor(rt.desk, input.dealId);
  if (!view) return { ok: false, reason: "refused", message: "Deal not found" };
  const readiness = view.readiness[input.stage];
  if (readiness.hardStops.length) return { ok: false, reason: "refused", message: `Nothing goes to lenders: ${readiness.hardStops.join(" ")}` };
  const reason = input.overrideReason?.trim() ?? "";
  const missing = readiness.required.filter((r) => !r.met).map((r) => ({ id: r.id, label: r.label, href: r.fix.href }));
  if (missing.length && reason.length < OVERRIDE_REASON_LENGTH.min) {
    return {
      ok: false,
      reason: "not_ready",
      missing,
      message: `${missing.length} required item${missing.length === 1 ? " is" : "s are"} missing for a ${STAGE_NOUN[input.stage]} request. Add ${missing.length === 1 ? "it" : "them"}, or give a reason of at least ${OVERRIDE_REASON_LENGTH.min} characters to send anyway.${reason ? ` Your reason has ${reason.length}.` : ""}`,
    };
  }
  if (reason.length > OVERRIDE_REASON_LENGTH.max) return { ok: false, reason: "refused", message: `Keep the reason to ${OVERRIDE_REASON_LENGTH.max} characters` };
  if (!input.lenderIds.length) return { ok: false, reason: "refused", message: "Choose at least one lender" };

  const deal = view.ctx.deal;
  if (input.documentIds.length && !deal.leadId) return { ok: false, reason: "refused", message: "Link the deal to its lead so vault documents can be packaged" };
  try {
    const items = input.documentIds.length && deal.leadId ? await rt.desk.vaultItems(deal.leadId, input.documentIds) : [];
    const r = await submitToLenders(rt.outreach, {
      dealId: deal.id,
      profile: submissionDealProfile(tailorDealFrom(view.ctx), view.metrics.metrics),
      lenderIds: input.lenderIds,
      items,
      actor: staff.actor,
      allowStaleLender: input.allowStaleLender,
      overrideReason: reason || null,
      readinessOverrideReason: missing.length ? reason : null,
      targetStage: input.stage,
      advisor: advisorFor(staff),
      note: input.note?.trim() || null,
    });
    return {
      ok: true,
      outcomes: r.outcomes.map((o) =>
        o.ok ? { lenderId: o.lenderId, lenderName: o.lenderName, ok: true, message: o.message, outreachId: o.result.outreach.id, ...(o.result.shareUrl ? { shareUrl: o.result.shareUrl } : {}) } : { lenderId: o.lenderId, lenderName: o.lenderName, ok: false, message: o.error },
      ),
    };
  } catch (err) {
    if (err instanceof OutreachError || err instanceof PackageError || err instanceof PackageCopyError || err instanceof EmailSafetyError) return { ok: false, reason: "refused", message: err.message };
    throw err;
  }
}

/** The staff preview of the deal summary PDF at `stage` (the summary that would be locked now); null when the deal does not exist. Refused copy throws SubmissionDataError. */
export async function getSummaryPdf(dealId: string, stage: TargetStage, staff: StaffSession): Promise<Uint8Array | null> {
  const rt = dealDeskRuntime();
  if (!rt) return null;
  const view = await viewFor(rt, dealId);
  if (!view) return null;
  let summary: DealSummarySpec;
  try {
    summary = previewSubmission({ ctx: view.ctx, metrics: view.metrics, stage, lenders: [], boxes: [], documents: [], advisor: advisorFor(staff) }).summary;
  } catch (err) {
    throw new SubmissionDataError(builderError(err));
  }
  return renderDealSummary(summary);
}

/** The visible label of a requirement id (approvals queue); a checklist item's key reads as words. */
export function requirementLabel(id: string): string {
  return tableRequirementLabel(id);
}

/** The matching desk's defaults, read from the profile and its computed metrics. */
export function matchingDefaults(view: SubmissionView): MatchingDefaults {
  const p = view.ctx.profile;
  const d = submissionDealProfile(tailorDealFrom(view.ctx), view.metrics.metrics);
  return {
    noiCents: p?.noiInPlaceCents ?? null,
    valueCents: p?.asIsValueCents ?? p?.purchasePriceCents ?? null,
    costCents: p?.uses.length ? p.uses.reduce((s, u) => s + u.amountCents, 0) : null,
    occupancyPct: p?.occupancyPct ?? null,
    lien: p?.lienPosition === "first" || p?.lienPosition === "second" ? p.lienPosition : null,
    nonRecourse: d.requiresNonRecourse,
    closeDays: d.targetCloseDays,
    assetClass: d.assetClass,
    dscr: d.dscr,
  };
}

/** Labels of sections, for messages ("Loan request saved."). */
export function sectionLabel(id: SectionId): string {
  return SECTION_LABELS[id];
}

// ---------------------------------------------------------------------------
// Prefill rows for display

const ENUM_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  purpose: LOAN_PURPOSE_LABELS,
  recourse: RECOURSE_LABELS,
  rateType: RATE_TYPE_LABELS,
  lienPosition: LIEN_POSITION_LABELS,
  assetType: SUBMISSION_ASSET_TYPE_LABELS,
  sizeUnit: SIZE_UNIT_LABELS,
  asIsValueSource: VALUE_SOURCE_LABELS,
  stabilizedValueSource: VALUE_SOURCE_LABELS,
  noiBasis: NOI_BASIS_LABELS,
  exitStrategy: EXIT_STRATEGY_LABELS,
  creditBand: CREDIT_BAND_LABELS,
  contractType: CONSTRUCTION_CONTRACT_LABELS,
};

const sumCents = (o: Record<string, unknown>) => Object.values(o).reduce<number>((s, v) => s + (typeof v === "number" ? v : 0), 0);

/** A suggested value as staff read it: money, percentages, dates and labels, never a raw code. */
export function suggestionValue(field: string, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (field === "playbook") return PLAYBOOK_LABELS[value as SubmissionPlaybook] ?? String(value);
  const key = field.split(".").at(-1) ?? field;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") {
    const labels = ENUM_LABELS[key];
    if (labels) return labels[value] ?? value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return date(value);
    return value;
  }
  if (typeof value === "number") {
    if (/Cents$/.test(key)) return usd(value);
    if (/Pct$/.test(key)) return pct(value);
    if (/Months$/.test(key)) return `${count(value)} months`;
    if (/^year/.test(key)) return String(value);
    return count(value);
  }
  if (key === "uses" && Array.isArray(value)) return (value as UseLine[]).map((u) => `${USE_KIND_LABELS[u.kind]} ${usd(u.amountCents)}`).join("; ");
  if (key === "pip" && typeof value === "object") {
    const pip = value as { required?: boolean; budgetCents?: number };
    return pip.required ? `Required${pip.budgetCents !== undefined ? `, budget ${usd(pip.budgetCents)}` : ""}` : "Not required";
  }
  if (key === "budget" && typeof value === "object") return `${usd(sumCents(value as Record<string, unknown>))} total`;
  return "";
}

function rowOf(s: PrefillSuggestion): PrefillRow {
  const tag = s.field === "playbook" ? PREFILL_ORIGIN_LABELS.deal_program : s.source ? null : "Per borrower";
  return { name: s.field, label: s.label, value: suggestionValue(s.field, s.value), source: s.source, tag };
}

function suggestionsFrom(p: SubmissionPrefill): PrefillSuggestions {
  return { playbook: p.playbook, notes: p.notes, rows: p.suggestions.map(rowOf).filter((r) => r.value !== "") };
}
