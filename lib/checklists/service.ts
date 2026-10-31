// Checklist desk operations: create a deal's checklist from its program
// template, keep per-principal items in step with the ownership chart, review
// items and conditions, take portal uploads, and answer the closing question
// (checklist + conditions + sanctions screening + holds) for the pipeline.

import { randomUUID } from "node:crypto";
import { buildOrgChart } from "@/lib/principals/org-chart";
import { principalObligations } from "@/lib/principals/requirements";
import type { PrincipalStore } from "@/lib/principals/store";
import { toPublicPrincipal } from "@/lib/principals/service";
import { screeningGate, type ScreeningGate } from "@/lib/screening/policy";
import type { DealHold, DealHoldStore, ScreeningStore } from "@/lib/screening/store";
import { conditionsBlockingClosing, newConditionSchema, transitionCondition, type Condition, type ConditionStatus, type NewCondition } from "./conditions";
import { cslbVerificationSchema, evaluateCslb, type CslbVerificationInput } from "./cslb";
import { checklistReadiness, instantiateItems, ItemTransitionError, RETIRED_REASON, syncPrincipalItems, transitionItem, type ItemActor, type Readiness } from "./engine";
import { hmMetrics, hmUnderwritingSchema, type HmUnderwriting, type HmUnderwritingInput } from "./hm-underwriting";
import type { ChecklistStore } from "./store";
import { templateFor } from "./templates";
import { PROGRAM_LABEL, type ChecklistItemFile, type ChecklistProgram, type DealChecklist, type DealChecklistItem, type ItemStatus } from "./types";
import { bytesMatchType, checklistStoragePath, MAX_FILES_PER_ITEM, uploadRequestSchema, type AllowedType, type UploadRequest } from "./uploads";

/** Private vault bucket access for checklist uploads. */
export interface ChecklistObjectStorage {
  createSignedUploadUrl(path: string): Promise<{ url: string; token: string }>;
  /** First `bytes` bytes of the stored object, or null when it does not exist. */
  readHead(path: string, bytes: number): Promise<Uint8Array | null>;
  remove(path: string): Promise<void>;
}

export type ChecklistDeps = {
  checklists: ChecklistStore;
  principals: PrincipalStore;
  screenings: ScreeningStore;
  holds: DealHoldStore;
  storage?: ChecklistObjectStorage | null;
  now?: () => Date;
};

export class ChecklistError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ChecklistError";
  }
}

const now = (deps: { now?: () => Date }) => deps.now?.() ?? new Date();

async function obligationsFor(deps: ChecklistDeps, dealId: string, programs: ChecklistProgram[]) {
  const principals = (await deps.principals.forDeal(dealId)).map(toPublicPrincipal);
  return principalObligations(programs, principals, buildOrgChart(principals));
}

export async function createDealChecklist(deps: ChecklistDeps, input: { dealId: string; program: ChecklistProgram; leadId?: string | null; createdBy: string }): Promise<{ checklist: DealChecklist; items: DealChecklistItem[] }> {
  const template = templateFor(input.program);
  const obligations = await obligationsFor(deps, input.dealId, [input.program]);
  return deps.checklists.createChecklist(
    { dealId: input.dealId, leadId: input.leadId ?? null, program: input.program, templateVersion: template.version, title: template.title || PROGRAM_LABEL[input.program], createdBy: input.createdBy },
    instantiateItems(template, input.dealId, obligations),
    now(deps),
  );
}

/** Re-expands per-principal items on every checklist of the deal after the chart changes. */
export async function syncDealPrincipalItems(deps: ChecklistDeps, dealId: string): Promise<{ added: number; retired: number; revived: number }> {
  const checklists = await deps.checklists.checklistsForDeal(dealId);
  const all = await deps.checklists.itemsForDeal(dealId);
  let added = 0;
  let retired = 0;
  let revived = 0;
  for (const c of checklists) {
    const obligations = await obligationsFor(deps, dealId, [c.program]);
    const items = all.filter((i) => i.checklistId === c.id);
    const sync = syncPrincipalItems(templateFor(c.program), dealId, items, obligations);
    added += (await deps.checklists.insertItems(c.id, sync.add, now(deps))).length;
    for (const r of sync.retire) {
      await deps.checklists.updateItem(r.id, r.version, { status: "not_applicable", waivedReason: RETIRED_REASON, reviewedBy: "system:principals", reviewedAt: now(deps).toISOString() }, now(deps));
      retired++;
    }
    for (const r of sync.revive) {
      await deps.checklists.updateItem(r.id, r.version, { status: "requested", waivedReason: null }, now(deps));
      revived++;
    }
  }
  return { added, retired, revived };
}

export async function moveItem(deps: ChecklistDeps, input: { itemId: string; expectedVersion: number; to: ItemStatus; actor: ItemActor; note?: string | null; documentDate?: string | null; dealId?: string }): Promise<DealChecklistItem> {
  const item = await deps.checklists.getItem(input.itemId);
  if (!item || (input.dealId && item.dealId !== input.dealId)) throw new ChecklistError("Checklist item not found.", 404);
  if (item.version !== input.expectedVersion) throw new ChecklistError("This item changed since you loaded it; reload and try again.", 409);
  let patch;
  try {
    patch = transitionItem(item, { to: input.to, actor: input.actor, note: input.note, documentDate: input.documentDate, now: now(deps) });
  } catch (err) {
    if (err instanceof ItemTransitionError) throw new ChecklistError(err.message);
    throw err;
  }
  if (input.to === "accepted" && item.lookup === "cslb_license" && (item.verification as { satisfied?: boolean } | null)?.satisfied !== true) {
    throw new ChecklistError("Verify the contractor's license on CSLB before accepting this item.");
  }
  return deps.checklists.updateItem(item.id, item.version, patch, now(deps));
}

/** Records a CSLB license check on a `cslb_license` item. */
export async function recordContractorLicense(deps: ChecklistDeps, input: { itemId: string; expectedVersion: number; verification: CslbVerificationInput; staffEmail: string; source?: "cslb_manual" | "cslb_api"; closingDate?: Date }) {
  const item = await deps.checklists.getItem(input.itemId);
  if (!item) throw new ChecklistError("Checklist item not found.", 404);
  if (item.lookup !== "cslb_license") throw new ChecklistError("This item does not take a contractor license check.");
  const parsed = cslbVerificationSchema.safeParse(input.verification);
  if (!parsed.success) throw new ChecklistError(parsed.error.issues[0]?.message ?? "Check the license details.");
  const v = evaluateCslb(parsed.data, { now: now(deps), checkedBy: input.staffEmail, source: input.source ?? "cslb_manual", closingDate: input.closingDate });
  return deps.checklists.updateItem(item.id, input.expectedVersion, { verification: v as unknown as Record<string, unknown> }, now(deps));
}

// --- Conditions ------------------------------------------------------------------------------------

export async function addCondition(deps: ChecklistDeps, input: NewCondition, createdBy: string): Promise<Condition> {
  const parsed = newConditionSchema.safeParse(input);
  if (!parsed.success) throw new ChecklistError(parsed.error.issues[0]?.message ?? "Check the condition.");
  const d = parsed.data;
  if (d.checklistItemId) {
    const item = await deps.checklists.getItem(d.checklistItemId);
    if (!item || item.dealId !== d.dealId) throw new ChecklistError("The linked checklist item is not on this deal.");
  }
  return deps.checklists.insertCondition({ dealId: d.dealId, source: d.source, lenderName: d.lenderName ?? null, timing: d.timing, description: d.description, responsible: d.responsible, dueDate: d.dueDate ?? null, checklistItemId: d.checklistItemId ?? null, notes: d.notes ?? null, createdBy }, now(deps));
}

export async function moveCondition(deps: ChecklistDeps, input: { conditionId: string; expectedVersion: number; to: ConditionStatus; staffEmail: string; note?: string | null; waiverEvidence?: string | null }): Promise<Condition> {
  const c = await deps.checklists.getCondition(input.conditionId);
  if (!c) throw new ChecklistError("Condition not found.", 404);
  if (c.version !== input.expectedVersion) throw new ChecklistError("This condition changed since you loaded it; reload and try again.", 409);
  try {
    const patch = transitionCondition(c, { to: input.to, staffId: input.staffEmail, note: input.note, waiverEvidence: input.waiverEvidence, now: now(deps) });
    return await deps.checklists.updateCondition(c.id, c.version, patch, now(deps));
  } catch (err) {
    if (err instanceof Error && err.name === "ConditionTransitionError") throw new ChecklistError(err.message);
    throw err;
  }
}

// --- Hard money underwriting -------------------------------------------------------------------------

export async function saveHmUnderwriting(deps: ChecklistDeps, input: HmUnderwritingInput, preparedBy: string, expectedVersion: number | null): Promise<HmUnderwriting> {
  const parsed = hmUnderwritingSchema.safeParse(input);
  if (!parsed.success) throw new ChecklistError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const t = now(deps);
  return deps.checklists.saveHmUnderwriting(parsed.data, hmMetrics(parsed.data, t), preparedBy, expectedVersion, t);
}

// --- Portal uploads --------------------------------------------------------------------------------

export type PortalPrincipalScope = { dealId: string; principalId: string | null; email: string };

function assertBorrowerItem(item: DealChecklistItem | null, scope: PortalPrincipalScope): DealChecklistItem {
  if (!item || item.dealId !== scope.dealId) throw new ChecklistError("Checklist item not found.", 404);
  if (item.responsible !== "borrower" || !item.upload) throw new ChecklistError("This item is not uploaded through the portal.", 403);
  if (scope.principalId && item.principalId && item.principalId !== scope.principalId) throw new ChecklistError("This item belongs to another principal.", 403);
  if (!["requested", "rejected", "submitted"].includes(item.status)) throw new ChecklistError("Your advisor already has this item.", 409);
  return item;
}

export async function startPortalUpload(deps: ChecklistDeps, scope: PortalPrincipalScope, request: UploadRequest): Promise<{ file: ChecklistItemFile; uploadUrl: string; uploadToken: string }> {
  if (!deps.storage) throw new ChecklistError("Uploads are not available right now. Email your documents to docs@kuberacommercial.com.", 503);
  const req = uploadRequestSchema.parse(request);
  const item = assertBorrowerItem(await deps.checklists.getItem(req.itemId), scope);
  if ((await deps.checklists.countFiles(item.id)) >= MAX_FILES_PER_ITEM) throw new ChecklistError(`This item already has ${MAX_FILES_PER_ITEM} files. Ask your advisor before adding more.`, 429);
  const id = randomUUID();
  const path = checklistStoragePath(scope.dealId, item.id, req.fileName, req.contentType, id);
  const signed = await deps.storage.createSignedUploadUrl(path);
  const file = await deps.checklists.insertFile({ id, itemId: item.id, dealId: scope.dealId, storagePath: path, fileName: req.fileName.slice(0, 200), contentType: req.contentType, sizeBytes: req.sizeBytes, status: "pending_upload", uploadedBy: scope.email }, now(deps));
  return { file, uploadUrl: signed.url, uploadToken: signed.token };
}

/** After the browser's upload: check the stored bytes match the declared type, then mark the item received. */
export async function completePortalUpload(deps: ChecklistDeps, scope: PortalPrincipalScope, fileId: string): Promise<{ file: ChecklistItemFile; item: DealChecklistItem }> {
  if (!deps.storage) throw new ChecklistError("Uploads are not available right now.", 503);
  const file = await deps.checklists.getFile(fileId);
  if (!file || file.dealId !== scope.dealId || file.uploadedBy !== scope.email) throw new ChecklistError("Upload not found.", 404);
  if (file.status !== "pending_upload") throw new ChecklistError("This upload was already completed.", 409);
  const item = assertBorrowerItem(await deps.checklists.getItem(file.itemId), scope);
  const head = await deps.storage.readHead(file.storagePath, 512);
  if (!head) throw new ChecklistError("We did not receive the file. Please try the upload again.", 409);
  if (!bytesMatchType(head, file.contentType as AllowedType)) {
    await deps.storage.remove(file.storagePath).catch(() => {});
    await deps.checklists.updateFile(file.id, { status: "rejected", rejectReason: "File contents do not match its type." });
    throw new ChecklistError("That file does not look like the type it claims to be. Upload a PDF, Excel, CSV, PNG or JPEG file.", 422);
  }
  const t = now(deps);
  const done = await deps.checklists.updateFile(file.id, { status: "uploaded", uploadedAt: t.toISOString() });
  const patch = transitionItem(item, { to: "submitted", actor: { kind: "borrower", principalId: scope.principalId, email: scope.email }, now: t });
  const updated = item.status === "submitted" ? item : await deps.checklists.updateItem(item.id, item.version, patch, t);
  return { file: done, item: updated };
}

/** Marks a portal-captured item received (PFS, REO schedule, credit authorization, 1919, 2530). */
export async function markCapturedInPortal(deps: ChecklistDeps, dealId: string, principalId: string, templateKeys: readonly string[]): Promise<number> {
  const items = await deps.checklists.itemsForDeal(dealId);
  let n = 0;
  for (const i of items) {
    if (i.principalId !== principalId || !templateKeys.includes(i.templateKey) || !["requested", "rejected"].includes(i.status)) continue;
    await deps.checklists.updateItem(i.id, i.version, transitionItem(i, { to: "submitted", actor: { kind: "system", id: "system:portal" }, now: now(deps) }), now(deps));
    n++;
  }
  return n;
}

// --- Closing gate ------------------------------------------------------------------------------------

export type DealClosingGate = {
  ready: boolean;
  /** On hold (possible or confirmed sanctions match): nothing advances. */
  held: boolean;
  holds: DealHold[];
  checklists: { checklist: DealChecklist; readiness: Readiness }[];
  openConditions: Condition[];
  screening: ScreeningGate;
  chartIssues: string[];
  reasons: string[];
};

/**
 * The WS-U part of "may this deal go to closing?": every checklist ready,
 * no open pre-closing conditions, every principal screened clear within the
 * rescreen window, and no active holds. The pipeline combines it with the
 * MLDS and broker-of-record gates (lib/compliance/gates.ts).
 */
export async function dealClosingGate(deps: ChecklistDeps, dealId: string, closingDate?: Date): Promise<DealClosingGate> {
  const t = now(deps);
  const [checklists, items, conditions, principalRows, screenings, holds] = await Promise.all([
    deps.checklists.checklistsForDeal(dealId),
    deps.checklists.itemsForDeal(dealId),
    deps.checklists.conditionsForDeal(dealId),
    deps.principals.forDeal(dealId),
    deps.screenings.forDeal(dealId),
    deps.holds.active(dealId),
  ]);
  const principals = principalRows.map(toPublicPrincipal);
  const chart = buildOrgChart(principals);
  const perChecklist = checklists.map((c) => ({ checklist: c, readiness: checklistReadiness(items.filter((i) => i.checklistId === c.id), { now: t, closingDate }) }));
  const openConditions = conditionsBlockingClosing(conditions);
  const screening = screeningGate({ subjects: principals.map((p) => ({ principalId: p.id, name: p.legalName })), screenings, closingDate, now: t });

  const reasons: string[] = [];
  if (checklists.length === 0) reasons.push("No document checklist on this deal.");
  for (const c of perChecklist) if (!c.readiness.ready) reasons.push(`${c.checklist.title}: ${c.readiness.blocking.length} item(s) outstanding.`);
  if (openConditions.length) reasons.push(`${openConditions.length} condition(s) open before closing.`);
  if (principals.length === 0) reasons.push("No principals on file.");
  for (const issue of chart.issues) reasons.push(`Ownership chart: ${issue}`);
  for (const h of holds) reasons.push(`On hold: ${h.detail}`);
  for (const r of screening.holdReasons) if (!holds.length) reasons.push(r);
  for (const b of screening.blocking) reasons.push(`Screening — ${b.name}: ${b.reason}`);

  const held = holds.length > 0 || screening.held;
  return { ready: reasons.length === 0 && !held, held, holds, checklists: perChecklist, openConditions, screening, chartIssues: chart.issues, reasons };
}
