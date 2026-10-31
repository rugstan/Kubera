// Checklist engine (pure): instantiate a program template for a deal, expand
// per-principal items from the ownership chart, move items through review,
// and decide whether the checklist is ready for closing.

import type { PrincipalObligations } from "@/lib/principals/requirements";
import { SATISFIED_STATUSES, type ChecklistItemDef, type ChecklistTemplate, type DealChecklistItem, type ItemStatus } from "./types";

export type NewChecklistItem = Omit<DealChecklistItem, "id" | "checklistId" | "version" | "createdAt" | "updatedAt">;

const DAY = 86_400_000;

function fromDef(def: ChecklistItemDef, dealId: string, sortOrder: number, principal?: { id: string; name: string }): NewChecklistItem {
  return {
    dealId,
    itemKey: principal ? `${def.key}:${principal.id}` : def.key,
    templateKey: def.key,
    principalId: principal?.id ?? null,
    title: principal ? `${def.title} — ${principal.name}` : def.title,
    description: def.description,
    category: def.category,
    responsible: def.responsible,
    stage: def.stage,
    required: def.required,
    upload: def.upload,
    docKind: def.docKind ?? null,
    recencyDays: def.recencyDays ?? null,
    lookup: def.lookup ?? null,
    status: "requested",
    documentDate: null,
    dueDate: null,
    submittedAt: null,
    reviewedAt: null,
    reviewedBy: null,
    reviewNote: null,
    waivedReason: null,
    verification: null,
    sortOrder,
  };
}

/**
 * Items for a new deal checklist. Per-principal definitions expand to one
 * instance per principal that owes the requirement (none yet → no instance;
 * `syncPrincipalItems` adds them as principals are added).
 */
export function instantiateItems(template: ChecklistTemplate, dealId: string, obligations: ReadonlyMap<string, PrincipalObligations> = new Map()): NewChecklistItem[] {
  const out: NewChecklistItem[] = [];
  template.items.forEach((def, idx) => {
    const base = idx * 100;
    if (!def.perPrincipal) {
      out.push(fromDef(def, dealId, base));
      return;
    }
    let n = 1;
    for (const ob of obligations.values()) {
      if (ob.requirements.has(def.perPrincipal)) out.push(fromDef(def, dealId, base + n++, { id: ob.principalId, name: ob.legalName }));
    }
  });
  return out;
}

export type PrincipalSync = {
  add: NewChecklistItem[];
  /** Untouched instances for principals who no longer owe the item: mark not applicable. */
  retire: DealChecklistItem[];
  /** Instances retired earlier whose principal owes the item again: back to requested. */
  revive: DealChecklistItem[];
};

/** Reconciles per-principal items with the current obligations. Never deletes work already submitted. */
export function syncPrincipalItems(template: ChecklistTemplate, dealId: string, existing: readonly DealChecklistItem[], obligations: ReadonlyMap<string, PrincipalObligations>): PrincipalSync {
  const wanted = instantiateItems(template, dealId, obligations).filter((i) => i.principalId);
  const have = new Map(existing.map((i) => [i.itemKey, i]));
  const wantedKeys = new Set(wanted.map((w) => w.itemKey));
  const add = wanted.filter((w) => !have.has(w.itemKey));
  const retire = existing.filter((i) => i.principalId && !wantedKeys.has(i.itemKey) && i.status === "requested");
  // An instance retired earlier comes back when the principal owes it again.
  const revive = existing.filter((i) => i.principalId && wantedKeys.has(i.itemKey) && i.status === "not_applicable" && i.waivedReason === RETIRED_REASON);
  return { add, retire, revive };
}

export const RETIRED_REASON = "Principal no longer owes this item.";

// --- Transitions -------------------------------------------------------------------------------

export type ItemActor = { kind: "staff"; id: string } | { kind: "borrower"; principalId: string | null; email: string } | { kind: "system"; id: string };

export class ItemTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ItemTransitionError";
  }
}

/** Status changes staff can make from each status (the desk offers exactly these). */
export const STAFF_MOVES: Record<ItemStatus, readonly ItemStatus[]> = {
  requested: ["submitted", "accepted", "waived", "not_applicable"],
  submitted: ["under_review", "accepted", "rejected", "waived"],
  under_review: ["accepted", "rejected", "waived"],
  rejected: ["submitted", "accepted", "waived", "not_applicable", "requested"],
  accepted: ["requested", "rejected"],
  waived: ["requested"],
  not_applicable: ["requested"],
};

export type TransitionInput = {
  to: ItemStatus;
  actor: ItemActor;
  note?: string | null;
  /** Date on the document, required to accept an item with a recency window. */
  documentDate?: string | null;
  now: Date;
};

export type ItemPatch = Partial<Pick<DealChecklistItem, "status" | "documentDate" | "submittedAt" | "reviewedAt" | "reviewedBy" | "reviewNote" | "waivedReason">>;

/** Validates a status change and returns the fields to write. */
export function transitionItem(item: DealChecklistItem, input: TransitionInput): ItemPatch {
  const { to, actor, now } = input;
  const at = now.toISOString();
  const note = input.note?.trim() || null;

  if (actor.kind === "borrower") {
    if (to !== "submitted") throw new ItemTransitionError("Borrowers can only submit items.");
    if (item.responsible !== "borrower") throw new ItemTransitionError("This item is not one you provide.");
    if (actor.principalId && item.principalId && item.principalId !== actor.principalId) throw new ItemTransitionError("This item belongs to another principal.");
    if (!["requested", "rejected", "submitted"].includes(item.status)) throw new ItemTransitionError("This item is already with your advisor.");
    return { status: "submitted", submittedAt: at };
  }

  // Automations (portal data captured, a vendor report arriving) can only mark items received; people review.
  if (actor.kind === "system" && to !== "submitted") throw new ItemTransitionError("Only staff can review checklist items.");
  if (!STAFF_MOVES[item.status].includes(to)) throw new ItemTransitionError(`Cannot move an item from ${item.status} to ${to}.`);
  const reviewer = actor.id;
  switch (to) {
    case "submitted":
      return { status: "submitted", submittedAt: at };
    case "under_review":
      return { status: "under_review", reviewedBy: reviewer, reviewedAt: at };
    case "accepted": {
      const documentDate = input.documentDate ?? item.documentDate;
      if (item.recencyDays && !documentDate) throw new ItemTransitionError("Enter the document date: this item must be current at closing.");
      if (documentDate && !/^\d{4}-\d{2}-\d{2}$/.test(documentDate)) throw new ItemTransitionError("Document date must be YYYY-MM-DD.");
      if (documentDate && Date.parse(`${documentDate}T00:00:00Z`) > now.getTime() + DAY) throw new ItemTransitionError("Document date cannot be in the future.");
      return { status: "accepted", documentDate: documentDate ?? null, reviewedBy: reviewer, reviewedAt: at, reviewNote: note, waivedReason: null };
    }
    case "rejected":
      if (!note) throw new ItemTransitionError("Tell the borrower what to fix.");
      return { status: "rejected", reviewedBy: reviewer, reviewedAt: at, reviewNote: note };
    case "waived":
    case "not_applicable":
      if (!note || note.length < 5) throw new ItemTransitionError("Give a reason (at least 5 characters).");
      return { status: to, reviewedBy: reviewer, reviewedAt: at, waivedReason: note };
    case "requested":
      return { status: "requested", reviewedBy: reviewer, reviewedAt: at, reviewNote: note, waivedReason: null };
  }
}

// --- Readiness ---------------------------------------------------------------------------------------

export type Readiness = {
  ready: boolean;
  total: number;
  requiredTotal: number;
  requiredSatisfied: number;
  /** Share of required items satisfied, 0–100. */
  percent: number;
  blocking: { itemId: string; title: string; reason: string }[];
};

/** Whether an accepted item's document is too old on the reference date. */
export function isStale(item: DealChecklistItem, ref: Date): boolean {
  if (item.status !== "accepted" || !item.recencyDays || !item.documentDate) return false;
  return (ref.getTime() - Date.parse(`${item.documentDate}T00:00:00Z`)) / DAY > item.recencyDays;
}

export function checklistReadiness(items: readonly DealChecklistItem[], opts: { now: Date; closingDate?: Date }): Readiness {
  const ref = opts.closingDate ?? opts.now;
  const required = items.filter((i) => i.required);
  const blocking: Readiness["blocking"] = [];
  let satisfied = 0;
  for (const i of required) {
    if (!SATISFIED_STATUSES.includes(i.status)) {
      blocking.push({ itemId: i.id, title: i.title, reason: i.status === "rejected" ? "Needs a corrected document." : i.status === "requested" ? "Not received." : "Waiting on review." });
      continue;
    }
    if (isStale(i, ref)) {
      blocking.push({ itemId: i.id, title: i.title, reason: `Out of date at closing (dated ${i.documentDate}; must be within ${i.recencyDays} days).` });
      continue;
    }
    if (i.lookup === "cslb_license" && i.status === "accepted" && (i.verification as { satisfied?: boolean } | null)?.satisfied !== true) {
      blocking.push({ itemId: i.id, title: i.title, reason: "Contractor license not verified active on CSLB." });
      continue;
    }
    satisfied++;
  }
  const percent = required.length === 0 ? 100 : Math.floor((satisfied / required.length) * 100);
  return { ready: blocking.length === 0, total: items.length, requiredTotal: required.length, requiredSatisfied: satisfied, percent, blocking };
}

/** Items the borrower still owes (portal list and reminder feed for WS-R). */
export function outstandingForBorrower(items: readonly DealChecklistItem[], principalId?: string | null): DealChecklistItem[] {
  return items
    .filter((i) => i.responsible === "borrower" && (i.status === "requested" || i.status === "rejected"))
    .filter((i) => !principalId || !i.principalId || i.principalId === principalId)
    .sort((a, b) => Number(b.required) - Number(a.required) || a.sortOrder - b.sortOrder);
}
