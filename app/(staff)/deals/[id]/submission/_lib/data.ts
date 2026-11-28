import "server-only";

// The staff UI's one door to the submission module. Every page, route and
// action under app/(staff)/deals/[id]/submission (and the deal page card, the
// matching desk and the approvals queue) calls only the exported functions
// below; nothing else in app/ imports Builder A's or Builder B's modules.
//
// Until those modules land, each function runs on a small stand-in in this
// file, marked `PHASE2: wire to lib/deals/submission/...`. The stand-ins keep
// the contract types, so wiring is a body swap:
//
//   loadSubmissionView  → context.ts loadSubmissionContext, metrics.ts computeSubmissionMetrics,
//                         readiness.ts evaluateReadiness, prefill.ts (suggestions)
//   saveSection         → store.ts / store-supabase.ts upsertProfile / upsertSponsor (via rt.submission)
//   applyPrefill        → prefill.ts + upsertProfile / upsertSponsor
//   getPreview          → summary.ts buildDealSummary, tailor.ts lenderFit, email.ts buildLenderEmail
//   requestSubmission   → send.ts prepareSubmission + submitDealToLenders
//   getSummaryPdf       → summary.ts + lib/agents/lenders/package-pdf.tsx (extended)
//   requirementLabel    → requirements.ts
//
// The stand-ins store profiles in memory and only in fake-auth demo mode
// (lib/deals/demo.ts); on any other deployment saving refuses until the real
// store is wired. They never send anything: a request goes through the
// existing lender outreach flow, which waits for broker approval.

import { createHash } from "node:crypto";
import { OutreachError, submitToLenders } from "@/lib/agents/lenders/outreach";
import { PackageCopyError, buildExecutiveSummary, type PackageSpreads } from "@/lib/agents/lenders/package";
import { lenderRuntime, renderSummaryPdf } from "@/lib/agents/lenders/runtime";
import { dealProfile, type ProfileOverrides } from "@/lib/agents/lenders/service";
import type { AssetClass } from "@/lib/agents/lenders/types";
import { SATISFIED_STATUSES } from "@/lib/checklists/types";
import { DEMO_EXTRA_DEAL_IDS, demoDesks } from "@/lib/deals/demo";
import { lenderStaleness } from "@/lib/deals/lenders";
import { LENDER_LOAN_TYPE_SHORT_LABELS } from "@/lib/deals/loan-types";
import { PackageError } from "@/lib/deals/packages";
import { dealDeskRuntime, type DealDeskRuntime } from "@/lib/deals/runtime";
import type { StaffSession } from "@/lib/deals/session";
import { dealAcceptsLenderAccess } from "@/lib/deals/share-links";
import { ConcurrentUpdateError } from "@/lib/deals/store";
import type { Deal, LenderPanelEntry } from "@/lib/deals/types";
import {
  HARD_MONEY_FILE_PLAYBOOKS,
  PLAYBOOK_LABELS,
  PLAYBOOK_SHORT_LABELS,
  SECTION_LABELS,
  SHORT_TERM_PLAYBOOKS,
  allowedPlaybooks,
  defaultPlaybook,
  isIncomeProperty,
  playbookLoanTypes,
  playbookTrancheSource,
  submissionFixHref,
  visibleSections,
  type SectionView,
} from "@/lib/deals/submission/playbooks";
import { emptySubmissionContext, submissionFixture } from "@/lib/deals/submission/test-fixtures";
import {
  CREDIT_BAND_LABELS,
  EMAIL_PLACEHOLDERS,
  EXIT_STRATEGY_LABELS,
  LIEN_POSITION_LABELS,
  LOAN_PURPOSE_LABELS,
  METRIC_UNITS,
  NOI_BASIS_LABELS,
  OVERRIDE_REASON_LENGTH,
  PFS_MAX_AGE_DAYS,
  RATE_TYPE_LABELS,
  RECOURSE_LABELS,
  REFINANCE_PURPOSES,
  SIZE_UNIT_LABELS,
  SOURCE_KIND_LABELS,
  SUBMISSION_ASSET_TYPE_LABELS,
  TARGET_STAGE_LABELS,
  USE_KIND_LABELS,
  VALUE_SOURCE_LABELS,
  blankSponsorProfileFields,
  blankSubmissionProfileFields,
  creditEventKinds,
  type DealSummarySpec,
  type EmailAdvisor,
  type FieldSource,
  type FieldSourceKey,
  type FixTarget,
  type LenderFit,
  type Metric,
  type MetricBasis,
  type MetricInput,
  type MetricKey,
  type Readiness,
  type ReadinessItem,
  type RequirementLevel,
  type SectionId,
  type SponsorProfile,
  type SponsorProfilePatch,
  type SponsorStrength,
  type SubmissionContext,
  type SubmissionMetrics,
  type SubmissionPlaybook,
  type SubmissionProfile,
  type SubmissionProfilePatch,
  type TargetStage,
  type VaultDocumentRef,
} from "@/lib/deals/submission/types";
import { licenseLine, site } from "@/lib/site";
import { intakeSchema, type Intake } from "@/lib/validation";
import type { SectionValues } from "./fields";
import { count, date, formatMetricInput, metricValue, pct, sourceLabel, usd } from "./format";

// ---------------------------------------------------------------------------
// Public types

export type StageReadiness = Record<TargetStage, Readiness>;

/** One suggested value on the "Start from these" panel. */
export type PrefillRow = { name: string; label: string; value: string; source: FieldSource };

/** What prefill would write: nothing is stored until staff press "Start from these". */
export type PrefillSuggestions = { profile: SubmissionProfilePatch; sponsor: SponsorProfilePatch; rows: PrefillRow[] };

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
  /** LENDER_EMAIL_ENABLED and a mailer: false means staff send the approved text by hand. */
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
  /** The exact text a broker approves, with EMAIL_PLACEHOLDERS for the link; null until a lender is chosen. */
  email: { subject: string; text: string; sha256: string } | null;
  /** The one-page summary, identical for every lender. */
  summary: DealSummarySpec;
  /** Clean vault documents that can go into the package. */
  documents: VaultDocumentRef[];
};

export type SubmissionRequestInput = {
  dealId: string;
  lenderIds: string[];
  stage: TargetStage;
  documentIds: string[];
  /** Required when required items are missing at `stage`; OVERRIDE_REASON_LENGTH after trimming. */
  overrideReason: string | null;
  note: string | null;
  allowStaleLender: boolean;
};

export type MissingItem = { id: string; label: string; href: string };

export type SubmissionRequestResult =
  | { ok: false; reason: "not_ready"; missing: MissingItem[]; message: string }
  | { ok: false; reason: "refused"; message: string }
  | { ok: true; outcomes: { lenderId: string; lenderName: string; ok: boolean; message: string; shareUrl?: string }[] };

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

/** A save the stand-in store cannot make, or a refusal staff can act on. */
export class SubmissionDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubmissionDataError";
  }
}

// ---------------------------------------------------------------------------
// The adapter

/** Everything the editor, the deal-page card and the preview show for a deal; null when the deal does not exist. */
export async function loadSubmissionView(dealId: string): Promise<SubmissionView | null> {
  const rt = dealDeskRuntime();
  if (!rt) return null;
  // PHASE2: wire to lib/deals/submission/context.ts loadSubmissionContext(rt, dealId)
  const ctx = await standinContext(rt, dealId);
  if (!ctx) return null;
  const playbook = ctx.profile?.playbook ?? defaultPlaybook(ctx.deal.program);
  // PHASE2: wire to lib/deals/submission/metrics.ts computeSubmissionMetrics(ctx)
  const metrics = standinMetrics(ctx, playbook);
  // PHASE2: wire to lib/deals/submission/readiness.ts evaluateReadiness(ctx, metrics, stage)
  const readiness: StageReadiness = { screen: standinReadiness(ctx, metrics, playbook, "screen"), term_sheet: standinReadiness(ctx, metrics, playbook, "term_sheet"), underwrite: standinReadiness(ctx, metrics, playbook, "underwrite") };
  return {
    ctx,
    playbook,
    allowedPlaybooks: allowedPlaybooks(ctx.deal.program),
    sections: visibleSections(playbook, ctx.profile ? { sizeCount: ctx.profile.sizeCount, sizeUnit: ctx.profile.sizeUnit } : null),
    metrics,
    readiness,
    // PHASE2: wire to lib/deals/submission/prefill.ts
    prefill: ctx.profile ? null : standinPrefill(ctx, playbook),
    lenderEmailEnabled: rt.lenderMailer !== null,
  };
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
  // PHASE2: wire to lib/deals/submission/store.ts rt.submission.upsertProfile / upsertSponsor
  const store = writableStandinStore();
  if (values.target === "sponsor") standinUpsertSponsor(store, dealId, expectedVersion, values.patch, actor, rt.now());
  else standinUpsertProfile(store, dealId, expectedVersion, values.patch, actor, rt.now());
}

/** Writes the suggested values (sources "Per borrower", "From spread", "Public record"); refuses once a profile exists. */
export async function applyPrefill(dealId: string, actor: string): Promise<{ fields: number }> {
  const view = await loadSubmissionView(dealId);
  if (!view) throw new SubmissionDataError("Deal not found");
  if (view.ctx.profile || !view.prefill) throw new SubmissionDataError("This deal already has a submission profile; edit the sections instead");
  const rt = dealDeskRuntime()!;
  // PHASE2: wire to lib/deals/submission/prefill.ts + store.ts upsertProfile / upsertSponsor
  const store = writableStandinStore();
  standinUpsertProfile(store, dealId, null, view.prefill.profile, actor, rt.now());
  if (Object.keys(view.prefill.sponsor).length && !view.ctx.sponsor) standinUpsertSponsor(store, dealId, null, view.prefill.sponsor, actor, rt.now());
  return { fields: view.prefill.rows.length };
}

/** The email, fit and summary a lender would get at `stage`, built in memory. Writes nothing and calls no gate. */
export async function getPreview(dealId: string, lenderId: string | null, stage: TargetStage, advisor: EmailAdvisor): Promise<SubmissionPreview | null> {
  const rt = dealDeskRuntime();
  const view = await loadSubmissionView(dealId);
  if (!rt || !view) return null;
  const now = rt.now();
  const panel = (await rt.store.listLenders({ activeOnly: true })).filter((l) => l.programs.includes(view.ctx.deal.program));
  const lenders: PreviewLender[] = panel.map((l) => {
    const s = lenderStaleness(l, now);
    return { id: l.id, name: l.name, portalUrl: l.portalUrl, submissionInstructions: l.submissionInstructions, stale: s.stale, staleReason: s.reason };
  });
  const chosen = panel.find((l) => l.id === lenderId) ?? null;
  const readiness = view.readiness[stage];
  // PHASE2: wire to lib/deals/submission/summary.ts buildDealSummary(ctx, metrics, stage)
  const summary = standinSummary(view, stage);
  // PHASE2: wire to lib/deals/submission/tailor.ts lenderFit and email.ts buildLenderEmail
  const fit = chosen ? standinFit(chosen, view, now) : null;
  const email = chosen && fit ? standinEmail(view, readiness, chosen, fit, stage, advisor) : null;
  return {
    view,
    stage,
    lenders,
    lender: chosen ? (lenders.find((l) => l.id === chosen.id) ?? null) : null,
    fit,
    email,
    summary,
    documents: view.ctx.deal.leadId ? await rt.vaultDocuments(view.ctx.deal.leadId) : [],
  };
}

/**
 * Requests broker approval to submit to each lender. Refuses, locking nothing
 * and asking no gate, when required items are missing at `stage` and no reason
 * of OVERRIDE_REASON_LENGTH.min characters is given, or when a hard stop
 * (hold, closed deal) applies.
 */
export async function requestSubmission(input: SubmissionRequestInput, staff: StaffSession): Promise<SubmissionRequestResult> {
  const rt = lenderRuntime();
  if (!rt) return { ok: false, reason: "refused", message: "Lender matching storage is not configured" };
  const view = await loadSubmissionView(input.dealId);
  if (!view) return { ok: false, reason: "refused", message: "Deal not found" };
  const readiness = view.readiness[input.stage];
  if (readiness.hardStops.length) return { ok: false, reason: "refused", message: `Nothing goes to lenders: ${readiness.hardStops.join("; ")}` };
  const reason = input.overrideReason?.trim() ?? "";
  const missing = readiness.required.filter((r) => !r.met).map((r) => ({ id: r.id, label: r.label, href: r.fix.href }));
  if (missing.length && reason.length < OVERRIDE_REASON_LENGTH.min) {
    const noun = input.stage === "screen" ? "soft-quote" : input.stage === "term_sheet" ? "term-sheet" : "underwriting";
    return {
      ok: false,
      reason: "not_ready",
      missing,
      message: `${missing.length} required item${missing.length === 1 ? " is" : "s are"} missing for a ${noun} request. Add ${missing.length === 1 ? "it" : "them"}, or give a reason of at least ${OVERRIDE_REASON_LENGTH.min} characters to send anyway.${reason ? ` Your reason has ${reason.length}.` : ""}`,
    };
  }
  if (reason.length > OVERRIDE_REASON_LENGTH.max) return { ok: false, reason: "refused", message: `Keep the reason to ${OVERRIDE_REASON_LENGTH.max} characters` };
  if (!input.lenderIds.length) return { ok: false, reason: "refused", message: "Choose at least one lender" };

  // PHASE2: wire to lib/deals/submission/send.ts prepareSubmission + submitDealToLenders
  // (deal summary PDF, per-lender readiness, fit and email, the v2 approval payload with
  // readinessMissing, overrideReason and the email hash). Until then this goes through
  // the existing outreach flow with the executive summary, and the approving broker
  // sees the missing items and the reason in the approval summary.
  const deal = view.ctx.deal;
  try {
    const items = input.documentIds.length && deal.leadId ? await rt.desk.vaultItems(deal.leadId, input.documentIds) : [];
    if (input.documentIds.length && !deal.leadId) return { ok: false, reason: "refused", message: "Link the deal to its lead so vault documents can be packaged" };
    const stageLabel = TARGET_STAGE_LABELS[input.stage].toLowerCase();
    const missingNote = missing.length ? `Missing for a ${stageLabel} request: ${missing.map((m) => m.label).join("; ")}. Reason: ${reason}` : null;
    const r = await submitToLenders(rt.outreach, {
      dealId: deal.id,
      profile: dealProfile(deal, matchingOverrides(view)),
      lenderIds: input.lenderIds,
      items,
      summary: executiveSummaryInput(view, staff),
      actor: staff.actor,
      allowStaleLender: input.allowStaleLender,
      overrideReason: reason || null,
      note: [missingNote, input.note?.trim()].filter(Boolean).join(" — ") || null,
    });
    return {
      ok: true,
      outcomes: r.outcomes.map((o) => (o.ok ? { lenderId: o.lenderId, lenderName: o.lenderName, ok: true, message: o.message, ...(o.result.shareUrl ? { shareUrl: o.result.shareUrl } : {}) } : { lenderId: o.lenderId, lenderName: o.lenderName, ok: false, message: o.error })),
    };
  } catch (err) {
    if (err instanceof OutreachError || err instanceof PackageError || err instanceof PackageCopyError) return { ok: false, reason: "refused", message: err.message };
    throw err;
  }
}

/** The staff preview of the deal summary PDF at `stage`; null when the deal does not exist. Refused copy throws SubmissionDataError. */
export async function getSummaryPdf(dealId: string, stage: TargetStage, staff: StaffSession): Promise<Uint8Array | null> {
  const view = await loadSubmissionView(dealId);
  if (!view) return null;
  void stage; // PHASE2: wire to lib/deals/submission/summary.ts buildDealSummary(ctx, metrics, stage) and the extended package-pdf.tsx
  try {
    return await renderSummaryPdf(buildExecutiveSummary({ ...executiveSummaryInput(view, staff), deal: view.ctx.deal }));
  } catch (err) {
    if (err instanceof PackageCopyError) throw new SubmissionDataError(err.message);
    throw err;
  }
}

/** The visible label of a requirement id (approvals queue); the id itself when unknown. */
export function requirementLabel(id: string): string {
  // PHASE2: wire to lib/deals/submission/requirements.ts
  return STANDIN_REQUIREMENTS.find((r) => r.id === id)?.label ?? id;
}

/** The matching desk's defaults, read from the profile and its computed metrics. */
export function matchingDefaults(view: SubmissionView): MatchingDefaults {
  const p = view.ctx.profile;
  const m = (k: MetricKey) => view.metrics.metrics.find((x) => x.key === k)?.value ?? null;
  const cost = p?.uses.length ? p.uses.reduce((s, u) => s + u.amountCents, 0) : null;
  const close = p?.targetCloseDate ? Math.max(0, Math.round((Date.parse(`${p.targetCloseDate}T00:00:00Z`) - view.ctx.now.getTime()) / 86_400_000)) : null;
  return {
    noiCents: p?.noiInPlaceCents ?? null,
    valueCents: p?.asIsValueCents ?? p?.purchasePriceCents ?? null,
    costCents: cost,
    occupancyPct: p?.occupancyPct ?? null,
    lien: p?.lienPosition === "first" || p?.lienPosition === "second" ? p.lienPosition : null,
    nonRecourse: p?.recourse === "non_recourse",
    closeDays: close,
    assetClass: assetClassOf(view.playbook, p?.assetType ?? null),
    dscr: m("dscr_in_place") ?? m("dscr_rental"),
  };
}

// ===========================================================================
// PHASE2 stand-ins. Everything below is replaced by Builder A's and Builder B's
// modules at integration and deleted with this comment.
// ===========================================================================

// --- Store (PHASE2: wire to lib/deals/submission/store.ts) -----------------------------------------

type StoredRows = { profile: SubmissionProfile | null; sponsor: SponsorProfile | null };
const STORE_KEY = Symbol.for("corin.deals.submission.standin");

function standinStore(): Map<string, StoredRows> {
  const g = globalThis as unknown as Record<symbol, Map<string, StoredRows> | undefined>;
  return (g[STORE_KEY] ??= new Map());
}

function writableStandinStore(): Map<string, StoredRows> {
  if (!demoDesks()) throw new SubmissionDataError("Submission profiles cannot be saved on this deployment yet: the submission store is not configured.");
  return standinStore();
}

function standinUpsertProfile(store: Map<string, StoredRows>, dealId: string, expectedVersion: number | null, patch: SubmissionProfilePatch, actor: string, now: Date): SubmissionProfile {
  const rows = store.get(dealId) ?? { profile: null, sponsor: null };
  const at = now.toISOString();
  let cur = rows.profile;
  if (expectedVersion === null) {
    if (cur) throw new ConcurrentUpdateError("Submission profile");
    if (!patch.playbook) throw new SubmissionDataError("A new submission profile needs its playbook");
    cur = { id: crypto.randomUUID(), dealId, createdAt: at, createdBy: actor, updatedAt: at, updatedBy: actor, recordVersion: 0, ...blankSubmissionProfileFields(patch.playbook) };
  } else if (!cur || cur.recordVersion !== expectedVersion) throw new ConcurrentUpdateError("Submission profile");
  const { programDetails, fieldSources, ...columns } = patch;
  const next: SubmissionProfile = { ...structuredClone(cur), ...structuredClone(columns), updatedAt: at, updatedBy: actor, recordVersion: cur.recordVersion + 1 };
  if (programDetails) next.programDetails = { ...next.programDetails, ...structuredClone(programDetails) };
  if (fieldSources) {
    const merged = { ...next.fieldSources } as Record<string, FieldSource>;
    for (const [k, v] of Object.entries(fieldSources)) {
      if (v === null || v === undefined) delete merged[k];
      else merged[k] = v;
    }
    next.fieldSources = merged;
  }
  store.set(dealId, { ...rows, profile: next });
  return next;
}

function standinUpsertSponsor(store: Map<string, StoredRows>, dealId: string, expectedVersion: number | null, patch: SponsorProfilePatch, actor: string, now: Date): SponsorProfile {
  const rows = store.get(dealId) ?? { profile: null, sponsor: null };
  const at = now.toISOString();
  let cur = rows.sponsor;
  if (expectedVersion === null) {
    if (cur) throw new ConcurrentUpdateError("Sponsor profile");
    cur = { id: crypto.randomUUID(), dealId, createdAt: at, createdBy: actor, updatedAt: at, updatedBy: actor, recordVersion: 0, ...blankSponsorProfileFields() };
  } else if (!cur || cur.recordVersion !== expectedVersion) throw new ConcurrentUpdateError("Sponsor profile");
  const next: SponsorProfile = { ...structuredClone(cur), ...structuredClone(patch), updatedAt: at, updatedBy: actor, recordVersion: cur.recordVersion + 1 };
  store.set(dealId, { ...rows, sponsor: next });
  return next;
}

// --- Context (PHASE2: wire to lib/deals/submission/context.ts) -------------------------------------

/**
 * Demo seeds: Desert Palms Hotel PIP starts from the hotel PIP bridge fixture
 * (its loan line set to the demo deal's amount, sponsor equity rebalanced) and
 * is ready at Screen; Valley Memory Care has only a lead intake, so prefill has
 * something to suggest. Every other demo deal starts empty.
 */
const DEMO_SEEDS: Record<string, { fixture?: SubmissionPlaybook; intake?: { at: string; data: Record<string, unknown> } }> = {
  [DEMO_EXTRA_DEAL_IDS.pipHotel]: { fixture: "hotel_pip_bridge" },
  [DEMO_EXTRA_DEAL_IDS.memoryCare]: {
    intake: {
      at: "2026-10-20T17:00:00.000Z",
      data: { assetType: "MEMORY_CARE", transaction: "REFINANCE", loanAmount: 12_000_000, noi: 1_180_000, value: 17_400_000, unitCount: 96, occupancyPct: 87, timelineDays: 75, nonRecourseOnly: false, creditBand: "700_739", source: "website" },
    },
  },
};

function seededRows(deal: Deal, fx: SubmissionContext): StoredRows {
  const profile = structuredClone(fx.profile!);
  profile.dealId = deal.id;
  const loan = deal.loanAmountCents ?? 0;
  const tranche = profile.sources.find((s) => s.kind === playbookTrancheSource[profile.playbook]);
  const equity = profile.sources.find((s) => s.kind === "sponsor_equity");
  if (tranche && equity) {
    equity.amountCents += tranche.amountCents - loan;
    tranche.amountCents = loan;
  }
  return { profile, sponsor: fx.sponsor ? { ...structuredClone(fx.sponsor), dealId: deal.id } : null };
}

async function openHolds(rt: DealDeskRuntime, dealId: string): Promise<string[]> {
  if (!rt.checklist) return ["Sanctions holds cannot be checked because the checklist and screening desk is not configured"];
  try {
    return (await rt.checklist.holds.active(dealId)).map((h) => h.detail);
  } catch {
    return ["Sanctions holds could not be checked"];
  }
}

async function standinContext(rt: DealDeskRuntime, dealId: string): Promise<SubmissionContext | null> {
  const deal = await rt.store.getDeal(dealId);
  if (!deal) return null;
  const demo = demoDesks() !== null;
  const seed = demo ? DEMO_SEEDS[deal.id] : undefined;
  const fixture = seed?.fixture ? submissionFixture(seed.fixture) : null;
  const store = standinStore();
  if (fixture && !store.has(deal.id)) store.set(deal.id, seededRows(deal, fixture));
  const rows = store.get(deal.id) ?? { profile: null, sponsor: null };
  const [docs, holds] = await Promise.all([deal.leadId ? rt.vaultDocuments(deal.leadId) : Promise.resolve([]), openHolds(rt, deal.id)]);
  const base = fixture ?? emptySubmissionContext(deal.program);
  const intake: Intake | null = fixture?.intake ?? (seed?.intake ? intakeSchema.parse(seed.intake.data) : null);
  return {
    ...base,
    deal,
    profile: rows.profile,
    sponsor: rows.sponsor,
    intake,
    intakeReceivedAt: fixture?.intakeReceivedAt ?? seed?.intake?.at ?? null,
    vaultDocuments: fixture ? base.vaultDocuments : docs,
    openHolds: holds,
    now: rt.now(),
  };
}

// --- Metrics (PHASE2: wire to lib/deals/submission/metrics.ts) -------------------------------------

const KEYED_UNITS = new Set(["units", "keys", "beds", "pads", "lots"]);

function sourceOf(p: SubmissionProfile | null, key: FieldSourceKey): FieldSource | null {
  if (!p) return null;
  return p.fieldSources[key] ?? { source: "entered", by: p.updatedBy ?? p.createdBy, at: p.updatedAt };
}

function monthlyPayment(principalCents: number, ratePct: number, amortMonths: number): number {
  const r = ratePct / 100 / 12;
  return r === 0 ? principalCents / amortMonths : (principalCents * r) / (1 - (1 + r) ** -amortMonths);
}

function standinMetrics(ctx: SubmissionContext, playbook: SubmissionPlaybook): SubmissionMetrics {
  const p = ctx.profile;
  const loan = ctx.deal.loanAmountCents;
  const out: Metric[] = [];
  const inp = (field: string, label: string, value: number | null | undefined, key?: FieldSourceKey): MetricInput => ({ field, label, value: value ?? null, source: key && value !== null && value !== undefined ? sourceOf(p, key) : null });
  const loanIn: MetricInput = { field: "deal.loanAmountCents", label: "loan amount", value: loan, source: null };
  const add = (key: MetricKey, label: string, basis: MetricBasis, formula: string, inputs: MetricInput[], compute: (v: number[]) => number | null, note?: string) => {
    const missing = inputs.filter((i) => i.value === null).map((i) => i.label);
    const values = inputs.map((i) => i.value ?? 0);
    let value: number | null = null;
    if (!missing.length) {
      const v = compute(values);
      value = v === null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100;
      if (value === null) missing.push(...inputs.filter((i) => i.value === 0).map((i) => i.label));
    }
    out.push({ key, label, value, unit: METRIC_UNITS[key], basis, formula, inputs, missing, ...(note ? { note } : {}) });
  };
  const div = (a: number, b: number) => (b === 0 ? null : a / b);
  const pctOf = (a: number, b: number) => (b === 0 ? null : (a / b) * 100);
  const totalUses = p?.uses.length ? p.uses.reduce((s, u) => s + u.amountCents, 0) : null;
  const totalSources = p?.sources.length ? p.sources.reduce((s, u) => s + u.amountCents, 0) : null;
  const acquisition = p?.purpose === "acquisition";
  const income = isIncomeProperty(playbook, p ? { sizeCount: p.sizeCount, sizeUnit: p.sizeUnit } : null);
  const shortTerm = SHORT_TERM_PLAYBOOKS.includes(playbook) || playbook === "c_pace";
  const hm = HARD_MONEY_FILE_PLAYBOOKS.includes(playbook) ? ctx.hardMoney : null;

  if (hm) {
    add("ltc", "LTC", "cost", "loan ÷ total cost (hard money file)", [loanIn, inp("hardMoney.totalCost", "total cost (hard money file)", Math.round(hm.metrics.totalCost * 100))], ([l, c]) => pctOf(l!, c!));
    add("ltarv", "LTARV", "stabilized", "loan ÷ after-repair value (hard money file)", [loanIn, inp("hardMoney.arv", "after-repair value", Math.round(hm.arv * 100))], ([l, v]) => pctOf(l!, v!));
  } else if (acquisition && !p?.asIsValueCents && p?.purchasePriceCents) {
    add("ltv_as_is", "Loan to purchase price", "in_place", "loan ÷ purchase price", [loanIn, inp("purchasePriceCents", "purchase price", p.purchasePriceCents, "purchasePriceCents")], ([l, v]) => pctOf(l!, v!));
  } else {
    add("ltv_as_is", "LTV (as-is)", "in_place", "loan ÷ as-is value", [loanIn, inp("asIsValueCents", "as-is value", p?.asIsValueCents, "asIsValueCents")], ([l, v]) => pctOf(l!, v!));
  }
  if (shortTerm && !hm) add("ltv_stabilized", "LTV (stabilized)", "stabilized", "loan ÷ as-stabilized value", [loanIn, inp("stabilizedValueCents", "stabilized value", p?.stabilizedValueCents, "stabilizedValueCents")], ([l, v]) => pctOf(l!, v!));
  if (!hm) add("ltc", "LTC", "cost", "loan ÷ total cost (sum of uses)", [loanIn, inp("uses", "total cost (sources and uses)", totalUses, "uses")], ([l, c]) => pctOf(l!, c!));
  if (income) {
    add("debt_yield_in_place", "Debt yield (in place)", "in_place", "in-place NOI ÷ loan", [inp("noiInPlaceCents", "in-place NOI", p?.noiInPlaceCents, "noiInPlaceCents"), loanIn], ([n, l]) => pctOf(n!, l!));
    if (p?.noiStabilizedCents !== null && p?.noiStabilizedCents !== undefined) add("debt_yield_stabilized", "Debt yield (stabilized)", "stabilized", "stabilized NOI ÷ loan", [inp("noiStabilizedCents", "stabilized NOI", p.noiStabilizedCents, "noiStabilizedCents"), loanIn], ([n, l]) => pctOf(n!, l!));
    const rate = p?.assumedRatePct ?? null;
    const amort = p?.assumedAmortMonths ?? null;
    add(
      "dscr_in_place",
      "DSCR (in place)",
      "in_place",
      "in-place NOI ÷ annual debt service at the assumed rate and amortization",
      [inp("noiInPlaceCents", "in-place NOI", p?.noiInPlaceCents, "noiInPlaceCents"), loanIn, inp("assumedRatePct", "assumed rate", rate, "assumedRatePct"), inp("assumedAmortMonths", "assumed amortization", amort, "assumedAmortMonths")],
      ([n, l, r, a]) => div(n!, monthlyPayment(l!, r!, a!) * 12),
      rate !== null && amort !== null ? `at an assumed ${rate}% / ${Math.round(amort / 12)}-year amortization; an assumption, not a quote` : undefined,
    );
    const basisValue = acquisition ? (p?.purchasePriceCents ?? null) : (p?.asIsValueCents ?? null);
    add("cap_rate", "Cap rate", "in_place", acquisition ? "in-place NOI ÷ purchase price" : "in-place NOI ÷ as-is value", [inp("noiInPlaceCents", "in-place NOI", p?.noiInPlaceCents, "noiInPlaceCents"), inp(acquisition ? "purchasePriceCents" : "asIsValueCents", acquisition ? "purchase price" : "as-is value", basisValue, acquisition ? "purchasePriceCents" : "asIsValueCents")], ([n, v]) => pctOf(n!, v!));
  }
  if (playbook === "construction" || playbook === "bridge" || playbook === "hotel_pip_bridge") add("yield_on_cost", "Yield on cost", "stabilized", "stabilized NOI ÷ total cost", [inp("noiStabilizedCents", "stabilized NOI", p?.noiStabilizedCents, "noiStabilizedCents"), inp("uses", "total cost (sources and uses)", totalUses, "uses")], ([n, c]) => pctOf(n!, c!));
  if (playbook === "dscr_rental") {
    const r = p?.programDetails.rental;
    const rent = r?.monthlyRentCents !== undefined && r?.marketRentCents !== undefined ? Math.min(r.monthlyRentCents, r.marketRentCents) : (r?.monthlyRentCents ?? r?.marketRentCents ?? null);
    const pitiaInputs = [loanIn, inp("assumedRatePct", "assumed rate", p?.assumedRatePct, "assumedRatePct"), inp("assumedAmortMonths", "assumed amortization", p?.assumedAmortMonths, "assumedAmortMonths"), inp("programDetails.rental.monthlyTaxesCents", "monthly taxes", r?.monthlyTaxesCents, "programDetails.rental.monthlyTaxesCents"), inp("programDetails.rental.monthlyInsuranceCents", "monthly insurance", r?.monthlyInsuranceCents, "programDetails.rental.monthlyInsuranceCents")];
    const pitia = ([l, rt, a, t, i]: number[]) => monthlyPayment(l!, rt!, a!) + t! + i! + (r?.monthlyHoaCents ?? 0);
    add("pitia_monthly", "PITIA (monthly)", "na", "principal and interest at the assumed terms + taxes + insurance + HOA", pitiaInputs, pitia);
    add("dscr_rental", "DSCR (rental)", "in_place", "monthly rent (lower of lease and market) ÷ PITIA", [inp("programDetails.rental.monthlyRentCents", "monthly rent", rent, "programDetails.rental.monthlyRentCents"), ...pitiaInputs], ([rent0, ...rest]) => div(rent0!, pitia(rest)), "PITIA at the assumed rate and amortization; an assumption, not a quote");
  }
  if (playbook === "sba_7a" || playbook === "sba_504") {
    const g = ctx.spreadFigures.globalCashFlow;
    add("global_dscr", "Global DSCR", "in_place", "global cash flow ÷ global debt service (global cash flow spread)", [{ field: "spread.global_cash_flow", label: "global cash flow spread", value: g?.globalDscr ?? null, source: g ? { source: "spread", ref: g.spreadId, asOf: g.asOf, at: g.asOf } : null }], ([v]) => v!);
  }
  if (playbook === "hotel_cmbs" || playbook === "hotel_pip_bridge") {
    const pip = p?.programDetails.hotel?.pip;
    if (pip?.required) add("pip_per_key", "PIP cost per key", "cost", "PIP budget ÷ keys", [inp("programDetails.hotel.pip", "PIP budget", pip.budgetCents, "programDetails.hotel.pip"), inp("sizeCount", "keys", p?.sizeUnit === "keys" ? p.sizeCount : null, "sizeCount")], ([b, k]) => div(b!, k!));
  }
  if (p?.sizeUnit && KEYED_UNITS.has(p.sizeUnit)) add("loan_per_unit", `Loan per ${p.sizeUnit === "keys" ? "key" : p.sizeUnit === "beds" ? "bed" : "unit"}`, "na", `loan ÷ ${SIZE_UNIT_LABELS[p.sizeUnit]}`, [loanIn, inp("sizeCount", SIZE_UNIT_LABELS[p.sizeUnit], p.sizeCount, "sizeCount")], ([l, n]) => div(l!, n!));
  if (totalSources !== null || totalUses !== null) add("sources_minus_uses", "Sources minus uses", "na", "sum of sources − sum of uses (0 when balanced)", [inp("sources", "sources", totalSources, "sources"), inp("uses", "uses", totalUses, "uses")], ([s, u]) => s! - u!);

  return { metrics: out, sponsorStrength: standinSponsorStrength(ctx), warnings: [] };
}

function standinSponsorStrength(ctx: SubmissionContext): SponsorStrength | null {
  const t = ctx.guarantorTotals;
  const s = ctx.sponsor;
  const loan = ctx.deal.loanAmountCents;
  const nw = t ? t.netWorthCents : (s?.statedNetWorthCents ?? null);
  const liq = t ? t.liquidityCents : (s?.statedLiquidityCents ?? null);
  if (!t && nw === null && liq === null) return null;
  const reqNw = loan === null ? null : loan;
  const reqLiq = loan === null ? null : Math.round(loan * 0.1);
  return {
    basis: t ? "pfs" : "stated",
    asOf: t ? t.oldestPfsAsOf : (s?.statedAsOf ?? null),
    netWorthCents: nw,
    liquidityCents: liq,
    guarantorCount: t?.guarantorCount ?? 0,
    pfsCount: t?.pfsCount ?? 0,
    covenants: { netWorthMultiple: 1, liquidityPct: 0.1, requiredNetWorthCents: reqNw, requiredLiquidityCents: reqLiq, netWorthOk: nw === null || reqNw === null ? null : nw >= reqNw, liquidityOk: liq === null || reqLiq === null ? null : liq >= reqLiq },
  };
}

// --- Readiness (PHASE2: wire to lib/deals/submission/requirements.ts + readiness.ts) ----------------

type StageLv = { screen?: RequirementLevel; term_sheet?: RequirementLevel };
type StandinReq = {
  id: string;
  section: SectionId;
  label: string;
  levels: (pb: SubmissionPlaybook, ctx: SubmissionContext) => StageLv | null;
  when?: (ctx: SubmissionContext) => boolean;
  met: (ctx: SubmissionContext, m: SubmissionMetrics) => boolean;
  fields?: readonly FieldSourceKey[];
  fix: (ctx: SubmissionContext) => FixTarget;
  hint: string;
};

const RR: StageLv = { screen: "required", term_sheet: "required" };
const rR: StageLv = { screen: "recommended", term_sheet: "required" };
const ALL = (lv: StageLv) => () => lv;
const ONLY = (pbs: readonly SubmissionPlaybook[], lv: StageLv) => (pb: SubmissionPlaybook) => (pbs.includes(pb) ? lv : null);
const INCOME = (pb: SubmissionPlaybook, ctx: SubmissionContext) => isIncomeProperty(pb, ctx.profile ? { sizeCount: ctx.profile.sizeCount, sizeUnit: ctx.profile.sizeUnit } : null);
const set = (v: unknown) => v !== null && v !== undefined && v !== "";
const ed = (section: SectionId, field?: FieldSourceKey) => () => ({ kind: "editor" as const, section, ...(field ? { field } : {}) });
const HOTEL: readonly SubmissionPlaybook[] = ["hotel_cmbs", "hotel_pip_bridge"];
const SBA: readonly SubmissionPlaybook[] = ["sba_7a", "sba_504"];
const HUD: readonly SubmissionPlaybook[] = ["hud_232", "hud_multifamily"];
const hasDoc = (ctx: SubmissionContext, kinds: string[], itemKey?: string) =>
  ctx.vaultDocuments.some((d) => kinds.includes(d.kind)) || (itemKey ? ctx.checklistItems.some((i) => i.templateKey === itemKey && i.status !== "requested" && i.status !== "rejected") : false);
const guarantors = (ctx: SubmissionContext) => ctx.principals.filter((p) => p.kind === "individual" && (p.isGuarantor || HUD.includes(ctx.profile?.playbook ?? defaultPlaybook(ctx.deal.program))));
const daysOld = (ctx: SubmissionContext, iso: string | null) => (iso ? (ctx.now.getTime() - Date.parse(`${iso}T00:00:00Z`)) / 86_400_000 : Infinity);

const STANDIN_REQUIREMENTS: readonly StandinReq[] = [
  { id: "request.amount", section: "loan_request", label: "Loan amount", levels: ALL(RR), met: (c) => (c.deal.loanAmountCents ?? 0) > 0, fix: () => ({ kind: "deal_details" }), hint: "Set the loan amount in the deal's Details." },
  { id: "request.purpose", section: "loan_request", label: "Loan purpose", levels: ALL(RR), met: (c) => set(c.profile?.purpose), fields: ["purpose"], fix: ed("loan_request", "purpose"), hint: "Pick the purpose." },
  { id: "request.structure", section: "loan_request", label: "Requested term, rate type and amortization or interest-only", levels: ALL(rR), met: (c) => set(c.profile?.requestedTermMonths) && set(c.profile?.rateType) && (set(c.profile?.requestedAmortMonths) || set(c.profile?.requestedIoMonths)), fields: ["requestedTermMonths", "rateType"], fix: ed("loan_request", "requestedTermMonths"), hint: "Term, rate type and amortization." },
  { id: "request.recourse_lien", section: "loan_request", label: "Recourse and lien position", levels: ALL(RR), met: (c) => set(c.profile?.recourse) && set(c.profile?.lienPosition), fields: ["recourse", "lienPosition"], fix: ed("loan_request", "recourse"), hint: "Recourse sought and lien position." },
  { id: "request.close_date", section: "loan_request", label: "Target closing date", levels: ALL(rR), met: (c) => set(c.profile?.targetCloseDate), fields: ["targetCloseDate"], fix: ed("loan_request", "targetCloseDate"), hint: "When the borrower needs to close." },
  { id: "request.existing_debt", section: "loan_request", label: "Existing lender, balance and maturity", levels: ALL(RR), when: (c) => REFINANCE_PURPOSES.includes(c.profile?.purpose ?? "acquisition"), met: (c) => set(c.profile?.existingLender) && set(c.profile?.existingDebtCents) && set(c.profile?.existingMaturityDate), fields: ["existingLender", "existingDebtCents", "existingMaturityDate"], fix: ed("loan_request", "existingLender"), hint: "The debt being refinanced." },
  { id: "request.cash_out_use", section: "loan_request", label: "Use of the cash out", levels: ALL(RR), when: (c) => (c.profile?.cashOutCents ?? 0) > 0, met: (c) => set(c.profile?.cashOutUse), fields: ["cashOutUse"], fix: ed("loan_request", "cashOutUse"), hint: "What the borrower does with the cash." },
  { id: "property.identity", section: "property", label: "Property address, state and type", levels: ALL(RR), met: (c) => set(c.deal.propertyAddress) && set(c.deal.propertyState) && set(c.profile?.assetType), fields: ["assetType"], fix: (c) => (c.deal.propertyAddress && c.deal.propertyState ? { kind: "editor", section: "property", field: "assetType" } : { kind: "deal_details" }), hint: "Address and state are on the deal's Details." },
  { id: "property.size", section: "property", label: "Property size", levels: ALL(RR), when: (c) => c.profile?.assetType !== "LAND", met: (c) => set(c.profile?.sizeCount) && set(c.profile?.sizeUnit), fields: ["sizeCount", "sizeUnit"], fix: ed("property", "sizeCount"), hint: "Units, keys, beds or square feet." },
  { id: "property.occupancy", section: "property", label: "Occupancy and its date", levels: (pb, c) => (INCOME(pb, c) || pb === "dscr_rental" ? RR : null), met: (c) => set(c.profile?.occupancyPct) && set(c.profile?.occupancyAsOf), fields: ["occupancyPct", "occupancyAsOf"], fix: ed("property", "occupancyPct"), hint: "Physical occupancy and as-of date." },
  {
    id: "value.basis",
    section: "value",
    label: "Purchase price, or as-is value with its source and date",
    levels: ALL(RR),
    met: (c) => (c.profile?.purpose === "acquisition" ? set(c.profile.purchasePriceCents) : set(c.profile?.asIsValueCents) && set(c.profile?.asIsValueSource) && set(c.profile?.asIsValueAsOf)),
    fields: ["purchasePriceCents", "asIsValueCents"],
    fix: (c) => ({ kind: "editor", section: "value", field: c.profile?.purpose === "acquisition" ? "purchasePriceCents" : "asIsValueCents" }),
    hint: "The value basis lenders size against.",
  },
  { id: "value.stabilized", section: "value", label: "Stabilized or after-repair value with its source", levels: (pb) => (SHORT_TERM_PLAYBOOKS.includes(pb) || pb === "c_pace" ? RR : null), met: (c) => (HARD_MONEY_FILE_PLAYBOOKS.includes(c.profile?.playbook ?? "bridge") && c.hardMoney ? c.hardMoney.arv > 0 : set(c.profile?.stabilizedValueCents) && set(c.profile?.stabilizedValueSource)), fields: ["stabilizedValueCents"], fix: ed("value", "stabilizedValueCents"), hint: "As-complete, as-stabilized or ARV." },
  { id: "financials.noi_in_place", section: "financials", label: "In-place NOI with its period and basis", levels: (pb, c) => (INCOME(pb, c) ? RR : null), met: (c) => (set(c.profile?.noiInPlaceCents) && set(c.profile?.noiPeriodEnd) && set(c.profile?.noiBasis)) || c.spreadBundleKinds.includes("operating_statement"), fields: ["noiInPlaceCents"], fix: ed("financials", "noiInPlaceCents"), hint: "From the T-12 or the borrower." },
  { id: "financials.noi_stabilized", section: "financials", label: "Stabilized NOI and months to stabilize", levels: ONLY(["bridge", "hotel_pip_bridge", "construction", "mezz_pref"], RR), met: (c) => set(c.profile?.noiStabilizedCents) && set(c.profile?.stabilizationMonths), fields: ["noiStabilizedCents"], fix: (c) => ({ kind: "editor", section: INCOME(c.profile?.playbook ?? "bridge", c) ? "financials" : "plan_exit", field: "noiStabilizedCents" }), hint: "The pro forma the plan reaches." },
  { id: "financials.dscr_assumption", section: "loan_request", label: "Assumed rate and amortization, so DSCR can be shown", levels: (pb, c) => (INCOME(pb, c) && pb !== "construction" ? rR : null), met: (c) => set(c.profile?.assumedRatePct) && set(c.profile?.assumedAmortMonths), fields: ["assumedRatePct", "assumedAmortMonths"], fix: ed("loan_request", "assumedRatePct"), hint: "A sizing assumption, not a quote." },
  { id: "docs.t12", section: "documents", label: "T-12 operating statement", levels: (pb, c) => (INCOME(pb, c) ? rR : null), met: (c) => hasDoc(c, ["T12"], "t12"), fix: (c) => ({ kind: "checklist", itemId: c.checklistItems.find((i) => i.docKind === "T12")?.id }), hint: "Upload it to the vault through the checklist." },
  { id: "docs.rent_roll", section: "documents", label: "Rent roll, census or STR report", levels: (pb, c) => (INCOME(pb, c) ? rR : null), met: (c) => hasDoc(c, ["RENT_ROLL", "CENSUS", "STR_REPORT"]), fix: (c) => ({ kind: "checklist", itemId: c.checklistItems.find((i) => i.docKind === "RENT_ROLL" || i.docKind === "CENSUS" || i.docKind === "STR_REPORT")?.id }), hint: "The current occupancy document." },
  { id: "sponsor.entity", section: "sponsor", label: "Borrowing entity on the org chart", levels: ALL(rR), met: (c) => set(c.deal.borrowerName) && c.principals.some((p) => p.roles.includes("borrower_entity")), fix: () => ({ kind: "principals" }), hint: "Add the borrower entity on the checklist desk." },
  { id: "sponsor.guarantor", section: "sponsor", label: "At least one guarantor", levels: (pb) => (HUD.includes(pb) ? null : rR), met: (c) => c.principals.some((p) => p.isGuarantor), fix: () => ({ kind: "principals" }), hint: "Mark who guarantees." },
  { id: "sponsor.experience", section: "sponsor", label: "Sponsor experience (80+ characters) and track record", levels: ALL(RR), met: (c) => (c.sponsor?.experienceSummary?.length ?? 0) >= 80 && (set(c.sponsor?.yearsExperience) || set(c.sponsor?.similarProjectsCount) || set(c.sponsor?.portfolioCount)), fix: ed("sponsor"), hint: "Years, similar projects or properties owned." },
  { id: "sponsor.strength", section: "sponsor", label: "Net worth and liquidity (stated with a date, or a PFS on file)", levels: ALL(RR), met: (c) => (c.guarantorTotals?.pfsCount ?? 0) > 0 || (set(c.sponsor?.statedNetWorthCents) && set(c.sponsor?.statedLiquidityCents) && set(c.sponsor?.statedAsOf)), fix: ed("sponsor"), hint: "Stated figures, or a PFS per guarantor." },
  { id: "sponsor.pfs_current", section: "sponsor", label: `A PFS for every guarantor, none older than ${PFS_MAX_AGE_DAYS} days`, levels: () => ({ term_sheet: "required" }), met: (c) => guarantors(c).length > 0 && guarantors(c).every((g) => g.hasPfs && daysOld(c, g.pfsAsOf) <= PFS_MAX_AGE_DAYS), fix: () => ({ kind: "principals" }), hint: "Collect the statements through the portal." },
  { id: "sponsor.reo", section: "sponsor", label: "Schedule of real estate owned for each key principal", levels: (pb) => (HARD_MONEY_FILE_PLAYBOOKS.includes(pb) ? null : rR), met: (c) => guarantors(c).length > 0 && guarantors(c).every((g) => g.hasReoSchedule), fix: () => ({ kind: "principals" }), hint: "On the principals file." },
  { id: "sponsor.credit", section: "sponsor", label: "Credit band and credit events answered", levels: ONLY(["hard_money", "fix_flip", "dscr_rental", "sba_7a", "sba_504", "bank", "bridge"], RR), met: (c) => set(c.sponsor?.creditBand) && creditEventKinds.every((k) => c.sponsor?.creditEvents[k] !== undefined), fix: ed("sponsor"), hint: "Self-reported band; yes or no for each event." },
  { id: "plan.narrative", section: "plan_exit", label: "Business plan (200+ characters)", levels: (pb) => (SHORT_TERM_PLAYBOOKS.includes(pb) ? RR : rR), met: (c) => (c.profile?.businessPlan?.length ?? 0) >= 200, fields: ["businessPlan"], fix: ed("plan_exit", "businessPlan"), hint: "One paragraph." },
  { id: "plan.exit", section: "plan_exit", label: "Exit strategy, timing and detail", levels: ONLY(SHORT_TERM_PLAYBOOKS, RR), met: (c) => set(c.profile?.exitStrategy) && set(c.profile?.exitMonths) && set(c.profile?.exitDetail), fields: ["exitStrategy", "exitMonths", "exitDetail"], fix: ed("plan_exit", "exitStrategy"), hint: "Sale or refinance, when, and the take-out." },
  { id: "plan.risks", section: "plan_exit", label: "At least one known issue with its mitigant", levels: ALL(rR), met: (c) => (c.profile?.risks.length ?? 0) > 0, fields: ["risks"], fix: ed("plan_exit", "risks"), hint: "State the weak spot plainly." },
  {
    id: "capital.sources_uses",
    section: "sources_uses",
    label: "Balanced sources and uses, with the loan line equal to the loan amount",
    levels: (pb, c) => ({ screen: ["acquisition", "construction", "renovation"].includes(c.profile?.purpose ?? "") ? "required" : "recommended", term_sheet: "required" }),
    met: (c) => {
      const p = c.profile;
      if (!p?.sources.length || !p.uses.length) return false;
      const s = p.sources.reduce((a, l) => a + l.amountCents, 0);
      const u = p.uses.reduce((a, l) => a + l.amountCents, 0);
      const tranche = p.sources.filter((l) => l.kind === playbookTrancheSource[p.playbook]).reduce((a, l) => a + l.amountCents, 0);
      return s === u && tranche === c.deal.loanAmountCents;
    },
    fields: ["sources", "uses"],
    fix: ed("sources_uses", "sources"),
    hint: "Sources must equal uses.",
  },
  { id: "construction.budget", section: "construction", label: "Construction budget by category", levels: ONLY(["construction", "c_pace"], RR), met: (c) => set(c.profile?.programDetails.construction?.budget) || c.spreadFigures.constructionBudget !== null, fields: ["programDetails.construction.budget"], fix: ed("construction", "programDetails.construction.budget"), hint: "Or save a budget spread." },
  { id: "construction.timeline", section: "construction", label: "Construction and lease-up months", levels: ONLY(["construction"], RR), met: (c) => set(c.profile?.programDetails.construction?.constructionMonths) && set(c.profile?.programDetails.construction?.leaseUpMonths), fix: ed("construction", "programDetails.construction.constructionMonths"), hint: "Build and lease-up time." },
  { id: "construction.entitlements", section: "construction", label: "Entitlement and permit status", levels: ONLY(["construction"], RR), met: (c) => set(c.profile?.programDetails.construction?.entitlementStatus) && set(c.profile?.programDetails.construction?.permitStatus), fix: ed("construction", "programDetails.construction.entitlementStatus"), hint: "Where approvals stand." },
  { id: "construction.gc", section: "construction", label: "General contractor with a CSLB check on file", levels: ONLY(["construction"], rR), met: (c) => Boolean(c.construction?.project.generalContractorName && c.construction.licenseCheck), fix: (c) => ({ kind: "construction_project", projectId: c.construction?.project.id ?? null }), hint: "On the construction desk." },
  { id: "construction.track_record", section: "construction", label: "Ground-up projects the sponsor completed", levels: ONLY(["construction"], RR), met: (c) => set(c.profile?.programDetails.construction?.groundUpProjectsCompleted), fix: ed("construction", "programDetails.construction.groundUpProjectsCompleted"), hint: "A count." },
  { id: "rehab.budget", section: "rehab", label: "Rehab or capex budget", levels: ONLY(["bridge", "hotel_pip_bridge"], RR), when: (c) => c.profile?.playbook !== "bridge" || c.profile.purpose === "renovation" || c.profile.uses.some((u) => u.kind === "renovation"), met: (c) => set(c.profile?.programDetails.rehab?.budgetCents), fix: ed("rehab", "programDetails.rehab.budgetCents"), hint: "The renovation budget." },
  { id: "hm.file", section: "rehab", label: "Hard money file", levels: ONLY(HARD_MONEY_FILE_PLAYBOOKS, RR), met: (c) => c.hardMoney !== null, fix: () => ({ kind: "hard_money_file" }), hint: "Scope, ARV and exit live there." },
  { id: "hm.scope_lines", section: "rehab", label: "Scope of work lines", levels: ONLY(["fix_flip"], rR), met: (c) => (c.hardMoney?.scopeOfWork.length ?? 0) > 0, fix: () => ({ kind: "hard_money_file" }), hint: "On the hard money file." },
  { id: "rental.rent", section: "rental", label: "Rent, taxes and insurance", levels: ONLY(["dscr_rental"], RR), met: (c) => { const r = c.profile?.programDetails.rental; return (set(r?.monthlyRentCents) || set(r?.marketRentCents)) && set(r?.monthlyTaxesCents) && set(r?.monthlyInsuranceCents); }, fix: ed("rental", "programDetails.rental.monthlyRentCents"), hint: "Monthly figures." },
  { id: "rental.lease_status", section: "rental", label: "Lease status", levels: ONLY(["dscr_rental"], RR), met: (c) => set(c.profile?.programDetails.rental?.leaseStatus), fix: ed("rental", "programDetails.rental.leaseStatus"), hint: "Leased, vacant or short-term." },
  { id: "sba.business", section: "sba", label: "Operating business, NAICS code and years in business", levels: ONLY(SBA, RR), met: (c) => { const s = c.profile?.programDetails.sba; return set(s?.businessName) && set(s?.naics) && set(s?.yearsInBusiness); }, fix: ed("sba", "programDetails.sba.businessName"), hint: "The business that occupies the building." },
  { id: "sba.occupancy", section: "sba", label: "Owner-occupied share", levels: ONLY(SBA, RR), met: (c) => set(c.profile?.ownerOccupiedPct), fields: ["ownerOccupiedPct"], fix: ed("property", "ownerOccupiedPct"), hint: "On the Property section." },
  { id: "sba.cash_flow", section: "sba", label: "Business revenue, EBITDA and debt service, or a global cash flow spread", levels: ONLY(SBA, RR), met: (c) => { const s = c.profile?.programDetails.sba; return (set(s?.businessRevenueCents) && set(s?.businessEbitdaCents) && set(s?.existingBusinessDebtServiceCents)) || c.spreadFigures.globalCashFlow !== null; }, fix: ed("sba", "programDetails.sba.businessRevenueCents"), hint: "Annual figures." },
  { id: "sba.injection", section: "sba", label: "Equity injection and its source", levels: ONLY(SBA, RR), met: (c) => set(c.profile?.programDetails.sba?.equityInjectionCents) && set(c.profile?.programDetails.sba?.equityInjectionSource), fix: ed("sba", "programDetails.sba.equityInjectionCents"), hint: "Amount and where it comes from." },
  { id: "sba.eligibility_flags", section: "sba", label: "Franchise, change of ownership and affiliates answered", levels: ONLY(SBA, rR), met: (c) => { const s = c.profile?.programDetails.sba; return s?.franchise !== undefined && s?.changeOfOwnership !== undefined && s?.affiliates !== undefined; }, fix: ed("sba", "programDetails.sba.franchise"), hint: "Yes or no for each." },
  { id: "hotel.identity", section: "hotel", label: "Keys, brand and management company", levels: ONLY(HOTEL, RR), met: (c) => c.profile?.sizeUnit === "keys" && set(c.profile.sizeCount) && set(c.profile.programDetails.hotel?.brand) && set(c.sponsor?.managementCompany), fix: ed("hotel", "programDetails.hotel.brand"), hint: "Management company is on the Sponsor section." },
  { id: "hotel.performance", section: "hotel", label: "Occupancy, ADR and RevPAR", levels: ONLY(HOTEL, RR), met: (c) => c.spreadFigures.hotelStr !== null || (set(c.profile?.occupancyPct) && set(c.profile?.programDetails.hotel?.adrCents) && set(c.profile?.programDetails.hotel?.revparCents)), fix: ed("hotel", "programDetails.hotel.adrCents"), hint: "From the STR report or the T-12." },
  { id: "hotel.franchise_term", section: "hotel", label: "Franchise expiry for a branded hotel", levels: ONLY(HOTEL, rR), met: (c) => /^independent$/i.test(c.profile?.programDetails.hotel?.brand ?? "") || set(c.profile?.programDetails.hotel?.franchiseExpiry), fix: ed("hotel", "programDetails.hotel.franchiseExpiry"), hint: "It should run past the loan term." },
  { id: "hotel.pip", section: "hotel", label: "PIP answered, with budget and deadline when required", levels: ONLY(HOTEL, RR), met: (c) => { const pip = c.profile?.programDetails.hotel?.pip; return pip !== undefined && (!pip.required || (set(pip.budgetCents) && set(pip.deadline))); }, fix: ed("hotel", "programDetails.hotel.pip"), hint: "Yes or no; then the budget and deadline." },
  { id: "tenancy.rollover", section: "tenancy", label: "Top tenants with lease ends", levels: (pb, c) => (pb === "cmbs" || pb === "life_company" || (pb === "bank" && c.profile?.tenancy === "multi_tenant") ? RR : null), met: (c) => (c.profile?.programDetails.tenancy?.topTenants?.length ?? 0) > 0, fix: ed("tenancy", "programDetails.tenancy.topTenants"), hint: "Largest first." },
  { id: "agency.occupancy", section: "agency", label: "Economic occupancy and unit mix", levels: ONLY(["agency"], RR), met: (c) => set(c.profile?.programDetails.agency?.economicOccupancyPct) && ((c.profile?.programDetails.agency?.unitMix?.length ?? 0) > 0 || c.spreadBundleKinds.includes("rent_roll")), fix: ed("agency", "programDetails.agency.economicOccupancyPct"), hint: "Or save a rent-roll spread." },
  { id: "hud.section", section: "hud", label: "HUD program and repairs", levels: ONLY(HUD, RR), met: (c) => set(c.profile?.programDetails.hud?.section) && set(c.profile?.programDetails.hud?.repairsCents), fix: ed("hud", "programDetails.hud.section"), hint: "Repairs may be 0." },
  { id: "hud.232_operations", section: "hud", label: "Licensed beds, operator and payor mix", levels: ONLY(["hud_232"], RR), met: (c) => { const h = c.profile?.programDetails.hud; return set(h?.licensedBeds) && set(h?.operatorName) && (set(h?.payorMixNote) || c.spreadBundleKinds.includes("senior_census")); }, fix: ed("hud", "programDetails.hud.licensedBeds"), hint: "Operations of the facility." },
  { id: "hud.prior_participation", section: "hud", label: "Prior HUD participation answered", levels: ONLY(HUD, rR), met: (c) => c.profile?.programDetails.hud?.priorHudParticipation !== undefined, fix: ed("hud", "programDetails.hud.priorHudParticipation"), hint: "Yes or no." },
  { id: "stack.senior", section: "capital_stack", label: "Senior lender, amount, maturity and whether it allows subordinate debt", levels: ONLY(["mezz_pref", "c_pace"], RR), met: (c) => { const s = c.profile?.programDetails.capitalStack; return set(s?.seniorLender) && set(s?.seniorAmountCents) && set(s?.seniorMaturity) && s?.seniorAllowsSubordinate !== undefined; }, fix: ed("capital_stack", "programDetails.capitalStack.seniorLender"), hint: "The loan ahead of this one." },
  { id: "stack.consent", section: "capital_stack", label: "Intercreditor or consent status", levels: ONLY(["mezz_pref", "c_pace"], RR), met: (c) => set(c.profile?.programDetails.capitalStack?.[c.profile.playbook === "c_pace" ? "consentStatus" : "intercreditorStatus"]), fix: (c) => ({ kind: "editor", section: "capital_stack", field: c.profile?.playbook === "c_pace" ? "programDetails.capitalStack.consentStatus" : "programDetails.capitalStack.intercreditorStatus" }), hint: "Where the senior lender stands." },
  { id: "cpace.improvements", section: "capital_stack", label: "Eligible improvements cost and program jurisdiction", levels: ONLY(["c_pace"], RR), met: (c) => set(c.profile?.programDetails.capitalStack?.eligibleImprovementsCents) && set(c.profile?.programDetails.capitalStack?.programJurisdiction), fix: ed("capital_stack", "programDetails.capitalStack.eligibleImprovementsCents"), hint: "What the assessment pays for." },
];

const RECEIVED: readonly string[] = [...SATISFIED_STATUSES, "submitted", "under_review"];

function hardStops(ctx: SubmissionContext): string[] {
  const out = [...ctx.openHolds];
  if (!dealAcceptsLenderAccess(ctx.deal)) out.push(`The deal is ${ctx.deal.status === "active" ? ctx.deal.stage.replace(/_/g, " ") : ctx.deal.status.replace(/_/g, " ")}`);
  return out;
}

function standinReadiness(ctx: SubmissionContext, metrics: SubmissionMetrics, playbook: SubmissionPlaybook, stage: TargetStage): Readiness {
  const required: ReadinessItem[] = [];
  const recommended: ReadinessItem[] = [];
  const href = (t: FixTarget) => submissionFixHref(ctx.deal.id, t);
  if (stage === "underwrite") {
    const items = ctx.checklistItems.filter((i) => i.required && (i.stage === "application" || i.stage === "underwriting"));
    if (!items.length) required.push({ id: "checklist.created", section: "documents", label: "Deal checklist created on the checklist desk", met: false, perBorrower: false, fix: { href: href({ kind: "checklist" }), hint: "Create the checklist for the deal's program." } });
    for (const i of items) required.push({ id: `checklist.${i.itemKey}`, section: "documents", label: i.title, met: RECEIVED.includes(i.status), perBorrower: false, fix: { href: href({ kind: "checklist", itemId: i.id }), hint: "On the deal checklist." } });
  } else {
    for (const r of STANDIN_REQUIREMENTS) {
      const lv = r.levels(playbook, ctx)?.[stage];
      if (!lv || (r.when && !r.when(ctx))) continue;
      const met = r.met(ctx, metrics);
      const setFields = (r.fields ?? []).filter((k) => set(ctx.profile ? ((ctx.profile as unknown as Record<string, unknown>)[k] ?? null) : null));
      const perBorrower = met && setFields.length > 0 && setFields.every((k) => ctx.profile?.fieldSources[k]?.source === "borrower");
      const item: ReadinessItem = { id: r.id, section: r.section, label: r.label, met, perBorrower, fix: { href: href(r.fix(ctx)), hint: r.hint } };
      (lv === "required" ? required : recommended).push(item);
    }
  }
  const metCount = required.filter((i) => i.met).length;
  return {
    playbook,
    stage,
    required,
    recommended,
    score: required.length ? Math.round((metCount / required.length) * 100) : 100,
    ready: required.every((i) => i.met),
    missing: required.filter((i) => !i.met).map((i) => i.id),
    hardStops: hardStops(ctx),
  };
}

// --- Prefill (PHASE2: wire to lib/deals/submission/prefill.ts) -------------------------------------

const SENIOR = new Set(["ASSISTED_LIVING", "MEMORY_CARE", "RCFE", "SNF"]);
const HOTELS = new Set(["HOTEL_FLAGGED", "HOTEL_BOUTIQUE"]);

function standinPrefill(ctx: SubmissionContext, playbook: SubmissionPlaybook): PrefillSuggestions | null {
  const patch: SubmissionProfilePatch = { playbook };
  const sources: Partial<Record<FieldSourceKey, FieldSource>> = {};
  const sponsor: SponsorProfilePatch = {};
  const rows: PrefillRow[] = [];
  const at = ctx.now.toISOString();
  const by = "prefill";
  const put = <K extends keyof SubmissionProfilePatch & FieldSourceKey>(key: K, value: SubmissionProfilePatch[K], label: string, shown: string, source: FieldSource) => {
    patch[key] = value;
    sources[key] = source;
    rows.push({ name: key, label, value: shown, source });
  };
  const i = ctx.intake;
  if (i) {
    const borrower: FieldSource = { source: "borrower", by, at, ...(ctx.deal.leadId ? { ref: ctx.deal.leadId } : {}) };
    put("assetType", i.assetType, "Property type", SUBMISSION_ASSET_TYPE_LABELS[i.assetType], borrower);
    const purpose = i.transaction === "PURCHASE" ? "acquisition" : i.transaction === "REFINANCE" ? "refinance" : i.transaction === "CONSTRUCTION" ? "construction" : i.transaction === "CONVERSION" ? "renovation" : i.hardMoney?.purpose === "REFINANCE" ? "refinance" : "acquisition";
    put("purpose", purpose, "Loan purpose", LOAN_PURPOSE_LABELS[purpose], borrower);
    if (i.noi > 0) {
      put("noiInPlaceCents", Math.round(i.noi * 100), "NOI in place", usd(Math.round(i.noi * 100)), borrower);
      put("noiBasis", "borrower_stated", "NOI basis", NOI_BASIS_LABELS.borrower_stated, borrower);
    }
    if (i.value) {
      put("asIsValueCents", Math.round(i.value * 100), "As-is value", usd(Math.round(i.value * 100)), borrower);
      put("asIsValueSource", "sponsor_estimate", "As-is value source", VALUE_SOURCE_LABELS.sponsor_estimate, borrower);
    }
    if (i.unitCount > 0) {
      const unit = SENIOR.has(i.assetType) ? "beds" : HOTELS.has(i.assetType) ? "keys" : "units";
      put("sizeCount", i.unitCount, "Size", count(i.unitCount), borrower);
      put("sizeUnit", unit, "Size measured in", SIZE_UNIT_LABELS[unit], borrower);
    }
    // The financing-page short form never asks for occupancy; its 85 is the form default, not the borrower's answer.
    if (i.source !== "financing_page") put("occupancyPct", i.occupancyPct, "Physical occupancy", pct(i.occupancyPct), borrower);
    if (i.nonRecourseOnly) put("recourse", "non_recourse", "Recourse sought", RECOURSE_LABELS.non_recourse, borrower);
    if (ctx.intakeReceivedAt) {
      const close = new Date(Date.parse(ctx.intakeReceivedAt) + i.timelineDays * 86_400_000).toISOString().slice(0, 10);
      put("targetCloseDate", close, "Target closing date", date(close), borrower);
    }
    if (i.creditBand) {
      sponsor.creditBand = i.creditBand;
      rows.push({ name: "sponsor.creditBand", label: "Credit band", value: CREDIT_BAND_LABELS[i.creditBand], source: borrower });
    }
  }
  const s = ctx.spreads;
  if (s) {
    const spread: FieldSource = { source: "spread", ref: s.sourceSpreadIds[0] ?? "spread", ...(s.asOf ? { asOf: s.asOf } : {}), at, by };
    if (s.occupancyPct !== null) put("occupancyPct", s.occupancyPct, "Physical occupancy", pct(s.occupancyPct), spread);
    if (s.units !== null) put("sizeCount", s.units, "Size", count(s.units), spread);
  }
  const f = ctx.propertyFacts;
  if (f) {
    const pub: FieldSource = { source: "public_record", ref: f.id, at, by };
    if (f.apn) put("apn", f.apn, "APN", f.apn, pub);
    if (f.county) put("county", f.county, "County", f.county, pub);
    if (f.floodZone) put("floodZone", f.floodZone, "Flood zone", f.floodZone, pub);
    if (f.yearBuilt) put("yearBuilt", f.yearBuilt, "Year built", String(f.yearBuilt), pub);
  }
  const seen = new Map<string, PrefillRow>();
  for (const r of rows) seen.set(r.name, r);
  patch.fieldSources = sources;
  return { profile: patch, sponsor, rows: [...seen.values()] };
}

// --- Summary (PHASE2: wire to lib/deals/submission/summary.ts) -------------------------------------

const metricOf = (view: SubmissionView, key: MetricKey) => view.metrics.metrics.find((m) => m.key === key) ?? null;

function asOfOf(view: SubmissionView): string {
  const stamps = [view.ctx.profile?.updatedAt, view.ctx.sponsor?.updatedAt, view.ctx.spreads?.asOf].filter((s): s is string => Boolean(s));
  return (stamps.sort().at(-1) ?? view.ctx.deal.updatedAt).slice(0, 10);
}

function standinSummary(view: SubmissionView, stage: TargetStage): DealSummarySpec {
  const { ctx, playbook } = view;
  const p = ctx.profile;
  const asOf = asOfOf(view);
  const tag = (k: FieldSourceKey) => sourceLabel(p?.fieldSources[k]);
  const row = (label: string, value: string | null, source?: string) => (value ? [{ label, value, ...(source ? { source } : {}) }] : []);
  const m = (k: MetricKey) => {
    const x = metricOf(view, k);
    return x ? metricValue(x) : null;
  };
  const headline = [
    { label: "Loan", value: ctx.deal.loanAmountCents ? usd(ctx.deal.loanAmountCents) : "" },
    { label: "LTV", value: m("ltv_as_is") ?? "" },
    { label: "LTC", value: m("ltc") ?? "" },
    { label: "Debt yield", value: m("debt_yield_in_place") ?? "" },
    { label: "DSCR", value: m("dscr_in_place") ?? m("dscr_rental") ?? m("global_dscr") ?? "" },
  ].filter((h) => h.value);
  const strength = view.metrics.sponsorStrength;
  const readiness = view.readiness[stage];
  return {
    templateVersion: "standin-0",
    title: `${ctx.deal.title} — loan request summary`,
    subtitle: `Prepared ${date(asOf)} by ${site.legalName} for lender review`,
    asOf,
    headline,
    sections: [
      {
        title: "Request",
        rows: [
          ...row("Loan amount", ctx.deal.loanAmountCents ? usd(ctx.deal.loanAmountCents) : null, "Deal record"),
          ...row("Playbook", PLAYBOOK_LABELS[playbook]),
          ...row("Purpose", p?.purpose ? LOAN_PURPOSE_LABELS[p.purpose] : null, tag("purpose")),
          ...row("Term", p?.requestedTermMonths ? `${p.requestedTermMonths} months${p.requestedAmortMonths ? `, ${Math.round(p.requestedAmortMonths / 12)}-year amortization` : ", interest-only"}` : null, tag("requestedTermMonths")),
          ...row("Rate type", p?.rateType ? RATE_TYPE_LABELS[p.rateType] : null, tag("rateType")),
          ...row("Recourse", p?.recourse ? RECOURSE_LABELS[p.recourse] : null, tag("recourse")),
          ...row("Lien", p?.lienPosition ? LIEN_POSITION_LABELS[p.lienPosition] : null, tag("lienPosition")),
          ...row("Target closing", p?.targetCloseDate ? date(p.targetCloseDate) : null, tag("targetCloseDate")),
        ],
      },
      {
        title: "Property",
        rows: [
          ...row("Address", p?.maskAddress ? [p.city, ctx.deal.propertyState].filter(Boolean).join(", ") : ctx.deal.propertyAddress, "Deal record"),
          ...row("Type", p?.assetType ? SUBMISSION_ASSET_TYPE_LABELS[p.assetType] : null, tag("assetType")),
          ...row("Size", p?.sizeCount !== null && p?.sizeCount !== undefined && p.sizeUnit ? `${count(p.sizeCount)} ${SIZE_UNIT_LABELS[p.sizeUnit]}` : null, tag("sizeCount")),
          ...row("Year built", p?.yearBuilt ? String(p.yearBuilt) : null, tag("yearBuilt")),
          ...row("Occupancy", p?.occupancyPct !== null && p?.occupancyPct !== undefined ? `${pct(p.occupancyPct)}${p.occupancyAsOf ? ` as of ${date(p.occupancyAsOf)}` : ""}` : null, tag("occupancyPct")),
        ],
      },
      {
        title: "Value and financials",
        rows: [
          ...row("Purchase price", p?.purchasePriceCents ? usd(p.purchasePriceCents) : null, tag("purchasePriceCents")),
          ...row("As-is value", p?.asIsValueCents ? `${usd(p.asIsValueCents)}${p.asIsValueSource ? ` (${VALUE_SOURCE_LABELS[p.asIsValueSource]})` : ""}` : null, tag("asIsValueCents")),
          ...row("Stabilized value", p?.stabilizedValueCents ? usd(p.stabilizedValueCents) : null, tag("stabilizedValueCents")),
          ...row("NOI in place", p?.noiInPlaceCents !== null && p?.noiInPlaceCents !== undefined ? `${usd(p.noiInPlaceCents)}${p.noiPeriodEnd ? ` through ${date(p.noiPeriodEnd)}` : ""}` : null, tag("noiInPlaceCents")),
          ...row("NOI stabilized (pro forma)", p?.noiStabilizedCents !== null && p?.noiStabilizedCents !== undefined ? usd(p.noiStabilizedCents) : null, tag("noiStabilizedCents")),
          ...view.metrics.metrics.flatMap((x) => row(x.label, metricValue(x), "Corin calculation")),
        ],
      },
      {
        title: "Sponsor",
        rows: [
          ...row("Experience", ctx.sponsor?.experienceSummary ?? null, "Per borrower"),
          ...row("Portfolio", ctx.sponsor?.portfolioSizeNote ?? null, "Per borrower"),
          ...row("Combined net worth", strength?.netWorthCents !== null && strength?.netWorthCents !== undefined ? usd(strength.netWorthCents) : null, strength ? (strength.basis === "pfs" ? `Personal financial statements${strength.asOf ? ` (${date(strength.asOf)})` : ""}` : `Stated by the sponsor${strength.asOf ? ` (${date(strength.asOf)})` : ""}`) : undefined),
          ...row("Combined liquidity", strength?.liquidityCents !== null && strength?.liquidityCents !== undefined ? usd(strength.liquidityCents) : null),
          ...row("Credit band", ctx.sponsor?.creditBand ? CREDIT_BAND_LABELS[ctx.sponsor.creditBand] : null, "Per borrower"),
        ],
      },
      { title: "Plan and exit", paragraphs: [p?.businessPlan, p?.exitStrategy ? `Exit: ${EXIT_STRATEGY_LABELS[p.exitStrategy]}${p.exitMonths ? ` in about ${p.exitMonths} months` : ""}. ${p.exitDetail ?? ""}`.trim() : null].filter((s): s is string => Boolean(s)) },
      {
        title: "Sources and uses",
        table: {
          head: ["Line", "Amount"],
          rows: [...(p?.sources ?? []).map((s) => [`Source: ${SOURCE_KIND_LABELS[s.kind]}${s.note ? ` (${s.note})` : ""}`, usd(s.amountCents)]), ...(p?.uses ?? []).map((u) => [`Use: ${USE_KIND_LABELS[u.kind]}${u.note ? ` (${u.note})` : ""}`, usd(u.amountCents)])],
        },
      },
      { title: "Known issues and mitigants", paragraphs: (p?.risks ?? []).map((r) => `${r.risk}: ${r.mitigant}`) },
      { title: "About this request", paragraphs: [`${site.legalName} arranges loans as a broker and does not lend. Figures come from the borrower's documents and Corin's calculations as labeled; the lender performs its own underwriting and makes every credit decision.`] },
    ].filter((s) => (s.rows?.length ?? 0) + (s.paragraphs?.length ?? 0) + (s.table?.rows.length ?? 0) > 0),
    metricNotes: view.metrics.metrics.filter((x) => x.value !== null).map((x) => ({ key: x.key, formula: x.formula, inputs: x.inputs.map((i) => `${i.label}: ${formatMetricInput(i)}`) })),
    openItems: readiness.required.filter((r) => !r.met).map((r) => r.label),
    footer: licenseLine(),
  };
}

// --- Fit (PHASE2: wire to lib/deals/submission/tailor.ts) ------------------------------------------

function standinFit(lender: LenderPanelEntry, view: SubmissionView, now: Date): LenderFit {
  const matches: string[] = [];
  const exceptions: string[] = [];
  const unknown: string[] = [];
  const types = playbookLoanTypes[view.playbook];
  const shared = types.filter((t) => lender.loanTypes.includes(t));
  if (!lender.loanTypes.length) unknown.push("Loan types");
  else if (shared.length) matches.push(shared.map((t) => LENDER_LOAN_TYPE_SHORT_LABELS[t]).join(", "));
  else exceptions.push(`Loan type ${types.map((t) => LENDER_LOAN_TYPE_SHORT_LABELS[t]).join(" / ")} is not among the lender's recorded types`);
  const loan = view.ctx.deal.loanAmountCents;
  if (loan === null) unknown.push("Loan amount");
  else if (lender.minLoanCents === null && lender.maxLoanCents === null) unknown.push("Loan size range");
  else {
    const range = `${lender.minLoanCents !== null ? usd(lender.minLoanCents) : "no minimum"}–${lender.maxLoanCents !== null ? usd(lender.maxLoanCents) : "no maximum"}`;
    if ((lender.minLoanCents !== null && loan < lender.minLoanCents) || (lender.maxLoanCents !== null && loan > lender.maxLoanCents)) exceptions.push(`${usd(loan)} is outside ${range}`);
    else matches.push(`${range} covers ${usd(loan)}`);
  }
  const state = view.ctx.deal.propertyState?.toUpperCase() ?? null;
  if (!lender.states.length) unknown.push("States");
  else if (state && lender.states.includes(state)) matches.push(`Lends in ${state}`);
  else if (state) exceptions.push(`No recorded lending in ${state}`);
  return { lenderId: lender.id, matches, exceptions, unknown, staleness: lenderStaleness(lender, now), score: null };
}

// --- Email (PHASE2: wire to lib/deals/submission/email.ts) -----------------------------------------

const STAGE_ASK: Record<TargetStage, string> = { screen: "a soft quote", term_sheet: "a term sheet", underwrite: "full underwriting" };

function standinEmail(view: SubmissionView, readiness: Readiness, lender: LenderPanelEntry, fit: LenderFit, stage: TargetStage, advisor: EmailAdvisor): { subject: string; text: string; sha256: string } {
  const { ctx, playbook } = view;
  const p = ctx.profile;
  const loan = ctx.deal.loanAmountCents;
  const mv = (k: MetricKey) => {
    const x = metricOf(view, k);
    return x ? metricValue(x) : null;
  };
  const size = p?.sizeCount !== null && p?.sizeCount !== undefined && p.sizeUnit ? `${count(p.sizeCount)}-${p.sizeUnit === "sf" ? "SF" : p.sizeUnit.replace(/s$/, "")}` : null;
  const asset = p?.assetType ? SUBMISSION_ASSET_TYPE_LABELS[p.assetType].toLowerCase() : null;
  const place = [p?.city, ctx.deal.propertyState].filter(Boolean).join(" ");
  const headline = [mv("ltv_as_is") ? `${mv("ltv_as_is")} LTV` : null, mv("dscr_in_place") ? `${mv("dscr_in_place")} DSCR` : mv("debt_yield_in_place") ? `${mv("debt_yield_in_place")} debt yield` : null].filter(Boolean).join(", ");
  const subject = ["Loan request: " + [loan ? usd(loan) : null, PLAYBOOK_SHORT_LABELS[playbook]].filter(Boolean).join(" "), [size && asset ? `${size} ${asset}` : asset, place].filter(Boolean).join(", "), headline, site.legalName.replace(/, Inc\.$/, "")].filter((s) => s && s.trim()).join(" | ");
  const lines: string[] = [];
  const push = (...l: (string | null | undefined | false)[]) => lines.push(...l.filter((x): x is string => typeof x === "string"));
  const kv = (k: string, v: string | null | undefined) => (v ? `  ${`${k}:`.padEnd(18)} ${v}` : null);
  push(`${(lender.primaryContactName ?? "").split(/\s+/)[0] || "Hello"},`, "");
  push(`${site.legalName} is the broker on this request, not the lender. We are asking ${lender.name} for ${STAGE_ASK[stage]} on the loan below. Please reply with yes, no, or what else you need.`, "");
  if (fit.matches.length) push(`Your recorded box: ${fit.matches.join("; ")}.`);
  if (fit.exceptions.length) push(`Outside your recorded box: ${fit.exceptions.join("; ")}.`);
  if (fit.matches.length || fit.exceptions.length) push("");
  push("THE REQUEST");
  push(
    kv("Loan", [loan ? usd(loan) : null, p?.purpose ? LOAN_PURPOSE_LABELS[p.purpose].toLowerCase() : null, p?.lienPosition ? LIEN_POSITION_LABELS[p.lienPosition].toLowerCase() : null].filter(Boolean).join(", ")),
    kv("Structure", [p?.requestedTermMonths ? `${p.requestedTermMonths} months` : null, p?.requestedAmortMonths ? `${Math.round(p.requestedAmortMonths / 12)}-year amortization` : p?.requestedTermMonths ? "interest-only" : null, p?.rateType ? RATE_TYPE_LABELS[p.rateType].toLowerCase() : null, p?.recourse ? RECOURSE_LABELS[p.recourse].toLowerCase() : null].filter(Boolean).join(", ")),
    kv("Closing", p?.targetCloseDate ? `target ${date(p.targetCloseDate)}${p.closeDriver ? ` (${p.closeDriver})` : ""}` : null),
    p?.existingDebtCents ? kv("Existing debt", `${usd(p.existingDebtCents)}${p.existingLender ? ` with ${p.existingLender}` : ""}${p.existingMaturityDate ? `, matures ${date(p.existingMaturityDate)}` : ""}`) : null,
    "",
  );
  push("THE PROPERTY");
  push(
    `  ${[p?.propertyName, p?.maskAddress ? place : ctx.deal.propertyAddress].filter(Boolean).join(", ")}${size && asset ? ` — ${size} ${asset}` : ""}${p?.yearBuilt ? `, built ${p.yearBuilt}` : ""}${p?.yearRenovated ? `, renovated ${p.yearRenovated}` : ""}`,
    kv("Occupancy", p?.occupancyPct !== null && p?.occupancyPct !== undefined ? `${pct(p.occupancyPct)}${p.occupancyAsOf ? ` as of ${date(p.occupancyAsOf)}` : ""} (${sourceLabel(p.fieldSources.occupancyPct)})` : null),
    kv("Purchase price", p?.purchasePriceCents ? `${usd(p.purchasePriceCents)}${p.purchaseCloseDate ? `, closing ${date(p.purchaseCloseDate)}` : ""}` : null),
    kv("As-is value", p?.asIsValueCents ? `${usd(p.asIsValueCents)}${p.asIsValueSource ? ` (${VALUE_SOURCE_LABELS[p.asIsValueSource]}${p.asIsValueAsOf ? `, ${date(p.asIsValueAsOf)}` : ""})` : ""}` : null),
    "",
  );
  push("THE NUMBERS");
  push(kv("NOI in place", p?.noiInPlaceCents !== null && p?.noiInPlaceCents !== undefined ? `${usd(p.noiInPlaceCents)}${p.noiBasis ? ` (${NOI_BASIS_LABELS[p.noiBasis].toLowerCase()}${p.noiPeriodEnd ? ` through ${date(p.noiPeriodEnd)}` : ""}; ${sourceLabel(p.fieldSources.noiInPlaceCents)})` : ""}` : null));
  push(kv("NOI stabilized", p?.noiStabilizedCents !== null && p?.noiStabilizedCents !== undefined ? `${usd(p.noiStabilizedCents)}${p.stabilizationMonths ? ` in about ${p.stabilizationMonths} months` : ""} (Corin pro forma from the sponsor's plan)` : null));
  for (const x of view.metrics.metrics) {
    if (x.value === null || x.key === "sources_minus_uses") continue;
    push(kv(x.label, `${metricValue(x)} (Corin calculation${x.note ? `; ${x.note}` : ""})`));
  }
  push("");
  const sp = ctx.sponsor;
  const strength = view.metrics.sponsorStrength;
  if (sp) {
    push("THE SPONSOR");
    if (sp.experienceSummary) push(`  ${sp.experienceSummary.slice(0, 300)}`);
    const record = [sp.yearsExperience !== null ? `${sp.yearsExperience} years` : null, sp.similarProjectsCount !== null ? `${sp.similarProjectsCount} similar projects` : null, sp.portfolioSizeNote].filter(Boolean).join(", ");
    if (record) push(`  ${record}`);
    if (strength && sp.emailFinancialsMode !== "none") {
      const yn = (b: boolean | null) => (b === null ? "not yet known" : b ? "yes" : "no");
      push(`  Guarantor net worth at or above the loan amount: ${yn(strength.covenants.netWorthOk)}. Liquidity at or above 10% of the loan: ${yn(strength.covenants.liquidityOk)}.`);
      push(`    (${strength.basis === "pfs" ? `from personal financial statements${strength.asOf ? ` dated ${date(strength.asOf)}` : ""}` : `as stated by the sponsor${strength.asOf ? ` on ${date(strength.asOf)}` : ""}`}; figures are in the summary)`);
    }
    if (sp.creditBand) push(`  Credit: ${CREDIT_BAND_LABELS[sp.creditBand]}${Object.values(sp.creditEvents).some((e) => e?.occurred) ? '; see "Known issues"' : creditEventKinds.every((k) => sp.creditEvents[k]) ? "; no bankruptcies, foreclosures or open litigation reported" : ""}`);
    push("");
  }
  if (p?.businessPlan || p?.exitStrategy) {
    push("THE PLAN AND THE EXIT");
    if (p.businessPlan) push(`  ${p.businessPlan.slice(0, 600)}`);
    if (p.exitStrategy) push(`  Exit: ${EXIT_STRATEGY_LABELS[p.exitStrategy].toLowerCase()}${p.exitMonths ? ` in about ${p.exitMonths} months` : ""}.${p.exitDetail ? ` ${p.exitDetail.slice(0, 300)}` : ""}`);
    push("");
  }
  if (p?.sources.length || p?.uses.length) {
    const total = (l: { amountCents: number }[]) => usd(l.reduce((s, x) => s + x.amountCents, 0));
    push("SOURCES AND USES");
    if (p.sources.length) push(`  Sources: ${p.sources.map((s) => `${SOURCE_KIND_LABELS[s.kind].toLowerCase()} ${usd(s.amountCents)}`).join("; ")} = ${total(p.sources)}`);
    if (p.uses.length) push(`  Uses:    ${p.uses.map((u) => `${USE_KIND_LABELS[u.kind].toLowerCase()} ${usd(u.amountCents)}`).join("; ")} = ${total(p.uses)}`);
    push("");
  }
  if (p?.risks.length) {
    push("KNOWN ISSUES");
    for (const r of p.risks) push(`  - ${r.risk}: ${r.mitigant}`);
    push("");
  }
  const notYet = readiness.required.filter((r) => !r.met).map((r) => r.label);
  push("IN THE PACKAGE");
  push(`  Deal summary (PDF)${ctx.vaultDocuments.length ? `; ${ctx.vaultDocuments.map((d) => d.fileName.replace(/\.[a-z0-9]+$/i, "")).join("; ")}` : ""}`);
  if (notYet.length) push(`  Not yet in hand: ${notYet.join("; ")}`);
  push("");
  push(`Secure link for ${lender.name} only (expires ${EMAIL_PLACEHOLDERS.linkExpires}):`, EMAIL_PLACEHOLDERS.shareLink, "");
  push(`${advisor.name}${advisor.title ? `, ${advisor.title}` : ""}${advisor.dreLicense ? ` · DRE ${advisor.dreLicense}` : ""}`, [advisor.email, advisor.phone].filter(Boolean).join(" · "), "");
  push(
    `${site.legalName} arranges loans as a broker and does not lend. Figures come from the borrower's documents and Corin's calculations as labeled; your institution performs its own underwriting and makes every credit decision. This is a request for terms, not a commitment by any party. Confidential: for ${lender.name}'s credit review only. Please do not forward the link.`,
    licenseLine(),
  );
  const text = lines.join("\n");
  return { subject: subject.slice(0, 200), text, sha256: createHash("sha256").update(text, "utf8").digest("hex") };
}

// --- Outreach glue (PHASE2: wire to lib/deals/submission/send.ts) ----------------------------------

function assetClassOf(playbook: SubmissionPlaybook, assetType: string | null): AssetClass | null {
  if (playbook === "construction") return "CONSTRUCTION";
  if (!assetType) return null;
  if (SENIOR.has(assetType) || assetType === "HOTEL_TO_SENIOR_CONVERSION") return "SENIOR_LIVING";
  if (HOTELS.has(assetType)) return "HOSPITALITY";
  if (["MULTIFAMILY", "RESIDENTIAL_2_4", "MANUFACTURED_HOUSING", "SFR_1_4"].includes(assetType)) return "MULTIFAMILY";
  return "COMMERCIAL";
}

/** The matcher profile from computed metrics and the profile (no typed ratio anywhere). */
function matchingOverrides(view: SubmissionView): ProfileOverrides {
  const d = matchingDefaults(view);
  const m = (k: MetricKey) => metricOf(view, k)?.value ?? null;
  const out: ProfileOverrides = {};
  const ltv = m("ltv_as_is");
  const ltc = m("ltc");
  const dy = m("debt_yield_in_place");
  if (ltv !== null) out.ltvPct = ltv;
  if (ltc !== null) out.ltcPct = ltc;
  if (dy !== null) out.debtYieldPct = dy;
  if (d.dscr !== null) out.dscr = d.dscr;
  if (d.assetClass) out.assetClass = d.assetClass;
  if (d.lien) out.lienPosition = d.lien;
  if (d.nonRecourse) out.requiresNonRecourse = true;
  if (d.closeDays !== null) out.targetCloseDays = d.closeDays;
  const brand = view.ctx.profile?.programDetails.hotel?.brand;
  if (brand) out.franchise = brand.slice(0, 120);
  return out;
}

function executiveSummaryInput(view: SubmissionView, staff: StaffSession) {
  const p = view.ctx.profile;
  const m = (k: MetricKey) => metricOf(view, k)?.value ?? null;
  const d = matchingDefaults(view);
  const spreads: PackageSpreads = {
    asOf: view.ctx.spreads?.asOf ?? null,
    noiCents: d.noiCents,
    underwrittenNoiCents: view.ctx.spreads?.underwrittenNoiCents ?? null,
    valueCents: d.valueCents,
    costCents: d.costCents,
    ltvPct: m("ltv_as_is"),
    ltcPct: m("ltc"),
    dscr: d.dscr,
    debtYieldPct: m("debt_yield_in_place"),
    occupancyPct: d.occupancyPct,
    revenueCents: p?.revenueCents ?? null,
    expensesCents: p?.expensesCents ?? null,
    units: p?.sizeCount ?? null,
    unitLabel: p?.sizeUnit ? SIZE_UNIT_LABELS[p.sizeUnit] : null,
  };
  return {
    asOf: asOfOf(view),
    assetClass: d.assetClass,
    spreads,
    highlights: p?.highlights ?? [],
    risks: (p?.risks ?? []).map((r) => `${r.risk}: ${r.mitigant}`),
    purpose: p?.purpose ? `${LOAN_PURPOSE_LABELS[p.purpose]}${p.cashOutUse ? `; ${p.cashOutUse}` : ""}` : null,
    advisor: { name: staff.name, email: staff.email, dreLicense: staff.dreLicense },
  };
}

/** Labels of sections, for messages ("Loan request saved."). */
export function sectionLabel(id: SectionId): string {
  return SECTION_LABELS[id];
}
